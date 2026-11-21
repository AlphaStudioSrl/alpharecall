<?php

if (!defined("ABSPATH")) {
    exit;
}

/**
 * Creates revocable, client-safe AlphaRecall performance report snapshots.
 *
 * Only aggregate metrics are stored. The public token is encrypted at rest and
 * its SHA-256 digest is used for constant-shape lookup on public requests.
 */
class AlphaRecall_Report
{
    private static ?AlphaRecall_Report $instance = null;
    private const OPTION_KEY = "alpharecall_report_share";
    private const ROUTE_VERSION_KEY = "alpharecall_report_route_version";
    private const ROUTE_VERSION = "2";

    public static function get_instance(): AlphaRecall_Report
    {
        if (!self::$instance) {
            self::$instance = new AlphaRecall_Report();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action("init", [self::class, "add_rewrite_rule"]);
        add_action("init", [self::class, "ensure_rewrite_rules"], 99);
        add_filter("query_vars", [$this, "query_vars"]);
        // Run before WordPress canonical redirects so anonymous report URLs are
        // rendered directly instead of being normalized into a theme 404.
        add_action("template_redirect", [$this, "render_public_report"], 0);
        add_action("rest_api_init", [$this, "register_routes"]);
    }

    public static function add_rewrite_rule(): void
    {
        add_rewrite_rule(
            "^alpharecall-report/([a-f0-9]{64})/?$",
            'index.php?alpharecall_report=$matches[1]',
            "top"
        );
    }

    public static function ensure_rewrite_rules(): void
    {
        if ((string) get_option(self::ROUTE_VERSION_KEY, "") === self::ROUTE_VERSION) {
            return;
        }
        self::add_rewrite_rule();
        flush_rewrite_rules(false);
        update_option(self::ROUTE_VERSION_KEY, self::ROUTE_VERSION, true);
    }

    public function query_vars(array $vars): array
    {
        $vars[] = "alpharecall_report";
        return $vars;
    }

    public function register_routes(): void
    {
        register_rest_route("alpharecall/v1", "/report-share", [
            [
                "methods" => "GET",
                "permission_callback" => [$this, "can_manage"],
                "callback" => [$this, "get_share"],
            ],
            [
                "methods" => "POST",
                "permission_callback" => [$this, "can_manage"],
                "callback" => [$this, "create_share"],
            ],
            [
                "methods" => "DELETE",
                "permission_callback" => [$this, "can_manage"],
                "callback" => [$this, "revoke_share"],
            ],
        ]);
    }

    public function can_manage(): bool
    {
        return current_user_can("manage_options") || current_user_can("alpharecall_admin");
    }

    public function get_share(): WP_REST_Response
    {
        $record = $this->active_record();
        if (!$record) {
            return new WP_REST_Response(["active" => false]);
        }
        $token = AlphaRecall_Storage::decrypt((string) ($record["token_enc"] ?? ""));
        if (!$this->valid_token($token)) {
            delete_option(self::OPTION_KEY);
            return new WP_REST_Response(["active" => false]);
        }
        return new WP_REST_Response($this->status_payload($record, $token));
    }

    public function create_share(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = absint($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }

        $body = AlphaRecall_Sanitize::json_array($request->get_json_params());
        $days = absint($body["days"] ?? 30);
        if (!in_array($days, [7, 30, 90], true)) {
            return new WP_REST_Response(["error" => "Invalid report period."], 422);
        }
        $expires_in = absint($body["expires_in_days"] ?? 30);
        if (!in_array($expires_in, [0, 7, 30, 90], true)) {
            return new WP_REST_Response(["error" => "Invalid expiry period."], 422);
        }
        $language = sanitize_key((string) ($body["language"] ?? ""));
        if (!in_array($language, ["it", "en"], true)) {
            $tenant_language = (string) ($options["tenant_settings"]["response_language"] ?? "it");
            $language = str_starts_with(strtolower($tenant_language), "en") ? "en" : "it";
        }
        $client_name = sanitize_text_field((string) ($body["client_name"] ?? ""));
        $prepared_by = sanitize_text_field((string) ($body["prepared_by"] ?? ""));
        $client_name = wp_html_excerpt($client_name ?: get_bloginfo("name"), 100, "");
        $prepared_by = wp_html_excerpt($prepared_by, 100, "");

        $metrics = AlphaRecall_Client::get_instance()->performance_report($tenant_id, $days);
        if (is_wp_error($metrics)) {
            $error_data = $metrics->get_error_data();
            $error_status = is_array($error_data) ? (int) ($error_data["status"] ?? 502) : 502;
            return new WP_REST_Response(
                ["error" => $metrics->get_error_message()],
                $error_status
            );
        }

        try {
            $token = bin2hex(random_bytes(32));
        } catch (Throwable $e) {
            $token = strtolower(wp_generate_password(64, false, false));
        }
        if (!$this->valid_token($token)) {
            return new WP_REST_Response(["error" => "Could not create a secure report link."], 500);
        }
        $token_enc = AlphaRecall_Storage::encrypt($token);
        if (!$token_enc) {
            return new WP_REST_Response(["error" => "Secure storage is unavailable."], 500);
        }

        $created_at = gmdate("c");
        $expires_at = $expires_in ? gmdate("c", time() + ($expires_in * DAY_IN_SECONDS)) : null;
        $record = [
            "version" => 1,
            "tenant_id" => $tenant_id,
            "token_hash" => hash("sha256", $token),
            "token_enc" => $token_enc,
            "created_at" => $created_at,
            "expires_at" => $expires_at,
            "expires_in_days" => $expires_in,
            "period_days" => $days,
            "language" => $language,
            "client_name" => $client_name,
            "prepared_by" => $prepared_by,
            "site_name" => sanitize_text_field(get_bloginfo("name")),
            "site_url" => esc_url_raw(home_url("/")),
            "accent" => sanitize_hex_color((string) ($options["chat_config"]["primaryColor"] ?? "")) ?: "#2f7d67",
            "metrics" => $metrics,
        ];
        update_option(self::OPTION_KEY, $record, false);
        return new WP_REST_Response($this->status_payload($record, $token), 201);
    }

    public function revoke_share(): WP_REST_Response
    {
        delete_option(self::OPTION_KEY);
        return new WP_REST_Response(["active" => false, "revoked" => true]);
    }

    private function active_record(): ?array
    {
        $record = get_option(self::OPTION_KEY, null);
        if (!is_array($record) || empty($record["token_hash"]) || empty($record["metrics"])) {
            return null;
        }
        $options = AlphaRecall_Settings::get_options();
        $current_tenant_id = absint($options["tenant_id"] ?? 0);
        if (!$current_tenant_id || (int) ($record["tenant_id"] ?? 0) !== $current_tenant_id) {
            delete_option(self::OPTION_KEY);
            return null;
        }
        $expires_at = (string) ($record["expires_at"] ?? "");
        if ($expires_at && strtotime($expires_at) <= time()) {
            delete_option(self::OPTION_KEY);
            return null;
        }
        return $record;
    }

    private function valid_token(string $token): bool
    {
        return preg_match('/^[a-f0-9]{64}$/D', $token) === 1;
    }

    private function public_url(string $token): string
    {
        if (!(string) get_option("permalink_structure", "")) {
            return add_query_arg("alpharecall_report", rawurlencode($token), home_url("/"));
        }
        return trailingslashit(home_url("/alpharecall-report/{$token}"));
    }

    private function status_payload(array $record, string $token): array
    {
        return [
            "active" => true,
            "url" => $this->public_url($token),
            "created_at" => $record["created_at"] ?? null,
            "expires_at" => $record["expires_at"] ?? null,
            "expires_in_days" => (int) ($record["expires_in_days"] ?? 30),
            "period_days" => (int) ($record["period_days"] ?? 30),
            "language" => $record["language"] ?? "it",
            "client_name" => $record["client_name"] ?? "",
            "prepared_by" => $record["prepared_by"] ?? "",
        ];
    }

    public function render_public_report(): void
    {
        $token = (string) get_query_var("alpharecall_report", "");
        if (!$token && isset($_GET["alpharecall_report"])) {
            $token = sanitize_text_field(wp_unslash((string) $_GET["alpharecall_report"]));
        }
        // The request URI fallback keeps friendly report links working even
        // while rewrite rules are stale (for example immediately after an
        // update, or on hosts that delay persisting a rewrite flush).
        if (!$token) {
            $token = $this->token_from_request_uri();
        }
        if (!$token) {
            return;
        }

        $record = $this->active_record();
        if (
            !$record ||
            !$this->valid_token($token) ||
            !hash_equals((string) $record["token_hash"], hash("sha256", $token))
        ) {
            status_header(404);
            nocache_headers();
            header("X-Robots-Tag: noindex, nofollow, noarchive", true);
            $this->render_not_found();
            exit;
        }

        status_header(200);
        nocache_headers();
        header("Content-Type: text/html; charset=utf-8");
        header("X-Robots-Tag: noindex, nofollow, noarchive", true);
        header("Referrer-Policy: no-referrer", true);
        header("X-Content-Type-Options: nosniff", true);
        $assets_origin = $this->asset_origin();
        header("Content-Security-Policy: default-src 'none'; style-src " . $assets_origin . " 'unsafe-inline'; script-src " . $assets_origin . "; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", true);
        $this->render_report($record, !empty($_GET["print"])); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- the token in the URL is the access check, print is a display flag.
        exit;
    }

    private function token_from_request_uri(): string
    {
        $request_uri = isset($_SERVER["REQUEST_URI"])
            ? esc_url_raw(wp_unslash((string) $_SERVER["REQUEST_URI"]))
            : "";
        $path = (string) wp_parse_url($request_uri, PHP_URL_PATH);
        if (!$path || !preg_match('~/alpharecall-report/([a-f0-9]{64})/?$~D', $path, $matches)) {
            return "";
        }
        return (string) $matches[1];
    }

    /** The page for an unknown, expired or revoked link: static markup, nothing from the request. */
    private function render_not_found(): void
    {
        ?>
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Report unavailable</title></head><body style="margin:0;background:#edf0ec;color:#151f1a;font:16px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center"><main style="max-width:520px;padding:40px;text-align:center"><div style="display:inline-grid;place-items:center;width:34px;height:34px;background:#151f1a;color:#fff;border-radius:9px;font:700 16px/1 Georgia,serif;margin-bottom:18px">A</div><h1 style="font:400 30px/1.2 Georgia,'Palatino Linotype',serif;margin:0 0 8px">Report unavailable</h1><p style="color:#5c6b64;margin:0">This secure report link is invalid, expired, or has been revoked.</p></main></body></html>
        <?php
    }

    /**
     * The report document. Escaping happens at output: the head values with
     * esc_attr()/esc_html(), the body through wp_kses() with the report's own
     * tag list (report_allowed_html()), the stylesheet and script through the
     * WordPress style and script APIs.
     */
    private function render_report(array $record, bool $auto_print): void
    {
        $language = ($record["language"] ?? "it") === "en" ? "en" : "it";
        $labels = $this->labels($language);
        $accent = sanitize_hex_color((string) ($record["accent"] ?? "")) ?: "#2f7d67";
        $title = $labels["title"] . " · " . (string) ($record["client_name"] ?? "");
        $body = $this->report_body_html($record);
        $this->register_report_assets($accent);
        ?>
<!doctype html><html lang="<?php echo esc_attr($language); ?>"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title><?php echo esc_html($title); ?></title><?php wp_print_styles(["alpharecall-report"]); ?></head><body<?php if ($auto_print) : ?> data-auto-print="1"<?php endif; ?>><?php echo wp_kses($body, self::report_allowed_html()); ?><?php wp_print_scripts(["alpharecall-report"]); ?></body></html>
        <?php
    }

    /**
     * Every tag and attribute the report body uses (report_body_html()), for
     * wp_kses() at output. Inline styles are only the bar sizes (width/height
     * in %), which safecss_filter_attr() keeps.
     *
     * @return array<string, array<string, bool>>
     */
    public static function report_allowed_html(): array
    {
        $common = ["class" => true, "style" => true, "role" => true, "title" => true, "aria-hidden" => true, "aria-label" => true];
        $tags = [];
        foreach (["article", "b", "caption", "div", "em", "footer", "h1", "h2", "header", "i", "main", "p", "section", "small", "span", "strong", "table", "tbody", "td", "tr"] as $tag) {
            $tags[$tag] = $common;
        }
        $tags["a"] = $common + ["href" => true];
        $tags["button"] = $common + ["type" => true, "data-*" => true];
        $tags["th"] = $common + ["scope" => true];
        $tags["svg"] = $common + ["viewbox" => true, "fill" => true, "stroke" => true, "stroke-width" => true, "stroke-linecap" => true, "stroke-linejoin" => true];
        $tags["path"] = ["d" => true];
        $tags["circle"] = ["cx" => true, "cy" => true, "r" => true];
        $tags["rect"] = ["x" => true, "y" => true, "width" => true, "height" => true, "rx" => true];
        return $tags;
    }

    /** The report body, each value escaped as it is put in (and again by wp_kses() at output). */
    private function report_body_html(array $record): string
    {
        $metrics = (array) ($record["metrics"] ?? []);
        $current = (array) ($metrics["current"] ?? []);
        $previous = (array) ($metrics["previous"] ?? []);
        $series = (array) ($metrics["series"] ?? []);
        $language = ($record["language"] ?? "it") === "en" ? "en" : "it";
        $labels = $this->labels($language);
        $client_name = esc_html((string) ($record["client_name"] ?? ""));
        $prepared_by = esc_html((string) ($record["prepared_by"] ?? ""));
        $site_name = esc_html((string) ($record["site_name"] ?? "AlphaRecall"));
        $site_url = esc_url((string) ($record["site_url"] ?? home_url("/")));
        $currency = strtoupper((string) ($metrics["currency"] ?? "EUR"));
        $start = $this->format_date((string) ($metrics["period_start"] ?? ""), $language);
        $end = $this->format_date((string) ($metrics["period_end"] ?? ""), $language);
        $generated = $this->format_date((string) ($record["created_at"] ?? ""), $language);

        $conversations = (int) ($current["conversations"] ?? 0);
        $conversions = (int) ($current["conversions"] ?? 0);
        $visitors = (int) ($current["visitors"] ?? 0);
        $replies = (int) ($current["assistant_replies"] ?? 0);
        $pipeline = (int) ($current["estimated_pipeline_value_cents"] ?? 0);
        $minutes_saved = (int) ($current["estimated_minutes_saved"] ?? 0);

        if (!empty($current["has_pipeline_assumptions"])) {
            $hero_value = $this->money($pipeline, $currency, $language);
            $hero_label = $labels["estimated_value"];
            $hero_previous = (int) ($previous["estimated_pipeline_value_cents"] ?? 0);
            $hero_current = $pipeline;
        } elseif ($conversions > 0) {
            $hero_value = number_format_i18n($conversions);
            $hero_label = $labels["conversion_actions"];
            $hero_previous = (int) ($previous["conversions"] ?? 0);
            $hero_current = $conversions;
        } else {
            $hero_value = number_format_i18n($conversations);
            $hero_label = $labels["conversations"];
            $hero_previous = (int) ($previous["conversations"] ?? 0);
            $hero_current = $conversations;
        }
        $hero_trend = $this->trend($hero_current, $hero_previous, $language);
        // Decorative: the full trend wording is already visible text in the hero.
        $hero_chip = $this->delta_chip($hero_current, $hero_previous, $language, true);

        $kpis = [
            [$labels["conversations"], $conversations, "conversations"],
            [$labels["conversion_actions"], $conversions, "conversions"],
            [$labels["visitors"], $visitors, "visitors"],
            [$labels["assistant_replies"], $replies, "assistant_replies"],
        ];
        $kpi_html = "";
        foreach ($kpis as [$label, $value, $key]) {
            $kpi_html .= '<article class="kpi"><div class="kpi-head">' . $this->icon_svg($key) . '<span>' . esc_html($label) . '</span></div><strong>' . esc_html(number_format_i18n($value)) . '</strong>' . $this->delta_chip((int) $value, (int) ($previous[$key] ?? 0), $language) . '</article>';
        }

        $impact_html = "";
        if (!empty($current["has_pipeline_assumptions"]) || !empty($current["has_time_assumption"])) {
            $impact_cards = "";
            if (!empty($current["has_pipeline_assumptions"])) {
                $impact_cards .= '<div class="impact-item"><span>' . $this->icon_svg("value") . esc_html($labels["estimated_value"]) . '</span><strong>' . esc_html($this->money($pipeline, $currency, $language)) . '</strong>' . $this->delta_chip($pipeline, (int) ($previous["estimated_pipeline_value_cents"] ?? 0), $language) . '</div>';
            }
            if (!empty($current["has_time_assumption"])) {
                $hours = number_format_i18n($minutes_saved / 60, 1) . " h";
                $impact_cards .= '<div class="impact-item"><span>' . $this->icon_svg("time") . esc_html($labels["time_saved"]) . '</span><strong>' . esc_html($hours) . '</strong>' . $this->delta_chip($minutes_saved, (int) ($previous["estimated_minutes_saved"] ?? 0), $language) . '</div>';
            }
            $impact_html = '<section class="section impact-section"><div class="section-heading"><div><span class="eyebrow">' . esc_html($labels["impact_eyebrow"]) . '</span><h2>' . esc_html($labels["impact_title"]) . '</h2></div><p>' . esc_html($labels["impact_note"]) . '</p></div><div class="impact-grid">' . $impact_cards . '</div></section>';
        }

        $conversion_rows = [
            ["contact", $labels["contact_requests"], "contact_requests"],
            ["mail", $labels["email_leads"], "email_leads"],
            ["calendar", $labels["appointments"], "appointments"],
            ["registration", $labels["registrations"], "registrations"],
        ];
        $conversion_html = $this->conversion_breakdown_html(
            $conversion_rows,
            $current,
            $previous,
            $conversions,
            $labels,
            $language
        );
        $series_html = $this->series_charts_html(
            $series,
            $labels,
            $language,
            max(1, (int) ($metrics["period_days"] ?? count($series))),
            $current,
            $previous
        );
        $comparison_html = $this->comparison_html($kpis, $current, $previous, $labels, $language);
        $efficiency_html = $this->efficiency_html($current, $labels, $language);
        $summary = sprintf($labels["summary"], number_format_i18n($conversations), number_format_i18n($conversions));
        $prepared = $prepared_by ? '<span>' . esc_html($labels["prepared_by"]) . ' <strong>' . $prepared_by . '</strong></span>' : "";
        return '<div class="toolbar"><a href="' . $site_url . '" class="site-link">' . $site_name . '</a><button type="button" data-report-print>' . $this->icon_svg("print") . esc_html($labels["save_pdf"]) . '</button></div><main class="report"><header class="report-header"><div class="brand-row"><div><span class="brand-mark">A</span><span>ALPHARECALL</span></div><span class="secure">' . $this->icon_svg("secure") . esc_html($labels["secure_snapshot"]) . '</span></div><div class="header-copy"><span class="eyebrow">' . esc_html($labels["performance_report"]) . '</span><h1>' . $client_name . '</h1><p>' . esc_html($start . " – " . $end) . '</p></div><div class="header-meta">' . $prepared . '<span>' . esc_html($labels["generated_on"] . " " . $generated) . '</span></div></header><section class="hero' . ($series ? "" : " no-skyline") . '"><div class="hero-main"><span class="eyebrow">' . esc_html($labels["period_highlight"]) . '</span><strong>' . esc_html($hero_value) . '</strong><p>' . esc_html($hero_label) . $hero_chip . '</p></div><div class="hero-context"><p>' . esc_html($summary) . '</p><span>' . esc_html($hero_trend) . '</span></div>' . $this->skyline_html($series) . '</section><section class="kpi-grid">' . $kpi_html . '</section><section class="section chart-section"><div class="section-heading"><div><span class="eyebrow">' . esc_html($labels["performance_eyebrow"]) . '</span><h2>' . esc_html($labels["performance_title"]) . '</h2></div><p>' . esc_html($labels["performance_note"]) . '</p></div>' . $series_html . '</section><section class="section comparison-section"><div class="section-heading"><div><span class="eyebrow">' . esc_html($labels["comparison_eyebrow"]) . '</span><h2>' . esc_html($labels["comparison_title"]) . '</h2></div><div class="legend"><span><i class="dot current-dot"></i>' . esc_html($labels["current_period"]) . '</span><span><i class="dot previous-dot"></i>' . esc_html($labels["previous_period"]) . '</span></div></div>' . $comparison_html . '</section><section class="section"><div class="section-heading"><div><span class="eyebrow">' . esc_html($labels["outcomes_eyebrow"]) . '</span><h2>' . esc_html($labels["outcomes_title"]) . '</h2></div><p>' . esc_html($labels["outcomes_note"]) . '</p></div>' . $conversion_html . '</section><section class="section"><div class="section-heading"><div><span class="eyebrow">' . esc_html($labels["efficiency_eyebrow"]) . '</span><h2>' . esc_html($labels["efficiency_title"]) . '</h2></div><p>' . esc_html($labels["efficiency_note"]) . '</p></div>' . $efficiency_html . '</section>' . $impact_html . '<footer><div><strong>AlphaRecall</strong><span>' . esc_html($labels["footer_line"]) . '</span></div><p>' . esc_html($labels["methodology"]) . '</p></footer></main>';
    }

    /**
     * Compact colored delta pill; full trend wording stays in the title/aria label.
     */
    private function delta_chip(int $current, int $previous, string $language, bool $decorative = false): string
    {
        $aria = esc_attr($this->trend($current, $previous, $language));
        $attrs = $decorative
            ? ' title="' . $aria . '" aria-hidden="true"'
            : ' role="img" title="' . $aria . '" aria-label="' . $aria . '"';
        if ($previous === 0) {
            if ($current === 0) {
                return '<span class="chip flat"' . $attrs . '>–</span>';
            }
            $text = $language === "it" ? "Nuovo" : "New";
            return '<span class="chip up"' . $attrs . '>▲ ' . esc_html($text) . '</span>';
        }
        $change = (int) round((($current - $previous) / $previous) * 100);
        if ($change === 0) {
            return '<span class="chip flat"' . $attrs . '>±0%</span>';
        }
        $class = $change > 0 ? "up" : "down";
        $arrow = $change > 0 ? "▲" : "▼";
        return '<span class="chip ' . $class . '"' . $attrs . '>' . $arrow . " " . abs($change) . '%</span>';
    }

    /**
     * The hero "skyline": the period's own daily conversation profile, so every
     * client's report carries a data-generated silhouette instead of decoration.
     */
    private function skyline_html(array $series): string
    {
        if (!$series) {
            return "";
        }
        $groups = array_chunk($series, max(1, (int) ceil(count($series) / 60)));
        $values = array_map(
            fn($group) => array_sum(array_map(fn($row) => (int) ($row["conversations"] ?? 0), $group)),
            $groups
        );
        $maximum = max(1, max($values));
        $bars = "";
        foreach ($values as $value) {
            $height = $value > 0 ? max(8, round(($value / $maximum) * 100)) : 4;
            $bars .= '<i style="height:' . esc_attr((string) $height) . '%"></i>';
        }
        return '<div class="skyline" aria-hidden="true">' . $bars . '</div>';
    }

    private function series_charts_html(
        array $series,
        array $labels,
        string $language,
        int $period_days,
        array $current,
        array $previous
    ): string
    {
        if (!$series) {
            return '<div class="empty-chart">' . esc_html($labels["no_activity"]) . '</div>';
        }
        $source_count = count($series);
        $chunk_size = $source_count > 45 ? 7 : ($source_count > 14 ? 2 : 1);
        $groups = array_chunk($series, $chunk_size);
        $points = [];
        foreach ($groups as $group) {
            $first_date = (string) ($group[0]["date"] ?? "");
            $last_date = (string) ($group[count($group) - 1]["date"] ?? "");
            $points[] = [
                "label" => $this->compact_date_label($first_date, $last_date, $language),
                "conversations" => array_sum(array_map(fn($row) => (int) ($row["conversations"] ?? 0), $group)),
                "conversions" => array_sum(array_map(fn($row) => (int) ($row["conversions"] ?? 0), $group)),
            ];
        }
        return '<div class="chart-grid">'
            . $this->metric_chart_html($points, "conversations", $labels["conversations"], $period_days, $chunk_size, (int) ($current["conversations"] ?? 0), (int) ($previous["conversations"] ?? 0), $labels, $language, "conversation")
            . $this->metric_chart_html($points, "conversions", $labels["conversion_actions"], $period_days, $chunk_size, (int) ($current["conversions"] ?? 0), (int) ($previous["conversions"] ?? 0), $labels, $language, "conversion")
            . '</div>';
    }

    private function compact_date_label(string $first, string $last, string $language): string
    {
        $first_time = strtotime($first);
        $last_time = strtotime($last);
        if (!$first_time || !$last_time) {
            return "–";
        }
        $first_label = $language === "it" ? gmdate("d/m", $first_time) : gmdate("M j", $first_time);
        if ($first === $last) {
            return $first_label;
        }
        $last_label = $language === "it" ? gmdate("d/m", $last_time) : gmdate("M j", $last_time);
        return $first_label . "–" . $last_label;
    }

    private function nice_axis_max(int $value): int
    {
        if ($value <= 4) {
            return max(1, $value);
        }
        $magnitude = 10 ** floor(log10($value));
        $normalized = $value / $magnitude;
        $nice = $normalized <= 1
            ? 1
            : ($normalized <= 1.5
                ? 1.5
                : ($normalized <= 2
                    ? 2
                    : ($normalized <= 2.5 ? 2.5 : ($normalized <= 5 ? 5 : 10))));
        return (int) ceil($nice * $magnitude);
    }

    private function metric_chart_html(
        array $points,
        string $key,
        string $title,
        int $period_days,
        int $group_size,
        int $period_total,
        int $previous_total,
        array $labels,
        string $language,
        string $class_name
    ): string {
        $values = array_map(fn($point) => (int) ($point[$key] ?? 0), $points);
        $series_total = array_sum($values);
        $axis_max = $this->nice_axis_max(max(1, ...$values));
        $axis_mid = $axis_max / 2;
        $average = $period_days > 0 ? $series_total / $period_days : 0;
        $group_label = $group_size === 1
            ? $labels["daily_totals"]
            : ($group_size === 7
                ? $labels["weekly_totals"]
                : sprintf($labels["multi_day_totals"], $group_size));
        $bars = "";
        $table_rows = "";
        $point_count = count($points);
        $label_every = max(1, (int) ceil($point_count / 5));
        foreach ($points as $index => $point) {
            $value = (int) ($point[$key] ?? 0);
            $height = $value > 0 ? max(3, round(($value / $axis_max) * 100)) : 0;
            $show_label = $index === 0 || $index === $point_count - 1 || $index % $label_every === 0;
            $label = (string) ($point["label"] ?? "");
            $bars .= '<div class="metric-column" title="' . esc_attr($label . ": " . $value) . '"><i style="height:' . esc_attr((string) $height) . '%"></i>'
                . ($show_label ? '<span>' . esc_html($label) . '</span>' : "") . '</div>';
            $table_rows .= '<tr><th scope="row">' . esc_html($label) . '</th><td>' . esc_html(number_format_i18n($value)) . '</td></tr>';
        }
        return '<article class="metric-chart ' . esc_attr($class_name) . '-chart"><div class="metric-chart-head"><div><span>' . esc_html($title) . '</span><strong>' . esc_html(number_format_i18n($period_total)) . $this->delta_chip($period_total, $previous_total, $language) . '</strong><em>' . esc_html($labels["period_total"]) . '</em></div><p><b>' . esc_html(number_format_i18n($average, 1)) . '</b> ' . esc_html($labels["average_per_day"]) . '<small>' . esc_html($group_label) . '</small></p></div><div class="metric-plot" role="img" aria-label="' . esc_attr($title) . '"><div class="metric-scale"><span>' . esc_html(number_format_i18n($axis_max)) . '</span><span>' . esc_html(number_format_i18n($axis_mid, floor($axis_mid) == $axis_mid ? 0 : 1)) . '</span><span>0</span></div><div class="metric-gridlines"></div><div class="metric-bars">' . $bars . '</div></div><table class="visually-hidden"><caption>' . esc_html($title) . '</caption><tbody>' . $table_rows . '</tbody></table></article>';
    }

    private function comparison_html(
        array $rows,
        array $current,
        array $previous,
        array $labels,
        string $language
    ): string {
        $html = '<div class="comparison-list">';
        foreach ($rows as [$label, $value, $key]) {
            $current_value = (int) $value;
            $previous_value = (int) ($previous[$key] ?? 0);
            $maximum = max(1, $current_value, $previous_value);
            $current_width = round(($current_value / $maximum) * 100);
            $previous_width = round(($previous_value / $maximum) * 100);
            $html .= '<div class="comparison-row"><div class="comparison-name">' . $this->icon_svg($key) . '<span>' . esc_html($label) . '</span></div><div class="comparison-bars"><div><i class="current-bar" style="width:' . esc_attr((string) $current_width) . '%"></i></div><div><i class="previous-bar" style="width:' . esc_attr((string) $previous_width) . '%"></i></div></div><div class="comparison-values"><strong>' . esc_html(number_format_i18n($current_value)) . '</strong><span>' . esc_html(number_format_i18n($previous_value)) . '</span></div><div class="comparison-change">' . $this->delta_chip($current_value, $previous_value, $language) . '</div></div>';
        }
        return $html . '</div>';
    }

    private function conversion_breakdown_html(
        array $rows,
        array $current,
        array $previous,
        int $total_conversions,
        array $labels,
        string $language
    ): string {
        $previous_total = (int) ($previous["conversions"] ?? 0);
        $maximum = 1;
        foreach ($rows as $row) {
            $maximum = max(
                $maximum,
                (int) ($current[$row[2]] ?? 0),
                (int) ($previous[$row[2]] ?? 0)
            );
        }
        $html = '<div class="outcome-summary"><div><span>' . esc_html($labels["current_period"]) . '</span><strong>' . esc_html(number_format_i18n($total_conversions)) . '</strong></div><div><span>' . esc_html($labels["previous_period"]) . '</span><strong>' . esc_html(number_format_i18n($previous_total)) . '</strong></div></div><div class="outcome-columns"><span>' . esc_html($labels["outcome_type"]) . '</span><span>' . esc_html($labels["volume_comparison"]) . '</span><span>' . esc_html($labels["current_previous_short"]) . '</span><span>' . esc_html($labels["share_of_actions"]) . '</span></div><div class="conversion-list">';
        foreach ($rows as [$icon, $label, $key]) {
            $value = (int) ($current[$key] ?? 0);
            $previous_value = (int) ($previous[$key] ?? 0);
            $current_width = round(($value / $maximum) * 100);
            $previous_width = round(($previous_value / $maximum) * 100);
            $share = $total_conversions > 0 ? round(($value / $total_conversions) * 100) : 0;
            $html .= '<div class="conversion-row"><div class="conversion-name">' . $this->icon_svg($icon) . '<span>' . esc_html($label) . '</span></div><div class="outcome-bars"><div><i class="current-bar" style="width:' . esc_attr((string) $current_width) . '%"></i></div><div><i class="previous-bar" style="width:' . esc_attr((string) $previous_width) . '%"></i></div></div><div class="outcome-values"><strong>' . esc_html(number_format_i18n($value)) . '</strong><span>' . esc_html(number_format_i18n($previous_value)) . '</span></div><div class="outcome-share"><strong>' . esc_html((string) $share) . '%</strong>' . $this->delta_chip($value, $previous_value, $language) . '</div></div>';
        }
        return $html . '</div>';
    }

    private function efficiency_html(array $current, array $labels, string $language): string
    {
        $conversations = (int) ($current["conversations"] ?? 0);
        $conversions = (int) ($current["conversions"] ?? 0);
        $replies = (int) ($current["assistant_replies"] ?? 0);
        $escalations = (int) ($current["escalations"] ?? 0);
        $feedback_count = (int) ($current["feedback_count"] ?? 0);
        $decimal = $language === "it" ? "," : ".";
        $format_decimal = fn(float $value) => str_replace(".", $decimal, number_format($value, 1, ".", ""));
        $zero = $format_decimal(0);
        $signals = [
            ["conversions", $labels["actions_per_100"], $conversations ? $format_decimal(($conversions / $conversations) * 100) : $zero, $labels["actions_per_100_note"]],
            ["assistant_replies", $labels["replies_per_conversation"], $conversations ? $format_decimal($replies / $conversations) : $zero, $labels["replies_per_conversation_note"]],
            ["team", $labels["handoff_rate"], $conversations ? $format_decimal(($escalations / $conversations) * 100) : $zero, $labels["handoff_rate_note"]],
            ["rating", $labels["feedback_score"], $feedback_count ? $format_decimal((float) ($current["feedback_average"] ?? 0)) . "/5" : "–", $feedback_count ? sprintf($labels["feedback_count"], number_format_i18n($feedback_count)) : $labels["no_feedback"]],
        ];
        $html = '<div class="efficiency-grid">';
        foreach ($signals as [$icon, $label, $value, $note]) {
            $html .= '<article class="efficiency-card"><div>' . $this->icon_svg($icon) . '<span>' . esc_html($label) . '</span></div><strong>' . esc_html($value) . '</strong><p>' . esc_html($note) . '</p></article>';
        }
        return $html . '</div>';
    }

    private function format_date(string $value, string $language): string
    {
        $timestamp = strtotime($value);
        if (!$timestamp) {
            return "–";
        }
        return $language === "it" ? gmdate("d/m/Y", $timestamp) : gmdate("M j, Y", $timestamp);
    }

    private function money(int $cents, string $currency, string $language): string
    {
        $symbols = ["EUR" => "€", "USD" => "$", "GBP" => "£"];
        $number = number_format($cents / 100, 2, $language === "it" ? "," : ".", $language === "it" ? "." : ",");
        return ($symbols[$currency] ?? $currency . " ") . $number;
    }

    private function trend(int $current, int $previous, string $language): string
    {
        if ($previous === 0) {
            if ($current === 0) {
                return $language === "it" ? "Nessuna variazione" : "No change";
            }
            return $language === "it" ? "Nuovo nel periodo" : "New in this period";
        }
        $change = (int) round((($current - $previous) / $previous) * 100);
        if ($change === 0) {
            return $language === "it" ? "In linea col periodo precedente" : "In line with the previous period";
        }
        $prefix = $change > 0 ? "+" : "";
        return $prefix . $change . "% " . ($language === "it" ? "vs periodo precedente" : "vs previous period");
    }

    private function labels(string $language): array
    {
        if ($language === "en") {
            return [
                "title" => "AlphaRecall performance report",
                "performance_report" => "Performance report",
                "secure_snapshot" => "Secure snapshot",
                "generated_on" => "Generated",
                "prepared_by" => "Prepared by",
                "save_pdf" => "Save as PDF",
                "period_highlight" => "Period highlight",
                "estimated_value" => "Estimated potential value",
                "conversion_actions" => "Conversion actions",
                "conversations" => "Conversations handled",
                "visitors" => "Visitors engaged",
                "assistant_replies" => "Assistant replies",
                "summary" => "In this period, AlphaRecall handled %1\$s conversations and brought in %2\$s measurable conversion actions.",
                "performance_eyebrow" => "Activity over time",
                "performance_title" => "Performance over time",
                "performance_note" => "Conversations and business actions use separate scales, so both stay easy to read.",
                "average_per_day" => "average per day",
                "period_total" => "Period total",
                "daily_totals" => "Bars: daily totals",
                "weekly_totals" => "Bars: weekly totals",
                "multi_day_totals" => "Bars: up to %s-day totals",
                "comparison_eyebrow" => "Period over period",
                "comparison_title" => "Performance comparison",
                "current_period" => "Current period",
                "previous_period" => "Previous period",
                "outcomes_eyebrow" => "Measurable outcomes",
                "outcomes_title" => "Conversion activity",
                "outcomes_note" => "Exact numbers for each type, compared with the previous period, and their share of all actions.",
                "outcome_type" => "Outcome",
                "volume_comparison" => "Volume comparison",
                "current_previous_short" => "Current / previous",
                "share_of_actions" => "Share / change",
                "contact_requests" => "Contact requests",
                "email_leads" => "Email leads",
                "appointments" => "Appointments",
                "registrations" => "Registrations",
                "efficiency_eyebrow" => "How it's working",
                "efficiency_title" => "Efficiency and quality signals",
                "efficiency_note" => "Ratios keep results comparable even when traffic changes.",
                "actions_per_100" => "Actions per 100 conversations",
                "actions_per_100_note" => "Business actions brought in for every 100 conversations.",
                "replies_per_conversation" => "Replies per conversation",
                "replies_per_conversation_note" => "How many replies the assistant gives in an average conversation.",
                "handoff_rate" => "Handoffs per 100 conversations",
                "handoff_rate_note" => "Conversations passed to your team for every 100 handled.",
                "feedback_score" => "Average feedback",
                "feedback_count" => "Based on %s ratings.",
                "no_feedback" => "No feedback was submitted in this period.",
                "impact_eyebrow" => "Business impact",
                "impact_title" => "Estimated value brought",
                "impact_note" => "Based on the values set by the account owner.",
                "time_saved" => "Estimated team time saved",
                "footer_line" => "AI conversations turned into measurable outcomes.",
                "methodology" => "This snapshot is based on real AlphaRecall activity. Value and time figures are estimates based on the account's settings, not confirmed sales or revenue.",
                "no_activity" => "No activity to report for this period.",
            ];
        }
        return [
            "title" => "Report performance AlphaRecall",
            "performance_report" => "Report performance",
            "secure_snapshot" => "Snapshot protetto",
            "generated_on" => "Generato il",
            "prepared_by" => "Preparato da",
            "save_pdf" => "Salva come PDF",
            "period_highlight" => "Risultato principale",
            "estimated_value" => "Valore potenziale stimato",
            "conversion_actions" => "Azioni di conversione",
            "conversations" => "Conversazioni gestite",
            "visitors" => "Visitatori coinvolti",
            "assistant_replies" => "Risposte dell'assistente",
            "summary" => "In questo periodo AlphaRecall ha gestito %1\$s conversazioni e portato %2\$s azioni di conversione misurabili.",
            "performance_eyebrow" => "Attività nel tempo",
            "performance_title" => "Performance nel tempo",
            "performance_note" => "Conversazioni e azioni commerciali hanno scale separate, così si leggono bene entrambe.",
            "average_per_day" => "media giornaliera",
            "period_total" => "Totale del periodo",
            "daily_totals" => "Barre: totali giornalieri",
            "weekly_totals" => "Barre: totali settimanali",
            "multi_day_totals" => "Barre: totali fino a %s giorni",
            "comparison_eyebrow" => "Confronto tra periodi",
            "comparison_title" => "Confronto delle performance",
            "current_period" => "Periodo attuale",
            "previous_period" => "Periodo precedente",
            "outcomes_eyebrow" => "Risultati misurabili",
            "outcomes_title" => "Attività di conversione",
            "outcomes_note" => "Numeri esatti per tipo, confronto con il periodo precedente e peso sul totale delle azioni.",
            "outcome_type" => "Risultato",
            "volume_comparison" => "Confronto volumi",
            "current_previous_short" => "Attuale / precedente",
            "share_of_actions" => "Peso / variazione",
            "contact_requests" => "Richieste di contatto",
            "email_leads" => "Lead email",
            "appointments" => "Appuntamenti",
            "registrations" => "Registrazioni",
            "efficiency_eyebrow" => "Come sta andando",
            "efficiency_title" => "Indicatori di efficienza e qualità",
            "efficiency_note" => "I rapporti rendono i risultati confrontabili anche quando cambia il traffico.",
            "actions_per_100" => "Azioni ogni 100 conversazioni",
            "actions_per_100_note" => "Azioni commerciali portate a casa ogni 100 conversazioni.",
            "replies_per_conversation" => "Risposte per conversazione",
            "replies_per_conversation_note" => "Quante risposte dà in media l'assistente in una conversazione.",
            "handoff_rate" => "Passaggi al team ogni 100 conversazioni",
            "handoff_rate_note" => "Conversazioni passate al tuo team ogni 100 gestite.",
            "feedback_score" => "Feedback medio",
            "feedback_count" => "Su %s valutazioni.",
            "no_feedback" => "Nessun feedback ricevuto in questo periodo.",
            "impact_eyebrow" => "Impatto sul business",
            "impact_title" => "Valore stimato generato",
            "impact_note" => "Calcolato in base ai valori impostati dal titolare dell'account.",
            "time_saved" => "Tempo risparmiato dal team (stima)",
            "footer_line" => "Conversazioni AI trasformate in risultati misurabili.",
            "methodology" => "Questo snapshot si basa sull'attività reale di AlphaRecall. Valore e tempo sono stime basate sulle impostazioni dell'account, non vendite o ricavi confermati.",
            "no_activity" => "Nessuna attività da mostrare per questo periodo.",
        ];
    }

    private function icon_svg(string $name): string
    {
        $paths = [
            "conversations" => '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/>',
            "conversions" => '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-7"/>',
            "visitors" => '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
            "assistant_replies" => '<path d="M12 8V4H8"/><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M9 13v2M15 13v2M2 14h2M20 14h2"/>',
            "contact" => '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>',
            "mail" => '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
            "calendar" => '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M9 16l2 2 4-4"/>',
            "registration" => '<path d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>',
            "value" => '<circle cx="12" cy="12" r="9"/><path d="M16 8.5c-.8-.8-2-1.2-3.5-1.2-2 0-3.5 1-3.5 2.5s1.2 2.1 3.5 2.7 3.5 1.2 3.5 2.7-1.5 2.5-3.5 2.5c-1.5 0-2.8-.4-3.7-1.3M12 5v14"/>',
            "time" => '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
            "team" => '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 11 2 2 4-4"/>',
            "rating" => '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1z"/>',
            "print" => '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
            "secure" => '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
        ];
        $path = $paths[$name] ?? $paths["conversations"];
        return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' . $path . '</svg>';
    }

    /**
     * The report's stylesheet and print script (assets/css/report.css,
     * assets/js/report.js), printed by render_report() through
     * wp_print_styles() / wp_print_scripts(). The accent of the record is the
     * only inline rule.
     */
    private function register_report_assets(string $accent): void
    {
        $version = defined("ALPHARECALL_PLUGIN_VERSION") ? ALPHARECALL_PLUGIN_VERSION : null;
        wp_register_style("alpharecall-report", ALPHARECALL_PLUGIN_URL . "assets/css/report.css", [], $version);
        wp_add_inline_style("alpharecall-report", ":root{--accent:" . $accent . "}");
        wp_register_script("alpharecall-report", ALPHARECALL_PLUGIN_URL . "assets/js/report.js", [], $version, false);
    }

    /** Origin (scheme://host[:port]) the plugin's assets load from, for the report's CSP. */
    private function asset_origin(): string
    {
        $parts = wp_parse_url(ALPHARECALL_PLUGIN_URL);
        if (!is_array($parts) || empty($parts["host"])) {
            return "'self'";
        }
        $scheme = ($parts["scheme"] ?? "") === "http" ? "http" : "https";
        return $scheme . "://" . $parts["host"] . (isset($parts["port"]) ? ":" . (int) $parts["port"] : "");
    }
}
