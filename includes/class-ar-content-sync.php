<?php

if (!defined("ABSPATH")) {
    exit;
}

/**
 * Keeps the assistant's copy of the site's pages and posts current.
 *
 * The index only changed when someone pressed "Sincronizza": an owner who
 * fixed the address on the contact page kept getting the old (theme demo)
 * address in the chat until the next manual sync, which never came. Now any
 * edit to a published page or post, a publish, an unpublish or a trash queues
 * one incremental sync a few minutes later. Edits made in the meantime fold
 * into that same run (one scheduled event at a time), unchanged pages are
 * skipped by their content hash on the API side, and pages gone from the site
 * are dropped from the index there.
 */
class AlphaRecall_Content_Sync
{
    public const SYNC_HOOK = "alpharecall_content_changed_sync";
    /** Long enough for a burst of edits (or a page builder's several saves) to become one run. */
    public const DELAY_SECONDS = 5 * MINUTE_IN_SECONDS;
    public const RETRY_SECONDS = 30 * MINUTE_IN_SECONDS;
    private const POST_TYPES = ["page", "post"];
    /** What the owner last chose to sync (Contenuti, onboarding): pages, posts or both. */
    public const SCOPE_OPTION = "alpharecall_sync_scope";

    private static ?AlphaRecall_Content_Sync $instance = null;

    public static function get_instance(): AlphaRecall_Content_Sync
    {
        if (!self::$instance) {
            self::$instance = new AlphaRecall_Content_Sync();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action("transition_post_status", [$this, "post_status_changed"], 20, 3);
        // A permanent delete of a published page skips the trash, and with it
        // transition_post_status.
        add_action("before_delete_post", [$this, "post_deleted"], 20, 2);
        add_action(self::SYNC_HOOK, [$this, "run_sync"]);
    }

    public static function deactivate(): void
    {
        wp_clear_scheduled_hook(self::SYNC_HOOK);
    }

    /**
     * Fires on every save, including a published page saved again unchanged
     * in status: that is the edit case. Drafts, autosaves and revisions never
     * reach visitors, so they are not a reason to sync.
     */
    public function post_status_changed($new_status, $old_status, $post): void
    {
        if (!self::should_sync($new_status, $old_status, $post)) {
            return;
        }
        self::schedule(self::DELAY_SECONDS);
    }

    public function post_deleted($post_id, $post = null): void
    {
        if ($post instanceof WP_Post && self::should_sync("trash", (string) ($post->post_status ?? ""), $post)) {
            self::schedule(self::DELAY_SECONDS);
        }
    }

    /** Remember the owner's choice of pages and posts, so an automatic sync reads the same. */
    public static function remember_scope(array $payload): void
    {
        update_option(self::SCOPE_OPTION, [
            "include_posts" => !empty($payload["include_posts"]),
            "include_pages" => !empty($payload["include_pages"]),
        ], false);
    }

    /** Pages and posts unless the owner chose otherwise; a site that never synced reads both. */
    public static function scope(): array
    {
        $saved = get_option(self::SCOPE_OPTION, []);
        $saved = is_array($saved) ? $saved : [];
        return [
            "include_posts" => (bool) ($saved["include_posts"] ?? true),
            "include_pages" => (bool) ($saved["include_pages"] ?? true),
        ];
    }

    public static function should_sync($new_status, $old_status, $post): bool
    {
        if (!($post instanceof WP_Post) || !in_array($post->post_type, self::POST_TYPES, true)) {
            return false;
        }
        // A post on a site that syncs only pages (or the reverse) changes nothing indexed.
        $scope = self::scope();
        if (!$scope[$post->post_type === "post" ? "include_posts" : "include_pages"]) {
            return false;
        }
        if (wp_is_post_revision($post) || wp_is_post_autosave($post)) {
            return false;
        }
        // Visible before or after: an edit, a publish, an unpublish, a trash.
        if ($new_status !== "publish" && $old_status !== "publish") {
            return false;
        }
        $options = AlphaRecall_Settings::get_options();
        return (int) ($options["tenant_id"] ?? 0) > 0;
    }

    private static function schedule(int $delay): void
    {
        if (wp_next_scheduled(self::SYNC_HOOK)) {
            return;
        }
        wp_schedule_single_event(time() + $delay, self::SYNC_HOOK);
    }

    public function run_sync(): void
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return;
        }
        $exclude_patterns = [];
        foreach ((array) ($options["exclude_page_ids"] ?? []) as $page_id) {
            $url = get_permalink((int) $page_id);
            if ($url) {
                $exclude_patterns[] = $url;
            }
        }
        $scope = self::scope();
        if (!$scope["include_posts"] && !$scope["include_pages"]) {
            return;
        }
        // The same request the Contenuti page sends: incremental, through the
        // WordPress REST API, the pages and posts the owner chose to sync.
        $result = AlphaRecall_Client::get_instance()->start_ingestion($tenant_id, [
            "include_posts" => $scope["include_posts"],
            "include_pages" => $scope["include_pages"],
            "exclude_patterns" => $exclude_patterns,
            "mode" => "wp_api",
            "replace_all" => false,
            "site_url" => home_url(),
        ]);
        if (is_wp_error($result)) {
            // The API was unreachable or busy: the edit must still land, later.
            self::schedule(self::RETRY_SECONDS);
        }
    }
}
