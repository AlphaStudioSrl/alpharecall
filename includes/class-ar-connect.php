<?php
/**
 * First-run connection: explicit consent before the plugin talks to the
 * AlphaRecall service, and the secret-free enrolment that gets the site its key.
 *
 * WordPress.org guideline 7: a plugin may not contact an external server
 * without the site owner's explicit consent. Until an administrator ticks the
 * box on the connection screen, AlphaRecall_Client::get_api_base() returns an empty
 * base, so no request leaves the site, the dashboard shows only this screen and
 * the chat widget is not rendered.
 *
 * Installs that carry the platform secret (the zip released from our own
 * repository and handed to clients who signed a contract) or that were already
 * connected before this screen existed count as consented, so they keep
 * working unchanged.
 *
 * Enrolment without a shared secret (see app/tenant_enrollment.py in the API):
 * the plugin keeps a random challenge for a few minutes, asks the API to enrol
 * its domain, and the API calls back the public route
 * /wp-json/alpharecall/v1/enroll/verify with a nonce. The site answers with
 * HMAC-SHA256(challenge, "domain|nonce"), which only the site that started the
 * enrolment can compute. The route reveals nothing else and answers 404 when no
 * enrolment is in progress.
 *
 * @package AlphaRecall
 */

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_Connect
{
    /** Consent record, kept apart from alpharecall_settings and its sanitizer. */
    public const OPTION = "alpharecall_connection";
    private const CHALLENGE_TRANSIENT = "alpharecall_enroll_challenge";
    private const CHALLENGE_TTL = 10 * MINUTE_IN_SECONDS;
    private const LOCK_OPTION = "alpharecall_enroll_lock";

    public const SERVICE_URL = "https://alpharecall.com/";
    public const TERMS_URL = "https://alpharecall.com/terms-and-conditions/";
    public const PRIVACY_URL = "https://alpharecall.com/privacy-policy/";

    /**
     * The Terms of Service version an administrator accepts on these screens. A new
     * value asks every site's administrator to accept again (render_terms_update()).
     * OWNER: set the final version and the art. 24 clause list (specific_approval_clauses())
     * from the lawyer-reviewed Terms before release; see docs/LAUNCH-COMPLIANCE.md.
     */
    public const TERMS_VERSION = "2026-11-draft";
    /**
     * Whether TERMS_VERSION and the clause list are the final, lawyer-reviewed text. While
     * false, sites already connected are not asked to accept (no record of a draft); new
     * connections still tick both boxes. OWNER: set true together with the final text.
     */
    public const TERMS_FINAL = false;
    private const TERMS_SYNC_RETRY = 5 * MINUTE_IN_SECONDS;

    public static function init(): void
    {
        add_action("admin_post_alpharecall_connect", [self::class, "handle_connect"]);
        add_action("admin_post_alpharecall_accept_terms", [self::class, "handle_accept_terms"]);
        add_action("admin_init", [self::class, "maybe_sync_terms_acceptance"], 20);
        add_action("rest_api_init", [self::class, "register_routes"]);
    }

    /**
     * The clauses of art. 24 of the Terms that the administrator approves specifically
     * (art. 1341-1342 of the Italian Civil Code), listed beside the second checkbox.
     * DRAFT until the lawyer-reviewed Terms are published (docs/LAUNCH-COMPLIANCE.md).
     *
     * @return string[]
     */
    public static function specific_approval_clauses(): array
    {
        return [
            __("limitation of AlphaRecall's liability;", "alpharecall"),
            __("AlphaRecall's right to suspend or interrupt the service;", "alpharecall"),
            __("automatic renewal of the subscription and how to cancel it;", "alpharecall"),
            __("changes to the Terms and to the prices;", "alpharecall"),
            __("withdrawal and termination of the contract;", "alpharecall"),
            __("governing law and exclusive place of jurisdiction.", "alpharecall"),
        ];
    }

    /** SHA-256 of the version and the clause text as shown, kept with the acceptance. */
    public static function clauses_text_hash(): string
    {
        return hash("sha256", self::TERMS_VERSION . "\n" . implode("\n", self::specific_approval_clauses()));
    }

    /** The acceptance stored on this site, or null. */
    public static function terms_record(): ?array
    {
        $record = get_option(self::OPTION, []);
        $terms = is_array($record) ? ($record["terms"] ?? null) : null;
        return is_array($terms) ? $terms : null;
    }

    /**
     * Whether an administrator still has to accept the current Terms: a site connected
     * before this screen asked for it, a managed install, or an older Terms version.
     * The "alpharecall_require_terms_acceptance" filter can turn the request off.
     */
    public static function needs_terms_acceptance(): bool
    {
        if (!self::TERMS_FINAL || !self::has_consent() || !apply_filters("alpharecall_require_terms_acceptance", true)) {
            return false;
        }
        $terms = self::terms_record();
        return !$terms || ($terms["version"] ?? "") !== self::TERMS_VERSION;
    }

    /** The administrator's IP: REMOTE_ADDR, or the first X-Forwarded-For hop behind a trusted proxy. */
    private static function client_ip(): string
    {
        $remote = trim(sanitize_text_field(wp_unslash((string) ($_SERVER["REMOTE_ADDR"] ?? ""))));
        $trusted = apply_filters("alpharecall_trusted_proxies", []);
        if (is_array($trusted) && in_array($remote, $trusted, true)) {
            $forwarded = sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_X_FORWARDED_FOR"] ?? "")));
            $first = trim((string) (explode(",", $forwarded)[0] ?? ""));
            if ($first !== "" && filter_var($first, FILTER_VALIDATE_IP)) {
                return $first;
            }
        }
        return filter_var($remote, FILTER_VALIDATE_IP) ? $remote : "";
    }

    /**
     * Read the two required checkboxes of a submitted form. Returns the acceptance to
     * store, or null when one of them is missing.
     */
    private static function acceptance_from_post(string $source): ?array
    {
        $ticked = static fn(string $name): bool => isset($_POST[$name]) // phpcs:ignore WordPress.Security.NonceVerification.Missing -- the callers check the nonce first.
            && sanitize_text_field(wp_unslash($_POST[$name])) === "1"; // phpcs:ignore WordPress.Security.NonceVerification.Missing
        if (!$ticked("alpharecall_agree") || !$ticked("alpharecall_clauses")) {
            return null;
        }
        $user = wp_get_current_user();
        return [
            "version" => self::TERMS_VERSION,
            "accepted_at" => time(),
            "professional" => true,
            "clauses" => true,
            "clauses_hash" => self::clauses_text_hash(),
            "ip" => self::client_ip(),
            "user_agent" => mb_substr(sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_USER_AGENT"] ?? ""))), 0, 512),
            "user_id" => (int) $user->ID,
            "user_name" => (string) $user->display_name,
            "user_email" => (string) $user->user_email,
            "source" => $source,
            "synced_at" => 0,
            "sync_attempt_at" => 0,
        ];
    }

    private static function store_terms(array $terms): void
    {
        $record = get_option(self::OPTION, []);
        $record = is_array($record) ? $record : [];
        $record["terms"] = $terms;
        update_option(self::OPTION, $record, false);
    }

    /**
     * Send the stored acceptance to AlphaRecall once the site has its key (admin_init).
     * A failure is retried a few minutes later; the API keeps every acceptance it receives.
     */
    public static function maybe_sync_terms_acceptance(): void
    {
        // An administrator's page load only: admin_init also runs for admin-ajax calls from visitors.
        if (wp_doing_ajax() || !current_user_can("manage_options")) {
            return;
        }
        $terms = self::terms_record();
        if (!$terms || !empty($terms["synced_at"]) || !empty($terms["sync_refused"]) || !self::has_consent()) {
            return;
        }
        if (time() - (int) ($terms["sync_attempt_at"] ?? 0) < self::TERMS_SYNC_RETRY) {
            return;
        }
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return;
        }
        $terms["sync_attempt_at"] = time();
        self::store_terms($terms);
        $result = AlphaRecall_Client::get_instance()->record_terms_acceptance($tenant_id, [
            "terms_version" => (string) $terms["version"],
            "professional_confirmed" => !empty($terms["professional"]),
            "clauses_approved" => !empty($terms["clauses"]),
            "clauses_text_hash" => (string) ($terms["clauses_hash"] ?? ""),
            "accepted_at" => gmdate("Y-m-d\\TH:i:s\\Z", (int) $terms["accepted_at"]),
            "ip_address" => ($terms["ip"] ?? "") !== "" ? (string) $terms["ip"] : null,
            "user_agent" => (string) ($terms["user_agent"] ?? ""),
            "wp_user_id" => (int) ($terms["user_id"] ?? 0),
            "user_name" => mb_substr((string) ($terms["user_name"] ?? ""), 0, 255),
            "user_email" => is_email((string) ($terms["user_email"] ?? "")) && strlen((string) $terms["user_email"]) <= 320 ? (string) $terms["user_email"] : null,
            "site_url" => home_url("/"),
            "source" => ($terms["source"] ?? "") === "reaccept" ? "reaccept" : "connect",
            "plugin_version" => ALPHARECALL_PLUGIN_VERSION,
        ]);
        if (is_wp_error($result)) {
            // A permanent refusal (4xx other than auth, timeout or rate limit) is not retried
            // every few minutes forever; accepting the Terms again stores a fresh record.
            $status = (int) (((array) $result->get_error_data())["status"] ?? 0);
            if ($status >= 400 && $status < 500 && !in_array($status, [401, 403, 408, 429], true)) {
                $terms["sync_refused"] = $status;
                self::store_terms($terms);
            }
            return;
        }
        $terms["synced_at"] = time();
        self::store_terms($terms);
    }

    /** The release carries the platform enrolment secret (direct installs only, never WordPress.org). */
    public static function is_managed_install(): bool
    {
        return AlphaRecall_Settings::has_platform_secret();
    }

    /**
     * Whether the plugin may contact the AlphaRecall service. Reads the raw
     * options (no AlphaRecall_Settings::get_options()) because get_api_base() calls this.
     */
    public static function has_consent(): bool
    {
        if (self::is_managed_install()) {
            return true;
        }
        $record = get_option(self::OPTION, []);
        if (is_array($record) && !empty($record["consent_at"])) {
            return true;
        }
        // Sites connected before the consent screen existed.
        $settings = get_option("alpharecall_settings", []);
        return is_array($settings) && !empty($settings["tenant_id"]);
    }

    /**
     * Whether the widget may show the "Powered by Alpha Recall" link: only
     * when the owner chose it (guideline 10), on the connection screen or
     * later in Personalizzazione > Widget (the /branding/attribution route).
     * The same on every plan and every kind of install (guideline 5): the plan
     * never shows or hides it. Sites connected before the connection screen
     * existed and managed installs have no recorded choice, so it stays off
     * until the owner turns it on. The "alpharecall_show_attribution" filter
     * overrides the choice.
     */
    public static function attribution_allowed(): bool
    {
        return (bool) apply_filters("alpharecall_show_attribution", self::attribution_choice());
    }

    /** The owner's "Powered by Alpha Recall" choice; off when none was made. */
    public static function attribution_choice(): bool
    {
        $record = get_option(self::OPTION, []);
        return is_array($record) && !empty($record["show_attribution"]);
    }

    /** Record the owner's choice. Every site can change it, on any plan. */
    public static function set_attribution(bool $show): bool
    {
        $record = get_option(self::OPTION, []);
        $record = is_array($record) ? $record : [];
        $record["show_attribution"] = $show;
        update_option(self::OPTION, $record, false);
        return true;
    }

    public static function can_manage(): bool
    {
        return current_user_can("manage_options");
    }

    /** GET/POST /branding/attribution: {editable, shown}. */
    public static function attribution_response(): WP_REST_Response
    {
        // "editable" stays in the answer for dashboards built before every
        // site could change it; it is always true now.
        return new WP_REST_Response(
            ["editable" => true, "shown" => self::attribution_allowed()],
            200,
            ["Cache-Control" => "no-store, private"]
        );
    }

    public static function save_attribution(WP_REST_Request $request): WP_REST_Response
    {
        self::set_attribution((bool) $request->get_param("show"));
        return self::attribution_response();
    }

    public static function register_routes(): void
    {
        // Guideline 10: the owner who opted in to the credit link can turn it
        // off again from the dashboard, on any plan.
        register_rest_route("alpharecall/v1", "/branding/attribution", [
            [
                "methods" => "GET",
                "permission_callback" => [self::class, "can_manage"],
                "callback" => [self::class, "attribution_response"],
            ],
            [
                "methods" => "POST",
                "permission_callback" => [self::class, "can_manage"],
                "callback" => [self::class, "save_attribution"],
                "args" => [
                    "show" => ["type" => "boolean", "required" => true],
                ],
            ],
        ]);
        register_rest_route("alpharecall/v1", "/enroll/verify", [
            "methods" => "GET",
            // Public on purpose: the AlphaRecall API calls it, unauthenticated,
            // while this site enrols. It only proves knowledge of a short-lived
            // random challenge and returns 404 when no enrolment is running.
            "permission_callback" => "__return_true",
            "callback" => [self::class, "verify_enrollment"],
            "args" => [
                "nonce" => [
                    "type" => "string",
                    "required" => true,
                    "validate_callback" => static fn($value): bool => is_string($value)
                        && preg_match('/^[A-Za-z0-9_-]{16,128}$/', $value) === 1,
                ],
            ],
        ]);
    }

    public static function verify_enrollment(WP_REST_Request $request): WP_REST_Response
    {
        $pending = get_transient(self::CHALLENGE_TRANSIENT);
        $headers = ["Cache-Control" => "no-store, private"];
        if (!is_array($pending) || empty($pending["challenge"]) || empty($pending["domain"])) {
            return new WP_REST_Response(["error" => "no_enrollment"], 404, $headers);
        }
        $nonce = sanitize_text_field((string) $request->get_param("nonce"));
        $proof = hash_hmac("sha256", $pending["domain"] . "|" . $nonce, (string) $pending["challenge"]);
        return new WP_REST_Response(["proof" => $proof], 200, $headers);
    }

    /**
     * Ask the API for this site's key by proving control of the domain.
     *
     * @return array|WP_Error The /tenants/enroll response (tenant_id, domain, api_key, status).
     */
    public static function enroll(AlphaRecall_Client $client, string $domain)
    {
        // One enrolment at a time: every success issues a new key, so parallel
        // requests of a site that lost its key must not race each other.
        $now = time();
        if (!add_option(self::LOCK_OPTION, $now, "", false)) {
            if ($now - (int) get_option(self::LOCK_OPTION, 0) < self::CHALLENGE_TTL) {
                return new WP_Error("alpharecall_enroll_busy", "Connection already in progress.", ["status" => 409]);
            }
            update_option(self::LOCK_OPTION, $now, false);
        }
        $challenge = wp_generate_password(64, false, false);
        set_transient(self::CHALLENGE_TRANSIENT, ["challenge" => $challenge, "domain" => strtolower($domain)], self::CHALLENGE_TTL);
        try {
            return $client->enroll_domain([
                "domain" => $domain,
                "verify_url" => rest_url("alpharecall/v1/enroll/verify"),
                "challenge" => $challenge,
            ]);
        } finally {
            delete_transient(self::CHALLENGE_TRANSIENT);
            delete_option(self::LOCK_OPTION);
        }
    }

    /**
     * Record the administrator's consent. The connection itself runs on the
     * next admin page load (AlphaRecall_Settings::maybe_bootstrap(), before admin_init),
     * the same path every other bootstrap takes; its outcome shows on the dashboard.
     */
    public static function handle_connect(): void
    {
        if (!current_user_can("manage_options")) {
            wp_die(esc_html__("You are not allowed to connect this site.", "alpharecall"), 403);
        }
        check_admin_referer("alpharecall_connect");
        $back = admin_url("admin.php?page=alpharecall-dashboard");
        $terms = self::acceptance_from_post("connect");
        if ($terms === null) {
            wp_safe_redirect(add_query_arg("alpharecall_connect_error", "consent", $back));
            exit;
        }
        $show_attribution = isset($_POST["alpharecall_attribution"])
            && sanitize_text_field(wp_unslash($_POST["alpharecall_attribution"])) === "1";
        update_option(self::OPTION, [
            "consent_at" => time(),
            "consent_user" => get_current_user_id(),
            "show_attribution" => $show_attribution,
            "terms" => $terms,
        ], false);
        $options = AlphaRecall_Settings::get_options();
        if (empty($options["tenant_id"])) {
            // Connect right away on the next page load, whatever an earlier attempt left.
            $options["pending_bootstrap"] = true;
            $options["bootstrap_last_attempt"] = 0;
            AlphaRecall_Settings::persist($options);
        }
        wp_safe_redirect($back);
        exit;
    }

    /** The update screen's form: a new Terms version, or a site that never accepted them. */
    public static function handle_accept_terms(): void
    {
        if (!current_user_can("manage_options")) {
            wp_die(esc_html__("You are not allowed to accept the Terms for this site.", "alpharecall"), 403);
        }
        check_admin_referer("alpharecall_accept_terms");
        $back = admin_url("admin.php?page=alpharecall-dashboard");
        $terms = self::acceptance_from_post("reaccept");
        if ($terms === null) {
            wp_safe_redirect(add_query_arg("alpharecall_connect_error", "consent", $back));
            exit;
        }
        self::store_terms($terms);
        self::maybe_sync_terms_acceptance();
        wp_safe_redirect($back);
        exit;
    }

    /** The two required checkboxes, not ticked, with the art. 24 clauses listed beside the second. */
    private static function render_terms_fields(bool $with_connection): void
    {
        $terms_link = '<a href="' . esc_url(self::TERMS_URL) . '" target="_blank" rel="noopener noreferrer">' . esc_html__("Terms of Service", "alpharecall") . "</a>";
        $privacy_link = '<a href="' . esc_url(self::PRIVACY_URL) . '" target="_blank" rel="noopener noreferrer">' . esc_html__("Privacy Policy", "alpharecall") . "</a>";
        $allowed = ["a" => ["href" => [], "target" => [], "rel" => []]];
        ?>
        <label>
            <input type="checkbox" name="alpharecall_agree" value="1" required />
            <span>
                <?php
                echo wp_kses(
                    $with_connection
                        ? sprintf(
                            /* translators: 1: "Terms of Service" link, 2: "Privacy Policy" link */
                            esc_html__("I accept the AlphaRecall %1\$s and %2\$s, I confirm that I am acting as a business or professional with a VAT number (Partita IVA), and I allow this site to connect to the AlphaRecall service.", "alpharecall"),
                            $terms_link,
                            $privacy_link
                        )
                        : sprintf(
                            /* translators: 1: "Terms of Service" link, 2: "Privacy Policy" link */
                            esc_html__("I accept the AlphaRecall %1\$s and %2\$s and I confirm that I am acting as a business or professional with a VAT number (Partita IVA).", "alpharecall"),
                            $terms_link,
                            $privacy_link
                        ),
                    $allowed
                );
                ?>
            </span>
        </label>
        <label>
            <input type="checkbox" name="alpharecall_clauses" value="1" required aria-describedby="alpharecall-clauses-list" />
            <span><?php esc_html_e("Under articles 1341 and 1342 of the Italian Civil Code, I specifically approve the clauses of article 24 of the Terms of Service:", "alpharecall"); ?></span>
        </label>
        <ul id="alpharecall-clauses-list" class="ar-connect-clauses">
            <?php foreach (self::specific_approval_clauses() as $clause) : ?>
                <li><?php echo esc_html($clause); ?></li>
            <?php endforeach; ?>
        </ul>
        <p class="description">
            <?php
            /* translators: %s: Terms of Service version */
            echo esc_html(sprintf(__("Terms of Service version %s.", "alpharecall"), self::TERMS_VERSION));
            ?>
        </p>
        <?php
    }

    /** Shown instead of the dashboard to an administrator who has not accepted the current Terms. */
    public static function render_terms_update(): void
    {
        $status = isset($_GET["alpharecall_connect_error"]) ? sanitize_key(wp_unslash($_GET["alpharecall_connect_error"])) : ""; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display-only flag set by our own redirect.
        $icon = ALPHARECALL_PLUGIN_URL . "assets/img/alpharecall-icon.png";
        ?>
        <div class="wrap ar-connect">
            <div class="card">
                <h1><img src="<?php echo esc_url($icon); ?>" alt="" /><?php esc_html_e("Accept the Terms of Service", "alpharecall"); ?></h1>
                <?php if ($status === "consent") : ?>
                    <div class="notice notice-error inline"><p><?php esc_html_e("Please tick both boxes to continue.", "alpharecall"); ?></p></div>
                <?php endif; ?>
                <p><?php esc_html_e("To keep using the AlphaRecall dashboard, an administrator of this site needs to accept the current Terms of Service. The assistant on your site keeps working in the meantime.", "alpharecall"); ?></p>
                <p><?php esc_html_e("We keep a record of the acceptance (date, time, IP address, name and e-mail of the administrator) as proof, and send a copy to that e-mail.", "alpharecall"); ?></p>
                <form method="post" action="<?php echo esc_url(admin_url("admin-post.php")); ?>">
                    <?php wp_nonce_field("alpharecall_accept_terms"); ?>
                    <input type="hidden" name="action" value="alpharecall_accept_terms" />
                    <?php self::render_terms_fields(false); ?>
                    <?php submit_button(__("Accept and continue", "alpharecall"), "primary", "submit", false); ?>
                </form>
            </div>
        </div>
        <?php
    }

    public static function enqueue_assets(): void
    {
        wp_register_style("alpharecall-connect", false, [], ALPHARECALL_PLUGIN_VERSION);
        wp_enqueue_style("alpharecall-connect");
        wp_add_inline_style(
            "alpharecall-connect",
            ".ar-connect{max-width:720px;margin:32px auto;padding:0 16px}"
            . ".ar-connect .card{max-width:none;padding:24px 28px}"
            . ".ar-connect h1{display:flex;align-items:center;gap:12px;margin:0 0 8px}"
            . ".ar-connect h1 img{width:40px;height:40px;border-radius:8px}"
            . ".ar-connect ul{list-style:disc;margin-left:20px}"
            . ".ar-connect label{display:flex;gap:8px;align-items:flex-start;margin:12px 0}"
            . ".ar-connect label input{margin-top:3px}"
            . ".ar-connect ul.ar-connect-clauses{margin:-4px 0 12px 44px}"
        );
    }

    public static function render(): void
    {
        $status = isset($_GET["alpharecall_connect_error"]) ? sanitize_key(wp_unslash($_GET["alpharecall_connect_error"])) : ""; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display-only flag set by our own redirect.
        $icon = ALPHARECALL_PLUGIN_URL . "assets/img/alpharecall-icon.png";
        ?>
        <div class="wrap ar-connect">
            <div class="card">
                <h1><img src="<?php echo esc_url($icon); ?>" alt="" /><?php esc_html_e("Connect AlphaRecall", "alpharecall"); ?></h1>
                <?php if (!current_user_can("manage_options")) : ?>
                    <p><?php esc_html_e("AlphaRecall is not connected yet. Ask a site administrator to connect it.", "alpharecall"); ?></p>
                <?php else : ?>
                    <?php if ($status === "consent") : ?>
                        <div class="notice notice-error inline"><p><?php esc_html_e("Please tick both boxes to agree before connecting.", "alpharecall"); ?></p></div>
                    <?php endif; ?>
                    <p><?php esc_html_e("AlphaRecall adds an AI assistant to your site. The assistant runs on the AlphaRecall cloud service, so the plugin needs your permission before it connects to it.", "alpharecall"); ?></p>
                    <p><strong><?php esc_html_e("When you connect, this site sends to AlphaRecall:", "alpharecall"); ?></strong></p>
                    <ul>
                        <li><?php esc_html_e("the site address, to create your account, and the site name, shown in your dashboard and reports;", "alpharecall"); ?></li>
                        <li><?php esc_html_e("the pages, posts, products and documents you choose to sync, so the assistant can answer from them;", "alpharecall"); ?></li>
                        <li><?php esc_html_e("the messages visitors write in the chat, the files they attach, the contact details they choose to leave, and their IP address, used against abuse;", "alpharecall"); ?></li>
                        <li><?php esc_html_e("the settings you change in the AlphaRecall dashboard, with the WordPress user ID, e-mail address and role of whoever makes the change;", "alpharecall"); ?></li>
                        <li><?php esc_html_e("the name and e-mail address of the administrator who accepts the Terms, with the date, time and IP address, as proof of the acceptance and to send service e-mails about the account (welcome, end of the trial, renewals, payments).", "alpharecall"); ?></li>
                    </ul>
                    <p><?php esc_html_e("Nothing is sent before you connect. You can disconnect at any time by deactivating the plugin.", "alpharecall"); ?></p>
                    <form method="post" action="<?php echo esc_url(admin_url("admin-post.php")); ?>">
                        <?php wp_nonce_field("alpharecall_connect"); ?>
                        <input type="hidden" name="action" value="alpharecall_connect" />
                        <?php self::render_terms_fields(true); ?>
                        <label>
                            <input type="checkbox" name="alpharecall_attribution" value="1" />
                            <span><?php esc_html_e("Optional: show a small \"Powered by Alpha Recall\" link in the chat widget.", "alpharecall"); ?></span>
                        </label>
                        <?php submit_button(__("Connect", "alpharecall"), "primary", "submit", false); ?>
                    </form>
                <?php endif; ?>
            </div>
        </div>
        <?php
    }
}
