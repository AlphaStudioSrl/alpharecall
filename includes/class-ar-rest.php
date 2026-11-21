<?php

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_Rest
{
    private static ?AlphaRecall_Rest $instance = null;
    private const CHAT_RATE_LIMIT_WINDOW = 60;
    private const CHAT_RATE_LIMIT_PER_IP = 60;
    private const CHAT_RATE_LIMIT_PER_SIG = 120;
    private const PUBLIC_MAX_BODY_BYTES = 262144;
    private const ANALYTICS_KINDS = ["conversation", "tool_use", "workflow_invocation"];
    private const ANALYTICS_MAX_DEPTH = 4;
    private const ANALYTICS_MAX_KEYS = 32;
    private const ANALYTICS_MAX_KEY_LENGTH = 64;
    private const ANALYTICS_MAX_STRING_LENGTH = 512;
    private const ANALYTICS_MAX_DATA_BYTES = 2048;
    private const ANALYTICS_MAX_PENDING_EVENTS = 100;
    /** Retry-After for a 429 whose origin gave none (the API limiters count per minute). */
    private const DEFAULT_RETRY_AFTER = 60;
    /**
     * Seconds the chat proxy waits for an answer. A long answer (a table, a
     * list of 40 questions) takes 40-60 s to generate; the old 20 s default
     * turned every one of them into a bare 502. Kept under the ~100 s that a
     * CDN or proxy in front of WordPress allows (Cloudflare answers 524 at
     * 100 s), so this proxy's own coded 504 is what reaches the browser.
     */
    private const CHAT_TIMEOUT = 90;
    /** Machine codes on every 429 body (app/errors.py): the client classifies by these, never by text. */
    private const RATE_LIMIT_CODES = ["rate_limited", "rate_limited_global", "quota_exceeded"];
    /** API 403 codes whose detail is written for the dashboard user (app/security.py, app/main.py). */
    private const USER_FACING_403_CODES = ["support_team_plan_required", "support_profile_limit"];
    /** Seconds until the local limiter that refused this request admits it again. */
    private int $local_retry_after = 0;

    public static function get_instance(): AlphaRecall_Rest
    {
        if (!self::$instance) {
            self::$instance = new AlphaRecall_Rest();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action("rest_api_init", [$this, "register_routes"]);
        add_filter("rest_post_dispatch", [$this, "relay_rate_limit"], 10, 3);
        add_action("alpharecall_log_analytics", [$this, "handle_log_analytics"], 10, 2);
        add_action("wp_ajax_alpharecall_pages", [$this, "ajax_pages"]);
        add_action("wp_ajax_alpharecall_admin", [$this, "ajax_admin"]);
        add_filter("rest_request_before_callbacks", [$this, "refuse_oversized_body"], 10, 3);
        add_action("wp_ajax_alpharecall_support_stream", [$this, "support_chat_stream"]);
    }

    public function register_routes(): void
    {
        register_rest_route("alpharecall/v1", "/health", [
            "methods" => "GET",
            "permission_callback" => "__return_true",
            "callback" => [$this, "health"],
        ]);

        register_rest_route("alpharecall/v1", "/settings", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "get_settings"],
        ]);

        register_rest_route("alpharecall/v1", "/settings", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "update_settings"],
        ]);

        register_rest_route("alpharecall/v1", "/resolve", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "resolve_tenant"],
        ]);

        register_rest_route("alpharecall/v1", "/bootstrap", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "bootstrap_website"],
        ]);

        register_rest_route("alpharecall/v1", "/dashboard", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "dashboard"],
        ]);

        register_rest_route("alpharecall/v1", "/performance-report", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "performance_report"],
        ]);

        register_rest_route("alpharecall/v1", "/knowledge-gaps", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "knowledge_gaps"],
        ]);

        register_rest_route("alpharecall/v1", "/knowledge-gaps/status", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "update_knowledge_gaps"],
        ]);

        register_rest_route("alpharecall/v1", "/top-questions", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "top_questions"],
        ]);

        register_rest_route("alpharecall/v1", "/pages", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "list_pages"],
        ]);

        register_rest_route("alpharecall/v1", "/ingestion", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "run_ingestion"],
        ]);

        register_rest_route("alpharecall/v1", "/ingestion", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "list_ingestions"],
        ]);

        register_rest_route("alpharecall/v1", "/documents", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "list_documents"],
        ]);

        register_rest_route("alpharecall/v1", "/documents/(?P<source_id>[^/]+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_document"],
        ]);

        register_rest_route("alpharecall/v1", "/knowledge/stats", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "knowledge_stats"],
        ]);

        register_rest_route("alpharecall/v1", "/knowledge-upload", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "upload_knowledge"],
        ]);

        register_rest_route("alpharecall/v1", "/knowledge-upload-pdf", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "upload_knowledge_pdf"],
        ]);

        register_rest_route("alpharecall/v1", "/business-profile", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "save_business_profile"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-config", [
            "methods" => "GET",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "chat_config"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-signature", [
            "methods" => "GET",
            // The callback enforces same-origin access and a scoped rate limit;
            // the returned capability is still not visitor authentication.
            "permission_callback" => "__return_true",
            "callback" => [$this, "refresh_chat_signature"],
        ]);

        register_rest_route("alpharecall/v1", "/chat", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "chat"],
        ]);

        // The widget's Stop and Prova's "Ricomincia": stop the question the
        // browser just abandoned (the proxy above cannot tell the API itself).
        register_rest_route("alpharecall/v1", "/chat/cancel", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "chat_cancel"],
        ]);

        register_rest_route("alpharecall/v1", "/tenant-settings", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "get_tenant_settings"],
        ]);

        register_rest_route("alpharecall/v1", "/tenant-settings", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "update_tenant_settings"],
        ]);

        register_rest_route("alpharecall/v1", "/integrations/google-calendar", [
            ["methods" => "GET", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "get_google_calendar_integration"]],
            ["methods" => "PUT", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "update_google_calendar_integration"]],
            ["methods" => "DELETE", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "delete_google_calendar_integration"]],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/google-calendar/oauth/start", [
            "methods" => "POST", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "start_google_calendar_oauth"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/google-calendar/test", [
            "methods" => "POST", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "test_google_calendar_integration"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/google-calendar/metadata", [
            "methods" => "GET", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "get_google_calendar_metadata"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/google-calendar/sync", [
            "methods" => "POST", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "sync_google_calendar_integration"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/google-calendar/availability", [
            "methods" => "POST", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "check_google_calendar_availability"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/google-calendar/deliveries", [
            "methods" => "GET", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "list_google_calendar_deliveries"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/google-calendar/deliveries/(?P<id>\\d+)/replay", [
            "methods" => "POST", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "replay_google_calendar_delivery"],
        ]);

        register_rest_route("alpharecall/v1", "/integrations/woocommerce", [
            ["methods" => "GET", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "get_woocommerce_integration"]],
            ["methods" => "PUT", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "update_woocommerce_integration"]],
            ["methods" => "DELETE", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "delete_woocommerce_integration"]],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/woocommerce/test", [
            "methods" => "POST", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "test_woocommerce_integration"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/woocommerce/sync", [
            "methods" => "POST", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "sync_woocommerce_integration"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/woocommerce/sync-status", [
            "methods" => "GET", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "woocommerce_sync_status"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/woocommerce/order-lookup", [
            "methods" => "POST", "permission_callback" => [$this, "verify_woocommerce_tool_request"], "callback" => [$this, "woocommerce_order_lookup"],
        ]);
        register_rest_route("alpharecall/v1", "/integrations/woocommerce/cart-link", [
            "methods" => "POST", "permission_callback" => [$this, "verify_woocommerce_tool_request"], "callback" => [$this, "woocommerce_cart_link"],
        ]);

        register_rest_route("alpharecall/v1", "/weekly-report/test", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "send_weekly_report_test"],
        ]);

        register_rest_route("alpharecall/v1", "/tenant-retention", [
            "methods" => "PATCH",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "update_tenant_retention"],
        ]);

        // Helpdesk: register specific sub-routes BEFORE generic routes
        register_rest_route("alpharecall/v1", "/helpdesk/reorder", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "reorder_helpdesk"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk/generate", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "generate_helpdesk"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk/import", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "import_helpdesk"],
        ]);

        register_rest_route("alpharecall/v1", "/branding/detect", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "detect_branding"],
            "args" => [
                "force" => [
                    "type" => "boolean",
                    "default" => false,
                    "sanitize_callback" => "rest_sanitize_boolean",
                ],
            ],
        ]);

        register_rest_route("alpharecall/v1", "/persona/generate", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "generate_persona"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "list_helpdesk"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "create_helpdesk"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk/(?P<id>\\d+)", [
            "methods" => ["POST", "PUT"],
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "update_helpdesk"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_helpdesk"],
        ]);

        // Helpdesk categories
        register_rest_route("alpharecall/v1", "/helpdesk/categories", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "list_helpdesk_categories"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk/categories", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "create_helpdesk_category"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk/categories/(?P<id>\\d+)", [
            "methods" => ["POST", "PUT"],
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "update_helpdesk_category"],
        ]);

        register_rest_route("alpharecall/v1", "/helpdesk/categories/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_helpdesk_category"],
        ]);

        // Support profiles
        register_rest_route("alpharecall/v1", "/support-profiles", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_support_profiles"],
        ]);

        register_rest_route("alpharecall/v1", "/support-profiles/limit", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "support_profiles_limit"],
        ]);

        register_rest_route("alpharecall/v1", "/support-profiles", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "create_support_profile"],
        ]);

        register_rest_route("alpharecall/v1", "/support-profiles/(?P<id>\\d+)", [
            "methods" => ["POST", "PUT"],
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "update_support_profile"],
        ]);

        register_rest_route("alpharecall/v1", "/support-profiles/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_support_profile"],
        ]);

        // Team management routes (sub-project #15)
        register_rest_route("alpharecall/v1", "/team/me", [
            "methods"             => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback"            => [$this, "team_me"],
        ]);
        register_rest_route("alpharecall/v1", "/team/members", [
            [
                // Listing is gated server-side to active members / team.manage.
                "methods"             => "GET",
                "permission_callback" => [$this, "require_admin"],
                "callback"            => [$this, "team_list_members"],
            ],
            [
                // Mutations are owner-only (manage_options) to match the spec; the
                // backend also enforces team.manage as defense-in-depth.
                "methods"             => "POST",
                "permission_callback" => [$this, "require_wp_admin"],
                "callback"            => [$this, "team_add_member"],
            ],
        ]);
        register_rest_route("alpharecall/v1", "/team/members/(?P<id>\\d+)", [
            [
                "methods"             => "PATCH",
                "permission_callback" => [$this, "require_wp_admin"],
                "callback"            => [$this, "team_update_member"],
            ],
            [
                "methods"             => "DELETE",
                "permission_callback" => [$this, "require_wp_admin"],
                "callback"            => [$this, "team_delete_member"],
            ],
        ]);

        register_rest_route("alpharecall/v1", "/ip-rules", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "list_ip_rules"],
        ]);

        register_rest_route("alpharecall/v1", "/ip-rules", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "create_ip_rule"],
        ]);

        register_rest_route("alpharecall/v1", "/ip-rules/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_ip_rule"],
        ]);

        register_rest_route("alpharecall/v1", "/conversations", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_conversations"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_chat_threads"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads/counts", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "chat_thread_counts"],
        ]);
        register_rest_route("alpharecall/v1", "/chat-threads/read", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "read_chat_threads"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads/(?P<id>\\d+)", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "get_chat_thread"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads/(?P<id>\\d+)/favorite", [
            "methods" => "PUT",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "favorite_chat_thread"],
        ]);
        register_rest_route("alpharecall/v1", "/chat-threads/(?P<id>\\d+)/read", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "read_chat_thread"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads/(?P<id>\\d+)/messages", [
            "methods" => "GET",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "list_chat_thread_messages"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads/(?P<id>\\d+)/messages", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "create_chat_thread_message"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads/(?P<id>\\d+)/generate-title", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "generate_chat_thread_title"],
        ]);

        // GDPR Phase 1 — DSR proxy routes.
        // Admin-only: the RBAC model reserves gdpr.manage for owner/admin, so the
        // support role must not be able to export or erase visitor personal data.
        register_rest_route("alpharecall/v1", "/gdpr/visitors/(?P<token>[A-Za-z0-9_\\-]+)/export", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "gdpr_export_visitor"],
        ]);

        register_rest_route("alpharecall/v1", "/gdpr/visitors/(?P<token>[A-Za-z0-9_\\-]+)/erase", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "gdpr_erase_visitor"],
        ]);

        register_rest_route("alpharecall/v1", "/gdpr/visitors/(?P<token>[A-Za-z0-9_\\-]+)/rectify", [
            "methods" => "PATCH",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "gdpr_rectify_visitor"],
        ]);

        // ID-based GDPR routes keep visitor bearer tokens entirely server-side.
        register_rest_route("alpharecall/v1", "/gdpr/visitors/by-id/(?P<id>\\d+)/export", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_wp_admin"],
            "callback" => [$this, "gdpr_export_visitor_by_id"],
        ]);
        register_rest_route("alpharecall/v1", "/gdpr/visitors/by-id/(?P<id>\\d+)/erase", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_wp_admin"],
            "callback" => [$this, "gdpr_erase_visitor_by_id"],
        ]);
        register_rest_route("alpharecall/v1", "/gdpr/visitors/by-id/(?P<id>\\d+)/rectify", [
            "methods" => "PATCH",
            "permission_callback" => [$this, "require_wp_admin"],
            "callback" => [$this, "gdpr_rectify_visitor_by_id"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads/(?P<id>\\d+)", [
            "methods" => "PATCH",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "update_chat_thread"],
        ]);

        register_rest_route("alpharecall/v1", "/chat-threads/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "delete_chat_thread"],
        ]);

        register_rest_route("alpharecall/v1", "/blacklisted-visitors", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_blacklisted_visitors"],
        ]);

        register_rest_route("alpharecall/v1", "/blacklisted-visitors", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "create_blacklisted_visitor"],
        ]);

        register_rest_route("alpharecall/v1", "/blacklisted-visitors/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "delete_blacklisted_visitor"],
        ]);

        // Richieste: support agents read the records and change their status
        // (status_only_for_support); deleting, bulk deletes and the other tool
        // routes stay with admins.
        register_rest_route("alpharecall/v1", "/tools/appointments", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_appointments"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/appointments/(?P<id>\\d+)", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "update_appointment"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/appointments/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_appointment"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/appointments", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_all_appointments"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/leads", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_leads"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/leads/(?P<id>\\d+)", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "update_lead"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/leads/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_lead"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/leads", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_all_leads"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/escalations", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_escalations"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/escalations/(?P<id>\\d+)", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "update_escalation"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/escalations/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_escalation"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/escalations", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "delete_all_escalations"],
        ]);

        register_rest_route("alpharecall/v1", "/tools/products", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "list_products"],
        ]);

        register_rest_route("alpharecall/v1", "/product-sync", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "trigger_product_sync"],
        ]);

        register_rest_route("alpharecall/v1", "/product-sync-status", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "get_product_sync_status"],
        ]);

        register_rest_route("alpharecall/v1", "/upgrade-request", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "upgrade_request"],
        ]);

        register_rest_route("alpharecall/v1", "/analytics", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "log_public_analytics"],
        ]);

        register_rest_route("alpharecall/v1", "/invoke", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "invoke"],
        ]);

        register_rest_route("alpharecall/v1", "/quota", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "quota"],
        ]);

        register_rest_route("alpharecall/v1", "/proxy", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "proxy"],
        ]);

        // Billing routes (Polar.sh integration)
        register_rest_route("alpharecall/v1", "/billing/checkout-status", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_checkout_status"],
        ]);
        register_rest_route("alpharecall/v1", "/billing/checkout", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_checkout"],
        ]);

        register_rest_route("alpharecall/v1", "/billing/plans", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_plans"],
        ]);

        register_rest_route("alpharecall/v1", "/billing/portal", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_portal"],
        ]);

        register_rest_route("alpharecall/v1", "/billing/cancel", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_cancel"],
        ]);

        register_rest_route("alpharecall/v1", "/billing/subscription", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_subscription"],
        ]);

        register_rest_route("alpharecall/v1", "/billing/change-plan", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_change_plan"],
        ]);

        register_rest_route("alpharecall/v1", "/billing/reactivate", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_reactivate"],
        ]);

        register_rest_route("alpharecall/v1", "/billing/orders", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "billing_orders"],
        ]);

        register_rest_route("alpharecall/v1", "/license/refresh", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "license_refresh"],
        ]);

        // Visitor registration (public, signature-verified)
        register_rest_route("alpharecall/v1", "/visitor-register", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "visitor_register"],
        ]);
        register_rest_route("alpharecall/v1", "/visitor-consent-decision", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "visitor_consent_decision"],
        ]);
        // Thumbs up/down on an answer of the visitor's own chat (the API checks ownership).
        register_rest_route("alpharecall/v1", "/chat-messages/(?P<id>\\d+)/rating", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "rate_chat_message"],
        ]);

        register_rest_route("alpharecall/v1", "/visitor-feedback", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "submit_visitor_feedback"],
        ]);
        // The visitor sends or cancels the contact/quote/call-back draft the assistant prepared.
        register_rest_route("alpharecall/v1", "/visitor-request-draft", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "visitor_request_draft"],
        ]);

        // The hand-off card: an e-mail, then optional details, from a visitor waiting for a person.
        register_rest_route("alpharecall/v1", "/visitor-handoff-contact", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "visitor_handoff_contact"],
        ]);
        // Tells the operator a waiting chat was closed or replaced by a new one.
        register_rest_route("alpharecall/v1", "/visitor-presence", [
            "methods" => "POST",
            "permission_callback" => [$this, "verify_public_request"],
            "callback" => [$this, "visitor_presence"],
        ]);

        // Visitor management (support agents)
        register_rest_route("alpharecall/v1", "/visitors", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_visitors"],
        ]);

        register_rest_route("alpharecall/v1", "/visitors/(?P<id>\\d+)", [
            [
                "methods" => "GET",
                "permission_callback" => [$this, "require_support"],
                "callback" => [$this, "get_visitor"],
            ],
            [
                "methods" => "PATCH",
                "permission_callback" => [$this, "require_support"],
                "callback" => [$this, "update_visitor"],
            ],
        ]);

        // WP roles list (admin only; the widget's per-role visibility rules)
        register_rest_route("alpharecall/v1", "/wp-roles", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "list_wp_roles"],
        ]);

        // Team di supporto: who holds the "Supporto AlphaRecall" role (admin only).
        // These grant and revoke that one role and nothing else (AlphaRecall_Support_Role).
        // Any plan (WordPress.org guideline 5): the API, not the plugin, refuses
        // a member's Messaggi and Richieste calls below Business, with a 403
        // support_team_plan_required that relay_forbidden() passes on.
        register_rest_route("alpharecall/v1", "/support-team", [
            [
                "methods" => "GET",
                "permission_callback" => [$this, "require_admin"],
                "callback" => [$this, "list_support_team"],
            ],
            [
                "methods" => "POST",
                "permission_callback" => [$this, "require_admin"],
                "callback" => [$this, "add_support_team_member"],
            ],
        ]);
        register_rest_route("alpharecall/v1", "/support-team/search", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "search_support_team_candidates"],
        ]);
        register_rest_route("alpharecall/v1", "/support-team/invite", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "invite_support_team_member"],
        ]);
        register_rest_route("alpharecall/v1", "/support-team/(?P<id>\\d+)", [
            "methods" => "DELETE",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "remove_support_team_member"],
        ]);

        // Current user's support profile (support agents)
        register_rest_route("alpharecall/v1", "/me/support-profile", [
            [
                "methods" => "GET",
                "permission_callback" => [$this, "require_support"],
                "callback" => [$this, "get_my_support_profile"],
            ],
            [
                "methods" => "POST",
                "permission_callback" => [$this, "require_support"],
                "callback" => [$this, "create_my_support_profile"],
            ],
        ]);

        // WP users list (admin only)
        register_rest_route("alpharecall/v1", "/wp-users", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_wp_admin"],
            "callback" => [$this, "list_wp_users"],
        ]);

        // Support profile user assignment (admin only)
        register_rest_route("alpharecall/v1", "/support-profiles/(?P<id>\\d+)/assign", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_admin"],
            "callback" => [$this, "assign_profile"],
        ]);

        // Support chat thread management (admin + support agents)
        register_rest_route("alpharecall/v1", "/support-chat/threads", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_support_threads"],
        ]);
        register_rest_route("alpharecall/v1", "/support-chat/threads/(?P<id>\\d+)/messages", [
            "methods" => "GET",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "list_support_thread_messages"],
        ]);
        register_rest_route("alpharecall/v1", "/support-chat/threads/(?P<id>\\d+)/close", [
            "methods" => "POST",
            "permission_callback" => [$this, "require_support"],
            "callback" => [$this, "close_support_thread"],
        ]);

        // Events management
        register_rest_route("alpharecall/v1", "/events", [
            ["methods" => "GET", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "list_events"]],
            ["methods" => "POST", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "create_event"]],
        ]);
        register_rest_route("alpharecall/v1", "/events/(?P<id>\\d+)", [
            ["methods" => "PUT", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "update_event"]],
            ["methods" => "DELETE", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "delete_event"]],
        ]);

        // WooCommerce coupon validation (called by backend coupon_check tool, rate-limited)
        register_rest_route("alpharecall/v1", "/wc/validate-coupon", [
            "methods" => "GET", "permission_callback" => [$this, "verify_coupon_request"], "callback" => [$this, "wc_validate_coupon"],
        ]);

        // Contact Submissions (read + status update)
        register_rest_route("alpharecall/v1", "/contact-submissions", [
            "methods" => "GET", "permission_callback" => [$this, "require_support"], "callback" => [$this, "list_contact_submissions"],
        ]);
        register_rest_route("alpharecall/v1", "/contact-submissions/(?P<id>\\d+)", [
            "methods" => "PATCH", "permission_callback" => [$this, "require_support"], "callback" => [$this, "update_contact_submission"],
        ]);
        register_rest_route("alpharecall/v1", "/contact-submissions/(?P<id>\\d+)", [
            "methods" => "DELETE", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "delete_contact_submission"],
        ]);
        register_rest_route("alpharecall/v1", "/contact-submissions", [
            "methods" => "DELETE", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "delete_all_contact_submissions"],
        ]);

        // Per-user UI preferences, stored in WP user meta so the
        // choice follows the user across browsers and machines.
        register_rest_route("alpharecall/v1", "/ui-prefs", [
            ["methods" => "GET", "permission_callback" => [$this, "require_support"], "callback" => [$this, "get_ui_prefs"]],
            ["methods" => "POST", "permission_callback" => [$this, "require_support"], "callback" => [$this, "save_ui_prefs"]],
        ]);

        // Feedback (read + status update)
        register_rest_route("alpharecall/v1", "/feedback", [
            "methods" => "GET", "permission_callback" => [$this, "require_support"], "callback" => [$this, "list_feedback"],
        ]);
        register_rest_route("alpharecall/v1", "/feedback/(?P<id>\\d+)", [
            "methods" => "PATCH", "permission_callback" => [$this, "require_support"], "callback" => [$this, "update_feedback"],
        ]);
        register_rest_route("alpharecall/v1", "/feedback/(?P<id>\\d+)", [
            "methods" => "DELETE", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "delete_feedback"],
        ]);
        register_rest_route("alpharecall/v1", "/feedback", [
            "methods" => "DELETE", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "delete_all_feedback"],
        ]);

        // Event Registrations
        register_rest_route("alpharecall/v1", "/events/(?P<event_id>\\d+)/registrations", [
            "methods" => "GET", "permission_callback" => [$this, "require_admin"], "callback" => [$this, "list_event_registrations"],
        ]);
    }

    public function require_wp_admin(): bool
    {
        return current_user_can("manage_options");
    }

    public function require_admin(): bool
    {
        return current_user_can("manage_options") || current_user_can("alpharecall_admin");
    }

    public function get_ui_prefs(): WP_REST_Response
    {
        $theme = AlphaRecall_Settings::get_user_theme();
        $response = new WP_REST_Response([
            "theme" => $theme !== "" ? $theme : null,
            "notifications" => AlphaRecall_Settings::get_notification_preferences(),
        ]);
        $response->header("Cache-Control", "private, no-store");
        return $response;
    }

    public function save_ui_prefs(WP_REST_Request $request): WP_REST_Response
    {
        $payload = self::json_body($request);
        if (!array_key_exists("theme", $payload) && !array_key_exists("notifications", $payload)) {
            return new WP_REST_Response(["error" => "No UI preferences supplied."], 400);
        }
        if (array_key_exists("theme", $payload) && !in_array($payload["theme"], ["light", "dark"], true)) {
            return new WP_REST_Response(["error" => "Invalid theme."], 400);
        }
        if (array_key_exists("notifications", $payload)) {
            if (!is_array($payload["notifications"])) {
                return new WP_REST_Response(["error" => "Invalid notification preferences."], 400);
            }
            foreach ($payload["notifications"] as $type => $enabled) {
                if (!in_array($type, AlphaRecall_Settings::NOTIFICATION_TYPES, true) || !is_bool($enabled)) {
                    return new WP_REST_Response(["error" => "Invalid notification preference."], 400);
                }
            }
        }
        // Validate the complete patch before changing either preference group.
        if (array_key_exists("theme", $payload)) {
            AlphaRecall_Settings::save_user_theme($payload["theme"]);
        }
        if (array_key_exists("notifications", $payload)) {
            AlphaRecall_Settings::save_notification_preferences($payload["notifications"]);
        }
        return $this->get_ui_prefs();
    }

    /**
     * Messaggi and Richieste: administrators and the Team di supporto role.
     * A member's calls are marked for the API, which refuses them on a plan
     * without the Team di supporto (the plugin does not check the plan).
     */
    public function require_support(): bool
    {
        if (current_user_can("manage_options") || current_user_can("alpharecall_admin")) {
            return true;
        }
        if (current_user_can("alpharecall_support")) {
            AlphaRecall_Client::mark_support_team_scope();
            return true;
        }
        return false;
    }

    /**
     * Verify coupon validation requests: check tenant key header + basic rate limiting.
     * Prevents public enumeration of coupon codes.
     */
    public function verify_coupon_request(WP_REST_Request $request): bool
    {
        $key = $request->get_header("x-tenant-key");
        if (empty($key)) {
            return false;
        }
        $stored_key = AlphaRecall_Client::get_instance()->get_tenant_key();
        if (empty($stored_key) || !hash_equals($stored_key, $key)) {
            return false;
        }
        // Basic rate limit: 10 coupon checks per minute per IP
        $ip = sanitize_text_field(wp_unslash((string) ($_SERVER["REMOTE_ADDR"] ?? "unknown")));
        $transient_key = "alpharecall_coupon_rl_" . md5($ip);
        return $this->rate_limit_check($transient_key, 10, 60);
    }

    /** Verify backend-only WooCommerce tool requests without exposing public order data. */
    public function verify_woocommerce_tool_request(WP_REST_Request $request): bool
    {
        $key = $request->get_header("x-tenant-key");
        $stored_key = AlphaRecall_Client::get_instance()->get_tenant_key();
        if (!$key || !$stored_key || !hash_equals($stored_key, $key)) {
            return false;
        }
        $ip = sanitize_text_field(wp_unslash((string) ($_SERVER["REMOTE_ADDR"] ?? "unknown")));
        $route = (string) $request->get_route();
        $order_lookup = str_ends_with($route, "/order-lookup");
        $bucket = $order_lookup ? "order" : "cart";
        $limit = $order_lookup ? 10 : 60;
        return $this->rate_limit_check("alpharecall_woo_{$bucket}_rl_" . md5($ip), $limit, 60);
    }

    public function health(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        return new WP_REST_Response([
            "connected" => !empty($options["api_base_url"]) && !empty($options["tenant_id"]),
        ]);
    }

    public function get_settings(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        return new WP_REST_Response([
            "tenant_domain" => $options["tenant_domain"],
            "tenant_id" => $options["tenant_id"],
            "tenant_status" => $options["tenant_status"],
            "onboarding_step" => (int) $options["onboarding_step"],
            "onboarding_completed" => (bool) $options["onboarding_completed"],
            "tutorial_completed" => (bool) ($options["tutorial_completed"] ?? false),
            "tutorial_sections" => AlphaRecall_Settings::sanitize_tutorial_sections(
                $options["tutorial_sections"] ?? []
            ),
            "exclude_page_ids" => $options["exclude_page_ids"],
            "business_profile" => $options["business_profile"],
            "tool_preferences" => $options["tool_preferences"] ?? [],
            "tenant_settings" => $options["tenant_settings"] ?? [],
            "chat_config" => $options["chat_config"],
            "integrations" => AlphaRecall_Settings::sanitize_integrations($options["integrations"] ?? []),
        ]);
    }

    private function sanitize_color_or_gradient(string $value, string $fallback): string
    {
        $value = trim($value);
        if ($value === "") {
            return $fallback;
        }
        // Accept valid hex colors
        $hex = sanitize_hex_color($value);
        if ($hex) {
            return $hex;
        }
        // Otherwise only a CSS colour: a colour name, rgb()/hsl(), or a gradient of
        // such colours. Anything else falls back, so no other CSS can be stored.
        if (strlen($value) > 500 || substr_count($value, "(") !== substr_count($value, ")")) {
            return $fallback;
        }
        $color = '(?:\#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,30}|(?:rgba?|hsla?)\([0-9\s,.%\/-]+\))';
        $stop = $color . '(?:\s+[0-9.]+%?){0,2}';
        $gradient = '(?:repeating-)?(?:linear|radial|conic)-gradient\(\s*(?:[a-zA-Z0-9\s.%-]+,\s*)?' . $stop . '(?:\s*,\s*' . $stop . ')+\s*\)';
        if (preg_match('/^(?:' . $color . '|' . $gradient . ')$/', $value) === 1) {
            return $value;
        }
        return $fallback;
    }

    public function update_settings(WP_REST_Request $request): WP_REST_Response
    {
        $current = AlphaRecall_Settings::get_options();
        $payload = self::json_body($request);
        $next = $current;
        if (isset($payload["tenant_domain"])) {
            $next["tenant_domain"] = sanitize_text_field((string) $payload["tenant_domain"]);
        }
        if (isset($payload["onboarding_step"])) {
            $next["onboarding_step"] = max(1, (int) $payload["onboarding_step"]);
        }
        if (isset($payload["onboarding_completed"])) {
            $next["onboarding_completed"] = (bool) $payload["onboarding_completed"];
        }
        if (isset($payload["tutorial_completed"])) {
            $next["tutorial_completed"] = (bool) $payload["tutorial_completed"];
        }
        if (isset($payload["tutorial_sections"])) {
            $next["tutorial_sections"] = AlphaRecall_Settings::sanitize_tutorial_sections(
                $payload["tutorial_sections"]
            );
        }
        if (isset($payload["tenant_settings"])) {
            $next["tenant_settings"] = $this->sanitize_tenant_settings(
                (array) $payload["tenant_settings"],
                (array) ($current["tenant_settings"] ?? [])
            );
        }
        if (isset($payload["integrations"])) {
            $next["integrations"] = AlphaRecall_Settings::sanitize_integrations($payload["integrations"]);
        }
        if (isset($payload["exclude_page_ids"])) {
            $next["exclude_page_ids"] = array_map("intval", (array) $payload["exclude_page_ids"]);
        }
        if (isset($payload["business_profile"])) {
            $profile = (array) $payload["business_profile"];
            $next["business_profile"] = [
                "name" => sanitize_text_field((string) ($profile["name"] ?? "")),
                "description" => sanitize_textarea_field((string) ($profile["description"] ?? "")),
                "tone" => sanitize_text_field((string) ($profile["tone"] ?? "")),
                "policies" => sanitize_textarea_field((string) ($profile["policies"] ?? "")),
                "faqs" => sanitize_textarea_field((string) ($profile["faqs"] ?? "")),
                "contact" => sanitize_text_field((string) ($profile["contact"] ?? "")),
            ];
        }
        if (isset($payload["tool_preferences"])) {
            $prefs = (array) $payload["tool_preferences"];
            $allowed = ["appointment", "email_marketing", "product_search", "escalate"];
            $sanitized = [];
            foreach ($allowed as $key) {
                if (array_key_exists($key, $prefs)) {
                    $sanitized[$key] = (bool) $prefs[$key];
                }
            }
            $next["tool_preferences"] = array_merge($current["tool_preferences"] ?? [], $sanitized);
        }
        if (isset($payload["chat_config"])) {
            $chat = (array) $payload["chat_config"];
            $current_chat = (array) ($current["chat_config"] ?? []);
            // In range, and a non-number ("" from an emptied field) keeps the saved value instead of 0.
            $radius = AlphaRecall_Settings::widget_number("radius", $chat, $current_chat);
            $button_radius = AlphaRecall_Settings::widget_number("buttonRadius", $chat, $current_chat);
            $panel_height = AlphaRecall_Settings::widget_number("panelHeight", $chat, $current_chat);
            $panel_width = AlphaRecall_Settings::widget_number("panelWidth", $chat, $current_chat);
            $font_scale = AlphaRecall_Settings::widget_number("fontScale", $chat, $current_chat);
            $theme_raw = $chat["theme"] ?? ($current_chat["theme"] ?? "system");
            $theme = in_array($theme_raw, ["dark", "light", "system"], true)
                ? $theme_raw
                : "system";
            $primary = $this->sanitize_color_or_gradient(
                (string) ($chat["primaryColor"] ?? $current_chat["primaryColor"] ?? "#1877f2"),
                "#1877f2"
            );
            $accent = $this->sanitize_color_or_gradient(
                (string) ($chat["accentColor"] ?? $current_chat["accentColor"] ?? $primary),
                $primary
            );
            $button = $this->sanitize_color_or_gradient(
                (string) ($chat["buttonColor"] ?? $current_chat["buttonColor"] ?? $primary),
                $primary
            );
            $title = $this->sanitize_color_or_gradient(
                (string) ($chat["titleColor"] ?? $current_chat["titleColor"] ?? "#ffffff"),
                "#ffffff"
            );
            $starter_raw = $chat["starterQuestions"]
                ?? $chat["starter_questions"]
                ?? $current_chat["starterQuestions"]
                ?? $current_chat["starter_questions"]
                ?? [];
            $starter_questions = [];
            if (is_array($starter_raw)) {
                foreach ($starter_raw as $item) {
                    if (!is_scalar($item)) {
                        continue;
                    }
                    $question = sanitize_text_field((string) $item);
                    $question = trim($question);
                    if ($question === "") {
                        continue;
                    }
                    $starter_questions[] = $question;
                    if (count($starter_questions) >= 6) {
                        break;
                    }
                }
            }
            $next["chat_config"] = [
                ...AlphaRecall_Settings::sanitize_widget_appearance($chat, $current_chat),
                ...AlphaRecall_Settings::sanitize_widget_visibility($chat, $current_chat),
                "enabled" => array_key_exists("enabled", $chat)
                    ? !empty($chat["enabled"])
                    : !empty($current_chat["enabled"]),
                "position" => in_array(($chat["position"] ?? ($current_chat["position"] ?? "right")), ["left", "right"], true)
                    ? ($chat["position"] ?? $current_chat["position"])
                    : "right",
                "primaryColor" => $primary,
                "accentColor" => $accent,
                "buttonColor" => $button,
                "titleColor" => $title,
                "launcherLabel" => AlphaRecall_Settings::cap_edited_text(sanitize_text_field((string) ($chat["launcherLabel"] ?? $current_chat["launcherLabel"] ?? "Chiedici")), $current_chat["launcherLabel"] ?? null, AlphaRecall_Settings::LAUNCHER_LABEL_MAX),
                "headerTitle" => AlphaRecall_Settings::cap_edited_text(sanitize_text_field((string) ($chat["headerTitle"] ?? $current_chat["headerTitle"] ?? "AlphaRecall")), $current_chat["headerTitle"] ?? null, AlphaRecall_Settings::HEADER_TITLE_MAX),
                "widgetTitle" => AlphaRecall_Settings::cap_edited_text(sanitize_text_field((string) ($chat["widgetTitle"] ?? $current_chat["widgetTitle"] ?? "Come possiamo aiutarti?")), $current_chat["widgetTitle"] ?? null, AlphaRecall_Settings::WIDGET_TITLE_MAX),
                "logoUrl" => esc_url_raw((string) ($chat["logoUrl"] ?? $current_chat["logoUrl"] ?? "")),
                "logoUrlDark" => AlphaRecall_Settings::image_url($chat["logoUrlDark"] ?? $current_chat["logoUrlDark"] ?? ""),
                "launcherIconUrl" => esc_url_raw((string) ($chat["launcherIconUrl"] ?? $current_chat["launcherIconUrl"] ?? "")),
                "welcomeMessage" => AlphaRecall_Settings::cap_edited_text(sanitize_textarea_field((string) ($chat["welcomeMessage"] ?? $current_chat["welcomeMessage"] ?? "")), $current_chat["welcomeMessage"] ?? null, AlphaRecall_Settings::WELCOME_MESSAGE_MAX),
                "radius" => $radius,
                "buttonRadius" => $button_radius,
                "panelHeight" => $panel_height,
                "panelWidth" => $panel_width,
                "fontScale" => $font_scale,
                "theme" => $theme,
                "marginX" => AlphaRecall_Settings::widget_number("marginX", $chat, $current_chat),
                "marginY" => AlphaRecall_Settings::widget_number("marginY", $chat, $current_chat),
                "starterQuestions" => $starter_questions,
                "starter_questions" => $starter_questions,
                "launcherStyle" => in_array(($chat["launcherStyle"] ?? ($current_chat["launcherStyle"] ?? "pill")), ["pill", "circle", "rounded-square", "text-only"], true)
                    ? ($chat["launcherStyle"] ?? $current_chat["launcherStyle"] ?? "pill")
                    : "pill",
                "widgetStyle" => in_array(($chat["widgetStyle"] ?? ($current_chat["widgetStyle"] ?? "sidepanel")), ["sidepanel", "popup"], true)
                    ? ($chat["widgetStyle"] ?? $current_chat["widgetStyle"])
                    : "sidepanel",
                "launcher_animation" => in_array(($chat["launcher_animation"] ?? ($current_chat["launcher_animation"] ?? "pulse")), ["none", "pulse", "bounce", "wiggle", "breathe", "rubberBand"], true)
                    ? ($chat["launcher_animation"] ?? $current_chat["launcher_animation"])
                    : "pulse",
                "auto_open_delay" => AlphaRecall_Settings::widget_number("auto_open_delay", $chat, $current_chat),
                "auto_open_greeting" => mb_substr(
                    sanitize_text_field((string) ($chat["auto_open_greeting"] ?? $current_chat["auto_open_greeting"] ?? "")),
                    0,
                    200
                ),
                "attention_sound" => in_array(($chat["attention_sound"] ?? ($current_chat["attention_sound"] ?? "none")), ["none", "chime", "pop", "ding", "bubble", "gentle"], true)
                    ? ($chat["attention_sound"] ?? $current_chat["attention_sound"])
                    : "none",
            ];
        }
        // update_option() runs the registered settings sanitizer. Do not pass
        // decrypted credentials through an unrelated partial settings save;
        // the sanitizer preserves the existing encrypted values when these
        // keys are absent.
        unset($next["tenant_key"], $next["auto_create_secret"], $next["chat_config"]["defaultAvatarUrl"]);
        update_option("alpharecall_settings", $next);
        return $this->get_settings($request);
    }

    public function resolve_tenant(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $domain = $options["tenant_domain"];
        if (!$domain) {
            return new WP_REST_Response(["error" => "Website domain missing."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $response = $client->resolve_tenant($domain);
        if (is_wp_error($response)) {
            return new WP_REST_Response(["error" => $response->get_error_message()], 502);
        }
        $options["tenant_id"] = (string) ($response["tenant"]["id"] ?? "");
        $options["tenant_status"] = (string) ($response["tenant"]["status"] ?? "");
        $options["tenant_domain"] = (string) ($response["tenant"]["domain"] ?? $domain);
        update_option(
            "alpharecall_settings",
            array_merge($options, ["tenant_key" => "", "auto_create_secret" => ""])
        );
        return new WP_REST_Response([
            "tenant_id" => $options["tenant_id"],
            "tenant_status" => $options["tenant_status"],
            "tenant_domain" => $options["tenant_domain"],
        ]);
    }

    public function bootstrap_website(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        if (empty($options["api_base_url"])) {
            return new WP_REST_Response(["status" => "pending", "error" => "API base URL is not configured."], 202);
        }
        $domain = $options["tenant_domain"] ?: wp_parse_url(home_url(), PHP_URL_HOST);
        if (!$domain) {
            return new WP_REST_Response(["error" => "Website domain missing."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $response = $client->fetch_tenant_key($domain);
        if (is_wp_error($response)) {
            AlphaRecall_Settings::record_bootstrap_error($options, $response);
            return new WP_REST_Response(
                ["status" => "pending", "error" => $response->get_error_message()],
                202
            );
        }
        // Shared with AlphaRecall_Settings::maybe_bootstrap(): clears pending_bootstrap,
        // applies branding, syncs the prompt and starts the content sync queued
        // during onboarding. Doing this inline here is what previously stranded
        // pending_ingestion.
        $options = AlphaRecall_Settings::finalize_bootstrap($options, $response, $domain);
        return new WP_REST_Response([
            "tenant_id" => $options["tenant_id"],
            "tenant_status" => $options["tenant_status"],
            "tenant_domain" => $options["tenant_domain"],
        ]);
    }

    public function dashboard(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        // Chat summaries include personal favorites/read state.
        $cache_key = "alpharecall_dashboard_" . $tenant_id . "_" . get_current_user_id();
        $cached = get_transient($cache_key);
        if (is_array($cached)) {
            return new WP_REST_Response($cached);
        }
        $client = AlphaRecall_Client::get_instance();
        $domain = (string) ($options["tenant_domain"] ?? "");
        $tenant_info = $domain ? $client->get_current_tenant($domain) : [];
        $quota = $client->quota_check($tenant_id);
        $conversations = $client->list_conversations($tenant_id, 20);
        // Chat threads are the conversations a visitor actually had; the
        // legacy list above is a page of inference turns kept for older bundles.
        // 200, as the inbox list: Oggi's "waiting for a person" rows read these
        // instead of a /chat-threads request of their own.
        $chat_threads = $client->list_chat_threads($tenant_id, 200);
        $ingestions = $client->list_ingestions($tenant_id, 10);
        $analytics = $client->tenant_analytics($tenant_id, 300);
        $page_counts = wp_count_posts("page");
        $post_counts = wp_count_posts("post");
        $content_counts = [
            "pages" => (int) ($page_counts->publish ?? 0),
            "posts" => (int) ($post_counts->publish ?? 0),
        ];
        $payload = [
            "tenant" => is_wp_error($tenant_info) ? [] : $tenant_info,
            "quota" => is_wp_error($quota) ? [] : $quota,
            "conversations" => is_wp_error($conversations) ? [] : $conversations,
            "chat_threads" => is_wp_error($chat_threads) ? ["items" => [], "total" => 0] : $chat_threads,
            "ingestions" => is_wp_error($ingestions) ? [] : $ingestions,
            "analytics" => is_wp_error($analytics) ? [] : $analytics,
            "content_counts" => $content_counts,
            "commerce" => $this->build_commerce_summary(),
        ];
        set_transient($cache_key, $payload, 15);
        return new WP_REST_Response($payload);
    }

    /** Measured totals of the last 7, 30 or 90 days against the period before, with the daily series. */
    public function performance_report(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $days = (int) ($request->get_param("days") ?? 30);
        $result = AlphaRecall_Client::get_instance()->performance_report($tenant_id, $days);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    /** Visitor questions the assistant could not answer, grouped by question. */
    public function knowledge_gaps(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->knowledge_gaps(
            $tenant_id,
            (int) ($request->get_param("days") ?? 30),
            sanitize_key((string) ($request->get_param("status") ?? "open")),
            (int) ($request->get_param("limit") ?? 50)
        );
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    /** Dismiss, resolve (optionally with the FAQ written for it) or reopen knowledge gap groups. */
    public function update_knowledge_gaps(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $body = $request->get_json_params();
        $body = AlphaRecall_Sanitize::json_array(is_array($body) ? $body : $request->get_params());
        $keys = is_array($body["keys"] ?? null) ? array_values(array_map("strval", $body["keys"])) : [];
        $status = (string) ($body["status"] ?? "");
        if (!$keys || !in_array($status, ["open", "dismissed", "resolved"], true)) {
            return new WP_REST_Response(["error" => "Richiesta non valida."], 400);
        }
        $payload = ["keys" => $keys, "status" => $status];
        if (isset($body["helpdesk_entry_id"]) && $body["helpdesk_entry_id"] !== null && $body["helpdesk_entry_id"] !== "") {
            $payload["helpdesk_entry_id"] = (int) $body["helpdesk_entry_id"];
        }
        $result = AlphaRecall_Client::get_instance()->update_knowledge_gaps($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    /** The questions visitors asked most in the last 7, 30 or 90 days. */
    public function top_questions(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->top_questions($tenant_id, (int) ($request->get_param("days") ?? 7));
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function list_pages(WP_REST_Request $request): WP_REST_Response
    {
        $page = max(1, (int) $request->get_param("page"));
        $per_page = (int) $request->get_param("per_page");
        $per_page = $per_page > 0 ? min(50, $per_page) : 20;
        $search = sanitize_text_field((string) ($request->get_param("search") ?? ""));
        $query = new WP_Query([
            "post_type" => "page",
            "post_status" => "publish",
            "posts_per_page" => $per_page,
            "paged" => $page,
            "s" => $search,
            "orderby" => "menu_order",
            "order" => "ASC",
        ]);
        $items = array_map(function ($post) {
            return [
                "id" => $post->ID,
                "title" => $post->post_title,
                "url" => get_permalink($post->ID),
            ];
        }, $query->posts);
        return new WP_REST_Response([
            "items" => $items,
            "page" => $page,
            "per_page" => $per_page,
            "total" => (int) $query->found_posts,
            "total_pages" => (int) $query->max_num_pages,
        ]);
    }

    public function ajax_pages(): void
    {
        if (!current_user_can("manage_options")) {
            wp_send_json_error(["error" => "Unauthorized."], 403);
        }
        $nonce = isset($_REQUEST["nonce"]) ? sanitize_text_field(wp_unslash((string) $_REQUEST["nonce"])) : "";
        if (!wp_verify_nonce($nonce, "alpharecall_admin")) {
            wp_send_json_error(["error" => "Invalid nonce."], 403);
        }
        $request = new WP_REST_Request("GET", "/alpharecall/v1/pages");
        $request->set_param("page", max(1, isset($_REQUEST["page"]) ? absint(wp_unslash($_REQUEST["page"])) : 1));
        $request->set_param("per_page", max(1, min(100, isset($_REQUEST["per_page"]) ? absint(wp_unslash($_REQUEST["per_page"])) : 20)));
        if (isset($_REQUEST["search"])) {
            $request->set_param("search", sanitize_text_field(wp_unslash((string) $_REQUEST["search"])));
        }
        $response = $this->list_pages($request);
        wp_send_json_success($response->get_data());
    }

    public function ajax_admin(): void
    {
        try {
            $route = isset($_REQUEST["route"]) ? sanitize_text_field(wp_unslash((string) $_REQUEST["route"])) : "";
            $method = isset($_REQUEST["method"]) ? strtoupper(sanitize_text_field(wp_unslash((string) $_REQUEST["method"]))) : "GET";
            // Match the REST chat permissions when WordPress REST is unavailable.
            // Support operators must not inherit access to the other admin routes.
            $chat_route = preg_match(
                "#^(?:GET /(?:chat-threads|support-chat/threads)(?:/\\d+(?:/messages)?)?|GET /chat-threads/counts|POST /chat-threads/read|PUT /chat-threads/\\d+/favorite|POST /chat-threads/\\d+/(?:read|messages|generate-title)|(?:PATCH|DELETE) /chat-threads/\\d+|POST /support-chat/threads/\\d+/close|GET /(?:tools/(?:leads|appointments|escalations)|contact-submissions|feedback)|POST /tools/(?:leads|appointments|escalations)/\\d+)$#",
                $method . " " . $route
            ) === 1;
            if (!current_user_can("manage_options") && !($chat_route && $this->require_support())) {
                wp_send_json_error(["error" => "Unauthorized."], 403);
            }
            $nonce = isset($_REQUEST["nonce"]) ? sanitize_text_field(wp_unslash((string) $_REQUEST["nonce"])) : "";
            if (!wp_verify_nonce($nonce, "alpharecall_admin")) {
                wp_send_json_error(["error" => "Invalid nonce."], 403);
            }
            $allowed = [
                "GET /settings" => [$this, "get_settings"],
                "POST /settings" => [$this, "update_settings"],
                "POST /bootstrap" => [$this, "bootstrap_website"],
                "GET /dashboard" => [$this, "dashboard"],
                "GET /performance-report" => [$this, "performance_report"],
                "GET /knowledge-gaps" => [$this, "knowledge_gaps"],
                "POST /knowledge-gaps/status" => [$this, "update_knowledge_gaps"],
                "GET /top-questions" => [$this, "top_questions"],
                "GET /report-share" => [AlphaRecall_Report::get_instance(), "get_share"],
                "POST /report-share" => [AlphaRecall_Report::get_instance(), "create_share"],
                "DELETE /report-share" => [AlphaRecall_Report::get_instance(), "revoke_share"],
                "GET /pages" => [$this, "list_pages"],
                "POST /ingestion" => [$this, "run_ingestion"],
                "GET /knowledge/stats" => [$this, "knowledge_stats"],
                "POST /knowledge-upload" => [$this, "upload_knowledge"],
                "POST /knowledge-upload-pdf" => [$this, "upload_knowledge_pdf"],
                "POST /business-profile" => [$this, "save_business_profile"],
                "GET /tenant-settings" => [$this, "get_tenant_settings"],
                "POST /tenant-settings" => [$this, "update_tenant_settings"],
                "GET /integrations/google-calendar" => [$this, "get_google_calendar_integration"],
                "PUT /integrations/google-calendar" => [$this, "update_google_calendar_integration"],
                "DELETE /integrations/google-calendar" => [$this, "delete_google_calendar_integration"],
                "POST /integrations/google-calendar/oauth/start" => [$this, "start_google_calendar_oauth"],
                "POST /integrations/google-calendar/test" => [$this, "test_google_calendar_integration"],
                "GET /integrations/google-calendar/metadata" => [$this, "get_google_calendar_metadata"],
                "POST /integrations/google-calendar/sync" => [$this, "sync_google_calendar_integration"],
                "POST /integrations/google-calendar/availability" => [$this, "check_google_calendar_availability"],
                "GET /integrations/google-calendar/deliveries" => [$this, "list_google_calendar_deliveries"],
                "GET /integrations/woocommerce" => [$this, "get_woocommerce_integration"],
                "PUT /integrations/woocommerce" => [$this, "update_woocommerce_integration"],
                "DELETE /integrations/woocommerce" => [$this, "delete_woocommerce_integration"],
                "POST /integrations/woocommerce/test" => [$this, "test_woocommerce_integration"],
                "POST /integrations/woocommerce/sync" => [$this, "sync_woocommerce_integration"],
                "GET /integrations/woocommerce/sync-status" => [$this, "woocommerce_sync_status"],
                "PATCH /tenant-retention" => [$this, "update_tenant_retention"],
                "GET /helpdesk" => [$this, "list_helpdesk"],
                "POST /helpdesk" => [$this, "create_helpdesk"],
                "POST /helpdesk/reorder" => [$this, "reorder_helpdesk"],
                "POST /helpdesk/generate" => [$this, "generate_helpdesk"],
                "POST /helpdesk/import" => [$this, "import_helpdesk"],
                "POST /persona/generate" => [$this, "generate_persona"],
                "GET /helpdesk/categories" => [$this, "list_helpdesk_categories"],
                "POST /helpdesk/categories" => [$this, "create_helpdesk_category"],
                "GET /support-profiles" => [$this, "list_support_profiles"],
                "POST /support-profiles" => [$this, "create_support_profile"],
                "GET /support-profiles/limit" => [$this, "support_profiles_limit"],
                "GET /ip-rules" => [$this, "list_ip_rules"],
                "POST /ip-rules" => [$this, "create_ip_rule"],
                "GET /conversations" => [$this, "list_conversations"],
                "GET /chat-threads" => [$this, "list_chat_threads"],
                "GET /chat-threads/counts" => [$this, "chat_thread_counts"],
                "POST /chat-threads/read" => [$this, "read_chat_threads"],
                "GET /tools/appointments" => [$this, "list_appointments"],
                "DELETE /tools/appointments" => [$this, "delete_all_appointments"],
                "GET /tools/leads" => [$this, "list_leads"],
                "DELETE /tools/leads" => [$this, "delete_all_leads"],
                "GET /tools/escalations" => [$this, "list_escalations"],
                "DELETE /tools/escalations" => [$this, "delete_all_escalations"],
                "GET /contact-submissions" => [$this, "list_contact_submissions"],
                "DELETE /contact-submissions" => [$this, "delete_all_contact_submissions"],
                "GET /feedback" => [$this, "list_feedback"],
                "DELETE /feedback" => [$this, "delete_all_feedback"],
                "GET /tools/products" => [$this, "list_products"],
                "POST /product-sync" => [$this, "trigger_product_sync"],
                "GET /product-sync-status" => [$this, "get_product_sync_status"],
                "GET /support-chat/threads" => [$this, "list_support_threads"],
                "POST /ui-prefs" => [$this, "save_ui_prefs"],
                "POST /proxy" => [$this, "proxy"],
                "GET /quota" => [$this, "quota"],
                "POST /upgrade-request" => [$this, "upgrade_request"],
                "GET /billing/subscription" => [$this, "billing_subscription"],
                "GET /billing/plans" => [$this, "billing_plans"],
                "POST /billing/checkout" => [$this, "billing_checkout"],
                "POST /billing/checkout-status" => [$this, "billing_checkout_status"],
                "POST /billing/portal" => [$this, "billing_portal"],
                "POST /billing/cancel" => [$this, "billing_cancel"],
                "POST /billing/change-plan" => [$this, "billing_change_plan"],
                "POST /billing/reactivate" => [$this, "billing_reactivate"],
                "GET /billing/orders" => [$this, "billing_orders"],
                "GET /team/me" => [$this, "team_me"],
                "GET /team/members" => [$this, "team_list_members"],
                "POST /team/members" => [$this, "team_add_member"],
            ];
            $key = $method . " " . $route;
            $callback = $allowed[$key] ?? null;
            $request = new WP_REST_Request($method, "/alpharecall/v1" . $route);
            if (!$callback) {
                if ($method === "GET" && preg_match("#^/chat-threads/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "get_chat_thread"];
                } elseif ($method === "PUT" && preg_match("#^/chat-threads/(\\d+)/favorite$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "favorite_chat_thread"];
                } elseif ($method === "POST" && preg_match("#^/chat-threads/(\\d+)/read$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "read_chat_thread"];
                } elseif ($method === "GET" && preg_match("#^/chat-threads/(\\d+)/messages$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "list_chat_thread_messages"];
                } elseif ($method === "POST" && preg_match("#^/chat-threads/(\\d+)/messages$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "create_chat_thread_message"];
                } elseif (($method === "POST" || $method === "PUT") && preg_match("#^/support-profiles/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "update_support_profile"];
                } elseif ($method === "DELETE" && preg_match("#^/support-profiles/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "delete_support_profile"];
                } elseif (($method === "POST" || $method === "PUT") && preg_match("#^/helpdesk/categories/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "update_helpdesk_category"];
                } elseif ($method === "DELETE" && preg_match("#^/helpdesk/categories/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "delete_helpdesk_category"];
                } elseif (($method === "POST" || $method === "PUT") && preg_match("#^/helpdesk/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "update_helpdesk"];
                } elseif ($method === "DELETE" && preg_match("#^/helpdesk/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "delete_helpdesk"];
                } elseif ($method === "DELETE" && preg_match("#^/ip-rules/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "delete_ip_rule"];
                } elseif ($method === "POST" && preg_match("#^/integrations/google-calendar/deliveries/(\\d+)/replay$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "replay_google_calendar_delivery"];
                } elseif ($method === "POST" && preg_match("#^/tools/appointments/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "update_appointment"];
                } elseif ($method === "DELETE" && preg_match("#^/tools/appointments/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "delete_appointment"];
                } elseif ($method === "POST" && preg_match("#^/tools/leads/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "update_lead"];
                } elseif ($method === "DELETE" && preg_match("#^/tools/leads/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "delete_lead"];
                } elseif ($method === "POST" && preg_match("#^/tools/escalations/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "update_escalation"];
                } elseif ($method === "DELETE" && preg_match("#^/tools/escalations/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "delete_escalation"];
                } elseif ($method === "DELETE" && preg_match("#^/feedback/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "delete_feedback"];
                } elseif ($method === "GET" && preg_match("#^/support-chat/threads/(\\d+)/messages$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "list_support_thread_messages"];
                } elseif ($method === "POST" && preg_match("#^/support-chat/threads/(\\d+)/close$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "close_support_thread"];
                } elseif ($method === "PATCH" && preg_match("#^/team/members/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "team_update_member"];
                } elseif ($method === "DELETE" && preg_match("#^/team/members/(\\d+)$#", $route, $m) === 1) {
                    $request->set_param("id", (int) $m[1]);
                    $callback = [$this, "team_delete_member"];
                }
            }
            if (!$callback) {
                wp_send_json_error(["error" => "Unsupported route."], 400);
            }
            // What the route itself fixed (the id in the path): neither the replayed query
            // parameters nor the replayed body may replace it.
            $from_route = $request->get_params();
            // "params" and "body" are JSON in a form field. Each is sanitized twice: as
            // text before it is decoded (the app escapes "<", ">", "&" and "%" inside the
            // JSON as \uXXXX, so sanitize_textarea_field() removes nothing a person
            // typed), then key by key and value by value once decoded.
            if (isset($_REQUEST["params"])) {
                $query = AlphaRecall_Sanitize::json_array(json_decode(sanitize_textarea_field(wp_unslash($_REQUEST["params"])), true));
                foreach ($query as $param_key => $value) {
                    if (!is_string($param_key) || array_key_exists($param_key, $from_route)) {
                        continue;
                    }
                    $request->set_param($param_key, $value);
                }
            }
            if (isset($_REQUEST["body"])) {
                $decoded = json_decode(sanitize_textarea_field(wp_unslash($_REQUEST["body"])), true);
                if (AlphaRecall_Sanitize::too_large($decoded)) {
                    wp_send_json_error(["error" => "Request body is too large."], 413);
                }
                $body = AlphaRecall_Sanitize::json($decoded);
                if (is_array($body)) {
                    // A JSON body outranks route parameters in WP_REST_Request, so the
                    // keys the route fixed are taken out of it.
                    $body = array_diff_key($body, $from_route);
                    $request->set_header("content-type", "application/json");
                    $request->set_body(wp_json_encode($body));
                }
            }
            // Bounds on the pagination parameters, wherever they came from.
            $req_page = $request->get_param("page");
            if ($req_page !== null) {
                $request->set_param("page", max(1, (int) $req_page));
            }
            $req_per_page = $request->get_param("per_page");
            if ($req_per_page !== null) {
                $request->set_param("per_page", max(1, min(100, (int) $req_per_page)));
            }
            $response = call_user_func($callback, $request);
            if (is_wp_error($response)) {
                $relayed = $this->ajax_relay(new WP_REST_Response(
                    ["error" => $response->get_error_message()],
                    (int) ($response->get_error_data("status") ?? 400)
                ));
                wp_send_json_error($relayed->get_data(), $relayed->get_status());
            }
            if ($response instanceof WP_REST_Response) {
                $response = $this->ajax_relay($response);
                if ($response->get_status() === 429) {
                    wp_send_json_error($response->get_data(), 429);
                }
                wp_send_json_success($response->get_data(), $response->get_status());
            }
            wp_send_json_success($response);
        } catch (Throwable $err) {
            wp_send_json_error(["error" => $err->getMessage()], 500);
        }
    }

    public function list_ingestions(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $limit = (int) ($request->get_param("limit") ?? 5);
        $limit = max(1, min(50, $limit));
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_ingestions($tenant_id, $limit);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function run_ingestion(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            $payload = self::json_body($request);
            $exclude_ids = $options["exclude_page_ids"] ?? [];
            $exclude_patterns = [];
            foreach ($exclude_ids as $page_id) {
                $url = get_permalink((int) $page_id);
                if ($url) {
                    $exclude_patterns[] = $url;
                }
            }
            $options["pending_ingestion"] = AlphaRecall_Sanitize::pending_ingestion([
                "include_posts" => !empty($payload["include_posts"]),
                "include_pages" => !empty($payload["include_pages"]),
                "exclude_patterns" => $exclude_patterns,
                "mode" => $payload["mode"] ?? null,
                "replace_all" => isset($payload["replace_all"]) ? (bool) $payload["replace_all"] : null,
                // Carried through so the deferred run targets the same site the
                // request came from, matching the non-deferred payload below.
                "site_url" => !empty($payload["site_url"]) ? esc_url_raw((string) $payload["site_url"]) : home_url(),
            ]);
            AlphaRecall_Settings::persist($options);
            return new WP_REST_Response(
                ["status" => "pending", "message" => "Website not configured yet."],
                202
            );
        }
        $payload = self::json_body($request);
        $exclude_ids = $options["exclude_page_ids"] ?? [];
        $exclude_patterns = [];
        foreach ($exclude_ids as $page_id) {
            $url = get_permalink((int) $page_id);
            if ($url) {
                $exclude_patterns[] = $url;
            }
        }
        $request_payload = AlphaRecall_Sanitize::pending_ingestion([
            "include_posts" => !empty($payload["include_posts"]),
            "include_pages" => !empty($payload["include_pages"]),
            "exclude_patterns" => $exclude_patterns,
            "mode" => $payload["mode"] ?? null,
            "replace_all" => isset($payload["replace_all"]) ? (bool) $payload["replace_all"] : null,
            "site_url" => !empty($payload["site_url"]) ? esc_url_raw((string) $payload["site_url"]) : home_url(),
        ]);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->start_ingestion($tenant_id, $request_payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        // The sync after a page edit reads what the owner chose here.
        AlphaRecall_Content_Sync::remember_scope($request_payload);
        return new WP_REST_Response($result);
    }

    public function upload_knowledge(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $items = (array) ($payload["items"] ?? []);
        if (!$items) {
            return new WP_REST_Response(["error" => "No items provided."], 400);
        }
        $sanitized = [];
        foreach ($items as $item) {
            $title = sanitize_text_field((string) ($item["title"] ?? "Upload"));
            $text = (string) ($item["text"] ?? "");
            $text = str_replace("\0", "", $text);
            $text = sanitize_textarea_field($text);
            if (!$text) {
                continue;
            }
            if (strlen($text) > 200000) {
                $text = substr($text, 0, 200000);
            }
            $source_url = sanitize_text_field((string) ($item["source_url"] ?? ""));
            $sanitized[] = [
                "title" => $title,
                "text" => $text,
                "source_url" => $source_url,
            ];
        }
        if (!$sanitized) {
            return new WP_REST_Response(["error" => "No valid items."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->upload_knowledge($tenant_id, ["items" => $sanitized]);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function upload_knowledge_pdf(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $files = $request->get_file_params();
        $file = $files["file"] ?? null;
        if (!$file || !isset($file["tmp_name"]) || empty($file["tmp_name"])) {
            return new WP_REST_Response(["error" => "Non hai selezionato nessun PDF."], 400);
        }
        if ($file["error"] !== UPLOAD_ERR_OK) {
            return new WP_REST_Response(["error" => "Il caricamento del file non è riuscito. Riprova."], 400);
        }
        $filename = sanitize_file_name($file["name"] ?? "documento.pdf");
        $tmp_path = $file["tmp_name"];
        $size = (int) ($file["size"] ?? filesize($tmp_path));
        if ($size <= 0) {
            return new WP_REST_Response(["error" => "Questo PDF è vuoto."], 400);
        }
        if ($size > 50 * MB_IN_BYTES) {
            return new WP_REST_Response(["error" => "Il PDF è troppo grande: il limite è 50 MB."], 413);
        }
        if (strtolower((string) pathinfo($filename, PATHINFO_EXTENSION)) !== "pdf") {
            return new WP_REST_Response(["error" => "Puoi caricare solo file .pdf."], 415);
        }
        $magic = file_get_contents($tmp_path, false, null, 0, 5);
        if ($magic !== "%PDF-") {
            return new WP_REST_Response(["error" => "Questo file non sembra un PDF valido."], 415);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->upload_knowledge_pdf($tenant_id, $tmp_path, $filename);
        if (is_wp_error($result)) {
            $status = (int) ($result->get_error_data("status") ?? 502);
            return new WP_REST_Response(["error" => $result->get_error_message()], $status);
        }
        return new WP_REST_Response($result);
    }

    public function knowledge_stats(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->knowledge_stats($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function save_business_profile(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $profile = $this->sanitize_business_profile(self::json_body($request));
        $options["business_profile"] = $profile;
        AlphaRecall_Settings::persist($options);
        if (!$tenant_id) {
            return new WP_REST_Response(
                ["status" => "pending", "message" => "Website not configured yet."],
                202
            );
        }
        $prompt = AlphaRecall_Settings::build_prompt_from_profile($profile);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_prompt($tenant_id, [
            "prompt_text" => $prompt,
            "notes" => "Updated from WordPress onboarding",
        ]);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response(["status" => "ok"]);
    }

    public function chat_config(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        if (!$this->enforce_public_rate_limit($request, "chat_config")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $this->maybe_refresh_auto_config($options);
        $config = (array) ($options["chat_config"] ?? []);
        $tenant_settings = (array) ($options["tenant_settings"] ?? []);
        $helpdesk_entries = [];
        if (!empty($tenant_settings["helpdesk_enabled"])) {
            $tenant_id = (int) ($options["tenant_id"] ?? 0);
            if ($tenant_id) {
                $cache_key = "alpharecall_helpdesk_chat_" . $tenant_id;
                $cached = get_transient($cache_key);
                if (is_array($cached)) {
                    $helpdesk_entries = $cached;
                } else {
                    $client = AlphaRecall_Client::get_instance();
                    $result = $client->list_helpdesk($tenant_id);
                    if (!is_wp_error($result)) {
                        $helpdesk_entries = array_values(array_filter((array) $result, function ($item) {
                            return !empty($item["enabled"]);
                        }));
                        set_transient($cache_key, $helpdesk_entries, 300);
                    }
                }
            }
        }
        $overrides = [
            "helpdeskEntries" => $helpdesk_entries,
            "chatbotName" => (string) ($tenant_settings["chatbot_name"] ?? ""),
            "chatbotTone" => (string) ($tenant_settings["chatbot_tone"] ?? ""),
        ];

        // Greeting and starter questions generated from the site's own content
        // after the first sync. They only apply while this install has not set
        // its own -- anything the client typed in Settings lives in chat_config
        // and wins, which is why these are merged conditionally rather than
        // being listed above.
        if (empty($config["welcomeMessage"]) && !empty($tenant_settings["welcome_message"])) {
            $overrides["welcomeMessage"] = (string) $tenant_settings["welcome_message"];
        }
        $local_starters = [];
        foreach ((array) ($config["starterQuestions"] ?? []) as $question) {
            if (is_string($question) && trim($question) !== "") {
                $local_starters[] = $question;
            }
        }
        if (!$local_starters && !empty($tenant_settings["starter_questions"])) {
            $overrides["starterQuestions"] = array_values((array) $tenant_settings["starter_questions"]);
        }

        return new WP_REST_Response(["config" => array_merge($config, $overrides)]);
    }

    /**
     * Pull tenant settings from the API while the auto-generated persona has
     * not arrived yet.
     *
     * The persona is produced by the worker minutes after onboarding queues the
     * content sync, and WordPress only refreshes its cached copy of tenant
     * settings when an admin loads the dashboard. A client who closes the tab
     * after the wizard would otherwise keep serving the default greeting
     * indefinitely.
     *
     * Self-limiting by design: once auto_config is present the first condition
     * is false forever, so the steady-state cost on this public endpoint is a
     * single array lookup. Until then it is one API call per 10 minutes.
     */
    private function maybe_refresh_auto_config(array &$options): void
    {
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id || !empty($options["tenant_settings"]["auto_config"])) {
            return;
        }
        if (get_transient("alpharecall_auto_config_poll")) {
            return;
        }
        set_transient("alpharecall_auto_config_poll", 1, 10 * MINUTE_IN_SECONDS);

        $result = AlphaRecall_Client::get_instance()->get_tenant_settings($tenant_id);
        if (is_wp_error($result) || !is_array($result)) {
            return;
        }
        $options = AlphaRecall_Settings::reload_options();
        if ((int) ($options["tenant_id"] ?? 0) !== $tenant_id) {
            return;
        }
        $options["tenant_settings"] = $this->sanitize_tenant_settings(
            $result,
            (array) ($options["tenant_settings"] ?? [])
        );
        AlphaRecall_Settings::persist($options);
    }

    public function get_tenant_settings(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->get_tenant_settings($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        $options = AlphaRecall_Settings::reload_options();
        if ((int) ($options["tenant_id"] ?? 0) !== $tenant_id) {
            return new WP_REST_Response(["error" => "The website connection changed. Please reload the page."], 409);
        }
        $options["tenant_settings"] = $this->sanitize_tenant_settings(
            (array) $result,
            (array) ($options["tenant_settings"] ?? [])
        );
        AlphaRecall_Settings::persist($options);
        return new WP_REST_Response($options["tenant_settings"]);
    }

    public function update_tenant_settings(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $input = self::json_body($request);
        // Refuse an address the sanitizer would otherwise blank or keep as is
        // ("javascript:", "non-una-email", a webhook to 127.0.0.1): the admin
        // must learn it was not saved, and why.
        $lang = (string) ((($options["tenant_settings"] ?? [])["response_language"] ?? "it"));
        $invalid = self::tenant_settings_input_errors($input, $lang);
        if ($invalid) {
            return new WP_REST_Response([
                "error" => reset($invalid),
                "code" => "invalid_settings",
                "fields" => $invalid,
            ], 400);
        }
        $payload = $this->sanitize_tenant_settings_patch(
            $input,
            (array) ($options["tenant_settings"] ?? [])
        );
        if (empty($payload)) {
            return new WP_REST_Response(["error" => "No settings provided."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_tenant_settings($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        // Email notification settings live only in WP (consumed by
        // AlphaRecall_Email_Notifications); the API ignores them and won't echo them
        // back, so re-apply the sanitized patch values over the API response
        // before persisting locally.
        $merged = (array) $result;
        foreach (self::WP_ONLY_TENANT_KEYS as $key) {
            if (array_key_exists($key, $payload)) {
                $merged[$key] = $payload[$key];
            }
        }
        $options = AlphaRecall_Settings::reload_options();
        if ((int) ($options["tenant_id"] ?? 0) !== $tenant_id) {
            return new WP_REST_Response(["error" => "The website connection changed. Please reload the page."], 409);
        }
        $options["tenant_settings"] = $this->sanitize_tenant_settings(
            $merged,
            (array) ($options["tenant_settings"] ?? [])
        );
        AlphaRecall_Settings::persist($options);
        return new WP_REST_Response($options["tenant_settings"]);
    }

    private function integration_tenant_id(): int
    {
        $options = AlphaRecall_Settings::get_options();
        return (int) ($options["tenant_id"] ?? 0);
    }

    private function upstream_error_response(
        WP_Error $error,
        int $fallback_status = 502
    ): WP_REST_Response {
        $data = $error->get_error_data();
        $status = is_array($data) ? (int) ($data["status"] ?? 0) : 0;
        if ($status < 400 || $status > 599) {
            $status = $fallback_status;
        }
        return new WP_REST_Response(
            ["error" => $error->get_error_message()],
            $status
        );
    }

    private function integration_response(array|WP_Error $result): WP_REST_Response
    {
        if (is_wp_error($result)) {
            return $this->upstream_error_response($result, 502);
        }
        return new WP_REST_Response($result);
    }

    public function get_google_calendar_integration(): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        return $this->integration_response(AlphaRecall_Client::get_instance()->get_google_calendar_integration($tenant_id));
    }

    public function start_google_calendar_oauth(): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        // Built here, never taken from the browser: after consent Google's
        // callback sends the owner back to Richieste > Agenda on this site.
        $return_url = admin_url("admin.php?page=alpharecall-conversions&view=agenda");
        return $this->integration_response(AlphaRecall_Client::get_instance()->start_google_calendar_oauth($tenant_id, $return_url));
    }

    public function update_google_calendar_integration(WP_REST_Request $request): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        return $this->integration_response(AlphaRecall_Client::get_instance()->update_google_calendar_integration($tenant_id, self::json_body($request)));
    }

    public function delete_google_calendar_integration(): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        return $this->integration_response(AlphaRecall_Client::get_instance()->delete_google_calendar_integration($tenant_id));
    }

    public function test_google_calendar_integration(): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        return $this->integration_response(AlphaRecall_Client::get_instance()->test_google_calendar_integration($tenant_id));
    }

    public function get_google_calendar_metadata(): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        return $this->integration_response(AlphaRecall_Client::get_instance()->get_google_calendar_metadata($tenant_id));
    }

    public function sync_google_calendar_integration(): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        return $this->integration_response(AlphaRecall_Client::get_instance()->sync_google_calendar_integration($tenant_id));
    }

    public function check_google_calendar_availability(WP_REST_Request $request): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        return $this->integration_response(AlphaRecall_Client::get_instance()->check_google_calendar_availability($tenant_id, self::json_body($request)));
    }

    public function list_google_calendar_deliveries(WP_REST_Request $request): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        if (!$tenant_id) return new WP_REST_Response(["error" => "Website not configured."], 400);
        $limit = max(1, min(100, (int) ($request->get_param("limit") ?: 25)));
        $offset = max(0, (int) ($request->get_param("offset") ?: 0));
        return $this->integration_response(AlphaRecall_Client::get_instance()->list_google_calendar_deliveries($tenant_id, $limit, $offset));
    }

    public function replay_google_calendar_delivery(WP_REST_Request $request): WP_REST_Response
    {
        $tenant_id = $this->integration_tenant_id();
        $delivery_id = (int) $request->get_param("id");
        if (!$tenant_id || !$delivery_id) return new WP_REST_Response(["error" => "Invalid integration request."], 400);
        return $this->integration_response(AlphaRecall_Client::get_instance()->replay_google_calendar_delivery($tenant_id, $delivery_id));
    }

    public function get_woocommerce_integration(): WP_REST_Response
    {
        return new WP_REST_Response(AlphaRecall_WooCommerce::get_instance()->get_connection());
    }

    public function update_woocommerce_integration(WP_REST_Request $request): WP_REST_Response
    {
        return $this->integration_response(
            AlphaRecall_WooCommerce::get_instance()->save_connection(self::json_body($request))
        );
    }

    public function delete_woocommerce_integration(): WP_REST_Response
    {
        return $this->integration_response(AlphaRecall_WooCommerce::get_instance()->disconnect());
    }

    public function test_woocommerce_integration(WP_REST_Request $request): WP_REST_Response
    {
        return $this->integration_response(
            AlphaRecall_WooCommerce::get_instance()->test_connection(self::json_body($request))
        );
    }

    public function sync_woocommerce_integration(): WP_REST_Response
    {
        return $this->integration_response(AlphaRecall_WooCommerce::get_instance()->sync_products());
    }

    public function woocommerce_sync_status(): WP_REST_Response
    {
        return $this->integration_response(AlphaRecall_WooCommerce::get_instance()->sync_status());
    }

    public function woocommerce_order_lookup(WP_REST_Request $request): WP_REST_Response
    {
        return $this->integration_response(
            AlphaRecall_WooCommerce::get_instance()->lookup_order(self::json_body($request))
        );
    }

    public function woocommerce_cart_link(WP_REST_Request $request): WP_REST_Response
    {
        return $this->integration_response(
            AlphaRecall_WooCommerce::get_instance()->cart_link(self::json_body($request))
        );
    }

    public function send_weekly_report_test(): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->send_weekly_report_test($tenant_id);
        if (is_wp_error($result)) {
            return $this->upstream_error_response($result, 502);
        }
        return new WP_REST_Response($result);
    }

    /**
     * Tenant settings persisted only in WordPress options — the backend API
     * neither stores nor echoes these keys.
     */
    private const WP_ONLY_TENANT_KEYS = [
        "email_notify_appointments",
        "email_notify_submissions",
        "email_notify_feedback",
        "notification_emails",
    ];

    public function update_tenant_retention(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        // Whitelist the retention fields only (Allegati: files sent in chats).
        $allowed = [
            "retention_chat_messages_days",
            "retention_analytics_events_days",
            "retention_contact_submissions_days",
            "retention_email_leads_days",
            "retention_appointments_days",
            "retention_feedbacks_days",
            "retention_chat_attachments_days",
        ];
        $body = [];
        foreach ($allowed as $key) {
            if (array_key_exists($key, $payload)) {
                $val = $payload[$key];
                if ($val === null) {
                    // Explicit null means unlimited retention. Preserve it so
                    // the API can distinguish "clear" from an omitted field.
                    $body[$key] = null;
                    continue;
                }
                $val = (int) $val;
                // Visitor conversations and their files are kept 90 days at most (API side:
                // app/conversation_retention.py); the other data up to 10 years.
                $max = in_array($key, ["retention_chat_messages_days", "retention_chat_attachments_days"], true) ? 90 : 3650;
                if ($val < 1 || $val > $max) {
                    return new WP_REST_Response(["error" => "Invalid value for $key (1..$max)"], 400);
                }
                $body[$key] = $val;
            }
        }
        if (!$body) {
            return new WP_REST_Response(["status" => "no-op"], 200);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_tenant_retention($tenant_id, $body);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        // Keep the localized admin bootstrap in sync so a direct settings-page
        // reload renders the values just confirmed by the API.
        $current_settings = (array) ($options["tenant_settings"] ?? []);
        $options["tenant_settings"] = $this->sanitize_tenant_settings(
            array_merge($current_settings, (array) $result),
            $current_settings
        );
        AlphaRecall_Settings::persist($options);
        return new WP_REST_Response($result);
    }

    public function list_helpdesk(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_helpdesk($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function create_helpdesk(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->create_helpdesk($tenant_id, $payload);
        if (is_wp_error($result)) {
            // A 4xx (a duplicate category, a missing entry) is relayed as is: the admin maps it to Italian (faq-errors.ts).
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        delete_transient("alpharecall_helpdesk_chat_" . $tenant_id);
        return new WP_REST_Response($result);
    }

    public function update_helpdesk(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $entry_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$entry_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_helpdesk($tenant_id, $entry_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        delete_transient("alpharecall_helpdesk_chat_" . $tenant_id);
        return new WP_REST_Response($result);
    }

    public function delete_helpdesk(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $entry_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$entry_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_helpdesk($tenant_id, $entry_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        delete_transient("alpharecall_helpdesk_chat_" . $tenant_id);
        return new WP_REST_Response($result);
    }

    public function reorder_helpdesk(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->reorder_helpdesk($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        delete_transient("alpharecall_helpdesk_chat_" . $tenant_id);
        return new WP_REST_Response($result);
    }

    public function generate_helpdesk(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $max_pages = max(1, min(50, (int) ($payload["max_pages"] ?? 6)));

        // Fetch page content directly from WordPress DB — no HTTP round-trip
        $wp_pages = get_posts([
            "post_type"      => "page",
            "post_status"    => "publish",
            "has_password"   => false,
            "posts_per_page" => $max_pages,
            "orderby"        => "modified",
            "order"          => "DESC",
        ]);
        $pages_content = [];
        foreach ($wp_pages as $page) {
            $text = wp_strip_all_tags(apply_filters("the_content", $page->post_content));
            $text = preg_replace('/\s+/', ' ', $text);
            // Cap at 3000 chars per page to keep payload reasonable
            if (mb_strlen($text) > 3000) {
                $text = mb_substr($text, 0, 3000) . "…";
            }
            if (empty(trim($text))) {
                continue;
            }
            $pages_content[] = [
                "title"   => $page->post_title,
                "content" => trim($text),
                "url"     => get_permalink($page),
            ];
        }

        if (empty($pages_content)) {
            return new WP_REST_Response(["error" => "No published pages found with content."], 400);
        }

        $payload["pages"] = $pages_content;
        unset($payload["site_url"]); // not needed — content is inline

        $client = AlphaRecall_Client::get_instance();
        // The client waits up to 180 s for the LLM; PHP must not cut the
        // request off first (max_execution_time is 30 s on the site).
        @set_time_limit(200);
        $result = $client->generate_helpdesk($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        delete_transient("alpharecall_helpdesk_chat_" . $tenant_id);
        return new WP_REST_Response($result);
    }

    public function import_helpdesk(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->import_helpdesk($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        delete_transient("alpharecall_helpdesk_chat_" . $tenant_id);
        return new WP_REST_Response($result);
    }

    public function detect_branding(WP_REST_Request $request): WP_REST_Response
    {
        // Return cached result if available
        $cached = get_transient("alpharecall_branding_extracted");
        if (is_array($cached) && !$request->get_param("force")) {
            return new WP_REST_Response($cached);
        }
        $result = AlphaRecall_Branding::extract();
        set_transient("alpharecall_branding_extracted", $result, 30 * DAY_IN_SECONDS);
        return new WP_REST_Response($result);
    }

    public function generate_persona(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->generate_persona($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_helpdesk_categories(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_helpdesk_categories($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function create_helpdesk_category(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->create_helpdesk_category($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function update_helpdesk_category(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $category_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$category_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_helpdesk_category($tenant_id, $category_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function delete_helpdesk_category(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $category_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$category_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_helpdesk_category($tenant_id, $category_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function list_support_profiles(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_support_profiles($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    /**
     * How many operator profiles exist and how many the plan allows ({count,
     * limit, tier, plan}; limit null = no limit). The limit is the service's
     * (app/plans.py); the plugin only shows it (WordPress.org guideline 5).
     */
    public function support_profiles_limit(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->support_profiles_limit($tenant_id);
        if (is_wp_error($result)) {
            return $this->support_profile_error($result);
        }
        return new WP_REST_Response($result);
    }

    /**
     * An API refusal of a profile call, relayed: a 4xx keeps its status, the
     * API's code ("support_profile_limit") and, for that code, the count and
     * limit; anything else is a 502.
     */
    private function support_profile_error(WP_Error $error): WP_REST_Response
    {
        $data = (array) $error->get_error_data();
        $status = $this->upstream_status($error);
        $response = is_array($data["response"] ?? null) ? $data["response"] : [];
        $body = ["error" => $error->get_error_message()];
        $code = is_string($data["code"] ?? null) ? $data["code"] : (is_string($response["code"] ?? null) ? $response["code"] : "");
        if ($code !== "") {
            $body["code"] = $code;
        }
        foreach (["count", "limit"] as $key) {
            if (array_key_exists($key, $response) && ($response[$key] === null || is_int($response[$key]))) {
                $body[$key] = $response[$key];
            }
        }
        return new WP_REST_Response($body, $status);
    }

    public function create_support_profile(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        // The plan's profile limit is checked by the API (403 support_profile_limit).
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->create_support_profile($tenant_id, $payload);
        if (is_wp_error($result)) {
            return $this->support_profile_error($result);
        }
        return new WP_REST_Response($result);
    }

    public function update_support_profile(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $profile_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$profile_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_support_profile($tenant_id, $profile_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_support_profile(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $profile_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$profile_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_support_profile($tenant_id, $profile_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        // Clean up user meta for any users linked to this profile
        $linked_users = get_users([
            "meta_key" => "alpharecall_support_profile_id",
            "meta_value" => $profile_id,
        ]);
        foreach ($linked_users as $linked_user) {
            delete_user_meta($linked_user->ID, "alpharecall_support_profile_id");
        }
        return new WP_REST_Response($result);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Team management handlers (sub-project #15)
    // ──────────────────────────────────────────────────────────────────────────

    public function team_me(WP_REST_Request $request): WP_REST_Response
    {
        $options   = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->get_team_me($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function team_list_members(WP_REST_Request $request): WP_REST_Response
    {
        $options   = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_team_members($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function team_add_member(WP_REST_Request $request): WP_REST_Response
    {
        $options   = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $body   = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->add_team_member($tenant_id, $body);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result, 201);
    }

    public function team_update_member(WP_REST_Request $request): WP_REST_Response
    {
        $options   = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $member_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$member_id) {
            return new WP_REST_Response(["error" => "Richiesta non valida."], 400);
        }
        $body   = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_team_member($tenant_id, $member_id, $body);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function team_delete_member(WP_REST_Request $request): WP_REST_Response
    {
        $options   = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $member_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$member_id) {
            return new WP_REST_Response(["error" => "Richiesta non valida."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_team_member($tenant_id, $member_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response(null, 204);
    }

    public function list_wp_users(): WP_REST_Response
    {
        $users = get_users([
            "orderby" => "display_name",
            "order" => "ASC",
            "fields" => ["ID", "display_name", "user_email"],
        ]);
        $result = [];
        foreach ($users as $user) {
            if (!isset($user->ID)) continue;
            // Only include users who have support or admin capability
            $wp_user = new WP_User($user->ID);
            if (!$wp_user->has_cap("manage_options") && !$wp_user->has_cap("alpharecall_support")) {
                continue;
            }
            $result[] = [
                "id" => (int) $user->ID,
                "name" => $user->display_name,
                "email" => $user->user_email,
                "avatar_url" => get_avatar_url($user->ID, ["size" => 64]),
                "linked_profile_id" => (int) get_user_meta($user->ID, "alpharecall_support_profile_id", true),
            ];
        }
        return new WP_REST_Response($result);
    }

    /**
     * Atomic lock using wp_options — add_option is atomic at the DB level.
     * Returns true if lock acquired, false if already held.
     */
    private static function acquire_lock(string $key, int $ttl = 30): bool
    {
        global $wpdb;
        // Clean up expired locks
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value < %s",
            $key,
            (string) time()
        ));
        // Atomic insert — fails if key already exists
        $result = $wpdb->query($wpdb->prepare(
            "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'no')",
            $key,
            (string) (time() + $ttl)
        ));
        return $result !== false && $result > 0;
    }

    private static function release_lock(string $key): void
    {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name = %s",
            $key
        ));
    }

    public function assign_profile(WP_REST_Request $request): WP_REST_Response
    {
        $profile_id = absint($request["id"]);
        $body = self::json_body($request);
        $wp_user_id = isset($body["wp_user_id"]) ? absint($body["wp_user_id"]) : 0;

        $lock_key = "alpharecall_lock_assign_{$profile_id}";
        if (!self::acquire_lock($lock_key, 15)) {
            return new WP_REST_Response(["error" => "Assignment in progress, try again"], 409);
        }

        try {
            // Clear any previous assignment of this profile
            $old_users = get_users([
                "meta_key" => "alpharecall_support_profile_id",
                "meta_value" => $profile_id,
            ]);
            foreach ($old_users as $old_user) {
                delete_user_meta($old_user->ID, "alpharecall_support_profile_id");
            }

            // Assign to new user (0 means unassign)
            if ($wp_user_id > 0) {
                $target_user = get_userdata($wp_user_id);
                if (!$target_user) {
                    return new WP_REST_Response(["error" => "User not found"], 404);
                }
                if (!$target_user->has_cap("manage_options") && !$target_user->has_cap("alpharecall_support")) {
                    return new WP_REST_Response(["error" => "User does not have support access"], 403);
                }
                // Clear any existing profile assignment for this user
                delete_user_meta($wp_user_id, "alpharecall_support_profile_id");
                update_user_meta($wp_user_id, "alpharecall_support_profile_id", $profile_id);
            }
        } finally {
            self::release_lock($lock_key);
        }

        return new WP_REST_Response(["ok" => true, "profile_id" => $profile_id, "wp_user_id" => $wp_user_id]);
    }

    public function list_ip_rules(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_ip_rules($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function create_ip_rule(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->create_ip_rule($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_ip_rule(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $rule_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$rule_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_ip_rule($tenant_id, $rule_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_conversations(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $limit = (int) ($request->get_param("limit") ?? 50);
        $limit = $limit > 0 ? min(100, $limit) : 50;
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_conversations($tenant_id, $limit);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_chat_threads(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $limit = (int) ($request->get_param("limit") ?? 50);
        $offset = (int) ($request->get_param("offset") ?? 0);
        $limit = $limit > 0 ? min(200, $limit) : 50;
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        // Messaggi and Ctrl K search on the server ("search", cleaned like the
        // Richieste one), within the inbox tab ("status") or one person's chats.
        $filters = array_intersect_key($this->list_filters($request), ["search" => true]);
        $status = $request->get_param("status");
        if (is_string($status) && preg_match('/^[a-z]+(?:,[a-z]+){0,7}$/', $status) === 1) {
            $filters["status"] = $status;
        }
        $visitor_id = (int) ($request->get_param("visitor_id") ?? 0);
        if ($visitor_id > 0) {
            $filters["visitor_id"] = $visitor_id;
        }
        // "Altri filtri" > Operatore: the chats a team member (support profile) replied in.
        $operator_id = (int) ($request->get_param("operator_id") ?? 0);
        if ($operator_id > 0 && $operator_id <= 2147483647) {
            $filters["operator_id"] = $operator_id;
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_chat_threads(
            $tenant_id, $limit, max(0, $offset),
            rest_sanitize_boolean($request->get_param("favorites_only") ?? false),
            rest_sanitize_boolean($request->get_param("unread_only") ?? false),
            $filters
        );
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function get_chat_thread(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->get_chat_thread($tenant_id, $thread_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function favorite_chat_thread(WP_REST_Request $request): WP_REST_Response
    {
        return $this->update_chat_inbox_state($request, "favorite_chat_thread");
    }

    public function read_chat_thread(WP_REST_Request $request): WP_REST_Response
    {
        return $this->update_chat_inbox_state($request, "read_chat_thread");
    }

    /** One request for "mark all read" (the API validates the per-thread cursors and the 500 cap). */
    public function read_chat_threads(WP_REST_Request $request): WP_REST_Response
    {
        $tenant_id = (int) (AlphaRecall_Settings::get_options()["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        // Forwarded whole: the API refuses any key it does not know (422). Dropping keys
        // here would turn {all_unread, up_to_message_id} into an unbounded mark-all.
        // Identity always comes from tenant_headers(); a body field cannot set it.
        $payload = self::json_body($request);
        $result = AlphaRecall_Client::get_instance()->read_chat_threads($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function chat_thread_counts(WP_REST_Request $request): WP_REST_Response
    {
        $tenant_id = (int) (AlphaRecall_Settings::get_options()["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->chat_thread_counts($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    private function update_chat_inbox_state(WP_REST_Request $request, string $method): WP_REST_Response
    {
        $tenant_id = (int) (AlphaRecall_Settings::get_options()["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        // Identity always comes from tenant_headers(), never from request data.
        $result = AlphaRecall_Client::get_instance()->$method($tenant_id, $thread_id, self::json_body($request));
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    /**
     * Status to relay for an upstream failure: a 4xx from the API (a thread
     * that does not exist, a forbidden id) is the caller's answer, not a
     * gateway fault, and the SPA branches on it.
     */
    private function upstream_status(WP_Error $error, int $default = 502): int
    {
        $data = $error->get_error_data();
        $status = is_array($data) ? (int) ($data["status"] ?? 0) : 0;
        return $status >= 400 && $status < 500 ? $status : $default;
    }

    // GDPR Phase 1 — DSR handlers

    public function gdpr_export_visitor(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $token = sanitize_text_field((string) ($request["token"] ?? ""));
        if (!$tenant_id || !$token) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->gdpr_export_visitor($tenant_id, $token);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function gdpr_erase_visitor(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $token = sanitize_text_field((string) ($request["token"] ?? ""));
        if (!$tenant_id || !$token) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->gdpr_erase_visitor($tenant_id, $token);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function gdpr_rectify_visitor(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $token = sanitize_text_field((string) ($request["token"] ?? ""));
        if (!$tenant_id || !$token) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        // Only allow the documented mutable fields
        $allowed = array_intersect_key($payload, array_flip(["display_name", "email", "phone"]));
        $client = AlphaRecall_Client::get_instance();
        $result = $client->gdpr_rectify_visitor($tenant_id, $token, $allowed);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function gdpr_export_visitor_by_id(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $visitor_id = absint($request["id"] ?? 0);
        if (!$tenant_id || !$visitor_id) {
            return new WP_REST_Response(["error" => "Invalid parameters."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->gdpr_export_visitor_by_id($tenant_id, $visitor_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function gdpr_erase_visitor_by_id(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $visitor_id = absint($request["id"] ?? 0);
        if (!$tenant_id || !$visitor_id) {
            return new WP_REST_Response(["error" => "Invalid parameters."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->gdpr_erase_visitor_by_id($tenant_id, $visitor_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function gdpr_rectify_visitor_by_id(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $visitor_id = absint($request["id"] ?? 0);
        if (!$tenant_id || !$visitor_id) {
            return new WP_REST_Response(["error" => "Invalid parameters."], 400);
        }
        $body = self::json_body($request);
        $allowed = array_intersect_key($body, array_flip(["display_name", "email", "phone"]));
        $result = AlphaRecall_Client::get_instance()->gdpr_rectify_visitor_by_id($tenant_id, $visitor_id, $allowed);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_chat_thread_messages(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        $after = sanitize_text_field((string) ($request->get_param("after") ?? ""));
        // Transcript reads require a visitor capability at both proxy and API.
        // The API remains authoritative and verifies that it owns the thread.
        $visitor_token_raw = (string) ($request->get_header("X-Visitor-Token") ?? "");
        $visitor_token = sanitize_text_field($visitor_token_raw);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if (!$this->enforce_public_rate_limit($request, "chat_messages")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        if ($visitor_token === "") {
            return new WP_REST_Response(["error" => "Visitor token required."], 403);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_chat_thread_messages(
            $tenant_id,
            $thread_id,
            $after ?: null,
            $visitor_token
        );
        if (is_wp_error($result)) {
            $error_data = $result->get_error_data();
            $upstream_status = is_array($error_data) ? (int) ($error_data["status"] ?? 0) : 0;
            $status = in_array($upstream_status, [403, 404, 429], true) ? $upstream_status : 502;
            return new WP_REST_Response(["error" => $result->get_error_message()], $status);
        }
        return new WP_REST_Response($result);
    }

    /**
     * Who a team reply is signed with, decided here and never taken from the
     * browser. A support agent always answers as their own profile, created
     * from their WordPress name the first time. An admin may pick a profile
     * ("Rispondi come"); otherwise their own linked profile is used. The
     * WordPress display name is sent along as the fallback the API uses when
     * there is no profile (none yet, plan limit, profile deleted).
     */
    private function reply_attribution(array $payload): array
    {
        $user = wp_get_current_user();
        $linked = (int) get_user_meta($user->ID, "alpharecall_support_profile_id", true);
        if ($this->require_admin()) {
            $profile_id = absint($payload["profile_id"] ?? 0) ?: $linked;
        } else {
            $profile_id = $linked;
            if (!$profile_id) {
                $created = $this->create_my_support_profile(new WP_REST_Request());
                $profile_id = $created->get_status() < 300 ? (int) (((array) $created->get_data())["id"] ?? 0) : 0;
            }
        }
        // Visitors see this name: never the login or the e-mail (public_name).
        $name = AlphaRecall_Support_Role::public_name($user);
        // profile_avatar: null overrides whatever the browser sent; the API
        // takes the photo from the profile row.
        return [
            "profile_id" => $profile_id ?: null,
            "profile_name" => $name !== "" ? $name : null,
            "profile_avatar" => null,
        ];
    }

    public function create_chat_thread_message(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $ids = AlphaRecall_Chat_Attachments::ids($payload["attachment_ids"] ?? null);
        if (is_wp_error($ids)) { return new WP_REST_Response(["error" => $ids->get_error_message()], 422); }
        $payload["attachment_ids"] = $ids;
        $payload = array_merge($payload, $this->reply_attribution($payload));
        $client = AlphaRecall_Client::get_instance();
        $result = $client->create_chat_thread_message($tenant_id, $thread_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function update_chat_thread(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_chat_thread($tenant_id, $thread_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_chat_thread(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_chat_thread($tenant_id, $thread_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function generate_chat_thread_title(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->generate_chat_thread_title($tenant_id, $thread_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_blacklisted_visitors(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_blacklisted_visitors($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function create_blacklisted_visitor(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->create_blacklisted_visitor($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_blacklisted_visitor(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $visitor_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$visitor_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_blacklisted_visitor($tenant_id, $visitor_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_documents(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $limit = (int) ($request->get_param("limit") ?? 100);
        $limit = max(1, min(500, $limit));
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_documents($tenant_id, $limit);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_document(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $source_id = sanitize_text_field((string) ($request["source_id"] ?? ""));
        if (!$tenant_id || !$source_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_document($tenant_id, $source_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    /**
     * The Richieste list filters every collection accepts: a server-side text
     * search and the per-status counts. Anything else is not forwarded.
     */
    private function list_filters(WP_REST_Request $request): array
    {
        $filters = [];
        $raw = $request->get_param("search");
        // The text as typed ("100%", "<b>" included): it only travels as a
        // query parameter and the API binds it, so only control characters
        // and broken UTF-8 go. An array (?search[]=x) is not a search.
        $search = is_scalar($raw)
            ? trim((string) preg_replace('/[\x00-\x1F\x7F]+/', " ", wp_check_invalid_utf8((string) $raw)))
            : "";
        if ($search !== "") {
            $filters["search"] = mb_substr($search, 0, 200);
        }
        if (rest_sanitize_boolean($request->get_param("with_counts") ?? false)) {
            $filters["with_counts"] = 1;
        }
        return $filters;
    }

    public function list_appointments(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $limit = (int) ($request->get_param("limit") ?? 50);
        $offset = (int) ($request->get_param("offset") ?? 0);
        $with_total = rest_sanitize_boolean($request->get_param("with_total") ?? false);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_appointments($tenant_id, $limit, $offset, $with_total, $this->list_filters($request));
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    /**
     * Support agents only move a request between states (Richieste). Anything
     * else on it, such as an appointment's time or a lead's details, stays
     * with admins.
     */
    private function status_only_for_support(WP_REST_Request $request): ?WP_REST_Response
    {
        if ($this->require_admin()) {
            return null;
        }
        $payload = self::json_body($request);
        if (array_keys($payload) === ["status"] && is_string($payload["status"])) {
            return null;
        }
        return new WP_REST_Response(["error" => "Support agents can only change the status."], 403);
    }

    public function update_appointment(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $appointment_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$appointment_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if ($denied = $this->status_only_for_support($request)) {
            return $denied;
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_appointment($tenant_id, $appointment_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_appointment(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $appointment_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$appointment_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_appointment($tenant_id, $appointment_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_leads(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $limit = (int) ($request->get_param("limit") ?? 50);
        $offset = (int) ($request->get_param("offset") ?? 0);
        $with_total = rest_sanitize_boolean($request->get_param("with_total") ?? false);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_leads($tenant_id, $limit, $offset, $with_total, $this->list_filters($request));
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function update_lead(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $lead_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$lead_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if ($denied = $this->status_only_for_support($request)) {
            return $denied;
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_lead($tenant_id, $lead_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_lead(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $lead_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$lead_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_lead($tenant_id, $lead_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_all_leads(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_all_leads($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_all_appointments(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_all_appointments($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_all_contact_submissions(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_all_contact_submissions($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    /** Richieste > Altre azioni: every escalation record (the conversations stay). */
    public function delete_all_escalations(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->delete_all_escalations($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    /** Richieste > an escalation's menu > Elimina (the conversation stays). Admins only. */
    public function delete_escalation(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->delete_escalation($tenant_id, $id);
        // The API's 404 (not this site's record) reaches the browser as a 404.
        return is_wp_error($result) ? $this->upstream_error_response($result) : new WP_REST_Response($result);
    }

    /** Richieste > a feedback's menu > Elimina. Admins only. */
    public function delete_feedback(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->delete_feedback($tenant_id, $id);
        return is_wp_error($result) ? $this->upstream_error_response($result) : new WP_REST_Response($result);
    }

    /** Richieste > Altre azioni: every feedback record. */
    public function delete_all_feedback(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->delete_all_feedback($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_escalations(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $limit = (int) ($request->get_param("limit") ?? 50);
        $offset = (int) ($request->get_param("offset") ?? 0);
        $with_total = rest_sanitize_boolean($request->get_param("with_total") ?? false);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_escalations($tenant_id, $limit, $offset, $with_total, $this->list_filters($request));
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function update_escalation(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $escalation_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$escalation_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if ($denied = $this->status_only_for_support($request)) {
            return $denied;
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_escalation($tenant_id, $escalation_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_events(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $params = [];
        foreach (["limit", "offset", "status", "upcoming"] as $key) {
            $val = AlphaRecall_Sanitize::json($request->get_param($key));
            if ($val !== null) {
                $params[$key] = $val;
            }
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_events($tenant_id, $params);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function create_event(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->create_event($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function update_event(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $event_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$event_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_event($tenant_id, $event_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_event(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $event_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$event_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_event($tenant_id, $event_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_coupons(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $params = [];
        foreach (["limit", "offset", "active"] as $key) {
            $val = AlphaRecall_Sanitize::json($request->get_param($key));
            if ($val !== null) {
                $params[$key] = $val;
            }
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_coupons($tenant_id, $params);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function create_coupon(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->create_coupon($tenant_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function update_coupon(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $coupon_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$coupon_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_coupon($tenant_id, $coupon_id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_coupon(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $coupon_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$coupon_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_coupon($tenant_id, $coupon_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_contact_submissions(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $params = [];
        foreach (["limit", "offset", "status", "with_total"] as $key) {
            $val = AlphaRecall_Sanitize::json($request->get_param($key));
            if ($val !== null) {
                $params[$key] = $val;
            }
        }
        $params += $this->list_filters($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_contact_submissions($tenant_id, $params);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function update_contact_submission(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if ($denied = $this->status_only_for_support($request)) {
            return $denied;
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_contact_submission($tenant_id, $id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function delete_contact_submission(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->delete_contact_submission($tenant_id, $id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_feedback(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $params = [];
        foreach (["limit", "offset", "status", "with_total"] as $key) {
            $val = AlphaRecall_Sanitize::json($request->get_param($key));
            if ($val !== null) {
                $params[$key] = $val;
            }
        }
        $params += $this->list_filters($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_feedback($tenant_id, $params);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function update_feedback(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if ($denied = $this->status_only_for_support($request)) {
            return $denied;
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_feedback($tenant_id, $id, $payload);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_event_registrations(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $event_id = (int) ($request["event_id"] ?? 0);
        if (!$tenant_id || !$event_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $params = [];
        foreach (["limit", "offset"] as $key) {
            $val = AlphaRecall_Sanitize::json($request->get_param($key));
            if ($val !== null) {
                $params[$key] = $val;
            }
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_event_registrations($tenant_id, $event_id, $params);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function list_products(WP_REST_Request $request): WP_REST_Response
    {
        if (!class_exists("WooCommerce")) {
            return new WP_REST_Response(["items" => []]);
        }
        $limit = (int) ($request->get_param("limit") ?? 50);
        $limit = $limit > 0 ? min(100, $limit) : 50;
        $products = wc_get_products([
            "status" => "publish",
            "limit" => $limit,
        ]);
        $items = array_map(function ($product) {
            if (!$product) {
                return [];
            }
            $image_id = $product->get_image_id();
            $image = $image_id ? wp_get_attachment_url($image_id) : "";
            return [
                "id" => $product->get_id(),
                "name" => $product->get_name(),
                "price" => $product->get_price(),
                "url" => $product->get_permalink(),
                "image" => $image,
                "stock_status" => $product->get_stock_status(),
            ];
        }, $products);
        return new WP_REST_Response(["items" => array_values(array_filter($items))]);
    }

    public function trigger_product_sync(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->trigger_product_sync($tenant_id);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        return new WP_REST_Response($result);
    }

    public function get_product_sync_status(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->get_product_sync_status($tenant_id);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        return new WP_REST_Response($result);
    }

    /**
     * Validate a WooCommerce coupon code. Called by the backend coupon_check tool.
     * Returns coupon details if valid, or an error if not.
     */
    public function wc_validate_coupon(WP_REST_Request $request): WP_REST_Response
    {
        if (!AlphaRecall_WooCommerce::get_instance()->is_feature_enabled("coupon_validation")) {
            return new WP_REST_Response(["valid" => false, "message" => "Coupon validation is disabled."], 404);
        }
        if (!class_exists("WooCommerce")) {
            return new WP_REST_Response(["valid" => false, "message" => "WooCommerce is not active."], 200);
        }
        $code = sanitize_text_field($request->get_param("code") ?? "");
        if (empty($code)) {
            return new WP_REST_Response(["valid" => false, "message" => "No coupon code provided."], 400);
        }
        try {
            $coupon = new \WC_Coupon($code);
            if (!$coupon->get_id()) {
                return new WP_REST_Response(["valid" => false, "code" => $code, "message" => "Coupon not found."]);
            }
            $discounts = new \WC_Discounts();
            $valid = $discounts->is_coupon_valid($coupon);
            if (is_wp_error($valid)) {
                return new WP_REST_Response([
                    "valid" => false,
                    "code" => $code,
                    "message" => $valid->get_error_message(),
                ]);
            }
            $discount_type = $coupon->get_discount_type();
            $amount = $coupon->get_amount();
            if ($discount_type === "percent") {
                $discount_text = $amount . "% off";
            } elseif ($discount_type === "fixed_cart") {
                $discount_text = wp_strip_all_tags(wc_price($amount)) . " off your cart";
            } elseif ($discount_type === "fixed_product") {
                $discount_text = wp_strip_all_tags(wc_price($amount)) . " off per product";
            } else {
                $discount_text = $amount . " " . $discount_type;
            }
            $result = [
                "valid" => true,
                "code" => $coupon->get_code(),
                "discount_type" => $discount_type,
                "discount_value" => (float) $amount,
                "discount_text" => $discount_text,
                "description" => wp_strip_all_tags((string) $coupon->get_description()),
                "free_shipping" => $coupon->get_free_shipping(),
                "expiry_date" => $coupon->get_date_expires() ? $coupon->get_date_expires()->format("Y-m-d") : null,
                "minimum_amount" => $coupon->get_minimum_amount() ? (float) $coupon->get_minimum_amount() : null,
                "maximum_amount" => $coupon->get_maximum_amount() ? (float) $coupon->get_maximum_amount() : null,
                "usage_limit" => $coupon->get_usage_limit() ?: null,
                "usage_count" => $coupon->get_usage_count(),
            ];
            return new WP_REST_Response($result);
        } catch (\Exception $e) {
            return new WP_REST_Response(["valid" => false, "code" => $code, "message" => "Error validating coupon."], 500);
        }
    }

    public function chat(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if (!$this->enforce_public_rate_limit($request, "chat")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $request_body = self::json_body($request);
        $attachment_ids = AlphaRecall_Chat_Attachments::ids($request_body["attachment_ids"] ?? null);
        if (is_wp_error($attachment_ids)) {
            return new WP_REST_Response(["error" => $attachment_ids->get_error_message()], 422);
        }
        $payload = $this->normalize_chat_payload($request_body);
        $payload["attachment_ids"] = $attachment_ids;
        $client = AlphaRecall_Client::get_instance();
        $tenant_key = $client->get_tenant_key();
        if (!$tenant_key) {
            return new WP_REST_Response(["error" => "Tenant API key unavailable."], 502);
        }
        $this->queue_analytics($tenant_id, [
            "kind" => "conversation",
            "data" => [
                "source" => "wordpress",
                "direction" => "inbound",
            ],
        ]);
        $headers = [
            "X-Tenant-Key" => $tenant_key,
            "X-AlphaRecall-Client-IP" => $this->client_ip(),
        ];
        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        if ($visitor_token === "" && isset($request_body["visitor_token"])) {
            $visitor_token = sanitize_text_field((string) $request_body["visitor_token"]);
        }
        if ($visitor_token !== "") {
            $headers["X-Visitor-Token"] = $visitor_token;
        }
        $device_id = $this->device_id_header($request);
        if ($device_id !== "") {
            $headers["X-AlphaRecall-Device-Id"] = $device_id;
        }
        $pow = $this->pow_header($request);
        if ($pow !== "") {
            $headers["X-AlphaRecall-PoW"] = $pow;
        }
        $headers = array_merge($headers, $this->shield_headers($request));
        self::allow_chat_wait();
        $result = $client->raw_request("POST", "/inference/{$tenant_id}/invoke", $payload, $headers, self::CHAT_TIMEOUT);
        if (is_wp_error($result)) {
            $pow_response = $this->relay_pow_challenge($result, $request);
            if ($pow_response) {
                return $pow_response;
            }
            $timeout_response = self::chat_timeout_response($result, (string) ((($options["tenant_settings"] ?? [])["response_language"] ?? "it")));
            if ($timeout_response) {
                return $timeout_response;
            }
            return $this->api_error_response($result);
        }
        $this->queue_analytics($tenant_id, [
            "kind" => "conversation",
            "data" => [
                "source" => "wordpress",
                "direction" => "outbound",
            ],
        ]);
        // Visitors get what the stream would have shown them; the full reply
        // (usage, model, raw citations...) only reaches an admin's Prova.
        $response = new WP_REST_Response(AlphaRecall_Chat::wants_full_chat_reply($request) ? $result : AlphaRecall_Chat::public_chat_reply($result));
        $response->header("Cache-Control", "private, no-store");
        return $response;
    }

    /**
     * POST /chat/cancel {turn_id, shown_chars?}: stop the visitor's running question.
     *
     * A browser that aborts /chat or the stream gives the API no sign through
     * this proxy (it is still waiting on the API), so the widget names the turn
     * it gave the question. The API checks it is this visitor's. Best effort:
     * the visitor has already moved on, so any failure is a quiet 202.
     */
    public function chat_cancel(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if (!$this->enforce_public_rate_limit($request, "chat_cancel")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $body = self::json_body($request);
        $turn_id = AlphaRecall_Chat::normalize_turn_id($body["turn_id"] ?? null);
        if ($turn_id === "") {
            return new WP_REST_Response(["error" => "Invalid turn."], 422);
        }
        $payload = ["turn_id" => $turn_id];
        if (isset($body["shown_chars"]) && is_numeric($body["shown_chars"])) {
            $payload["shown_chars"] = max(0, min(1000000, (int) $body["shown_chars"]));
        }
        $client = AlphaRecall_Client::get_instance();
        $tenant_key = $client->get_tenant_key();
        if (!$tenant_key) {
            return new WP_REST_Response(["cancelled" => false], 202);
        }
        $headers = [
            "X-Tenant-Key" => $tenant_key,
            "X-AlphaRecall-Client-IP" => $this->client_ip(),
        ];
        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        if ($visitor_token !== "") {
            $headers["X-Visitor-Token"] = $visitor_token;
        }
        $result = $client->raw_request("POST", "/inference/{$tenant_id}/cancel", $payload, $headers, 10);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["cancelled" => false], 202);
        }
        return new WP_REST_Response(["cancelled" => !empty($result["cancelled"])]);
    }

    private function normalize_chat_payload(array $payload): array
    {
        $workflow = AlphaRecall_Chat::normalize_public_workflow($payload["workflow"] ?? "chat");

        $input = [];
        if (isset($payload["input"]) && is_array($payload["input"])) {
            $input = (array) $payload["input"];
        }
        if (!$input) {
            $message = "";
            foreach (["message", "text", "query"] as $key) {
                $value = $payload[$key] ?? null;
                if (is_string($value) && trim($value) !== "") {
                    $message = trim($value);
                    break;
                }
            }
            if ($message !== "") {
                $input = ["text" => $message];
            }
        }

        $normalized = [
            "workflow" => $workflow,
            "input" => $input,
        ];

        if (isset($payload["history"]) && is_array($payload["history"])) {
            // Same clamp as the streaming proxy: only user/assistant turns with
            // string content reach the model (see AlphaRecall_Chat::sanitize_chat_history).
            $normalized["history"] = AlphaRecall_Chat::sanitize_chat_history($payload["history"]);
        }
        if (isset($payload["conversation_id"])) {
            $conversation_id = (int) $payload["conversation_id"];
            if ($conversation_id > 0) {
                $normalized["conversation_id"] = $conversation_id;
            }
        }
        if (isset($payload["tools"]) && is_array($payload["tools"])) {
            $normalized["tools"] = AlphaRecall_Chat::normalize_requested_tools($payload["tools"]);
        }
        $turn_id = AlphaRecall_Chat::normalize_turn_id($payload["turn_id"] ?? null);
        if ($turn_id !== "") {
            // The id /chat/cancel names when the visitor stops this question.
            $normalized["turn_id"] = $turn_id;
        }

        return $normalized;
    }

    private function build_commerce_summary(): array
    {
        if (!class_exists("WooCommerce")) {
            return ["enabled" => false];
        }
        $statuses = ["wc-processing", "wc-completed"];
        $timezone = wp_timezone();
        $since = (new DateTime("now", $timezone))->modify("-30 days")->format("Y-m-d H:i:s");
        $count_orders = function (array $args): int {
            $args["limit"] = 1;
            $args["paginate"] = true;
            $args["return"] = "ids";
            $result = wc_get_orders($args);
            if (is_array($result) && isset($result["total"])) {
                return (int) $result["total"];
            }
            if (is_object($result) && isset($result->total)) {
                return (int) $result->total;
            }
            if (is_array($result)) {
                return count($result);
            }
            return 0;
        };
        $orders_total = $count_orders([
            "status" => $statuses,
        ]);
        $orders_recent = $count_orders([
            "status" => $statuses,
            "date_created" => ">=" . $since,
        ]);
        return [
            "enabled" => true,
            "orders_total" => $orders_total,
            "orders_last_30d" => $orders_recent,
            "currency" => get_woocommerce_currency_symbol(),
        ];
    }

    private function client_ip(): string
    {
        return $this->resolve_client_ip();
    }

    public function log_public_analytics(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if (!$this->enforce_public_rate_limit($request, "analytics")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $payload = self::json_body($request);
        $kind = in_array(($payload["kind"] ?? ""), self::ANALYTICS_KINDS, true)
            ? $payload["kind"]
            : "conversation";
        // A flat map of short scalar values: nothing nested is queued.
        $data = array_slice(array_filter((array) ($payload["data"] ?? []), "is_scalar"), 0, 40, true);
        $this->queue_analytics($tenant_id, [
            "kind" => $kind,
            "data" => $data,
        ]);
        return new WP_REST_Response(["status" => "queued"]);
    }

    public function invoke(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        self::allow_chat_wait();
        $result = $client->invoke_workflow($tenant_id, $payload);
        if (is_wp_error($result)) {
            $timeout_response = self::chat_timeout_response($result, (string) ((($options["tenant_settings"] ?? [])["response_language"] ?? "it")));
            return $timeout_response ?: $this->api_error_response($result);
        }
        return new WP_REST_Response($result);
    }

    public function quota(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->quota_check($tenant_id);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        return new WP_REST_Response($result);
    }

    public function billing_checkout(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $body = self::json_body($request);
        $payload = [
            "plan" => sanitize_key($body["plan"] ?? ""),
            "billing_interval" => sanitize_key($body["billing_interval"] ?? "month"),
            "request_id" => sanitize_text_field($body["request_id"] ?? wp_generate_uuid4()),
            "success_url" => admin_url('admin.php?page=alpharecall-upgrade&billing=success&checkout_id={CHECKOUT_ID}'),
        ];
        $client = AlphaRecall_Client::get_instance();
        $result = $client->billing_checkout($tenant_id, $payload);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        // Clear license tier + plan-feature caches so UI/widget reflect the upgrade after checkout
        delete_transient("alpharecall_license_tier");
        delete_transient("alpharecall_plan_features");
        $response = new WP_REST_Response($result);
        $response->header("Cache-Control", "no-store");
        return $response;
    }

    public function billing_checkout_status(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $body = self::json_body($request);
        $result = AlphaRecall_Client::get_instance()->billing_checkout_status($tenant_id, [
            "checkout_id" => sanitize_text_field($body["checkout_id"] ?? ""),
        ]);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        if (!empty($result["confirmed"])) {
            delete_transient("alpharecall_license_tier");
            delete_transient("alpharecall_plan_features");
        }
        $response = new WP_REST_Response($result);
        $response->header("Cache-Control", "no-store");
        return $response;
    }

    public function billing_plans(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $cache_key = "alpharecall_billing_plans";
        $cached = get_transient($cache_key);
        if (is_array($cached)) {
            return new WP_REST_Response($cached);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->billing_plans($tenant_id);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        set_transient($cache_key, $result, 5 * MINUTE_IN_SECONDS);
        return new WP_REST_Response($result);
    }

    public function billing_portal(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->billing_portal($tenant_id, $payload);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        $response = new WP_REST_Response($result);
        $response->header("Cache-Control", "no-store");
        return $response;
    }

    public function billing_cancel(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->billing_cancel($tenant_id, $payload);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        // Clear license tier + plan-feature caches so UI/widget reflect the change immediately
        delete_transient("alpharecall_license_tier");
        delete_transient("alpharecall_plan_features");
        return new WP_REST_Response($result);
    }

    public function billing_subscription(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->billing_subscription($tenant_id);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        return new WP_REST_Response($result);
    }

    public function billing_change_plan(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $body = self::json_body($request);
        $payload = [
            "plan" => sanitize_key($body["plan"] ?? ""),
            "billing_interval" => sanitize_key($body["billing_interval"] ?? "month"),
            "request_id" => sanitize_text_field($body["request_id"] ?? wp_generate_uuid4()),
        ];
        $client = AlphaRecall_Client::get_instance();
        $result = $client->billing_change_plan($tenant_id, $payload);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        // Clear license tier + plan-feature caches so UI/widget reflect the change immediately
        delete_transient("alpharecall_license_tier");
        delete_transient("alpharecall_plan_features");
        return new WP_REST_Response($result);
    }

    public function billing_reactivate(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->billing_reactivate($tenant_id);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        // Clear license tier + plan-feature caches so UI/widget reflect the change immediately
        delete_transient("alpharecall_license_tier");
        delete_transient("alpharecall_plan_features");
        return new WP_REST_Response($result);
    }

    public function billing_orders(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->billing_orders($tenant_id);
        if (is_wp_error($result)) {
            return $this->api_error_response($result);
        }
        return new WP_REST_Response($result);
    }

    public function license_refresh(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $domain = $options["tenant_domain"] ?? "";
        if (!$domain) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $allowed_tiers = ["free", "pro", "business", "enterprise"];
        try {
            $client = AlphaRecall_Client::get_instance();
            $tenant_info = $client->resolve_tenant($domain);
            if (!is_wp_error($tenant_info) && is_array($tenant_info)) {
                // Refresh the widget plan-features cache from the same payload
                delete_transient("alpharecall_plan_features");
                AlphaRecall_Client::cache_plan_features($tenant_info);
                $tier = AlphaRecall_Client::effective_license_tier($tenant_info);
                if ($tier !== null && in_array($tier, $allowed_tiers, true)) {
                    delete_transient("alpharecall_license_tier");
                    set_transient("alpharecall_license_tier", $tier, AlphaRecall_Client::license_tier_ttl($tenant_info, HOUR_IN_SECONDS));
                    return new WP_REST_Response(["tier" => $tier]);
                }
            }
        } catch (\Throwable $e) {
            // API unreachable — keep existing transient rather than poisoning cache with "free"
        }
        // Return current cached tier (or "free" if no cache exists)
        $current = get_transient("alpharecall_license_tier");
        return new WP_REST_Response(["tier" => $current ?: "free"]);
    }

    public function visitor_register(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        if (!$this->enforce_public_rate_limit($request, "visitor_register")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $body = self::json_body($request);
        $data = [
            "email" => sanitize_email($body["email"] ?? ""),
            "display_name" => sanitize_text_field($body["display_name"] ?? ""),
            "notification_consent" => !empty($body["notification_consent"]),
            "anonymous" => !empty($body["anonymous"]),
        ];
        if (isset($body["consent_purposes"]) && is_array($body["consent_purposes"])) {
            $data["consent_purposes"] = [];
            foreach ($body["consent_purposes"] as $purpose => $granted) {
                $key = sanitize_key((string) $purpose);
                if ($key !== "") {
                    $data["consent_purposes"][$key] = (bool) $granted;
                }
            }
        }
        if (!empty($body["policy_version"])) {
            $data["policy_version"] = sanitize_text_field((string) $body["policy_version"]);
        }
        if (!empty($body["policy_text_hash"])) {
            $data["policy_text_hash"] = sanitize_text_field((string) $body["policy_text_hash"]);
        }
        if (!empty($body["wp_user_id"])) {
            // Verify wp_user_id matches the actual WordPress session to prevent spoofing
            if (!is_user_logged_in() || get_current_user_id() !== (int) $body["wp_user_id"]) {
                return new WP_REST_Response(["error" => "Invalid user identity"], 403);
            }
            $data["wp_user_id"] = absint($body["wp_user_id"]);
        }
        // Forward the caller's own visitor token when it sends one: the backend
        // needs it to tell a returning visitor from someone who merely typed
        // the same email address. The bundled chat widget only registers when
        // it has no stored token, so this is normally empty and the backend
        // starts a new session.
        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        $extra_headers = [];
        $device_id = $this->device_id_header($request);
        if ($device_id !== "") {
            $extra_headers["X-AlphaRecall-Device-Id"] = $device_id;
        }
        $pow = $this->pow_header($request);
        if ($pow !== "") {
            $extra_headers["X-AlphaRecall-PoW"] = $pow;
        }
        // The actor headers come from AlphaRecall_Client::tenant_headers(): a verified
        // admin (cookie + REST nonce + manage_options) is exempt from the bot
        // shield's challenge, anyone else is a "viewer".
        $extra_headers = array_merge($extra_headers, $this->shield_headers($request, false));
        $client = AlphaRecall_Client::get_instance();
        $result = $client->register_visitor($tenant_id, $data, $visitor_token, $extra_headers);
        if (is_wp_error($result)) {
            $pow_response = $this->relay_pow_challenge($result, $request);
            if ($pow_response) {
                return $pow_response;
            }
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($result);
    }

    public function visitor_consent_decision(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }

        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        if ($visitor_token === "") {
            return new WP_REST_Response(["error" => "Visitor token is required."], 400);
        }
        if (!$this->enforce_public_rate_limit($request, "consent_decision")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }

        $body = self::json_body($request);
        $action_id = trim((string) ($body["action_id"] ?? ""));
        $decision = (string) ($body["decision"] ?? "");
        if (!preg_match('/^[A-Za-z0-9_-]{16,64}$/', $action_id)) {
            return new WP_REST_Response(["error" => "Invalid action ID."], 400);
        }
        if (!in_array($decision, ["accept", "decline"], true)) {
            return new WP_REST_Response(["error" => "Invalid consent decision."], 400);
        }

        $result = AlphaRecall_Client::get_instance()->consent_decision(
            $tenant_id,
            $visitor_token,
            $action_id,
            $decision,
            $this->client_ip()
        );
        if (is_wp_error($result)) {
            return new WP_REST_Response(
                ["error" => $result->get_error_message()],
                $this->upstream_status($result)
            );
        }
        return new WP_REST_Response($result);
    }

    public function list_visitors(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $params = [
            "limit" => max(1, min(1000, absint($request->get_param("limit")) ?: 50)),
            "offset" => absint($request->get_param("offset")),
        ];
        if ($request->get_param("search")) {
            $params["search"] = sanitize_text_field($request->get_param("search"));
        }
        // Contatti asks only for the people who wrote (at least one chat).
        if (rest_sanitize_boolean($request->get_param("has_chats"))) {
            $params["has_chats"] = "true";
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_visitors($tenant_id, $params);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($this->redact_visitor_tokens($result));
    }

    public function get_visitor(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $id = absint($request["id"]);
        $client = AlphaRecall_Client::get_instance();
        $result = $client->get_visitor($tenant_id, $id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($this->redact_visitor_tokens($result));
    }

    public function update_visitor(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $id = absint($request["id"]);
        $body = self::json_body($request);
        $data = [];
        if (isset($body["is_banned"])) {
            $data["is_banned"] = (bool) $body["is_banned"];
        }
        if (isset($body["ban_reason"])) {
            $data["ban_reason"] = sanitize_text_field($body["ban_reason"]);
        }
        if (isset($body["notes"])) {
            $data["notes"] = sanitize_textarea_field($body["notes"]);
        }
        if (isset($body["display_name"])) {
            $data["display_name"] = sanitize_text_field($body["display_name"]);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->update_visitor($tenant_id, $id, $data);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], 502);
        }
        return new WP_REST_Response($this->redact_visitor_tokens($result));
    }

    /** Keep visitor bearer credentials out of every management response. */
    private function redact_visitor_tokens(mixed $result): mixed
    {
        if (!is_array($result)) {
            return $result;
        }
        unset($result["visitor_token"]);
        if (isset($result["items"]) && is_array($result["items"])) {
            foreach ($result["items"] as $index => $item) {
                if (is_array($item)) {
                    unset($item["visitor_token"]);
                    $result["items"][$index] = $item;
                }
            }
        }
        return $result;
    }

    public function list_wp_roles(?WP_REST_Request $request = null): WP_REST_Response
    {
        $wp_roles = wp_roles();
        $roles = [];
        foreach ($wp_roles->roles as $slug => $details) {
            if ($slug === "administrator" && (!$request || $request->get_param("include_administrator") !== "1")) continue;
            $roles[] = [
                "slug" => $slug,
                "name" => translate_user_role($details["name"]),
            ];
        }
        return new WP_REST_Response($roles);
    }

    public function get_my_support_profile(): WP_REST_Response
    {
        $user_id = get_current_user_id();
        $profile_id = (int) get_user_meta($user_id, "alpharecall_support_profile_id", true);
        if (!$profile_id) {
            return new WP_REST_Response(["error" => "No linked profile"], 404);
        }
        // Fetch from backend
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Not configured"], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->get_support_profile($tenant_id, $profile_id);
        if (is_wp_error($result)) {
            if ($result->get_error_code() !== "support_profile_not_found") {
                // The API did not answer: keep the link, or the next call would
                // create a second profile for this person.
                return new WP_REST_Response(["error" => "Profile unavailable"], 502);
            }
            // The profile was deleted on the backend: clear the link.
            delete_user_meta($user_id, "alpharecall_support_profile_id");
            return new WP_REST_Response(["error" => "Profile not found"], 404);
        }
        return new WP_REST_Response($result);
    }

    public function create_my_support_profile(WP_REST_Request $request): WP_REST_Response
    {
        $user = wp_get_current_user();
        $user_id = $user->ID;

        // Check if already linked
        $existing_id = (int) get_user_meta($user_id, "alpharecall_support_profile_id", true);
        if ($existing_id) {
            $options = AlphaRecall_Settings::get_options();
            $tenant_id = (int) ($options["tenant_id"] ?? 0);
            $client = AlphaRecall_Client::get_instance();
            $existing = $client->get_support_profile($tenant_id, $existing_id);
            if (!is_wp_error($existing)) {
                return new WP_REST_Response($existing);
            }
            if ($existing->get_error_code() !== "support_profile_not_found") {
                return new WP_REST_Response(["error" => "Profile unavailable"], 502);
            }
            delete_user_meta($user_id, "alpharecall_support_profile_id");
        }

        // Atomic lock to prevent concurrent auto-create race
        $lock_key = "alpharecall_lock_profile_create_{$user_id}";
        if (!self::acquire_lock($lock_key, 30)) {
            // Another request is creating — wait briefly and re-check
            usleep(500000);
            $existing_id = (int) get_user_meta($user_id, "alpharecall_support_profile_id", true);
            if ($existing_id) {
                $options = AlphaRecall_Settings::get_options();
                $tenant_id = (int) ($options["tenant_id"] ?? 0);
                $client = AlphaRecall_Client::get_instance();
                $existing = $client->get_support_profile($tenant_id, $existing_id);
                if (!is_wp_error($existing)) {
                    return new WP_REST_Response($existing);
                }
            }
            return new WP_REST_Response(["error" => "Profile creation in progress, try again"], 409);
        }

        try {
            $options = AlphaRecall_Settings::get_options();
            $tenant_id = (int) ($options["tenant_id"] ?? 0);
            if (!$tenant_id) {
                return new WP_REST_Response(["error" => "Not configured"], 400);
            }

            // Visitors see this profile: a name that is never the login or the
            // e-mail, and no Gravatar (its URL carries a hash of the e-mail).
            // The admin can add a photo in Team e accessi.
            $public_name = AlphaRecall_Support_Role::public_name($user);
            $data = [
                "name" => $public_name !== "" ? $public_name : "Assistenza",
                "title" => "",
            ];

            // The API applies the plan's profile limit (403 support_profile_limit).
            $client = AlphaRecall_Client::get_instance();
            $result = $client->create_support_profile($tenant_id, $data);

            if (is_wp_error($result)) {
                return $this->support_profile_error($result);
            }

            // Store the profile ID in user meta (inside lock so concurrent request sees it)
            if (!empty($result["id"])) {
                update_user_meta($user_id, "alpharecall_support_profile_id", (int) $result["id"]);
            }

            return new WP_REST_Response($result, 201);
        } finally {
            self::release_lock($lock_key);
        }
    }

    /* ---------- Team di supporto (AlphaRecall_Support_Role) ---------- */

    private function support_team_error(WP_Error $error): WP_REST_Response
    {
        $data = (array) $error->get_error_data();
        $body = ["error" => $error->get_error_message(), "code" => $error->get_error_code()];
        if (!empty($data["user_id"])) {
            $body["user_id"] = (int) $data["user_id"];
        }
        return new WP_REST_Response($body, (int) ($data["status"] ?? 400));
    }

    public function list_support_team(): WP_REST_Response
    {
        $response = new WP_REST_Response(["members" => AlphaRecall_Support_Role::members()]);
        $response->header("Cache-Control", "private, no-store");
        return $response;
    }

    public function search_support_team_candidates(WP_REST_Request $request): WP_REST_Response
    {
        $term = sanitize_text_field((string) ($request->get_param("q") ?? ""));
        return new WP_REST_Response(["users" => AlphaRecall_Support_Role::search($term)]);
    }

    public function add_support_team_member(WP_REST_Request $request): WP_REST_Response
    {
        $body = self::json_body($request);
        $result = AlphaRecall_Support_Role::add(absint($body["user_id"] ?? 0));
        return is_wp_error($result) ? $this->support_team_error($result) : new WP_REST_Response($result, 201);
    }

    public function invite_support_team_member(WP_REST_Request $request): WP_REST_Response
    {
        $body = self::json_body($request);
        $email = is_scalar($body["email"] ?? null) ? (string) $body["email"] : "";
        $name = is_scalar($body["name"] ?? null) ? (string) $body["name"] : "";
        $result = AlphaRecall_Support_Role::invite($email, $name);
        return is_wp_error($result) ? $this->support_team_error($result) : new WP_REST_Response($result, 201);
    }

    public function remove_support_team_member(WP_REST_Request $request): WP_REST_Response
    {
        $result = AlphaRecall_Support_Role::remove(absint($request["id"] ?? 0));
        return is_wp_error($result) ? $this->support_team_error($result) : new WP_REST_Response(["ok" => true]);
    }

    public function proxy(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $domain = (string) ($options["tenant_domain"] ?? "");
        if (!$tenant_id || !$domain) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $payload = self::json_body($request);
        $raw_path = is_scalar($payload["path"] ?? null) ? trim((string) $payload["path"]) : "";
        // Reject dot segments before any allow-list or tenant check. The HTTP
        // client normalises these segments, so validating the raw value alone
        // would allow a permitted prefix to escape to another backend route.
        $path_probe = $raw_path;
        for ($i = 0; $i < 3; $i++) {
            $decoded = rawurldecode($path_probe);
            if ($decoded === $path_probe) {
                break;
            }
            $path_probe = $decoded;
        }
        if ($raw_path === "" || str_contains($path_probe, "\\")
            || preg_match("#(^|/)\\.\\.?(/|$)#", $path_probe) === 1) {
            return new WP_REST_Response(["error" => "Path not allowed."], 403);
        }
        $path = sanitize_text_field($raw_path);
        $method = strtoupper((string) ($payload["method"] ?? "GET"));
        if (!$path || str_starts_with($path, "/admin")) {
            return new WP_REST_Response(["error" => "Path not allowed."], 403);
        }
        if (!in_array($method, ["GET", "POST", "PUT", "DELETE"], true)) {
            return new WP_REST_Response(["error" => "Method not allowed."], 400);
        }
        if ($path === "/tenants/current") {
            $client = AlphaRecall_Client::get_instance();
            $result = $client->resolve_tenant($domain);
            if (is_wp_error($result)) {
                AlphaRecall_Log::error("AlphaRecall tenant resolution failed: " . $result->get_error_message());
                return new WP_REST_Response(["error" => __("Upstream request failed.", "alpharecall")], 502);
            }
            return new WP_REST_Response($result);
        }
        if (preg_match("#^/(tenants|inference)/(\\d+)#", $path, $matches)) {
            $path_tenant = (int) $matches[2];
            if ($path_tenant !== $tenant_id) {
                return new WP_REST_Response(["error" => "Website mismatch."], 403);
            }
            if (!$this->is_proxy_path_allowed($method, $path)) {
                return new WP_REST_Response(["error" => "Path not allowed."], 403);
            }
            $this->log_proxy_request($method, $path, $tenant_id);
            $client = AlphaRecall_Client::get_instance();
            $headers = ["X-Tenant-Key" => $client->get_tenant_key()];
            $body = isset($payload["body"]) ? (array) $payload["body"] : null;
            $result = $client->raw_request($method, $path, $body, $headers);
            if (is_wp_error($result)) {
                AlphaRecall_Log::error("AlphaRecall proxy request failed: " . $result->get_error_message());
                return new WP_REST_Response(["error" => __("Upstream request failed.", "alpharecall")], 502);
            }
            return new WP_REST_Response($result);
        }
        return new WP_REST_Response(["error" => "Path not allowed."], 403);
    }

    public function rate_chat_message(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $message_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || $message_id <= 0) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        if ($visitor_token === "") {
            return new WP_REST_Response(["error" => "Visitor token is required."], 403);
        }
        if (!$this->enforce_public_rate_limit($request, "message_rating")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $body = self::json_body($request);
        $rating = $body["rating"] ?? null;
        if ($rating !== null && !in_array($rating, ["up", "down"], true)) {
            return new WP_REST_Response(["error" => "Invalid rating."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->rate_chat_message(
            $tenant_id,
            $visitor_token,
            $message_id,
            $rating,
            $this->client_ip()
        );
        if (is_wp_error($result)) {
            return new WP_REST_Response(
                ["error" => $result->get_error_message()],
                $this->upstream_status($result)
            );
        }
        return new WP_REST_Response($result);
    }

    /** The widget's "Valuta la conversazione" sheet: stored directly, not through the assistant. */
    public function submit_visitor_feedback(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        if ($visitor_token === "") {
            return new WP_REST_Response(["error" => "Visitor token is required."], 403);
        }
        if (!$this->enforce_public_rate_limit($request, "visitor_feedback")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $body = self::json_body($request);
        $rating = $body["rating"] ?? null;
        if ($rating !== null && (!is_int($rating) || $rating < 1 || $rating > 5)) {
            return new WP_REST_Response(["error" => "Invalid rating."], 400);
        }
        $comment = is_string($body["comment"] ?? null) ? trim($body["comment"]) : "";
        if ($comment === "" || mb_strlen($comment) > 2000) {
            return new WP_REST_Response(["error" => "Invalid comment."], 400);
        }
        $payload = ["rating" => $rating, "comment" => $comment];
        $conversation_id = (int) ($body["conversation_id"] ?? 0);
        if ($conversation_id > 0) {
            $payload["conversation_id"] = $conversation_id;
        }
        $key = is_string($body["idempotency_key"] ?? null) ? $body["idempotency_key"] : "";
        if ($key !== "") {
            if (strlen($key) > 64) {
                return new WP_REST_Response(["error" => "Invalid idempotency key."], 400);
            }
            $payload["idempotency_key"] = $key;
        }
        $result = AlphaRecall_Client::get_instance()->submit_visitor_feedback(
            $tenant_id,
            $visitor_token,
            $payload,
            $this->client_ip()
        );
        if (is_wp_error($result)) {
            $status = $this->upstream_status($result);
            $error = ["error" => $result->get_error_message()];
            // The plan has no feedback tool: retrying can never succeed.
            if ($status === 403 && stripos($error["error"], "license") !== false) {
                $error["code"] = "plan_required";
            }
            return new WP_REST_Response($error, $status);
        }
        return new WP_REST_Response($result);
    }

    /** Send (with the corrections typed in the card) or cancel a request draft: only the send stores it. */
    public function visitor_handoff_contact(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        if ($visitor_token === "") {
            return new WP_REST_Response(["error" => "Visitor token is required."], 403);
        }
        if (!$this->enforce_public_rate_limit($request, "handoff_contact")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $body = self::json_body($request);
        $thread_id = absint($body["thread_id"] ?? 0);
        if (!$thread_id) {
            return new WP_REST_Response(["error" => "Invalid chat."], 400);
        }
        $payload = [];
        if (is_string($body["email"] ?? null)) {
            if (mb_strlen($body["email"]) > 254) {
                return new WP_REST_Response(["error" => "Invalid email."], 422);
            }
            $payload["email"] = sanitize_text_field($body["email"]);
        } elseif (is_string($body["details"] ?? null)) {
            if (mb_strlen($body["details"]) > 2000) {
                return new WP_REST_Response(["error" => "Details too long."], 422);
            }
            $payload["details"] = sanitize_textarea_field($body["details"]);
        }
        if (!empty($body["finish"])) {
            $payload["finish"] = true;
        }
        if (!$payload) {
            return new WP_REST_Response(["error" => "Nothing to send."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->visitor_thread_post(
            $tenant_id,
            $visitor_token,
            $thread_id,
            "handoff-contact",
            $payload,
            $this->client_ip()
        );
        if (is_wp_error($result)) {
            return new WP_REST_Response(
                ["error" => $result->get_error_message()],
                $this->upstream_status($result)
            );
        }
        return new WP_REST_Response($result);
    }

    public function visitor_presence(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        if ($visitor_token === "") {
            return new WP_REST_Response(["error" => "Visitor token is required."], 403);
        }
        if (!$this->enforce_public_rate_limit($request, "visitor_presence")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $body = self::json_body($request);
        $thread_id = absint($body["thread_id"] ?? 0);
        $state = (string) ($body["state"] ?? "");
        if (!$thread_id || !in_array($state, ["left", "new_chat", "back"], true)) {
            return new WP_REST_Response(["error" => "Invalid request."], 400);
        }
        $result = AlphaRecall_Client::get_instance()->visitor_thread_post(
            $tenant_id,
            $visitor_token,
            $thread_id,
            "presence",
            ["state" => $state],
            $this->client_ip()
        );
        if (is_wp_error($result)) {
            return new WP_REST_Response(
                ["error" => $result->get_error_message()],
                $this->upstream_status($result)
            );
        }
        return new WP_REST_Response(null, 204);
    }

    public function visitor_request_draft(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $visitor_token = sanitize_text_field((string) ($request->get_header("X-Visitor-Token") ?? ""));
        if ($visitor_token === "") {
            return new WP_REST_Response(["error" => "Visitor token is required."], 403);
        }
        if (!$this->enforce_public_rate_limit($request, "request_draft")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        $body = self::json_body($request);
        $draft_id = trim((string) ($body["draft_id"] ?? ""));
        $decision = (string) ($body["decision"] ?? "");
        if (!preg_match('/^[A-Za-z0-9_-]{16,64}$/', $draft_id)) {
            return new WP_REST_Response(["error" => "Invalid draft ID."], 400);
        }
        if (!in_array($decision, ["confirm", "cancel"], true)) {
            return new WP_REST_Response(["error" => "Invalid decision."], 400);
        }
        $payload = ["decision" => $decision];
        if ($decision === "confirm" && is_array($body["fields"] ?? null)) {
            $fields = [];
            foreach (["name", "email", "phone", "subject", "body"] as $key) {
                if (!array_key_exists($key, $body["fields"])) {
                    continue;
                }
                $value = $body["fields"][$key];
                if (!is_string($value) || mb_strlen($value) > 5000) {
                    return new WP_REST_Response(["error" => "Invalid field."], 400);
                }
                $fields[$key] = $key === "body" ? sanitize_textarea_field($value) : sanitize_text_field($value);
            }
            if ($fields) {
                $payload["fields"] = $fields;
            }
        }
        $result = AlphaRecall_Client::get_instance()->request_draft_decision(
            $tenant_id,
            $visitor_token,
            $draft_id,
            $payload,
            $this->client_ip()
        );
        if (is_wp_error($result)) {
            return new WP_REST_Response(
                ["error" => $result->get_error_message()],
                $this->upstream_status($result)
            );
        }
        return new WP_REST_Response($result);
    }

    public function verify_public_request(WP_REST_Request $request): bool|WP_Error
    {
        if (!AlphaRecall_Chat::demo_access_allowed() && !AlphaRecall_Chat::admin_test_allowed()) {
            return new WP_Error("alpharecall_demo_restricted", __("This chat is only available to some WordPress roles.", "alpharecall"), ["status" => 403]);
        }
        if (strlen($request->get_body()) > self::PUBLIC_MAX_BODY_BYTES) {
            return new WP_Error(
                "alpharecall_payload_too_large",
                __("Request body is too large.", "alpharecall"),
                ["status" => 413]
            );
        }
        $origin = esc_url_raw(wp_unslash((string) ($_SERVER["HTTP_ORIGIN"] ?? "")));
        // Do not use wp_get_raw_referer(): WordPress populates it from the
        // request parameter `_wp_http_referer`, which an attacker can forge.
        $referer = esc_url_raw(wp_unslash((string) ($_SERVER["HTTP_REFERER"] ?? "")));
        $options = AlphaRecall_Settings::get_options();
        // This signature is exposed to anonymous widget clients. It is a
        // short-lived anti-abuse capability, not visitor authentication.
        if (!$this->verify_chat_signature($request, (string) ($options["chat_public_token"] ?? ""))) {
            return false;
        }
        $fetch_site = strtolower(sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_SEC_FETCH_SITE"] ?? ""))));
        return $this->is_same_origin($origin)
            || $this->is_same_origin($referer)
            || $fetch_site === "same-origin";
    }

    public function chat_attachment_headers(WP_REST_Request $request, bool $public): array
    {
        $client = AlphaRecall_Client::get_instance();
        $tenant_id = (int) (AlphaRecall_Settings::get_options()["tenant_id"] ?? 0);
        $headers = $public ? ["X-Tenant-Key" => $client->get_tenant_key()] : $client->tenant_headers($tenant_id);
        $headers["Accept"] = "application/json";
        $headers["X-AlphaRecall-Client-IP"] = $this->client_ip();
        if ($public) {
            $headers["X-Visitor-Token"] = (string) $request->get_header("X-Visitor-Token");
            $device = $this->device_id_header($request);
            $pow = $this->pow_header($request);
            if ($device !== "") { $headers["X-AlphaRecall-Device-Id"] = $device; }
            if ($pow !== "") { $headers["X-AlphaRecall-PoW"] = $pow; }
        }
        return $headers;
    }

    public function refresh_chat_signature(WP_REST_Request $request): WP_REST_Response
    {
        // The admin test chat must work whatever the widget's audience is:
        // Test mode with no roles selected hides the widget from everyone,
        // the owner included, but the owner still has to try the assistant.
        $admin_test = AlphaRecall_Chat::admin_test_allowed();
        if (!AlphaRecall_Chat::demo_access_allowed() && !$admin_test) {
            $response = new WP_REST_Response(["error" => "This chat is available only to selected WordPress roles."], 403);
            $response->header("Cache-Control", "no-store, private");
            return $response;
        }
        $origin = esc_url_raw(wp_unslash((string) ($_SERVER["HTTP_ORIGIN"] ?? "")));
        $referer = esc_url_raw(wp_unslash((string) ($_SERVER["HTTP_REFERER"] ?? "")));
        $fetch_site = strtolower(sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_SEC_FETCH_SITE"] ?? ""))));
        if (!$this->is_same_origin($origin)
            && !$this->is_same_origin($referer)
            && $fetch_site !== "same-origin") {
            return new WP_REST_Response(["error" => "Origin not allowed."], 403);
        }
        if (!$this->enforce_public_rate_limit($request, "chat_signature")) {
            return new WP_REST_Response(["error" => "Rate limit exceeded."], 429);
        }
        // The page render establishes the session cookie. Do not mint a new
        // session from this public endpoint, otherwise it remains a capability
        // oracle for unauthenticated callers.
        $session = AlphaRecall_Chat::public_session_cookie();
        if ($session === "" && $admin_test) {
            // A hidden widget means the site's pages set no session cookie.
            // An authenticated admin is not the anonymous oracle above.
            $session = AlphaRecall_Chat::ensure_public_session_cookie();
        }
        if ($session === "") {
            return new WP_REST_Response(["error" => "Unable to establish chat session."], 503);
        }
        $options = AlphaRecall_Settings::get_options();
        $secret = (string) ($options["chat_public_token"] ?? "");
        if ($secret === "") {
            return new WP_REST_Response(["error" => "Website not configured."], 503);
        }
        $response = new WP_REST_Response(AlphaRecall_Chat::build_public_signature($secret, null, $session));
        $response->header("Cache-Control", "no-store, private");
        return $response;
    }

    private function is_same_origin(?string $value): bool
    {
        if (!$value) {
            return false;
        }
        $home = wp_parse_url(home_url());
        $incoming = wp_parse_url($value);
        if (!is_array($home) || !is_array($incoming)) {
            return false;
        }
        $home_scheme = strtolower((string) ($home["scheme"] ?? ""));
        $incoming_scheme = strtolower((string) ($incoming["scheme"] ?? ""));
        $home_host = strtolower(rtrim((string) ($home["host"] ?? ""), "."));
        $incoming_host = strtolower(rtrim((string) ($incoming["host"] ?? ""), "."));
        $default_port = static fn(string $scheme): int => $scheme === "https" ? 443 : 80;
        $home_port = (int) ($home["port"] ?? $default_port($home_scheme));
        $incoming_port = (int) ($incoming["port"] ?? $default_port($incoming_scheme));
        return $home_scheme !== ""
            && hash_equals($home_scheme, $incoming_scheme)
            && hash_equals($home_host, $incoming_host)
            && $home_port === $incoming_port;
    }

    private function verify_chat_signature(WP_REST_Request $request, string $secret): bool
    {
        // The same session-bound check the chat stream performs, so the
        // signature issued with the page is accepted by every public route.
        return AlphaRecall_Chat::public_signature_is_valid(
            $secret,
            (string) ($request->get_header("x-alpharecall-timestamp") ?? ""),
            (string) ($request->get_header("x-alpharecall-signature") ?? "")
        );
    }

    private function enforce_public_rate_limit(WP_REST_Request $request, string $scope): bool
    {
        $ip = $this->get_client_ip();
        $signature = $request->get_header("x-alpharecall-signature") ?: "missing";
        $salt = wp_salt("nonce");
        $buckets = [
            ["alpharecall_rl_ip_" . hash_hmac("sha256", $scope . "|" . $ip, $salt), self::CHAT_RATE_LIMIT_PER_IP],
            ["alpharecall_rl_sig_" . hash_hmac("sha256", $scope . "|" . (string) $signature, $salt), self::CHAT_RATE_LIMIT_PER_SIG],
        ];
        $device_id = $this->device_id_header($request);
        if ($device_id !== "") {
            $buckets[] = [
                "alpharecall_rl_dev_" . hash_hmac("sha256", $scope . "|" . $device_id, $salt),
                self::CHAT_RATE_LIMIT_PER_IP,
            ];
        }
        // Look at every bucket before counting in any, so a request refused
        // by one bucket does not use up the others.
        foreach ($buckets as [$key, $limit]) {
            if (!$this->rate_limit_check($key, $limit, self::CHAT_RATE_LIMIT_WINDOW, false)) {
                return false;
            }
        }
        foreach ($buckets as [$key, $limit]) {
            if (!$this->rate_limit_check($key, $limit, self::CHAT_RATE_LIMIT_WINDOW)) {
                return false;
            }
        }
        return true;
    }

    private function device_id_header(WP_REST_Request $request): string
    {
        $value = (string) ($request->get_header("x-alpharecall-device-id") ?? "");
        return preg_match('/^[a-f0-9]{32}$/', $value) === 1 ? $value : "";
    }

    /**
     * Headers the API's bot shield reads besides the proof itself.
     *
     * X-AlphaRecall-PoW-Inline: the widget asked for the challenge as a 200;
     * the API logs and counts challenges with inline=1 (card dwfrgnb0q45f).
     * Actor headers (with $actor): the site admin testing the assistant
     * (Addestramento > Prova) is exempt from the challenge (card bl16ii44tolq).
     * They are set only after WordPress verified the logged-in user: REST
     * cookie auth drops the user unless the request carries a valid wp_rest
     * nonce, and AlphaRecall_Chat::admin_test_allowed() checks manage_options. The API
     * trusts them only next to the tenant key, which never leaves this server,
     * so a visitor cannot obtain the exemption by sending them.
     */
    private function shield_headers(WP_REST_Request $request, bool $actor = true): array
    {
        $headers = [];
        if ((string) ($request->get_header("x-alpharecall-pow-inline") ?? "") === "1") {
            $headers["X-AlphaRecall-PoW-Inline"] = "1";
        }
        if ($actor && AlphaRecall_Chat::admin_test_allowed()) {
            $user = wp_get_current_user();
            $headers["X-Actor-Wp-User"] = (string) $user->ID;
            $headers["X-Actor-Email"] = (string) ($user->user_email ?? "");
            $headers["X-Actor-Role"] = current_user_can("manage_options") ? "manage_options" : "alpharecall_admin";
        }
        return $headers;
    }

    private function pow_header(WP_REST_Request $request): string
    {
        $value = (string) ($request->get_header("x-alpharecall-pow") ?? "");
        return preg_match('/^[A-Za-z0-9_-]{16,64}\.[0-9]{1,20}$/', $value) === 1 ? $value : "";
    }

    /**
     * Fixed-window limiter. A refused attempt is not counted, so retrying
     * through the lockout does not extend it; the wait is kept for the
     * Retry-After header (relay_rate_limit). $count = false only looks.
     */
    private function rate_limit_check(string $key, int $limit, int $window, bool $count = true): bool
    {
        $read = function () use ($key, $limit, $window): ?array {
            $now = time();
            $data = get_transient($key);
            if (!is_array($data) || ($now - (int) ($data["start"] ?? 0)) > $window) {
                $data = ["count" => 0, "start" => $now];
            }
            if ((int) $data["count"] >= $limit) {
                // The window resets once more than $window seconds have passed.
                $this->local_retry_after = max(
                    $this->local_retry_after,
                    (int) $data["start"] + $window + 1 - $now,
                    1
                );
                return null;
            }
            return $data;
        };
        if (!$count) {
            return $read() !== null;
        }
        $lock_key = "_alpharecall_rl_lock_" . md5($key);
        if (!self::acquire_lock($lock_key, 5)) {
            $this->local_retry_after = max($this->local_retry_after, 1);
            return false;
        }
        try {
            $data = $read();
            if ($data === null) {
                return false;
            }
            $data["count"]++;
            set_transient($key, $data, $window + 5);
            return true;
        } finally {
            self::release_lock($lock_key);
        }
    }

    /** admin-ajax fallback: the same relay_rate_limit pass, with its Retry-After sent by header(). */
    private function ajax_relay(WP_REST_Response $response): WP_REST_Response
    {
        $relayed = $this->relay_rate_limit($response);
        $retry_after = $relayed->get_headers()["Retry-After"] ?? null;
        if ($retry_after !== null && !headers_sent()) {
            header("Retry-After: " . $retry_after);
        }
        return $relayed;
    }

    /**
     * rest_post_dispatch: every 429 leaves with a Retry-After and a message the
     * admin can act on, and an API 429 is never reported as a gateway failure.
     * Most handlers answer any upstream error with 502 and "Upstream request
     * failed.", so this runs once on the way out instead of at each call site.
     */
    public function relay_rate_limit($response, $server = null, $request = null)
    {
        if (!($response instanceof WP_HTTP_Response)) {
            return $response;
        }
        if ($request instanceof WP_REST_Request && !str_starts_with((string) $request->get_route(), "/alpharecall/v1/")) {
            return $response;
        }
        $upstream = AlphaRecall_Client::last_upstream();
        $upstream_429 = is_array($upstream) && (int) ($upstream["status"] ?? 0) === 429;
        $status = $response->get_status();
        if ($status >= 500 && is_array($upstream) && (int) ($upstream["status"] ?? 0) === 403) {
            return $this->relay_forbidden($response, $upstream);
        }
        if ($status >= 500 && $upstream_429) {
            $response->set_status(429);
            $status = 429;
        }
        if ($status !== 429) {
            return $response;
        }
        $headers = array_change_key_case($response->get_headers());
        if (isset($headers["retry-after"])) {
            $retry_after = AlphaRecall_Client::parse_retry_after($headers["retry-after"]);
        } else {
            $retry_after = $this->local_retry_after;
            if ($retry_after <= 0 && $upstream_429) {
                $retry_after = (int) ($upstream["retry_after"] ?? 0);
            }
            $retry_after = $retry_after > 0 ? $retry_after : self::DEFAULT_RETRY_AFTER;
            $response->header("Retry-After", (string) $retry_after);
        }
        // The local limiter answers before any API call, so the API's code and
        // detail only describe this 429 when the local limiter did not refuse.
        $from_api = $this->local_retry_after <= 0 && $upstream_429;
        $response->set_data(self::rate_limit_body(
            $response->get_data(),
            max(1, $retry_after),
            $from_api ? (string) ($upstream["code"] ?? "") : "",
            $from_api ? (string) ($upstream["detail"] ?? "") : ""
        ));
        return $response;
    }

    /**
     * An API 403 (a plan without the Team di supporto, the plan's profile
     * limit, a thread that is not the caller's) stays a 403: many handlers
     * answer any upstream error with 502, which the dashboard would show as a
     * broken connection. The body keeps the handler's own message, which for
     * these handlers is the API's (Italian) detail, unless it was replaced by
     * the generic "Upstream request failed." and the API sent a known code
     * whose detail is meant for the user. The API's code rides along.
     */
    private function relay_forbidden(WP_HTTP_Response $response, array $upstream): WP_HTTP_Response
    {
        $response->set_status(403);
        $code = (string) ($upstream["code"] ?? "");
        $detail = (string) ($upstream["detail"] ?? "");
        $data = $response->get_data();
        if (!is_array($data)) {
            $data = [];
        }
        if ($code !== "") {
            $data["code"] = $code;
            if (in_array($code, self::USER_FACING_403_CODES, true) && $detail !== "") {
                if (array_key_exists("message", $data) && !array_key_exists("error", $data)) {
                    $data["message"] = $detail;
                } else {
                    $data["error"] = $detail;
                }
            }
        }
        $response->set_data($data);
        return $response;
    }

    /**
     * The 429 body in the shape the caller already reads: "error" for this
     * plugin's own responses, "message" for a WP_Error the REST server turned
     * into {code, message, data}. "code" is the stable machine code the client
     * classifies by (RATE_LIMIT_CODES): the API's own code when it sent one,
     * else read from its detail (an older API), else "rate_limited".
     */
    private static function rate_limit_body(mixed $data, int $retry_after, string $code, string $detail): array
    {
        if (!in_array($code, self::RATE_LIMIT_CODES, true)) {
            $code = stripos($detail, "quota") !== false
                ? "quota_exceeded"
                : (preg_match("/rate limit exceeded for ip|global rate limit/i", $detail) === 1 ? "rate_limited_global" : "rate_limited");
        }
        $wait = self::italian_wait($retry_after);
        if ($code === "quota_exceeded") {
            if (stripos($detail, "trial") !== false) {
                $message = "Quota messaggi della prova gratuita esaurita: passa a un piano per continuare.";
            } elseif (stripos($detail, "yearly") !== false) {
                $message = "Quota messaggi dell'anno esaurita: si rinnova tra {$wait}.";
            } else {
                $message = "Quota messaggi del mese esaurita: si rinnova tra {$wait}.";
            }
        } elseif ($code === "rate_limited_global") {
            $message = "Il servizio sta ricevendo troppe richieste, riprova tra {$wait}.";
        } else {
            $message = "Troppe richieste, riprova tra {$wait}.";
        }
        $body = is_array($data) ? $data : [];
        if (array_key_exists("message", $body) && !array_key_exists("error", $body)) {
            $body["message"] = $message;
        } else {
            $body["error"] = $message;
        }
        $body["code"] = $code;
        $body["retry_after"] = $retry_after;
        return $body;
    }

    /** "45 secondi", "3 minuti", "5 ore", "12 giorni": the wait in the largest unit that reads well. */
    public static function italian_wait(int $seconds): string
    {
        $seconds = max(1, $seconds);
        if ($seconds < 90) {
            return $seconds === 1 ? "1 secondo" : "{$seconds} secondi";
        }
        $minutes = (int) ceil($seconds / 60);
        if ($minutes < 90) {
            return "{$minutes} minuti";
        }
        $hours = (int) ceil($seconds / 3600);
        if ($hours < 36) {
            return "{$hours} ore";
        }
        $days = (int) ceil($seconds / 86400);
        return $days === 1 ? "1 giorno" : "{$days} giorni";
    }

    private function get_client_ip(): string
    {
        return $this->resolve_client_ip();
    }

    private function resolve_client_ip(): string
    {
        $remote = trim(sanitize_text_field(wp_unslash((string) ($_SERVER["REMOTE_ADDR"] ?? ""))));
        $trusted_proxies = apply_filters("alpharecall_trusted_proxies", []);
        $is_trusted_proxy = is_array($trusted_proxies) && in_array($remote, $trusted_proxies, true);
        if ($is_trusted_proxy) {
            $forwarded = sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_X_FORWARDED_FOR"] ?? "")));
            if ($forwarded) {
                $parts = explode(",", $forwarded);
                $candidate = trim((string) ($parts[0] ?? ""));
                if ($candidate && filter_var($candidate, FILTER_VALIDATE_IP)) {
                    return $candidate;
                }
            }
        }
        if ($remote && filter_var($remote, FILTER_VALIDATE_IP)) {
            return $remote;
        }
        return $remote ?: "unknown";
    }

    private function is_proxy_path_allowed(string $method, string $path): bool
    {
        $allowlist = [
            "GET" => [
                "#^/tenants/\\d+/conversations(?:[/?].*)?$#",
                "#^/tenants/\\d+/ingestions/tenant(?:[/?].*)?$#",
                "#^/tenants/\\d+/documents/tenant(?:[/?].*)?$#",
                "#^/tenants/\\d+/analytics/tenant(?:[/?].*)?$#",
            ],
            "POST" => [
                "#^/tenants/\\d+/analytics/log(?:[/?].*)?$#",
                "#^/tenants/\\d+/ingestions/tenant(?:[/?].*)?$#",
                "#^/inference/\\d+/invoke(?:[/?].*)?$#",
                "#^/inference/\\d+/quota-check(?:[/?].*)?$#",
            ],
            "PUT" => [
                "#^/tenants/\\d+/prompt/tenant(?:[/?].*)?$#",
            ],
            "DELETE" => [],
        ];
        $patterns = $allowlist[$method] ?? [];
        // Security: hardcoded allowlist only — do not allow external modification
        // $patterns = apply_filters("alpharecall_proxy_allowlist", $patterns, $method);
        foreach ($patterns as $pattern) {
            if (@preg_match($pattern, $path) === 1) {
                return true;
            }
        }
        return false;
    }

    private function sanitize_business_profile(array $profile): array
    {
        return [
            "name" => sanitize_text_field((string) ($profile["name"] ?? "")),
            "description" => sanitize_textarea_field((string) ($profile["description"] ?? "")),
            "tone" => sanitize_text_field((string) ($profile["tone"] ?? "")),
            "policies" => sanitize_textarea_field((string) ($profile["policies"] ?? "")),
            "faqs" => sanitize_textarea_field((string) ($profile["faqs"] ?? "")),
            "contact" => sanitize_text_field((string) ($profile["contact"] ?? "")),
        ];
    }

    private function api_error_response(WP_Error $error, int $fallback_status = 502): WP_REST_Response
    {
        $data = $error->get_error_data();
        if (!is_array($data)) {
            $data = [];
        }
        $status = (int) ($data["status"] ?? $fallback_status);
        if ($status < 400 || $status > 599) {
            $status = $fallback_status;
        }

        // Upstream details can reveal internal routes, tenant identifiers, or
        // authentication state. Keep them in server logs and return a stable
        // client-safe message.
        AlphaRecall_Log::error("AlphaRecall upstream request failed: " . $error->get_error_message());
        $payload = ["error" => __("Upstream request failed.", "alpharecall")];
        if (isset($data["response"]) && is_array($data["response"])) {
            AlphaRecall_Log::error("AlphaRecall upstream error: " . wp_json_encode($data["response"]));
        }
        return new WP_REST_Response($payload, $status);
    }

    /**
     * The wait for an answer is network time, which max_execution_time does
     * not count on Linux; raised for hosts that count wall time, and never
     * lowered (0 is no limit).
     */
    private static function allow_chat_wait(): void
    {
        $limit = (int) ini_get("max_execution_time");
        if ($limit !== 0 && $limit < self::CHAT_TIMEOUT + 30 && function_exists("set_time_limit")) {
            @set_time_limit(self::CHAT_TIMEOUT + 30);
        }
    }

    /**
     * The chat answer did not arrive within CHAT_TIMEOUT: a 504 with a code the
     * admin and the widget classify by, never the generic 502 of a broken
     * gateway. Null for any other failure.
     */
    public static function chat_timeout_response(WP_Error $error, string $lang): ?WP_REST_Response
    {
        if ($error->get_error_code() !== "http_request_failed"
            // "Operation timed out": the answer did not come. A connect or DNS
            // timeout ("Connection timed out", "Resolving timed out") is an
            // unreachable API, not a long answer.
            || preg_match("/Operation timed out/i", $error->get_error_message()) !== 1) {
            return null;
        }
        AlphaRecall_Log::error("AlphaRecall chat answer timed out: " . $error->get_error_message());
        return new WP_REST_Response([
            "error" => $lang === "it"
                ? "L'assistente ci sta mettendo troppo a rispondere. Riprova tra poco."
                : "The assistant is taking too long to answer. Please try again shortly.",
            "code" => "upstream_timeout",
        ], 504);
    }

    /**
     * Pass the API's bot-shield challenge on to the widget. A widget that sends
     * X-AlphaRecall-PoW-Inline: 1 gets it as a 200 marked with
     * X-AlphaRecall-PoW-Challenge: 1, so the browser does not log the expected
     * challenge as a red 428 on every widget open. Both carry
     * X-AlphaRecall-PoW-Required: 1 for monitoring. Nothing is granted: the body
     * is the same challenge without any token or answer, and the retry must
     * carry a solved proof the API verifies. Other callers still get the 428.
     */
    private function relay_pow_challenge(WP_Error $error, ?WP_REST_Request $request = null): ?WP_REST_Response
    {
        $data = $error->get_error_data();
        if (!is_array($data) || (int) ($data["status"] ?? 0) !== 428) {
            return null;
        }
        $detail = $data["response"]["detail"] ?? null;
        if (!is_array($detail)
            || ($detail["error"] ?? "") !== "pow_required"
            || !isset($detail["challenge"])
            || !is_array($detail["challenge"])) {
            return null;
        }
        $options = AlphaRecall_Settings::get_options();
        $lang = (string) ((($options["tenant_settings"] ?? [])["response_language"] ?? "it"));
        $message = $lang === "it"
            ? "Serve un rapido controllo di sicurezza. Riprova tra un attimo."
            : "We need a quick security check. Please try again in a moment.";
        $inline = $request instanceof WP_REST_Request
            && (string) ($request->get_header("x-alpharecall-pow-inline") ?? "") === "1";
        $response = new WP_REST_Response([
            "error" => $message,
            "code" => "pow_required",
            "challenge" => $detail["challenge"],
        ], $inline ? 200 : 428);
        // Status-based monitoring cannot tell the inline 200 from a success:
        // this header marks every challenge, 200 or 428 (card dwfrgnb0q45f).
        $response->header("X-AlphaRecall-PoW-Required", "1");
        if ($inline) {
            $response->header("X-AlphaRecall-PoW-Challenge", "1");
            $response->header("Cache-Control", "no-store, private");
        }
        return $response;
    }

    private function sanitize_tenant_settings(array $tenant_settings, array $current): array
    {
        $defaults = [
            "chatbot_name" => "AlphaRecall",
            "chatbot_role" => "",
            "bot_role" => "",
            "chatbot_tone" => "professionale",
            "response_language" => "it",
            // Zone the dashboard renders timestamps in. Storage is always UTC.
            "timezone" => "Europe/Rome",
            "appointment_require_phone" => false,
            "appointment_alerts_enabled" => true,
            "custom_prompt" => "",
            "helpdesk_enabled" => true,
            "escalation_email" => "",
            "escalation_webhook" => "",
            "allow_handoff" => true,
            "handoff_active" => false,
            "require_visitor_info" => false,
            "privacy_notice_url" => "",
            "privacy_policy_version" => "",
            "auto_register_wp_users" => false,
            "bot_shield_mode" => "standard",
            "email_notify_appointments" => false,
            "email_notify_submissions" => false,
            "email_notify_feedback" => false,
            "notification_emails" => "",
            "weekly_report_enabled" => false,
            "weekly_report_recipients" => "",
            "weekly_report_currency" => "EUR",
            "weekly_report_lead_value_cents" => 0,
            "weekly_report_appointment_value_cents" => 0,
            "weekly_report_registration_value_cents" => 0,
            "weekly_report_hourly_cost_cents" => 0,
            "weekly_report_minutes_saved_per_conversation" => 0,
            "business_address" => "",
            "business_phone" => "",
            "business_email" => "",
            "business_hours" => null,
            "business_social_links" => null,
            "business_map_url" => "",
            "followups_enabled" => true,
            "enabled_tools" => null,
            // Written by the API's auto-configuration after the first content
            // sync (app/autoconfig.py). Read-only here: they are deliberately
            // absent from sanitize_tenant_settings_patch() so WordPress never
            // pushes a stale copy back.
            "welcome_message" => "",
            "starter_questions" => null,
            "auto_config" => null,
            "launcher_animation" => "pulse",
            "auto_open_delay" => 0,
            "auto_open_greeting" => "",
            "attention_sound" => "none",
            "retention_chat_messages_days" => null,
            "retention_analytics_events_days" => null,
            "retention_contact_submissions_days" => null,
            "retention_email_leads_days" => null,
            "retention_appointments_days" => null,
            "retention_feedbacks_days" => null,
            // Unlike the others the API default is 30 days; null = no limit.
            "retention_chat_attachments_days" => 30,
        ];
        $base = array_merge($defaults, $current);
        $language = $tenant_settings["response_language"] ?? $base["response_language"];
        if (!in_array($language, ["it", "en-US"], true)) {
            $language = "it";
        }
        $role = sanitize_textarea_field(
            (string) ($tenant_settings["chatbot_role"] ?? $tenant_settings["bot_role"] ?? $base["chatbot_role"] ?? $base["bot_role"] ?? "")
        );
        $base_bot_shield_mode = (string) ($current["bot_shield_mode"] ?? "standard");
        if (!in_array($base_bot_shield_mode, ["off", "standard", "strict"], true)) {
            $base_bot_shield_mode = "standard";
        }
        $bot_shield_mode = (string) ($tenant_settings["bot_shield_mode"] ?? $base_bot_shield_mode);
        if (!in_array($bot_shield_mode, ["off", "standard", "strict"], true)) {
            $bot_shield_mode = $base_bot_shield_mode;
        }
        return [
            "chatbot_name" => sanitize_text_field((string) ($tenant_settings["chatbot_name"] ?? $base["chatbot_name"])),
            "chatbot_role" => $role,
            "bot_role" => $role,
            "chatbot_tone" => sanitize_text_field((string) ($tenant_settings["chatbot_tone"] ?? $base["chatbot_tone"])),
            "response_language" => $language,
            "timezone" => self::sanitize_timezone($tenant_settings["timezone"] ?? $base["timezone"] ?? null),
            "appointment_require_phone" => array_key_exists("appointment_require_phone", $tenant_settings)
                ? !empty($tenant_settings["appointment_require_phone"])
                : !empty($base["appointment_require_phone"]),
            "appointment_alerts_enabled" => array_key_exists("appointment_alerts_enabled", $tenant_settings)
                ? !empty($tenant_settings["appointment_alerts_enabled"])
                : !empty($base["appointment_alerts_enabled"]),
            "custom_prompt" => sanitize_textarea_field((string) ($tenant_settings["custom_prompt"] ?? $base["custom_prompt"])),
            "helpdesk_enabled" => array_key_exists("helpdesk_enabled", $tenant_settings)
                ? !empty($tenant_settings["helpdesk_enabled"])
                : !empty($base["helpdesk_enabled"]),
            "escalation_email" => sanitize_email((string) ($tenant_settings["escalation_email"] ?? $base["escalation_email"])),
            "escalation_webhook" => esc_url_raw((string) ($tenant_settings["escalation_webhook"] ?? $base["escalation_webhook"])),
            "allow_handoff" => array_key_exists("allow_handoff", $tenant_settings)
                ? !empty($tenant_settings["allow_handoff"])
                : !empty($base["allow_handoff"]),
            "handoff_active" => array_key_exists("handoff_active", $tenant_settings)
                ? !empty($tenant_settings["handoff_active"])
                : !empty($base["handoff_active"]),
            "require_visitor_info" => array_key_exists("require_visitor_info", $tenant_settings)
                ? !empty($tenant_settings["require_visitor_info"])
                : !empty($base["require_visitor_info"]),
            "privacy_notice_url" => esc_url_raw(
                (string) ($tenant_settings["privacy_notice_url"] ?? $base["privacy_notice_url"] ?? ""),
                ["http", "https"]
            ),
            "privacy_policy_version" => mb_substr(
                sanitize_text_field((string) ($tenant_settings["privacy_policy_version"] ?? $base["privacy_policy_version"] ?? "")),
                0,
                32
            ),
            "auto_register_wp_users" => array_key_exists("auto_register_wp_users", $tenant_settings)
                ? !empty($tenant_settings["auto_register_wp_users"])
                : !empty($base["auto_register_wp_users"] ?? false),
            "bot_shield_mode" => $bot_shield_mode,
            "email_notify_appointments" => array_key_exists("email_notify_appointments", $tenant_settings)
                ? !empty($tenant_settings["email_notify_appointments"])
                : !empty($base["email_notify_appointments"]),
            "email_notify_submissions" => array_key_exists("email_notify_submissions", $tenant_settings)
                ? !empty($tenant_settings["email_notify_submissions"])
                : !empty($base["email_notify_submissions"]),
            "email_notify_feedback" => array_key_exists("email_notify_feedback", $tenant_settings)
                ? !empty($tenant_settings["email_notify_feedback"])
                : !empty($base["email_notify_feedback"]),
            "notification_emails" => implode(", ", self::split_email_list(sanitize_text_field((string) ($tenant_settings["notification_emails"] ?? $base["notification_emails"] ?? "")))["emails"]),
            "weekly_report_enabled" => array_key_exists("weekly_report_enabled", $tenant_settings)
                ? !empty($tenant_settings["weekly_report_enabled"])
                : !empty($base["weekly_report_enabled"]),
            "weekly_report_recipients" => sanitize_text_field((string) ($tenant_settings["weekly_report_recipients"] ?? $base["weekly_report_recipients"] ?? "")),
            "weekly_report_currency" => preg_match('/^[A-Z]{3}$/', strtoupper((string) ($tenant_settings["weekly_report_currency"] ?? $base["weekly_report_currency"] ?? "EUR")))
                ? strtoupper((string) ($tenant_settings["weekly_report_currency"] ?? $base["weekly_report_currency"] ?? "EUR"))
                : "EUR",
            "weekly_report_lead_value_cents" => max(0, (int) ($tenant_settings["weekly_report_lead_value_cents"] ?? $base["weekly_report_lead_value_cents"] ?? 0)),
            "weekly_report_appointment_value_cents" => max(0, (int) ($tenant_settings["weekly_report_appointment_value_cents"] ?? $base["weekly_report_appointment_value_cents"] ?? 0)),
            "weekly_report_registration_value_cents" => max(0, (int) ($tenant_settings["weekly_report_registration_value_cents"] ?? $base["weekly_report_registration_value_cents"] ?? 0)),
            "weekly_report_hourly_cost_cents" => max(0, (int) ($tenant_settings["weekly_report_hourly_cost_cents"] ?? $base["weekly_report_hourly_cost_cents"] ?? 0)),
            "weekly_report_minutes_saved_per_conversation" => max(0, min(120, (int) ($tenant_settings["weekly_report_minutes_saved_per_conversation"] ?? $base["weekly_report_minutes_saved_per_conversation"] ?? 0))),
            "business_address" => sanitize_text_field((string) ($tenant_settings["business_address"] ?? $base["business_address"])),
            "business_phone" => sanitize_text_field((string) ($tenant_settings["business_phone"] ?? $base["business_phone"])),
            "business_email" => sanitize_email((string) ($tenant_settings["business_email"] ?? $base["business_email"])),
            // A sent object replaces the stored one; null, {} or an object of
            // empty strings clears it (the API treats null as "clear" for
            // these two). Missing keys preserve it. Empty objects (decoded by
            // WP as []) become null so the API never gets a JSON list.
            "business_hours" => AlphaRecall_Sanitize::business_hours(array_key_exists("business_hours", $tenant_settings)
                ? $tenant_settings["business_hours"] : $base["business_hours"]),
            "business_social_links" => AlphaRecall_Sanitize::business_social_links(array_key_exists("business_social_links", $tenant_settings)
                ? $tenant_settings["business_social_links"] : $base["business_social_links"]),
            "business_map_url" => esc_url_raw((string) ($tenant_settings["business_map_url"] ?? $base["business_map_url"])),
            "followups_enabled" => array_key_exists("followups_enabled", $tenant_settings)
                ? !empty($tenant_settings["followups_enabled"])
                : !empty($base["followups_enabled"]),
            "enabled_tools" => self::sanitize_enabled_tools($tenant_settings["enabled_tools"] ?? $base["enabled_tools"]),
            "welcome_message" => mb_substr(sanitize_textarea_field((string) ($tenant_settings["welcome_message"] ?? $base["welcome_message"] ?? "")), 0, 500),
            "starter_questions" => self::sanitize_starter_questions($tenant_settings["starter_questions"] ?? $base["starter_questions"] ?? null),
            "auto_config" => self::sanitize_auto_config($tenant_settings["auto_config"] ?? $base["auto_config"] ?? null),
            "launcher_animation" => in_array(($tenant_settings["launcher_animation"] ?? $base["launcher_animation"]), ["none", "pulse", "bounce", "wiggle", "breathe", "rubberBand"], true)
                ? ($tenant_settings["launcher_animation"] ?? $base["launcher_animation"])
                : "pulse",
            "auto_open_delay" => max(0, min(60, (int) ($tenant_settings["auto_open_delay"] ?? $base["auto_open_delay"] ?? 0))),
            "auto_open_greeting" => mb_substr(sanitize_text_field((string) ($tenant_settings["auto_open_greeting"] ?? $base["auto_open_greeting"] ?? "")), 0, 200),
            "attention_sound" => in_array(($tenant_settings["attention_sound"] ?? $base["attention_sound"]), ["none", "chime", "pop", "ding", "bubble", "gentle"], true)
                ? ($tenant_settings["attention_sound"] ?? $base["attention_sound"])
                : "none",
            "retention_chat_messages_days" => $this->sanitize_retention_days($tenant_settings, $base, "retention_chat_messages_days"),
            "retention_analytics_events_days" => $this->sanitize_retention_days($tenant_settings, $base, "retention_analytics_events_days"),
            "retention_contact_submissions_days" => $this->sanitize_retention_days($tenant_settings, $base, "retention_contact_submissions_days"),
            "retention_email_leads_days" => $this->sanitize_retention_days($tenant_settings, $base, "retention_email_leads_days"),
            "retention_appointments_days" => $this->sanitize_retention_days($tenant_settings, $base, "retention_appointments_days"),
            "retention_feedbacks_days" => $this->sanitize_retention_days($tenant_settings, $base, "retention_feedbacks_days"),
            "retention_chat_attachments_days" => $this->sanitize_retention_days($tenant_settings, $base, "retention_chat_attachments_days"),
        ];
    }

    /**
     * Validate an IANA timezone, falling back to Europe/Rome.
     *
     * The value is echoed to the admin bundle and used to build DateTimeZone /
     * ZoneInfo keys, so an unrecognised identifier must never survive. Anything
     * PHP's own tz database does not know is replaced rather than rejected --
     * a bad zone should not make the settings screen unsaveable.
     */
    private static function sanitize_timezone($value): string
    {
        if (!is_string($value)) {
            return "Europe/Rome";
        }
        $name = trim($value);
        if ($name === "" || !in_array($name, timezone_identifiers_list(), true)) {
            return "Europe/Rome";
        }
        return $name;
    }

    /**
     * Normalise the auto-generated starter questions coming back from the API.
     * Returns null (rather than an empty array) when there are none, so the
     * widget's "no override" check stays a simple empty() test.
     */
    private static function sanitize_starter_questions($value): ?array
    {
        if (!is_array($value)) {
            return null;
        }
        $questions = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                continue;
            }
            $text = trim(sanitize_text_field((string) $item));
            if ($text === "") {
                continue;
            }
            $questions[] = mb_substr($text, 0, 160);
            if (count($questions) >= 6) {
                break;
            }
        }
        return $questions ? $questions : null;
    }

    /**
     * Provenance block for the auto-generated persona. Only the fields the
     * admin UI displays are kept; anything else the API adds later is dropped
     * rather than stored unvalidated.
     */
    private static function sanitize_auto_config($value): ?array
    {
        if (!is_array($value) || empty($value["generated_at"])) {
            return null;
        }
        $fields = [];
        if (!empty($value["fields"]) && is_array($value["fields"])) {
            foreach ($value["fields"] as $field) {
                if (is_scalar($field)) {
                    $fields[] = sanitize_key((string) $field);
                }
            }
        }
        return [
            "version" => (int) ($value["version"] ?? 1),
            "generated_at" => sanitize_text_field((string) $value["generated_at"]),
            "language" => sanitize_text_field((string) ($value["language"] ?? "")),
            "ingestion_run_id" => isset($value["ingestion_run_id"]) ? (int) $value["ingestion_run_id"] : null,
            "fields" => $fields,
        ];
    }

    /**
     * The address fields of a tenant-settings patch that cannot be saved, as
     * field => reason in the tenant's language. Empty values clear a field and
     * always pass. The admin form runs the same checks first (lib/validate.ts);
     * the API checks the webhook again, against DNS, when it sends.
     *
     * @return array<string, string>
     */
    public static function tenant_settings_input_errors(array $input, string $lang): array
    {
        $it = $lang !== "en-US";
        $errors = [];
        if (array_key_exists("privacy_notice_url", $input)) {
            $url = trim((string) ($input["privacy_notice_url"] ?? ""));
            if ($url !== "" && !self::is_web_url($url)) {
                $errors["privacy_notice_url"] = $it
                    ? "L'informativa privacy deve essere l'indirizzo completo di una pagina, che inizia con https://."
                    : "The privacy notice must be the full address of a page, starting with https://.";
            }
        }
        if (array_key_exists("escalation_email", $input)) {
            $email = trim((string) ($input["escalation_email"] ?? ""));
            if ($email !== "" && !self::is_valid_email($email)) {
                $errors["escalation_email"] = $it
                    ? "L'email per il passaggio al team non è un indirizzo valido."
                    : "The handoff email is not a valid address.";
            }
        }
        if (array_key_exists("escalation_webhook", $input)) {
            $webhook = trim((string) ($input["escalation_webhook"] ?? ""));
            $problem = $webhook === "" ? null : self::webhook_url_problem($webhook);
            if ($problem === "private") {
                $errors["escalation_webhook"] = $it
                    ? "Il webhook porta a una rete interna o a questo server: serve un indirizzo pubblico su internet."
                    : "The webhook leads to an internal network or to this server: it must be a public internet address.";
            } elseif ($problem !== null) {
                $errors["escalation_webhook"] = $it
                    ? "Il webhook deve essere un indirizzo che inizia con https://, senza nome utente o password."
                    : "The webhook must be an address starting with https://, without a user name or password.";
            }
        }
        // Dati attività: what the widget and the business_info tool show to
        // visitors. Links are https:// to a public host only, like the webhook.
        if (array_key_exists("business_phone", $input)) {
            $phone = trim((string) ($input["business_phone"] ?? ""));
            if ($phone !== "" && !self::is_valid_phone($phone)) {
                $errors["business_phone"] = $it
                    ? "Il telefono può contenere solo cifre, spazi, + iniziale, parentesi e trattini."
                    : "The phone number may only contain digits, spaces, a leading +, brackets and dashes.";
            }
        }
        if (array_key_exists("business_email", $input)) {
            $email = trim((string) ($input["business_email"] ?? ""));
            if ($email !== "" && !self::is_valid_email($email)) {
                $errors["business_email"] = $it
                    ? "L'email dell'attività non è un indirizzo valido."
                    : "The business email is not a valid address.";
            }
        }
        // [error key, what the message calls it, the URL]
        $links = [];
        if (array_key_exists("business_map_url", $input)) {
            $links[] = ["business_map_url", $it ? "Il link di Google Maps" : "The Google Maps link", $input["business_map_url"]];
        }
        if (array_key_exists("business_social_links", $input)) {
            $social = $input["business_social_links"];
            if ($social !== null && !is_array($social)) {
                $errors["business_social_links"] = $it ? "I profili social non sono validi." : "The social links are not valid.";
            } else {
                foreach ((array) $social as $platform => $url) {
                    $platform = ucfirst((string) preg_replace('/[^a-z0-9_-]/', '', strtolower((string) $platform)));
                    $links[] = ["business_social_links", $it ? "Il profilo {$platform}" : "The {$platform} profile", $url];
                }
            }
        }
        if (array_key_exists("business_hours", $input) && $input["business_hours"] !== null && !is_array($input["business_hours"])) {
            $errors["business_hours"] = $it ? "Gli orari di apertura non sono validi." : "The opening hours are not valid.";
        }
        foreach ($links as [$key, $label, $url]) {
            if (isset($errors[$key])) {
                continue;
            }
            if ($url !== null && !is_scalar($url)) {
                $problem = "format";
            } else {
                $url = trim((string) $url);
                $problem = $url === "" ? null : self::public_link_problem($url);
            }
            if ($problem === "private") {
                $errors[$key] = $it
                    ? "{$label} porta a una rete interna o a questo server: serve un indirizzo pubblico su internet."
                    : "{$label} leads to an internal network or to this server: it must be a public internet address.";
            } elseif ($problem !== null) {
                $errors[$key] = $it
                    ? "{$label} deve essere un indirizzo che inizia con https://, senza nome utente o password."
                    : "{$label} must be an address starting with https://, without a user name or password.";
            }
        }
        foreach (["notification_emails", "weekly_report_recipients"] as $key) {
            if (!array_key_exists($key, $input)) {
                continue;
            }
            $bad = self::split_email_list((string) ($input[$key] ?? ""))["invalid"];
            if ($bad) {
                $list = implode(", ", array_slice($bad, 0, 5));
                $errors[$key] = $it
                    ? "Questi indirizzi non sono email valide: {$list}."
                    : "These are not valid email addresses: {$list}.";
            }
        }
        return $errors;
    }

    private static function is_valid_email(string $email): bool
    {
        return filter_var($email, FILTER_VALIDATE_EMAIL) !== false
            && preg_match('/\.[a-z]{2,}$/i', $email) === 1;
    }

    /** Comma separated recipients: the clean, de-duplicated list and the entries that are not emails. */
    public static function split_email_list(string $value): array
    {
        $emails = [];
        $invalid = [];
        foreach (explode(",", $value) as $entry) {
            $entry = trim($entry);
            if ($entry === "") {
                continue;
            }
            if (!self::is_valid_email($entry)) {
                $invalid[] = $entry;
            } elseif (!in_array(strtolower($entry), array_map("strtolower", $emails), true)) {
                $emails[] = $entry;
            }
        }
        return ["emails" => $emails, "invalid" => $invalid];
    }

    /** An http(s) address with a host: what the widget may link to. */
    private static function is_web_url(string $url): bool
    {
        if (preg_match('/\s/', $url)) {
            return false;
        }
        $parts = wp_parse_url($url);
        return is_array($parts)
            && in_array(strtolower((string) ($parts["scheme"] ?? "")), ["http", "https"], true)
            && (string) ($parts["host"] ?? "") !== "";
    }

    /**
     * Why a webhook URL is refused ("format" or "private"), or null. Only
     * http(s), no credentials, and never a host on the server's own network:
     * loopback, private, CGNAT, link-local (cloud metadata 169.254.169.254),
     * reserved IPs and the names that only resolve inside a LAN. A host whose
     * last label is a number (0x7f.1, 2130706433, 127.1) is an IPv4 address to
     * resolvers and is refused too. IPv6 literals are refused in every layer
     * (lib/validate.ts, app/webhook_target.py) so the three agree.
     */
    public static function webhook_url_problem(string $url): ?string
    {
        if (!self::is_web_url($url)) {
            return "format";
        }
        $parts = wp_parse_url($url);
        if (isset($parts["user"]) || isset($parts["pass"])) {
            return "format";
        }
        $host = strtolower(trim((string) $parts["host"], "[]."));
        if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false) {
            return self::is_public_ip($host) ? "format" : "private";
        }
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return self::is_public_ip($host) ? null : "private";
        }
        if ($host === "localhost" || preg_match('/\.(localhost|local|internal|lan|home|arpa)$/', $host)) {
            return "private";
        }
        $labels = explode(".", $host);
        if (preg_match('/^(\d+|0x[0-9a-f]*)$/', (string) end($labels))) {
            return "private";
        }
        if (count($labels) < 2 || strlen($host) > 253) {
            return "format";
        }
        foreach ($labels as $label) {
            if ($label === "" || strlen($label) > 63) {
                return "format";
            }
        }
        return null;
    }

    /**
     * Why a link shown to visitors (Google Maps, social profiles) is refused,
     * or null: the webhook rules plus https:// only, so a visitor never gets
     * a javascript:, data: or plain http: link. Same rule as lib/validate.ts
     * publicLinkProblem and app/schemas.py.
     */
    public static function public_link_problem(string $url): ?string
    {
        $problem = self::webhook_url_problem($url);
        if ($problem !== null) {
            return $problem;
        }
        return stripos(trim($url), "https://") === 0 ? null : "format";
    }

    /** Digits, spaces, ( ) and -, an optional leading +, 5 to 20 digits (lib/validate.ts isPhone). */
    public static function is_valid_phone(string $phone): bool
    {
        $phone = trim($phone);
        if (preg_match('/^\+?[0-9 ()-]+$/', $phone) !== 1) {
            return false;
        }
        $digits = strlen((string) preg_replace('/\D/', '', $phone));
        return $digits >= 5 && $digits <= 20;
    }

    /**
     * Opening hours or social links as stored: string keys and values, trimmed,
     * empty entries dropped; null when nothing is left, which clears them.
     */
    /**
     * The JSON body of a REST request, with every key and string sanitized
     * (AlphaRecall_Sanitize::json()). Callbacks read bodies only through this, then
     * narrow each field to its own type.
     */
    private static function json_body(WP_REST_Request $request): array
    {
        return AlphaRecall_Sanitize::json_array($request->get_json_params());
    }

    /**
     * A body nested deeper or with longer lists than the sanitizer walks is
     * refused with 413 before any callback of this plugin runs.
     *
     * @param mixed $response
     * @param mixed $handler
     * @return mixed
     */
    public function refuse_oversized_body($response, $handler, $request)
    {
        if ($response !== null || !($request instanceof WP_REST_Request)) {
            return $response;
        }
        if (strpos((string) $request->get_route(), "/alpharecall/v1/") !== 0) {
            return $response;
        }
        if (AlphaRecall_Sanitize::too_large($request->get_json_params())) {
            return new WP_Error("alpharecall_body_too_large", "Request body is too large.", ["status" => 413]);
        }
        return $response;
    }

    /**
     * Which assistant tools are on: a map of tool name to true/false, or null
     * when the owner never chose (every tool of the plan is on).
     *
     * @param mixed $value
     */
    private static function sanitize_enabled_tools($value): ?array
    {
        if (!is_array($value)) {
            return null;
        }
        $clean = [];
        foreach ($value as $tool => $enabled) {
            $tool = is_string($tool) ? sanitize_key($tool) : "";
            if ($tool === "" || !(is_bool($enabled) || is_int($enabled))) {
                continue;
            }
            $clean[$tool] = (bool) $enabled;
            if (count($clean) >= 100) {
                break;
            }
        }
        return $clean;
    }

    private static function is_public_ip(string $ip): bool
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
            return false;
        }
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            [$a, $b] = array_map("intval", explode(".", $ip));
            // CGNAT 100.64/10, benchmarking 198.18/15 and multicast are not in PHP's ranges.
            return !(($a === 100 && $b >= 64 && $b <= 127) || ($a === 198 && ($b === 18 || $b === 19)) || $a >= 224);
        }
        // IPv6: global unicast only (2000::/3); mapped/compat IPv4 forms are refused.
        return preg_match('/^[23][0-9a-f]{0,3}:/', $ip) === 1;
    }

    private function sanitize_retention_days(array $tenant_settings, array $base, string $key): ?int
    {
        $value = array_key_exists($key, $tenant_settings)
            ? $tenant_settings[$key]
            : ($base[$key] ?? null);
        if ($value === null || $value === "") {
            return null;
        }
        $days = filter_var($value, FILTER_VALIDATE_INT);
        return $days !== false && $days >= 1 && $days <= 3650 ? $days : null;
    }

    private function sanitize_tenant_settings_patch(array $tenant_settings, array $current): array
    {
        $sanitized = $this->sanitize_tenant_settings($tenant_settings, $current);
        $keys = [
            "chatbot_name",
            "chatbot_role",
            "bot_role",
            "chatbot_tone",
            "response_language",
            "timezone",
            "appointment_require_phone",
            "appointment_alerts_enabled",
            "custom_prompt",
            "helpdesk_enabled",
            "escalation_email",
            "escalation_webhook",
            "allow_handoff",
            "handoff_active",
            "require_visitor_info",
            "privacy_notice_url",
            "privacy_policy_version",
            "auto_register_wp_users",
            "bot_shield_mode",
            "email_notify_appointments",
            "email_notify_submissions",
            "email_notify_feedback",
            "notification_emails",
            "weekly_report_enabled",
            "weekly_report_recipients",
            "weekly_report_currency",
            "weekly_report_lead_value_cents",
            "weekly_report_appointment_value_cents",
            "weekly_report_registration_value_cents",
            "weekly_report_hourly_cost_cents",
            "weekly_report_minutes_saved_per_conversation",
            "business_address",
            "business_phone",
            "business_email",
            "business_hours",
            "business_social_links",
            "business_map_url",
            "followups_enabled",
            "enabled_tools",
            "launcher_animation",
            "auto_open_delay",
            "auto_open_greeting",
            "attention_sound",
        ];

        $patch = [];
        foreach ($keys as $key) {
            if (array_key_exists($key, $tenant_settings) && array_key_exists($key, $sanitized)) {
                $patch[$key] = $sanitized[$key];
            }
        }

        if (array_key_exists("chatbot_role", $tenant_settings) || array_key_exists("bot_role", $tenant_settings)) {
            $patch["chatbot_role"] = $sanitized["chatbot_role"];
            $patch["bot_role"] = $sanitized["bot_role"];
        }

        return $patch;
    }

    private function log_proxy_request(string $method, string $path, int $tenant_id): void
    {
        do_action("alpharecall_proxy_request", [
            "method" => $method,
            "path" => $path,
            "tenant_id" => $tenant_id,
            "user_id" => get_current_user_id(),
        ]);
        AlphaRecall_Log::error(sprintf("AlphaRecall proxy %s %s (tenant %d)", $method, $path, $tenant_id));
    }

    private function queue_analytics(int $tenant_id, array $payload): void
    {
        // Cron arguments are serialised into the autoloaded `cron` option, so the
        // envelope has to be bounded before it is queued.
        $payload = $this->bound_analytics_payload($payload);
        if (function_exists("wp_schedule_single_event")) {
            $max_pending = (int) apply_filters(
                "alpharecall_analytics_max_pending_events",
                self::ANALYTICS_MAX_PENDING_EVENTS
            );
            if ($max_pending > 0 && $this->count_pending_analytics_events() >= $max_pending) {
                return;
            }
            wp_schedule_single_event(time(), "alpharecall_log_analytics", [$tenant_id, $payload]);
            return;
        }
        $client = AlphaRecall_Client::get_instance();
        $client->log_analytics($tenant_id, $payload);
    }

    private function bound_analytics_payload(array $payload): array
    {
        $kind = isset($payload["kind"]) && is_scalar($payload["kind"]) ? (string) $payload["kind"] : "";
        if (!in_array($kind, self::ANALYTICS_KINDS, true)) {
            $kind = "conversation";
        }
        $data = isset($payload["data"]) && is_array($payload["data"]) ? $payload["data"] : [];
        $budget = self::ANALYTICS_MAX_DATA_BYTES;
        return [
            "kind" => $kind,
            "data" => $this->bound_analytics_data($data, 1, $budget),
        ];
    }

    private function bound_analytics_data(array $data, int $depth, int &$budget): array
    {
        $bounded = [];
        $keys = 0;
        foreach ($data as $key => $value) {
            if ($keys >= self::ANALYTICS_MAX_KEYS || $budget <= 0) {
                break;
            }
            $clean_key = is_int($key) ? $key : mb_substr((string) $key, 0, self::ANALYTICS_MAX_KEY_LENGTH);
            $budget -= strlen((string) $clean_key) + 4;
            if (is_array($value)) {
                if ($depth >= self::ANALYTICS_MAX_DEPTH) {
                    continue;
                }
                $bounded[$clean_key] = $this->bound_analytics_data($value, $depth + 1, $budget);
            } elseif (is_string($value)) {
                $clean_value = mb_substr($value, 0, self::ANALYTICS_MAX_STRING_LENGTH);
                $budget -= strlen($clean_value);
                $bounded[$clean_key] = $clean_value;
            } elseif (is_int($value) || is_float($value) || is_bool($value) || $value === null) {
                $budget -= 8;
                $bounded[$clean_key] = $value;
            } else {
                continue;
            }
            $keys++;
        }
        return $bounded;
    }

    private function count_pending_analytics_events(): int
    {
        if (!function_exists("_get_cron_array")) {
            return 0;
        }
        $cron = _get_cron_array();
        if (!is_array($cron)) {
            return 0;
        }
        $pending = 0;
        foreach ($cron as $hooks) {
            if (!is_array($hooks) || !isset($hooks["alpharecall_log_analytics"])) {
                continue;
            }
            if (is_array($hooks["alpharecall_log_analytics"])) {
                $pending += count($hooks["alpharecall_log_analytics"]);
            }
        }
        return $pending;
    }

    public function handle_log_analytics(int $tenant_id, array $payload): void
    {
        $client = AlphaRecall_Client::get_instance();
        $client->log_analytics($tenant_id, $payload);
    }

    public function upgrade_request(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $payload = self::json_body($request);
        $company = sanitize_text_field((string) ($payload["company"] ?? ""));
        $name = sanitize_text_field((string) ($payload["name"] ?? ""));
        $email = sanitize_email((string) ($payload["email"] ?? ""));
        $phone = sanitize_text_field((string) ($payload["phone"] ?? ""));
        $plan = sanitize_text_field((string) ($payload["plan"] ?? ""));
        $notes = sanitize_textarea_field((string) ($payload["notes"] ?? ""));
        $domain = (string) ($options["tenant_domain"] ?? home_url());
        $tenant_id = (string) ($options["tenant_id"] ?? "");

        $lines = [
            "New AlphaRecall upgrade request",
            "Website: " . $domain,
            "Tenant ID: " . $tenant_id,
            "Company: " . $company,
            "Contact: " . $name,
            "Email: " . $email,
            "Phone: " . $phone,
            "Requested plan: " . $plan,
            "Notes:",
            $notes,
        ];
        $subject = "AlphaRecall upgrade request";
        $message = implode("\n", $lines);
        $recipient = apply_filters("alpharecall_upgrade_recipient", get_option("admin_email"));
        $sent = wp_mail($recipient, $subject, $message);
        if (!$sent) {
            return new WP_REST_Response(["error" => "Unable to send request."], 500);
        }
        return new WP_REST_Response(["status" => "ok"]);
    }

    public function list_support_threads(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return new WP_REST_Response(["error" => "Website not configured."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_support_threads($tenant_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function list_support_thread_messages(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Invalid parameters."], 400);
        }
        $after = sanitize_text_field((string) ($request->get_param("after") ?? ""));
        $client = AlphaRecall_Client::get_instance();
        $result = $client->list_support_thread_messages($tenant_id, $thread_id, $after);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function close_support_thread(WP_REST_Request $request): WP_REST_Response
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $thread_id = (int) ($request["id"] ?? 0);
        if (!$tenant_id || !$thread_id) {
            return new WP_REST_Response(["error" => "Invalid parameters."], 400);
        }
        $client = AlphaRecall_Client::get_instance();
        $result = $client->close_support_thread($tenant_id, $thread_id);
        if (is_wp_error($result)) {
            return new WP_REST_Response(["error" => $result->get_error_message()], $this->upstream_status($result));
        }
        return new WP_REST_Response($result);
    }

    public function support_chat_stream(): void
    {
        // Verify admin or support capability (require_support() also marks a
        // Team di supporto member's call for the API's plan check).
        if (!$this->require_support()) {
            status_header(403);
            echo "data: " . wp_json_encode(["error" => "Unauthorized."]) . "\n\n";
            exit;
        }
        // Verify nonce
        $nonce = isset($_SERVER["HTTP_X_WP_NONCE"]) ? sanitize_text_field(wp_unslash($_SERVER["HTTP_X_WP_NONCE"])) : "";
        if (!$nonce || !wp_verify_nonce($nonce, "wp_rest")) {
            status_header(403);
            echo "data: " . wp_json_encode(["error" => "Invalid nonce."]) . "\n\n";
            exit;
        }
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $client = AlphaRecall_Client::get_instance();
        $tenant_key = $client->get_tenant_key();
        if (!$tenant_id || !$tenant_key) {
            status_header(400);
            echo esc_html("Website not configured.");
            exit;
        }
        $payload = AlphaRecall_Sanitize::request_json(65536);
        if ($payload === null) {
            status_header(413);
            echo "data: " . wp_json_encode(["error" => "Request body is too large"]) . "\n\n";
            exit;
        }
        $ids = AlphaRecall_Chat_Attachments::ids($payload["attachment_ids"] ?? null);
        if (is_wp_error($ids)) {
            status_header(422);
            echo "data: " . wp_json_encode(["error" => $ids->get_error_message()]) . "\n\n";
            exit;
        }
        $conversation_id = $payload["conversation_id"] ?? null;
        $payload = [
            "input" => is_string($payload["input"] ?? null) ? $payload["input"] : "",
            "conversation_id" => is_numeric($conversation_id) && (int) $conversation_id > 0 ? (int) $conversation_id : null,
            "attachment_ids" => $ids,
        ];
        $api_base = $client->get_api_base();
        if (!$api_base) {
            status_header(502);
            echo "data: " . wp_json_encode(["error" => "Streaming not supported."]) . "\n\n";
            exit;
        }
        // A streamed answer outlives the default time limit, and a compressed
        // response would be held back until it ends: both apply to this request only.
        @set_time_limit(0);
        @ignore_user_abort(true);
        @ini_set("zlib.output_compression", "0");
        @ob_implicit_flush(true);
        while (ob_get_level() > 0) {
            ob_end_flush();
        }
        header("Content-Type: text/event-stream; charset=utf-8");
        header("Cache-Control: no-cache, no-store, must-revalidate");
        header("Pragma: no-cache");
        header("X-Accel-Buffering: no");
        header("Connection: keep-alive");

        $url = rtrim($api_base, "/") . "/support/{$tenant_id}/invoke/stream";
        $relayed = AlphaRecall_SSE_Relay::post($url, $client->tenant_headers($tenant_id), $payload, 300);
        if (!$relayed["ok"] || $relayed["status"] >= 400) {
            // JSON error bodies are intentionally filtered from the SSE relay.
            // Report failure explicitly so a denied/failed turn is not silent.
            echo "data: " . wp_json_encode(["error" => "Support request failed.", "status" => $relayed["status"] ?: 502]) . "\n\n";
            flush();
        }
        exit;
    }

}
