<?php

if (!defined("ABSPATH")) {
    exit;
}

/**
 * WooCommerce bridge for public catalog sync and privacy-safe order tools.
 *
 * WooCommerce remains the source of truth. Product changes are sent to the
 * AlphaRecall index through a durable local queue. Order events contain no
 * customer identity, address, payment data, or order key. Live order details
 * are returned only after the supplied checkout email matches exactly.
 */
class AlphaRecall_WooCommerce
{
    private static ?AlphaRecall_WooCommerce $instance = null;
    private const CONFIG_OPTION = "alpharecall_woocommerce";
    private const QUEUE_OPTION = "alpharecall_woocommerce_queue";
    private const STATS_OPTION = "alpharecall_woocommerce_stats";
    private const QUEUE_LOCK_OPTION = "alpharecall_woocommerce_queue_lock";
    private const WORKER_HOOK = "alpharecall_woocommerce_process_queue";
    private const DEFERRED_HOOK = "alpharecall_woocommerce_deferred_event";
    private const ACTION_GROUP = "alpharecall-woocommerce";
    private const MAX_QUEUE = 500;
    private const MAX_BATCH = 20;
    private const MAX_ATTEMPTS = 5;

    public static function get_instance(): AlphaRecall_WooCommerce
    {
        if (!self::$instance) {
            self::$instance = new AlphaRecall_WooCommerce();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action(self::WORKER_HOOK, [$this, "process_queue"]);
        add_action(self::DEFERRED_HOOK, [$this, "queue_deferred_event"], 10, 2);
        add_action("woocommerce_new_product", [$this, "product_created"]);
        add_action("woocommerce_update_product", [$this, "product_updated"]);
        add_action("woocommerce_before_delete_product", [$this, "product_deleted"]);
        add_action("woocommerce_new_product_variation", [$this, "variation_changed"]);
        add_action("woocommerce_update_product_variation", [$this, "variation_changed"]);
        add_action("woocommerce_before_delete_product_variation", [$this, "variation_changed"]);
        add_action("woocommerce_product_set_stock", [$this, "stock_changed"]);
        add_action("woocommerce_variation_set_stock", [$this, "stock_changed"]);
        add_action("wp_trash_post", [$this, "post_trashed"]);
        add_action("untrashed_post", [$this, "post_untrashed"]);
        add_action("woocommerce_new_order", [$this, "order_created"], 10, 2);
        add_action("woocommerce_order_status_changed", [$this, "order_updated"], 10, 4);
        add_action("woocommerce_order_refunded", [$this, "order_refunded"], 10, 2);
        add_action("init", [$this, "ensure_worker_scheduled"], 20);
    }

    public static function deactivate(): void
    {
        wp_clear_scheduled_hook(self::WORKER_HOOK);
        wp_clear_scheduled_hook(self::DEFERRED_HOOK);
        delete_option(self::QUEUE_LOCK_OPTION);
    }

    public function get_connection(): array
    {
        $config = $this->get_config();
        $stats = $this->get_stats();
        $available = $this->is_available();
        $status = empty($config["enabled"])
            ? "disabled"
            : ($available ? "enabled" : "error");

        return [
            "slug" => "woocommerce",
            "status" => $status,
            "plugin_detected" => $available,
            "plugin_version" => $this->plugin_version(),
            "store_url" => home_url(),
            "currency" => $available ? get_woocommerce_currency() : null,
            "hpos_enabled" => $available ? $this->hpos_enabled() : false,
            "product_count" => $available ? $this->product_count() : 0,
            "config" => $config,
            "queue_count" => count($this->get_queue()),
            "last_delivery_at" => $stats["last_delivery_at"] ?? null,
            "last_success_at" => $stats["last_success_at"] ?? null,
            "last_error_at" => $stats["last_error_at"] ?? null,
            "last_error" => $stats["last_error"] ?? null,
            "delivered_count" => (int) ($stats["delivered_count"] ?? 0),
            "failed_count" => (int) ($stats["failed_count"] ?? 0),
        ];
    }

    public function save_connection(array $input): array|WP_Error
    {
        $config = $this->sanitize_config($input);
        $validation = $this->validate_config($config);
        if (!empty($config["enabled"]) && is_wp_error($validation)) {
            return $validation;
        }
        $tenant_id = $this->tenant_id();
        if (!$tenant_id) {
            return new WP_Error("alpharecall_woocommerce_tenant", "Website not configured.", ["status" => 400]);
        }
        $result = AlphaRecall_Client::get_instance()->update_woocommerce_integration(
            $tenant_id,
            $this->backend_payload($config)
        );
        if (is_wp_error($result)) {
            return $result;
        }
        $this->write_option(self::CONFIG_OPTION, $config);
        if (empty($config["enabled"])) {
            wp_clear_scheduled_hook(self::WORKER_HOOK);
        } else {
            $this->ensure_worker_scheduled();
        }
        return $this->get_connection();
    }

    public function disconnect(): array|WP_Error
    {
        $tenant_id = $this->tenant_id();
        if ($tenant_id) {
            $result = AlphaRecall_Client::get_instance()->delete_woocommerce_integration($tenant_id);
            if (is_wp_error($result)) {
                $data = $result->get_error_data();
                $status = is_array($data) ? (int) ($data["status"] ?? 0) : 0;
                if ($status !== 404) {
                    return $result;
                }
            }
        }
        $config = $this->get_config();
        $config["enabled"] = false;
        $this->write_option(self::CONFIG_OPTION, $config);
        $this->write_option(self::QUEUE_OPTION, []);
        wp_clear_scheduled_hook(self::WORKER_HOOK);
        return $this->get_connection();
    }

    public function test_connection(array $input = []): array|WP_Error
    {
        $config = $this->sanitize_config($input);
        $validation = $this->validate_config($config, true);
        if (is_wp_error($validation)) {
            return $validation;
        }
        $tenant_id = $this->tenant_id();
        if (!$tenant_id) {
            return new WP_Error("alpharecall_woocommerce_tenant", "Website not configured.", ["status" => 400]);
        }
        $client = AlphaRecall_Client::get_instance();
        $registered = $client->update_woocommerce_integration(
            $tenant_id,
            $this->backend_payload($config)
        );
        if (is_wp_error($registered)) {
            return $registered;
        }
        return $client->test_woocommerce_integration($tenant_id);
    }

    public function sync_products(): array|WP_Error
    {
        $config = $this->get_config();
        if (empty($config["enabled"]) || empty($config["sync_products"])) {
            return new WP_Error("alpharecall_woocommerce_sync", "Product synchronization is disabled.", ["status" => 400]);
        }
        $tenant_id = $this->tenant_id();
        if (!$tenant_id) {
            return new WP_Error("alpharecall_woocommerce_tenant", "Website not configured.", ["status" => 400]);
        }
        return AlphaRecall_Client::get_instance()->trigger_product_sync($tenant_id);
    }

    public function sync_status(): array|WP_Error
    {
        $tenant_id = $this->tenant_id();
        if (!$tenant_id) {
            return new WP_Error("alpharecall_woocommerce_tenant", "Website not configured.", ["status" => 400]);
        }
        return AlphaRecall_Client::get_instance()->get_product_sync_status($tenant_id);
    }

    public function is_feature_enabled(string $feature): bool
    {
        $config = $this->get_config();
        return !empty($config["enabled"]) && !empty($config[$feature]);
    }

    public function product_created(int $product_id): void
    {
        $this->queue_product("product.created", $product_id);
    }

    public function product_updated(int $product_id): void
    {
        $this->queue_product("product.updated", $product_id);
    }

    public function product_deleted(int $product_id): void
    {
        if ($this->is_feature_enabled("sync_products")) {
            $this->queue_event("product.deleted", ["id" => absint($product_id)]);
        }
    }

    public function variation_changed(int $variation_id): void
    {
        if (!$this->is_feature_enabled("sync_products")) {
            return;
        }
        $variation = wc_get_product($variation_id);
        $parent_id = $variation ? absint($variation->get_parent_id()) : 0;
        if ($parent_id) {
            $this->queue_product("product.updated", $parent_id);
        }
    }

    public function stock_changed(mixed $product): void
    {
        if (!is_object($product) || !method_exists($product, "get_id")) {
            return;
        }
        if (method_exists($product, "get_parent_id") && $product->get_parent_id()) {
            $this->queue_product("product.updated", absint($product->get_parent_id()));
            return;
        }
        $this->queue_product("product.updated", absint($product->get_id()));
    }

    public function post_trashed(int $post_id): void
    {
        $post_type = get_post_type($post_id);
        if ($post_type === "product") {
            $this->product_deleted($post_id);
        } elseif ($post_type === "product_variation") {
            $this->variation_changed($post_id);
        }
    }

    public function post_untrashed(int $post_id): void
    {
        $post_type = get_post_type($post_id);
        if ($post_type === "product") {
            $this->product_updated($post_id);
        } elseif ($post_type === "product_variation") {
            $this->variation_changed($post_id);
        }
    }

    public function order_created(int $order_id, mixed $order = null): void
    {
        $this->queue_order("order.created", $order ?: $order_id);
    }

    public function order_updated(int $order_id, string $from, string $to, mixed $order): void
    {
        if ($from !== $to) {
            $this->queue_order("order.updated", $order ?: $order_id);
        }
    }

    public function order_refunded(int $order_id, int $refund_id): void
    {
        $this->queue_order("order.refunded", $order_id, $refund_id);
    }

    private function queue_product(string $event_type, int $product_id): void
    {
        if (!$this->is_feature_enabled("sync_products")) {
            return;
        }
        $payload = $this->product_payload($product_id);
        if (!$payload) {
            $this->queue_event("product.deleted", ["id" => absint($product_id)]);
            return;
        }
        $this->queue_event($event_type, $payload);
    }

    private function queue_order(string $event_type, mixed $order_or_id, int $refund_id = 0): void
    {
        if (!$this->is_feature_enabled("sync_order_events")) {
            return;
        }
        $order = is_object($order_or_id) ? $order_or_id : wc_get_order(absint($order_or_id));
        if (!$order) {
            return;
        }
        $payload = $this->order_event_payload($order, $refund_id);
        $this->queue_event($event_type, $payload);
    }

    private function queue_event(string $event_type, array $data): void
    {
        if (
            (str_starts_with($event_type, "product.") && !$this->is_feature_enabled("sync_products"))
            || (str_starts_with($event_type, "order.") && !$this->is_feature_enabled("sync_order_events"))
        ) {
            return;
        }
        $tenant_id = $this->tenant_id();
        if (!$tenant_id || empty($data["id"])) {
            return;
        }
        $encoded = wp_json_encode($data);
        if (!is_string($encoded)) {
            return;
        }
        $payload_hash = hash("sha256", $event_type . "\n" . $encoded);
        if (!$this->acquire_queue_lock()) {
            $this->schedule_deferred_event($event_type, $data);
            return;
        }
        try {
            $queue = $this->get_queue();
            foreach ($queue as $entry) {
                if (
                    (string) ($entry["event_type"] ?? "") === $event_type
                    && (string) ($entry["payload_hash"] ?? "") === $payload_hash
                ) {
                    $this->schedule_worker(time());
                    return;
                }
            }
            $nonce = str_replace("-", "", wp_generate_uuid4());
            $webhook_id = "wc_" . $tenant_id . "_" . str_replace(".", "_", $event_type)
                . "_" . absint($data["id"]) . "_" . substr($payload_hash, 0, 16)
                . "_" . $nonce;
            $queue[$webhook_id] = [
                "webhook_id" => $webhook_id,
                "event_type" => $event_type,
                "data" => $data,
                "payload_hash" => $payload_hash,
                "attempts" => 0,
                "next_attempt" => time(),
                "queued_at" => gmdate("Y-m-d\TH:i:s\Z"),
            ];
            if (count($queue) > self::MAX_QUEUE) {
                $queue = array_slice($queue, -self::MAX_QUEUE, null, true);
            }
            $this->write_option(self::QUEUE_OPTION, $queue);
        } finally {
            $this->release_queue_lock();
        }
        $this->schedule_worker(time());
    }

    public function queue_deferred_event(string $event_type, array $data): void
    {
        $this->queue_event($event_type, $data);
    }

    private function schedule_deferred_event(string $event_type, array $data): void
    {
        $timestamp = time() + 5;
        $args = [$event_type, $data];
        if (
            function_exists("as_schedule_single_action")
            && class_exists("Action_Scheduler")
            && method_exists("Action_Scheduler", "is_initialized")
            && Action_Scheduler::is_initialized()
        ) {
            as_schedule_single_action($timestamp, self::DEFERRED_HOOK, $args, self::ACTION_GROUP, false);
            return;
        }
        wp_schedule_single_event($timestamp, self::DEFERRED_HOOK, $args);
    }

    public function ensure_worker_scheduled(): void
    {
        if ($this->get_queue()) {
            $this->schedule_worker(time());
        }
    }

    private function schedule_worker(int $timestamp): void
    {
        $timestamp = max(time(), $timestamp);
        if (
            function_exists("as_enqueue_async_action")
            && class_exists("Action_Scheduler")
            && method_exists("Action_Scheduler", "is_initialized")
            && Action_Scheduler::is_initialized()
        ) {
            if ($timestamp <= time() + 1) {
                as_enqueue_async_action(self::WORKER_HOOK, [], self::ACTION_GROUP, true);
            } elseif (function_exists("as_schedule_single_action")) {
                as_schedule_single_action($timestamp, self::WORKER_HOOK, [], self::ACTION_GROUP, true);
            }
            return;
        }
        if (!wp_next_scheduled(self::WORKER_HOOK)) {
            wp_schedule_single_event($timestamp, self::WORKER_HOOK);
        }
    }

    public function process_queue(): array
    {
        $queue = $this->get_queue();
        $stats = $this->get_stats();
        $tenant_id = $this->tenant_id();
        if (!$queue || !$tenant_id || empty($this->get_config()["enabled"])) {
            return ["delivered" => 0, "failed" => 0, "remaining" => count($queue)];
        }
        $now = time();
        $processed = 0;
        $delivered = 0;
        $failed = 0;
        $removals = [];
        $updates = [];
        foreach ($queue as $webhook_id => $entry) {
            if ($processed >= self::MAX_BATCH || (int) ($entry["next_attempt"] ?? 0) > $now) {
                continue;
            }
            $processed++;
            $result = AlphaRecall_Client::get_instance()->send_woocommerce_event($tenant_id, [
                "webhook_id" => (string) $entry["webhook_id"],
                "event_type" => (string) $entry["event_type"],
                "data" => (array) $entry["data"],
            ]);
            if (!is_wp_error($result)) {
                $removals[] = $webhook_id;
                $delivered++;
                $stats["last_delivery_at"] = gmdate("Y-m-d\TH:i:s\Z");
                $stats["last_success_at"] = $stats["last_delivery_at"];
                $stats["last_error"] = null;
                continue;
            }
            $attempts = (int) ($entry["attempts"] ?? 0) + 1;
            $failed++;
            $stats["last_error_at"] = gmdate("Y-m-d\TH:i:s\Z");
            $stats["last_error"] = substr(wp_strip_all_tags($result->get_error_message()), 0, 500);
            if ($attempts >= self::MAX_ATTEMPTS) {
                $removals[] = $webhook_id;
            } else {
                $entry["attempts"] = $attempts;
                $entry["next_attempt"] = $now + min(3600, 60 * (2 ** ($attempts - 1)));
                $updates[$webhook_id] = $entry;
            }
        }
        $stats["delivered_count"] = (int) ($stats["delivered_count"] ?? 0) + $delivered;
        $stats["failed_count"] = (int) ($stats["failed_count"] ?? 0) + $failed;
        if (!$this->acquire_queue_lock()) {
            $this->schedule_worker(time() + 5);
            return ["delivered" => $delivered, "failed" => $failed, "remaining" => count($this->get_queue())];
        }
        try {
            $queue = $this->get_queue();
            foreach ($removals as $webhook_id) {
                unset($queue[$webhook_id]);
            }
            foreach ($updates as $webhook_id => $entry) {
                if (isset($queue[$webhook_id])) {
                    $queue[$webhook_id] = $entry;
                }
            }
            $this->write_option(self::QUEUE_OPTION, $queue);
        } finally {
            $this->release_queue_lock();
        }
        $this->write_option(self::STATS_OPTION, $stats);
        if ($queue) {
            $next = min(array_map(static fn(array $entry): int => (int) ($entry["next_attempt"] ?? time()), $queue));
            $this->schedule_worker($next);
        }
        return ["delivered" => $delivered, "failed" => $failed, "remaining" => count($queue)];
    }

    public function lookup_order(array $input): array|WP_Error
    {
        if (!$this->is_feature_enabled("order_lookup") || !$this->is_available()) {
            return new WP_Error("alpharecall_woocommerce_order", "Order lookup is unavailable.", ["status" => 404]);
        }
        $order_id = absint($input["order_id"] ?? 0);
        $email = strtolower(sanitize_email((string) ($input["email"] ?? "")));
        if (!$order_id || !$email || !is_email($email)) {
            return new WP_Error("alpharecall_woocommerce_order", "Order not found or customer verification failed.", ["status" => 404]);
        }
        $order = wc_get_order($order_id);
        $billing_email = $order ? strtolower((string) $order->get_billing_email()) : "";
        if (!$order || !$billing_email || !hash_equals($billing_email, $email)) {
            return new WP_Error("alpharecall_woocommerce_order", "Order not found or customer verification failed.", ["status" => 404]);
        }
        $items = [];
        foreach ($order->get_items("line_item") as $item_id => $item) {
            $quantity = max(1, (int) $item->get_quantity());
            $product = $item->get_product();
            $image_url = "";
            if ($product && $product->get_image_id()) {
                $image_url = (string) wp_get_attachment_image_url($product->get_image_id(), "thumbnail");
            }
            $item_data = [
                "id" => (string) $item_id,
                "name" => sanitize_text_field((string) $item->get_name()),
                "quantity" => $quantity,
                "unitPrice" => (float) $order->get_item_subtotal($item, false, false),
            ];
            if ($image_url) {
                $item_data["imageUrl"] = $image_url;
            }
            $items[] = $item_data;
        }
        $created = $order->get_date_created();
        return [
            "verified" => true,
            "order_id" => $order->get_id(),
            "order_number" => (string) $order->get_order_number(),
            "status" => (string) $order->get_status(),
            "status_label" => wc_get_order_status_name($order->get_status()),
            "title" => "Order #" . $order->get_order_number() . " - " . wc_get_order_status_name($order->get_status()),
            "created_at" => $created ? $created->date("c") : null,
            "items" => $items,
            "pricing" => [
                "subtotal" => (float) $order->get_subtotal(),
                "discount" => (float) $order->get_discount_total(),
                "shipping" => (float) $order->get_shipping_total(),
                "tax" => (float) $order->get_total_tax(),
                "total" => (float) $order->get_total(),
                "currency" => (string) $order->get_currency(),
            ],
        ];
    }

    public function cart_link(array $input): array|WP_Error
    {
        if (!$this->is_feature_enabled("cart_links") || !$this->is_available()) {
            return new WP_Error("alpharecall_woocommerce_cart", "Cart links are unavailable.", ["status" => 404]);
        }
        $product_id = absint($input["product_id"] ?? 0);
        $quantity = max(1, min(100, absint($input["quantity"] ?? 1)));
        $product = $product_id ? wc_get_product($product_id) : null;
        if (
            !$product
            || $product->get_status() !== "publish"
            || !$product->is_visible()
            || !$product->is_purchasable()
            || !$product->is_in_stock()
        ) {
            return new WP_Error("alpharecall_woocommerce_cart", "This product is not available for purchase.", ["status" => 404]);
        }
        $requires_options = !$product->is_type("simple");
        if ($product->is_type("external")) {
            $url = (string) $product->get_product_url();
        } elseif ($requires_options) {
            $url = (string) $product->get_permalink();
        } else {
            $url = add_query_arg(
                ["add-to-cart" => $product->get_id(), "quantity" => $quantity],
                wc_get_cart_url()
            );
        }
        return [
            "product_id" => $product->get_id(),
            "name" => $product->get_name(),
            "quantity" => $quantity,
            "url" => esc_url_raw($url),
            "requires_options" => $requires_options,
            "message" => $requires_options
                ? "Choose the product options on the store page."
                : "Open the link to add the product to your cart.",
        ];
    }

    private function product_payload(int $product_id): ?array
    {
        $product = wc_get_product($product_id);
        if (
            !$product
            || $product->get_status() !== "publish"
            || $product->get_catalog_visibility() === "hidden"
            || (string) get_post_field("post_password", $product->get_id()) !== ""
        ) {
            return null;
        }
        $categories = wp_get_post_terms($product->get_id(), "product_cat", ["fields" => "names"]);
        $tags = wp_get_post_terms($product->get_id(), "product_tag", ["fields" => "names"]);
        $categories = is_wp_error($categories) ? [] : array_values(array_map("sanitize_text_field", $categories));
        $tags = is_wp_error($tags) ? [] : array_values(array_map("sanitize_text_field", $tags));
        $attributes = [];
        foreach ($product->get_attributes() as $attribute) {
            if (!$attribute || !method_exists($attribute, "get_name")) {
                continue;
            }
            $name = (string) $attribute->get_name();
            $values = $attribute->is_taxonomy()
                ? wc_get_product_terms($product->get_id(), $name, ["fields" => "names"])
                : $attribute->get_options();
            $attributes[] = [
                "name" => wc_attribute_label($name),
                "values" => array_values(array_map("sanitize_text_field", (array) $values)),
            ];
        }
        $images = [];
        foreach (array_slice(array_values(array_unique(array_filter(array_merge(
            [$product->get_image_id()],
            $product->get_gallery_image_ids()
        )))), 0, 20) as $image_id) {
            $src = wp_get_attachment_image_url($image_id, "woocommerce_thumbnail");
            if ($src) {
                $images[] = [
                    "id" => absint($image_id),
                    "src" => esc_url_raw($src),
                    "alt" => sanitize_text_field((string) get_post_meta($image_id, "_wp_attachment_image_alt", true)),
                ];
            }
        }
        return [
            "id" => $product->get_id(),
            "name" => substr(sanitize_text_field($product->get_name()), 0, 500),
            "description" => substr(wp_kses_post($product->get_description()), 0, 20000),
            "short_description" => substr(wp_kses_post($product->get_short_description()), 0, 5000),
            "categories" => array_slice($categories, 0, 100),
            "tags" => array_slice($tags, 0, 100),
            "attributes" => array_slice($attributes, 0, 100),
            "images" => $images,
            "image_alts" => array_values(array_filter(array_column($images, "alt"))),
            "price" => (string) $product->get_price(),
            "currency" => get_woocommerce_currency(),
            "permalink" => esc_url_raw($product->get_permalink()),
            "stock_status" => sanitize_key($product->get_stock_status()),
            "on_sale" => (bool) $product->is_on_sale(),
            "average_rating" => (string) $product->get_average_rating(),
        ];
    }

    private function order_event_payload(object $order, int $refund_id = 0): array
    {
        $product_ids = [];
        $quantities = [];
        $item_count = 0;
        foreach ($order->get_items("line_item") as $item) {
            $quantity = max(0, (int) $item->get_quantity());
            $item_count += $quantity;
            $product_id = absint($item->get_product_id());
            if ($product_id) {
                $product_ids[] = $product_id;
                $quantities[] = $quantity;
            }
        }
        $created = $order->get_date_created();
        $updated = $order->get_date_modified();
        $refund_total = null;
        if ($refund_id) {
            $refund = wc_get_order($refund_id);
            $refund_total = $refund ? (string) abs((float) $refund->get_amount()) : null;
        }
        return [
            "id" => $order->get_id(),
            "number" => (string) $order->get_order_number(),
            "status" => (string) $order->get_status(),
            "total" => (string) $order->get_total(),
            "currency" => (string) $order->get_currency(),
            "item_count" => $item_count,
            "product_ids" => $product_ids,
            "quantities" => $quantities,
            "created_at" => $created ? $created->date("c") : null,
            "updated_at" => $updated ? $updated->date("c") : null,
            "refund_total" => $refund_total,
        ];
    }

    private function sanitize_config(array $input): array
    {
        $merged = array_merge($this->get_config(), $input);
        return [
            "enabled" => !empty($merged["enabled"]),
            "sync_products" => !empty($merged["sync_products"]),
            "sync_order_events" => !empty($merged["sync_order_events"]),
            "order_lookup" => !empty($merged["order_lookup"]),
            "coupon_validation" => !empty($merged["coupon_validation"]),
            "cart_links" => !empty($merged["cart_links"]),
            "default_page_size" => max(1, min(100, absint($merged["default_page_size"] ?? 10))),
            "cache_ttl_seconds" => max(30, min(86400, absint($merged["cache_ttl_seconds"] ?? 300))),
        ];
    }

    private function validate_config(array $config, bool $force = false): bool|WP_Error
    {
        if (!$this->is_available()) {
            return new WP_Error("alpharecall_woocommerce_missing", "WooCommerce is not installed or active.", ["status" => 400]);
        }
        if (!$force && empty($config["enabled"])) {
            return true;
        }
        $client = AlphaRecall_Client::get_instance();
        if (!$client->get_api_base() || !$client->get_tenant_key()) {
            return new WP_Error("alpharecall_woocommerce_credentials", "AlphaRecall tenant credentials are not configured.", ["status" => 400]);
        }
        return true;
    }

    private function backend_payload(array $config): array
    {
        return [
            "enabled" => (bool) $config["enabled"],
            "store_url" => home_url(),
            "sync_products" => (bool) $config["sync_products"],
            "sync_order_events" => (bool) $config["sync_order_events"],
            "order_lookup" => (bool) $config["order_lookup"],
            "coupon_validation" => (bool) $config["coupon_validation"],
            "cart_links" => (bool) $config["cart_links"],
            "default_page_size" => (int) $config["default_page_size"],
            "cache_ttl_seconds" => (int) $config["cache_ttl_seconds"],
        ];
    }

    private function get_config(): array
    {
        $stored = get_option(self::CONFIG_OPTION, []);
        return array_merge([
            "enabled" => false,
            "sync_products" => true,
            "sync_order_events" => true,
            "order_lookup" => true,
            "coupon_validation" => true,
            "cart_links" => true,
            "default_page_size" => 10,
            "cache_ttl_seconds" => 300,
        ], is_array($stored) ? $stored : []);
    }

    private function get_queue(): array
    {
        $queue = get_option(self::QUEUE_OPTION, []);
        return is_array($queue) ? $queue : [];
    }

    private function get_stats(): array
    {
        $stats = get_option(self::STATS_OPTION, []);
        return is_array($stats) ? $stats : [];
    }

    private function tenant_id(): int
    {
        return absint(AlphaRecall_Settings::get_options()["tenant_id"] ?? 0);
    }

    private function is_available(): bool
    {
        return class_exists("WooCommerce") && function_exists("wc_get_product") && function_exists("wc_get_order");
    }

    private function plugin_version(): ?string
    {
        return defined("WC_VERSION") ? (string) WC_VERSION : null;
    }

    private function hpos_enabled(): bool
    {
        $class = "\\Automattic\\WooCommerce\\Utilities\\OrderUtil";
        return class_exists($class) && $class::custom_orders_table_usage_is_enabled();
    }

    private function product_count(): int
    {
        $counts = wp_count_posts("product");
        return is_object($counts) ? (int) ($counts->publish ?? 0) : 0;
    }

    private function acquire_queue_lock(): bool
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            if (add_option(self::QUEUE_LOCK_OPTION, time(), "", false)) {
                return true;
            }
            $locked_at = (int) get_option(self::QUEUE_LOCK_OPTION, 0);
            if ($locked_at && $locked_at < time() - 30) {
                delete_option(self::QUEUE_LOCK_OPTION);
                continue;
            }
            usleep(20000);
        }
        return false;
    }

    private function release_queue_lock(): void
    {
        delete_option(self::QUEUE_LOCK_OPTION);
    }

    private function write_option(string $name, array $value): void
    {
        if (get_option($name, null) === null) {
            add_option($name, $value, "", false);
            return;
        }
        update_option($name, $value, false);
    }
}
