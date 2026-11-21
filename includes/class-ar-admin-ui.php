<?php

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_Admin_UI
{
    private static ?AlphaRecall_Admin_UI $instance = null;
    private const PAGE_SLUG = "alpharecall";
    /**
     * The seven sections of the dashboard, in menu order: wp-admin page slug
     * => section id. Mirrors NAV_SECTIONS in chat-ui/src/admin/lib/nav.ts;
     * the pages inside a section are `&view=<key>` on the same slug.
     */
    private const SUBMENU_SLUGS = [
        "alpharecall-dashboard" => "oggi",
        "alpharecall-conversations" => "inbox",
        "alpharecall-conversions" => "richieste",
        "alpharecall-stats" => "statistiche",
        "alpharecall-content" => "assistente",
        "alpharecall-widget" => "widget",
        "alpharecall-settings" => "impostazioni",
    ];
    /** Where the support role lands. */
    private const SUPPORT_SECTION = "inbox";
    /**
     * The sections the "Supporto AlphaRecall" role (alpharecall_support) may
     * open: Messaggi and Richieste. Their REST routes take require_support;
     * the SPA lists the same leaves (adminOnly: false in lib/nav.ts).
     */
    private const SUPPORT_SECTIONS = ["inbox", "richieste"];
    /**
     * Slugs from before the 7-section layout, kept alive for bookmarks, emails
     * and the billing return URL: slug => [target slug, view]. Their query
     * string (thread=, billing=, checkout_id= ...) is carried over.
     */
    private const LEGACY_SLUGS = [
        "alpharecall-helpdesk" => ["alpharecall-content", "faq"],
        "alpharecall-upgrade" => ["alpharecall-settings", "piano"],
        "alpharecall-integrations" => ["alpharecall-settings", "avanzate"],
    ];
    /**
     * Pages that exist in the SPA but are kept out of the product for now
     * (AdminTab names): direct URLs bounce to the dashboard and the app never
     * routes to them. The React side reads this list from the localized
     * config (hiddenTabs) so both halves agree. Nothing is hidden today.
     */
    private const HIDDEN_SECTIONS = [];

    public static function get_instance(): AlphaRecall_Admin_UI
    {
        if (!self::$instance) {
            self::$instance = new AlphaRecall_Admin_UI();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action("admin_menu", [$this, "register_menu"]);
        add_action("admin_menu", [$this, "remove_default_submenu"], 999);
        // Must run on admin_menu, not admin_init: WordPress checks page access
        // (wp-admin/includes/menu.php) right after the menu is built, before
        // admin_init ever fires, and a hidden slug would 403 there.
        add_action("admin_menu", [$this, "redirect_hidden_sections"], 1000);
        add_action("admin_enqueue_scripts", [$this, "enqueue_assets"]);
        add_action("admin_body_class", [$this, "add_body_class"]);
        add_action("admin_head", [$this, "inject_early_styles"]);
        add_action("admin_post_alpharecall_data_export", [$this, "handle_data_export"]);
    }

    /**
     * Impostazioni > Privacy > "Esporta tutti i dati": the site's whole AlphaRecall
     * archive as a ZIP (API GET /tenants/{id}/data-export, owner only), streamed to
     * the administrator's browser.
     */
    public function handle_data_export(): void
    {
        if (!current_user_can("manage_options")) {
            wp_die(esc_html__("You are not allowed to export this site's data.", "alpharecall"), 403);
        }
        check_admin_referer("alpharecall_data_export");
        $tenant_id = (int) (AlphaRecall_Settings::get_options()["tenant_id"] ?? 0);
        $result = $tenant_id ? AlphaRecall_Client::get_instance()->download_data_export($tenant_id) : new WP_Error("alpharecall_not_connected", "");
        if (is_wp_error($result)) {
            wp_die(esc_html__("The export could not be created. Try again in a few minutes.", "alpharecall"), 502);
        }
        nocache_headers();
        header("Content-Type: application/zip");
        header('Content-Disposition: attachment; filename="' . sanitize_file_name($result["filename"]) . '"');
        header("Content-Length: " . (string) filesize($result["path"]));
        readfile($result["path"]); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_readfile -- streams the ZIP without loading it in memory.
        wp_delete_file($result["path"]);
        exit;
    }

    /** Same labels as nav.sections.* in the app's i18n files. */
    private const TRANSLATIONS = [
        "it" => [
            "oggi"         => "Oggi",
            "inbox"        => "Messaggi",
            "richieste"    => "Richieste",
            "statistiche"  => "Statistiche",
            "assistente"   => "Addestramento",
            "widget"       => "Personalizzazione",
            "impostazioni" => "Impostazioni",
        ],
        "en-US" => [
            "oggi"         => "Today",
            "inbox"        => "Messages",
            "richieste"    => "Requests",
            "statistiche"  => "Statistics",
            "assistente"   => "Training",
            "widget"       => "Customization",
            "impostazioni" => "Settings",
        ],
    ];

    private function get_menu_label(string $key): string
    {
        // Read UI language from cookie (synced by React app, "ar_lang" before
        // 0.1.86), fall back to tenant setting
        $cookie = isset($_COOKIE["alpharecall_lang"]) ? "alpharecall_lang" : "ar_lang";
        $lang = isset($_COOKIE[$cookie]) ? sanitize_text_field(wp_unslash($_COOKIE[$cookie])) : null;
        if (!$lang || !isset(self::TRANSLATIONS[$lang])) {
            $options = AlphaRecall_Settings::get_options();
            $lang = $options["tenant_settings"]["response_language"] ?? "it";
            // Map "en-US" to "en-US" key in translations
            if ($lang === "en-US") {
                $lang = "en-US";
            }
        }
        // Cookie uses "en", tenant settings uses "en-US" — normalize
        if ($lang === "en") {
            $lang = "en-US";
        }
        $labels = self::TRANSLATIONS[$lang] ?? self::TRANSLATIONS["it"];
        return $labels[$key] ?? $key;
    }

    public function register_menu(): void
    {
        // Main menu: visible to both admin and support agents
        add_menu_page(
            "AlphaRecall",
            "AlphaRecall",
            "alpharecall_support",
            self::PAGE_SLUG,
            [$this, "render_page"],
            // Filled silhouette: WP recolours fill attributes to the menu colour and
            // would render strokes in black, so the icon must carry no strokes.
            "data:image/svg+xml;base64," . base64_encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#a7aaad"><circle cx="10" cy="2" r="1.6"/><path d="M9.25 3h1.5v2.2h-1.5z"/><path fill-rule="evenodd" d="M5.5 5.2h9A2.5 2.5 0 0 1 17 7.7v6.1a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 13.8V7.7a2.5 2.5 0 0 1 2.5-2.5zm2 3.3a1.1 1.1 0 0 0-1.1 1.1v2.3a1.1 1.1 0 0 0 2.2 0V9.6a1.1 1.1 0 0 0-1.1-1.1zm5 0a1.1 1.1 0 0 0-1.1 1.1v2.3a1.1 1.1 0 0 0 2.2 0V9.6a1.1 1.1 0 0 0-1.1-1.1z"/><rect x="0.5" y="9" width="1.9" height="3.6" rx="0.8"/><rect x="17.6" y="9" width="1.9" height="3.6" rx="0.8"/></svg>'),
            58
        );
        // One submenu item per section. Messaggi and Richieste are the support
        // role's whole dashboard; every other section needs the admin capability.
        foreach (self::SUBMENU_SLUGS as $slug => $section) {
            $label = $this->get_menu_label($section);
            add_submenu_page(
                self::PAGE_SLUG,
                $label,
                $label,
                in_array($section, self::SUPPORT_SECTIONS, true) ? "alpharecall_support" : "alpharecall_admin",
                $slug,
                [$this, "render_page"]
            );
        }
    }

    public function remove_default_submenu(): void
    {
        remove_submenu_page(self::PAGE_SLUG, self::PAGE_SLUG);
        global $submenu;
        if (!empty($submenu[self::PAGE_SLUG])) {
            foreach ($submenu[self::PAGE_SLUG] as $index => $item) {
                if (!empty($item[2]) && $item[2] === self::PAGE_SLUG) {
                    unset($submenu[self::PAGE_SLUG][$index]);
                }
            }
        }
    }

    /**
     * Old slugs have no menu entry, so WordPress would answer them with
     * "Sorry, you are not allowed to access this page". Send them to the page
     * that took their content, keeping the query string (a billing return
     * carries billing= and checkout_id=); a hidden page goes to the dashboard.
     * Hooked late on admin_menu so the redirect beats WordPress' own access
     * check.
     */
    public function redirect_hidden_sections(): void
    {
        $page = isset($_GET["page"]) ? sanitize_text_field(wp_unslash((string) $_GET["page"])) : "";
        if (!isset(self::LEGACY_SLUGS[$page])) {
            return;
        }
        [$slug, $view] = self::LEGACY_SLUGS[$page];
        $args = [];
        foreach ($_GET as $key => $value) {
            if (is_string($key) && is_string($value) && $key !== "page" && $key !== "view") {
                $args[sanitize_key($key)] = sanitize_text_field(wp_unslash($value));
            }
        }
        $args = array_merge(["page" => $slug, "view" => $view], $args);
        wp_safe_redirect(add_query_arg(rawurlencode_deep($args), admin_url("admin.php")));
        exit;
    }

    public function add_body_class(string $classes): string
    {
        $page = isset($_GET["page"]) ? sanitize_text_field(wp_unslash((string) $_GET["page"])) : "";
        $valid_pages = array_merge([self::PAGE_SLUG], array_keys(self::SUBMENU_SLUGS));
        if (in_array($page, $valid_pages, true)) {
            $classes .= " alpharecall-active";
        }
        return $classes;
    }

    public function inject_early_styles(): void
    {
        $page = isset($_GET["page"]) ? sanitize_text_field(wp_unslash((string) $_GET["page"])) : "";
        $valid_pages = array_merge([self::PAGE_SLUG], array_keys(self::SUBMENU_SLUGS));
        if (!in_array($page, $valid_pages, true) || !AlphaRecall_Connect::has_consent()
            || (current_user_can("manage_options") && AlphaRecall_Connect::needs_terms_acceptance())) {
            return;
        }
        // Inject in <head> BEFORE body renders — eliminates white/dark flash.
        // Theme resolution order (board card 4bfd6vm5vw6o): the user's saved
        // preference in WP user meta (follows them across devices), then the
        // localStorage value from this browser, then the OS preference via
        // prefers-color-scheme. Only an explicit choice forces a theme.
        $saved_theme = AlphaRecall_Settings::get_user_theme();
        $theme_init = '
            (function(){
                var t = ' . wp_json_encode($saved_theme) . ' || localStorage.getItem("ar-theme");
                if (t !== "light" && t !== "dark") {
                    t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
                }
                document.documentElement.setAttribute("data-ar-theme", t);
            })();
        ';
        wp_print_inline_script_tag($theme_init, ["id" => "alpharecall-theme-init"]);
        $early_css = '
            @keyframes ar-spin { to { transform: rotate(360deg); } }
            html[data-ar-theme="dark"] body, html[data-ar-theme="dark"] body.wp-admin { background: #0b0c0c !important; color: #edeeec !important; }
            html[data-ar-theme="dark"] #wpcontent, html[data-ar-theme="dark"] #wpbody, html[data-ar-theme="dark"] #wpbody-content, html[data-ar-theme="dark"] #wpwrap { background: #0b0c0c !important; padding-bottom: 0 !important; }
            html[data-ar-theme="dark"] #alpharecall-admin-app, html[data-ar-theme="dark"] #ar-boot-loader { background: #0b0c0c !important; }
            /* Core notices keep their light box: give them back core\'s ink, not the dark theme\'s. */
            html[data-ar-theme="dark"] #wpbody-content .notice, html[data-ar-theme="dark"] #wpbody-content .update-nag { color: #1d2327 !important; }
            html[data-ar-theme="light"] body, html[data-ar-theme="light"] body.wp-admin { background: #eeeeeb !important; color: #111312 !important; }
            html[data-ar-theme="light"] #wpcontent, html[data-ar-theme="light"] #wpbody, html[data-ar-theme="light"] #wpbody-content, html[data-ar-theme="light"] #wpwrap { background: #eeeeeb !important; padding-bottom: 0 !important; }
            html[data-ar-theme="light"] #alpharecall-admin-app, html[data-ar-theme="light"] #ar-boot-loader { background: #eeeeeb !important; }
            #wpfooter { display: none !important; }
            .wrap.alpharecall-admin { margin: 0 !important; padding: 0 !important; }
            /* Other plugins\' cosmetic notices would be spliced into the app by common.js; keep them off these
               pages. Errors, warnings and the core update nag still show. */
            body.alpharecall-active #wpbody-content > .notice:not(.notice-error):not(.notice-warning),
            body.alpharecall-active #wpbody-content > .updated,
            body.alpharecall-active .wrap.alpharecall-admin > .notice:not(.notice-error):not(.notice-warning),
            body.alpharecall-active .wrap.alpharecall-admin > .updated { display: none !important; }
            html.wp-toolbar, body.wp-admin { overflow-x: hidden !important; }
            #alpharecall-admin-app { margin-left: -20px; margin-right: 0; margin-top: -6px; min-height: var(--ar-app-height, calc(100dvh - var(--wp-admin--admin-bar--height, 32px))); overflow-x: hidden; }
            @media (max-width: 782px) { #alpharecall-admin-app { margin-left: -10px; margin-right: 0; min-height: var(--ar-app-height, calc(100dvh - var(--wp-admin--admin-bar--height, 46px))); } }
        ';
        // Printed here in <head> (admin_head) so the page never flashes the wrong theme.
        wp_register_style("alpharecall-admin-early", false, [], ALPHARECALL_PLUGIN_VERSION);
        wp_add_inline_style("alpharecall-admin-early", $early_css);
        wp_print_styles(["alpharecall-admin-early"]);
    }

    public function enqueue_assets(string $hook): void
    {
        global $pagenow;
        $page = isset($_GET["page"]) ? sanitize_text_field(wp_unslash((string) $_GET["page"])) : "";
        $valid_pages = array_merge([self::PAGE_SLUG], array_keys(self::SUBMENU_SLUGS));
        if ($pagenow !== "admin.php" || !in_array($page, $valid_pages, true)) {
            return;
        }
        if (!AlphaRecall_Connect::has_consent()
            || (current_user_can("manage_options") && AlphaRecall_Connect::needs_terms_acceptance())) {
            // Only the connection (or Terms update) screen until an administrator agrees.
            AlphaRecall_Connect::enqueue_assets();
            return;
        }
        $page = $page ?: self::PAGE_SLUG;
        $initial_tools_tab = null;
        $is_admin = current_user_can("manage_options") || current_user_can("alpharecall_admin");
        // The section this slug opens; the app reads `view` from the URL itself.
        $initial_tab = self::SUBMENU_SLUGS[$page] ?? "oggi";
        // Support agents land in the inbox unless they asked for Richieste
        if (!$is_admin && !in_array($initial_tab, self::SUPPORT_SECTIONS, true)) {
            $initial_tab = self::SUPPORT_SECTION;
        }
        $css_version = file_exists(ALPHARECALL_PLUGIN_PATH . "assets/css/admin.css")
            ? filemtime(ALPHARECALL_PLUGIN_PATH . "assets/css/admin.css")
            : ALPHARECALL_PLUGIN_VERSION;
        $js_version = file_exists(ALPHARECALL_PLUGIN_PATH . "assets/js/admin.js")
            ? filemtime(ALPHARECALL_PLUGIN_PATH . "assets/js/admin.js")
            : ALPHARECALL_PLUGIN_VERSION;
        wp_enqueue_media();
        wp_enqueue_style(
            "alpharecall-admin",
            ALPHARECALL_PLUGIN_URL . "assets/css/admin.css",
            [],
            $css_version
        );
        wp_enqueue_script(
            "alpharecall-admin",
            ALPHARECALL_PLUGIN_URL . "assets/js/admin.js",
            [],
            $js_version,
            true
        );
        wp_add_inline_script(
            "alpharecall-admin",
            "window.__AlphaRecallExpectedVersion = " . wp_json_encode((string) ALPHARECALL_PLUGIN_VERSION) . ";",
            "before"
        );
        wp_register_script("alpharecall-admin-healthcheck", "", [], ALPHARECALL_PLUGIN_VERSION, true);
        wp_enqueue_script("alpharecall-admin-healthcheck");
        $admin_failed_msg = esc_js(__("AlphaRecall couldn't load. Please reload the page.", "alpharecall"));
        $healthcheck_js = implode("\n", [
            '(function () {',
            '  var expected = String(window.__AlphaRecallExpectedVersion || "").trim();',
            '  function checkBoot() {',
            '    var root = document.getElementById("alpharecall-admin-app");',
            '    if (!root) return;',
            '    var adminReady = root.querySelector("[data-admin-ready]");',
            '    if (adminReady) return;',
            '    var hint = document.createElement("div");',
            '    hint.className = "ar-admin-runtime-hint";',
            '    hint.style.cssText =',
            '      "margin:16px 0;padding:12px 14px;border:1px solid #f0b429;background:#fff8e6;color:#5f370e;border-radius:8px;font:13px/1.45 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;";',
            '    hint.innerHTML =',
            '      "<strong>' . $admin_failed_msg . '</strong><br/>" +',
            '      "Expected version: <code>v" + (expected || "unknown") + "</code>. " +',
            '      "If the UI does not appear, clear optimizer/CDN cache for <code>/wp-content/plugins/alpharecall/assets/js/admin.js</code> and reload.";',
            '    if (!root.querySelector(".ar-admin-runtime-hint")) {',
            '      root.prepend(hint);',
            '    }',
            '    if (window.console && typeof window.console.warn === "function") {',
            '      console.warn("[AlphaRecall] Admin failed to load", {',
            '        expectedVersion: expected,',
            '        hasAdminReady: !!adminReady,',
            '        hasAlphaRecallAdminConfig: !!window.AlphaRecallAdmin',
            '      });',
            '    }',
            '  }',
            '  // admin.js only loads the app (a chunk of its own): count the 4s from when',
            '  // that chunk has arrived, or a slow connection would see the warning while',
            '  // the app is still on its way. A failed load is reported at once.',
            '  var boot = window.__AlphaRecallAdminBoot;',
            '  if (boot && typeof boot.then === "function") {',
            '    boot.then(function () { window.setTimeout(checkBoot, 4000); }, checkBoot);',
            '  } else {',
            '    window.setTimeout(checkBoot, 4000);',
            '  }',
            '})();',
        ]);
        wp_add_inline_script("alpharecall-admin-healthcheck", $healthcheck_js);
        $options = AlphaRecall_Settings::get_options();
        // Fetch license tier (cached for 1 hour)
        // Force refresh on billing success redirect so upgraded tier is shown immediately
        $billing_success = isset($_GET["billing"]) && sanitize_key(wp_unslash((string) $_GET["billing"])) === "success";
        $license_tier = $billing_success ? false : get_transient("alpharecall_license_tier");
        if ($license_tier === false) {
            $fetched_tier = null;
            $tier_ttl = HOUR_IN_SECONDS;
            try {
                $domain = $options["tenant_domain"] ?? "";
                if ($domain) {
                    $client = AlphaRecall_Client::get_instance();
                    $tenant_info = $client->resolve_tenant($domain);
                    if (!is_wp_error($tenant_info) && is_array($tenant_info)) {
                        // Reuse the payload to warm the widget plan-features cache (no extra call)
                        AlphaRecall_Client::cache_plan_features($tenant_info);
                        $fetched_tier = AlphaRecall_Client::effective_license_tier($tenant_info);
                        $tier_ttl = AlphaRecall_Client::license_tier_ttl($tenant_info, HOUR_IN_SECONDS);
                    }
                }
            } catch (\Throwable $e) {
                // API unreachable — don't cache "free"
            }
            if ($fetched_tier && in_array($fetched_tier, ["free", "pro", "business", "enterprise"], true)) {
                $license_tier = $fetched_tier;
                set_transient("alpharecall_license_tier", $license_tier, $tier_ttl);
            } else {
                // API failed or returned invalid tier — use "free" for this request only, don't cache
                $license_tier = get_transient("alpharecall_license_tier") ?: "free";
            }
        }

        // Determine the AlphaRecall role from WP capabilities (mirrors derive_role_from_caps in rbac.py)
        $current_user_obj = wp_get_current_user();
        $actor_role = "viewer";
        if ($current_user_obj->has_cap("manage_options")) {
            $actor_role = "owner";
        } elseif ($current_user_obj->has_cap("alpharecall_admin")) {
            $actor_role = "admin";
        } elseif ($current_user_obj->has_cap("alpharecall_support")) {
            $actor_role = "agent";
        }

        // Effective permissions — use role-based defaults (TTL 5 min per user).
        // The frontend will refresh via /team/me which may return a member-row override.
        $actor_permissions_key = "alpharecall_actor_perms_" . get_current_user_id() . "_" . ($options["tenant_id"] ?? "0");
        $actor_permissions = get_transient($actor_permissions_key);
        if ($actor_permissions === false) {
            $role_perm_map = [
                "owner"  => ["dashboard.read","conversations.read","conversations.manage","visitors.read","visitors.manage","gdpr.manage","content.manage","helpdesk.manage","tools.read","tools.manage","support_chat.handle","settings.manage","team.manage","billing.manage"],
                "admin"  => ["dashboard.read","conversations.read","conversations.manage","visitors.read","visitors.manage","gdpr.manage","content.manage","helpdesk.manage","tools.read","tools.manage","support_chat.handle","settings.manage"],
                "agent"  => ["dashboard.read","conversations.read","conversations.manage","visitors.read","visitors.manage","tools.read","tools.manage","support_chat.handle"],
                "viewer" => ["dashboard.read","conversations.read","visitors.read","tools.read"],
            ];
            $actor_permissions = $role_perm_map[$actor_role] ?? [];
            set_transient($actor_permissions_key, $actor_permissions, 5 * MINUTE_IN_SECONDS);
        }

        $plan_gate = AlphaRecall_Client::get_instance()->get_plan_features();
        wp_localize_script(
            "alpharecall-admin",
            "AlphaRecallAdmin",
            [
                "restUrl" => esc_url_raw(rest_url("alpharecall/v1")),
                "wpRestUrl" => esc_url_raw(rest_url()),
                "ajaxUrl" => esc_url_raw(admin_url("admin-ajax.php")),
                "ajaxNonce" => wp_create_nonce("alpharecall_admin"),
                "supportStreamUrl" => admin_url("admin-ajax.php?action=alpharecall_support_stream"),
                "siteUrl" => esc_url_raw(home_url()),
                // Workspace name in the top bar.
                "siteName" => wp_specialchars_decode(get_bloginfo("name"), ENT_QUOTES),
                // Base for bundled assets (visitor avatar placeholders, etc.)
                "assetsUrl" => esc_url_raw(ALPHARECALL_PLUGIN_URL . "assets/"),
                "nonce" => wp_create_nonce("wp_rest"),
                "dataExportUrl" => current_user_can("manage_options")
                    ? wp_nonce_url(admin_url("admin-post.php?action=alpharecall_data_export"), "alpharecall_data_export")
                    : "",
                "upgradeUrl" => esc_url_raw(apply_filters("alpharecall_upgrade_url", "https://alpharecall.com/pricing/")),
                "pluginVersion" => ALPHARECALL_PLUGIN_VERSION,
                "navMode" => "wp",
                "licenseTier" => $license_tier,
                "initialTab" => $initial_tab,
                "initialToolsTab" => $initial_tools_tab,
                "hiddenTabs" => self::HIDDEN_SECTIONS,
                // Same cached plan the widget's enqueue decision reads, so the
                // dashboard banner and the site agree on whether chat is on.
                "chatAvailable" => !array_key_exists("chat_available", $plan_gate) || !empty($plan_gate["chat_available"]),
                "chatUnavailableReason" => (string) ($plan_gate["chat_unavailable_reason"] ?? ""),
                "billing" => [
                    "success_url" => admin_url('admin.php?page=alpharecall-settings&view=piano&billing=success&checkout_id={CHECKOUT_ID}'),
                ],
                "role"        => $actor_role,
                "permissions" => $actor_permissions,
                "userRole" => $is_admin ? "admin" : "support",
                "notificationPreferences" => AlphaRecall_Settings::get_notification_preferences(),
                "currentUser" => [
                    "id" => get_current_user_id(),
                    "name" => wp_get_current_user()->display_name,
                    // What a reply without a profile is signed with, as the
                    // proxy sends it (reply_attribution): "" means unsigned.
                    "public_name" => AlphaRecall_Support_Role::public_name(wp_get_current_user()),
                    "email" => wp_get_current_user()->user_email,
                    "avatar_url" => get_avatar_url(get_current_user_id(), ["size" => 64]),
                ],
                "isWpAdmin" => current_user_can("manage_options"),
                "linkedProfileId" => (int) get_user_meta(get_current_user_id(), "alpharecall_support_profile_id", true),
                "settings" => [
                    "tenant_domain" => $options["tenant_domain"],
                    "tenant_id" => $options["tenant_id"],
                    "tenant_status" => $options["tenant_status"],
                    // Let the dashboard explain an unprovisioned site instead of
                    // rendering an empty "not ready" card with no cause.
                    "pending_bootstrap" => (bool) ($options["pending_bootstrap"] ?? false),
                    "bootstrap_last_error" => (string) ($options["bootstrap_last_error"] ?? ""),
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
                ],
            ]
        );
    }

    public function render_page(): void
    {
        if (!AlphaRecall_Connect::has_consent()) {
            AlphaRecall_Connect::render();
            return;
        }
        if (current_user_can("manage_options") && AlphaRecall_Connect::needs_terms_acceptance()) {
            // The dashboard waits for an administrator to accept the current Terms; the widget keeps working.
            AlphaRecall_Connect::render_terms_update();
            return;
        }
        ?>
        <div class="wrap alpharecall-admin">
            <?php /* Anchor for wp-admin notice relocation, so common.js never targets the app's own <h1>. */ ?>
            <hr class="wp-header-end" style="display:none" />
            <div id="alpharecall-admin-app">
                <div id="ar-boot-loader" style="
                    display:flex;align-items:center;justify-content:center;
                    min-height:calc(100vh - 32px);
                    background:#0b0c0c;
                    margin-left:-20px;margin-right:-2px;margin-top:-6px;
                ">
                    <div style="text-align:center;">
                        <div style="
                            width:40px;height:40px;margin:0 auto 16px;
                            border:3px solid rgba(128,132,130,0.22);
                            border-top-color:#2f6b55;
                            border-radius:50%;
                            animation:ar-spin 0.8s linear infinite;
                        "></div>
                        <div style="color:#8e928f;font:13px system-ui,sans-serif;letter-spacing:0.5px;">
                            AlphaRecall
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <?php
    }
}
