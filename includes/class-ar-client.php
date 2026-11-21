<?php

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_Client
{
    /** Set by mark_support_team_scope(): add X-Actor-Scope to tenant_headers(). */
    private static bool $support_team_scope = false;

    private static ?AlphaRecall_Client $instance = null;
    private string $resolved_tenant_key = "";
    /** Status and Retry-After of the last API answer in this PHP request (see AlphaRecall_Rest::relay_rate_limit). */
    private static ?array $last_upstream = null;

    public static function get_instance(): AlphaRecall_Client
    {
        if (!self::$instance) {
            self::$instance = new AlphaRecall_Client();
        }
        return self::$instance;
    }

    public function get_tenant_key(bool $refresh = false): string
    {
        if ($refresh) {
            $this->resolved_tenant_key = "";
        } elseif ($this->resolved_tenant_key !== "") {
            return $this->resolved_tenant_key;
        }

        $options = AlphaRecall_Settings::get_options();
        $tenant_key = trim((string) ($options["tenant_key"] ?? ""));
        if (!$tenant_key && !empty($options["tenant_key_enc"])) {
            $tenant_key = AlphaRecall_Storage::decrypt((string) $options["tenant_key_enc"]);
        }
        if (!$tenant_key) {
            $tenant_key = $this->ensure_tenant_key();
        }
        $this->resolved_tenant_key = trim((string) $tenant_key);
        return $this->resolved_tenant_key;
    }

    public function get_api_base(): string
    {
        // No request leaves the site before an administrator agreed to connect
        // (AlphaRecall_Connect): every API call starts from this base.
        if (class_exists("AlphaRecall_Connect") && !AlphaRecall_Connect::has_consent()) {
            return "";
        }
        $options = AlphaRecall_Settings::get_options();
        $base = trim((string) ($options["api_base_url"] ?? ""));
        return rtrim($base, "/");
    }

    public function resolve_tenant(string $domain): array|WP_Error
    {
        $headers = $this->auto_create_headers($domain);
        return $this->request("GET", "/tenants/current", null, $headers);
    }

    public function fetch_tenant_key(string $domain): array|WP_Error
    {
        // Without the platform secret (the WordPress.org build) the site
        // proves control of its domain instead; an API that predates
        // /tenants/enroll answers 404/405 and the signed path is tried.
        if (!AlphaRecall_Settings::has_platform_secret()) {
            $enrolled = AlphaRecall_Connect::enroll($this, $domain);
            $status = is_wp_error($enrolled) ? (int) ($enrolled->get_error_data()["status"] ?? 0) : 0;
            if (!is_wp_error($enrolled) || !in_array($status, [404, 405], true)) {
                return $enrolled;
            }
        }
        $headers = $this->auto_create_headers($domain);
        return $this->request("GET", "/tenants/current/key", null, $headers);
    }

    /** POST /tenants/enroll (see AlphaRecall_Connect::enroll()). The API calls this site back, so allow it time. */
    public function enroll_domain(array $payload): array|WP_Error
    {
        return $this->request("POST", "/tenants/enroll", $payload, [], false, 45);
    }

    public function get_current_tenant(string $domain): array|WP_Error
    {
        return $this->resolve_tenant($domain);
    }

    /**
     * The plan the API enforces, from a /tenants/current payload. Its license
     * block is the latest license row as stored: a paid license that has
     * ended, starts later or is not active still names its paid tier there,
     * while chat, quota and features already run on the free plan. A tenant
     * with no license at all is on free. Null when the payload is not a tenant
     * answer or names no usable tier (the caller keeps its cached value).
     */
    public static function effective_license_tier(array $tenant_info): ?string
    {
        $license = $tenant_info["license"] ?? null;
        if ($license === null && is_array($tenant_info["tenant"] ?? null) && array_key_exists("license", $tenant_info)) {
            return "free";
        }
        if (!is_array($license)) {
            return null;
        }
        $tier = strtolower(trim(sanitize_text_field((string) ($license["tier"] ?? ""))));
        if (!in_array($tier, ["free", "pro", "business", "enterprise"], true)) {
            return null;
        }
        $status = strtolower(trim((string) ($license["status"] ?? "")));
        if ($status !== "" && $status !== "active") {
            return "free";
        }
        $now = time();
        $start = self::utc_timestamp($license["start_at"] ?? null);
        $end = self::utc_timestamp($license["end_at"] ?? null);
        if (($start !== null && $start > $now) || ($end !== null && $end < $now)) {
            return "free";
        }
        return $tier;
    }

    private static function utc_timestamp(mixed $value): ?int
    {
        if (!is_string($value) || $value === "") {
            return null;
        }
        try {
            return (new DateTimeImmutable($value, new DateTimeZone("UTC")))->getTimestamp();
        } catch (\Exception $e) {
            return null;
        }
    }

    /**
     * How long the cached tier may live: an hour, but never past the moment
     * the license starts or ends (at least a minute, so a bound that just
     * passed does not turn every page load into an API call).
     */
    public static function license_tier_ttl(array $tenant_info, int $max = 3600): int
    {
        $license = is_array($tenant_info["license"] ?? null) ? $tenant_info["license"] : [];
        $now = time();
        $ttl = $max;
        foreach (["start_at", "end_at"] as $key) {
            $at = self::utc_timestamp($license[$key] ?? null);
            if ($at !== null && $at > $now) {
                $ttl = min($ttl, $at - $now);
            }
        }
        return max(60, $ttl);
    }

    /**
     * Persist the plan feature flags (features[], chat availability) from a
     * /tenants/current payload into a cached WP transient. Callers that already
     * fetch the payload (admin UI, license refresh, widget enqueue) reuse this so
     * we never make an extra backend call. Mirrors the alpharecall_license_tier
     * cache (1-hour TTL).
     */
    public static function cache_plan_features(array $tenant_info, ?array $chat_hold = null): array
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant = (array) ($tenant_info["tenant"] ?? []);
        $matches = (int) ($tenant["id"] ?? 0) > 0
            && (empty($options["tenant_id"]) || (string) $tenant["id"] === (string) $options["tenant_id"])
            && (empty($options["tenant_domain"]) || strtolower(rtrim((string) ($tenant["domain"] ?? ""), ".")) === strtolower(rtrim($options["tenant_domain"], ".")));
        if (!$matches) {
            // A delayed response for a previously connected tenant must not
            // grant features to the site's new connection or poison its cache.
            return ["features" => [], "chat_available" => true, "chat_unavailable_reason" => null];
        }
        $features = [];
        if (isset($tenant_info["features"]) && is_array($tenant_info["features"])) {
            foreach ($tenant_info["features"] as $feature) {
                if (is_scalar($feature)) {
                    $name = sanitize_key((string) $feature);
                    if ($name !== "") {
                        $features[] = $name;
                    }
                }
            }
        }
        $reason = $tenant_info["chat_unavailable_reason"] ?? null;
        $plan = [
            "_scope" => self::plan_feature_scope(),
            "_verified" => true,
            "features" => array_values(array_unique($features)),
            // Older backends do not send the flag: treat "unknown" as available
            // so an API rollout can never blank the widget on every site.
            "chat_available" => !array_key_exists("chat_available", $tenant_info)
                || !empty($tenant_info["chat_available"]),
            "chat_unavailable_reason" => is_string($reason) && $reason !== "" ? sanitize_key($reason) : null,
        ];
        $ttl = HOUR_IN_SECONDS;
        if (is_array($chat_hold) && array_key_exists("chat_available", $chat_hold) && empty($chat_hold["chat_available"])) {
            // A chat refusal recorded before the plan was known
            // (mark_chat_unavailable()) keeps the widget off for its own
            // short window, not the plan's hour.
            $plan["chat_available"] = false;
            $plan["chat_unavailable_reason"] = $chat_hold["chat_unavailable_reason"] ?? $plan["chat_unavailable_reason"];
            $ttl = 10 * MINUTE_IN_SECONDS;
        }
        set_transient("alpharecall_plan_features", $plan, $ttl);
        return $plan;
    }

    /**
     * Record that the backend just refused a chat message for a plan reason
     * (trial expired, monthly quota used up). The widget stops rendering on the
     * next page load instead of greeting visitors it cannot answer. Short TTL:
     * a purchase or the new month must bring it back without manual clearing.
     */
    public static function mark_chat_unavailable(string $reason): void
    {
        $plan = get_transient("alpharecall_plan_features");
        if (!is_array($plan) || ($plan["_scope"] ?? "") !== self::plan_feature_scope()) {
            $plan = ["features" => [], "_scope" => self::plan_feature_scope(), "_verified" => false];
        }
        $plan["chat_available"] = false;
        $plan["chat_unavailable_reason"] = sanitize_key($reason);
        set_transient("alpharecall_plan_features", $plan, 10 * MINUTE_IN_SECONDS);
    }

    private static function plan_feature_scope(): string
    {
        $options = AlphaRecall_Settings::get_options();
        // Keep the transient name so billing invalidation still works, but
        // never reuse another tenant's privileges after reconnecting a site.
        return hash("sha256", implode("|", [
            (string) ($options["api_base_url"] ?? ""),
            (string) ($options["tenant_id"] ?? ""),
            (string) ($options["tenant_domain"] ?? ""),
        ]));
    }

    /**
     * Fetch effective plan flags; backend failure never grants paid features.
     *
     * mark_chat_unavailable() can cache a placeholder whose `features` is
     * empty because the plan was not known (`_verified` false). Fine for the
     * widget, which only reads `chat_available` from it, but a caller that
     * decides from the features passes $verified: the placeholder is then replaced by the real plan,
     * keeping its chat refusal. If that fetch fails the placeholder comes
     * back as is; its `_verified` false tells the caller the plan is unknown.
     */
    public function get_plan_features(bool $verified = false): array
    {
        $scope = self::plan_feature_scope();
        $cached = get_transient("alpharecall_plan_features");
        $placeholder = null;
        if (is_array($cached) && array_key_exists("features", $cached)
            && ($cached["_scope"] ?? "") === $scope) {
            if (!$verified || ($cached["_verified"] ?? true) !== false) {
                return $cached;
            }
            $placeholder = $cached;
        }
        $default = [
            "features" => [],
            "chat_available" => true,
            "chat_unavailable_reason" => null,
        ];
        $options = AlphaRecall_Settings::get_options();
        $domain = $options["tenant_domain"] ?: wp_parse_url(home_url(), PHP_URL_HOST);
        if (!$domain) {
            return $placeholder ?? $default;
        }
        try {
            $tenant_info = $this->resolve_tenant($domain);
            if (is_wp_error($tenant_info) || !is_array($tenant_info) || $scope !== self::plan_feature_scope()) {
                return $placeholder ?? $default;
            }
            return self::cache_plan_features($tenant_info, $placeholder);
        } catch (\Throwable $e) {
            return $placeholder ?? $default;
        }
    }

    public function invoke_workflow(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        // A generated answer, not a lookup: the same wait as the public chat
        // proxy (AlphaRecall_Rest::CHAT_TIMEOUT).
        return $this->request("POST", "/inference/{$tenant_id}/invoke", $payload, $headers, false, 90);
    }

    public function quota_check(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/inference/{$tenant_id}/quota-check", [], $headers);
    }

    public function list_conversations(int $tenant_id, int $limit = 50): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/conversations?limit={$limit}", null, $headers);
    }

    /** @param array $filters search / status / visitor_id, already validated by the REST handler. */
    public function list_chat_threads(int $tenant_id, int $limit = 50, int $offset = 0, bool $favorites_only = false, bool $unread_only = false, array $filters = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/chat-threads?limit={$limit}&offset={$offset}&favorites_only=" . ($favorites_only ? "true" : "false") . "&unread_only=" . ($unread_only ? "true" : "false")
                . ($filters ? "&" . http_build_query($filters, "", "&", PHP_QUERY_RFC3986) : ""),
            null,
            $headers
        );
    }

    public function get_chat_thread(int $tenant_id, int $thread_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/chat-threads/{$thread_id}",
            null,
            $headers
        );
    }

    public function favorite_chat_thread(int $tenant_id, int $thread_id, array $payload): array|WP_Error
    {
        return $this->request("PUT", "/tenants/{$tenant_id}/chat-threads/{$thread_id}/favorite", $payload, $this->tenant_headers($tenant_id));
    }

    public function read_chat_thread(int $tenant_id, int $thread_id, array $payload): array|WP_Error
    {
        return $this->request("POST", "/tenants/{$tenant_id}/chat-threads/{$thread_id}/read", $payload, $this->tenant_headers($tenant_id));
    }

    /** "Mark all read" in one request: {threads: [{id, up_to_message_id}]} or {all_unread: true}. */
    public function read_chat_threads(int $tenant_id, array $payload): array|WP_Error
    {
        return $this->request("POST", "/tenants/{$tenant_id}/chat-threads/read", $payload, $this->tenant_headers($tenant_id));
    }

    public function chat_thread_counts(int $tenant_id): array|WP_Error
    {
        return $this->request("GET", "/tenants/{$tenant_id}/chat-threads/counts", null, $this->tenant_headers($tenant_id));
    }

    public function list_chat_thread_messages(
        int $tenant_id,
        int $thread_id,
        ?string $after,
        string $visitor_token
    ): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $headers["X-Visitor-Token"] = $visitor_token;
        $query = "?include_state=true" . ($after ? "&after=" . rawurlencode($after) : "");
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/chat-threads/{$thread_id}/messages{$query}",
            null,
            $headers
        );
    }

    public function gdpr_export_visitor(int $tenant_id, string $visitor_token): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "GET",
            "/gdpr/visitors/" . rawurlencode($visitor_token) . "/export",
            null,
            $headers
        );
    }

    public function gdpr_erase_visitor(int $tenant_id, string $visitor_token): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "POST",
            "/gdpr/visitors/" . rawurlencode($visitor_token) . "/erase",
            null,
            $headers
        );
    }

    public function gdpr_rectify_visitor(int $tenant_id, string $visitor_token, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "PATCH",
            "/gdpr/visitors/" . rawurlencode($visitor_token) . "/rectify",
            $payload,
            $headers
        );
    }

    public function gdpr_export_visitor_by_id(int $tenant_id, int $visitor_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "GET",
            "/gdpr/visitors/by-id/" . rawurlencode((string) $visitor_id) . "/export",
            null,
            $headers
        );
    }

    public function gdpr_erase_visitor_by_id(int $tenant_id, int $visitor_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "POST",
            "/gdpr/visitors/by-id/" . rawurlencode((string) $visitor_id) . "/erase",
            null,
            $headers
        );
    }

    public function gdpr_rectify_visitor_by_id(int $tenant_id, int $visitor_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "PATCH",
            "/gdpr/visitors/by-id/" . rawurlencode((string) $visitor_id) . "/rectify",
            $payload,
            $headers
        );
    }

    public function create_chat_thread_message(int $tenant_id, int $thread_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "POST",
            "/tenants/{$tenant_id}/chat-threads/{$thread_id}/messages",
            $payload,
            $headers
        );
    }

    public function update_chat_thread(int $tenant_id, int $thread_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PATCH", "/tenants/{$tenant_id}/chat-threads/{$thread_id}", $payload, $headers);
    }

    public function delete_chat_thread(int $tenant_id, int $thread_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/chat-threads/{$thread_id}", null, $headers);
    }

    public function list_support_threads(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/support/{$tenant_id}/threads", null, $headers);
    }

    public function list_support_thread_messages(int $tenant_id, int $thread_id, string $after = ""): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $qs = $after ? "?after=" . urlencode($after) : "";
        return $this->request("GET", "/support/{$tenant_id}/threads/{$thread_id}/messages{$qs}", null, $headers);
    }

    public function close_support_thread(int $tenant_id, int $thread_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/support/{$tenant_id}/threads/{$thread_id}/close", [], $headers);
    }

    public function generate_chat_thread_title(int $tenant_id, int $thread_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request_with_timeout("POST", "/tenants/{$tenant_id}/chat-threads/{$thread_id}/generate-title", [], $headers, 30);
    }

    public function list_blacklisted_visitors(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/blacklisted-visitors", null, $headers);
    }

    public function create_blacklisted_visitor(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/blacklisted-visitors", $payload, $headers);
    }

    public function delete_blacklisted_visitor(int $tenant_id, int $visitor_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/blacklisted-visitors/{$visitor_id}", null, $headers);
    }

    public function register_visitor(
        int $tenant_id,
        array $data,
        string $visitor_token = "",
        array $extra_headers = []
    ): array|WP_Error
    {
        $headers = array_merge($this->tenant_headers($tenant_id), $extra_headers);
        // Proof that the caller already owns a visitor session. The backend
        // only keeps a returning visitor on its existing record when this
        // token matches; without it the registration starts a new session.
        if ($visitor_token !== "") {
            $headers["X-Visitor-Token"] = $visitor_token;
        }
        return $this->request("POST", "/chat/{$tenant_id}/visitor", $data, $headers);
    }

    public function consent_decision(
        int $tenant_id,
        string $visitor_token,
        string $action_id,
        string $decision,
        string $client_ip
    ): array|WP_Error {
        $headers = $this->tenant_headers($tenant_id);
        $headers["X-Visitor-Token"] = $visitor_token;
        $headers["X-AlphaRecall-Client-IP"] = $client_ip;
        return $this->request(
            "POST",
            "/chat/{$tenant_id}/visitor/consent-decision",
            ["action_id" => $action_id, "decision" => $decision],
            $headers
        );
    }

    public function rate_chat_message(
        int $tenant_id,
        string $visitor_token,
        int $message_id,
        ?string $rating,
        string $client_ip
    ): array|WP_Error {
        $headers = $this->tenant_headers($tenant_id);
        $headers["X-Visitor-Token"] = $visitor_token;
        $headers["X-AlphaRecall-Client-IP"] = $client_ip;
        return $this->request(
            "POST",
            "/chat/{$tenant_id}/visitor/messages/{$message_id}/rating",
            ["rating" => $rating],
            $headers
        );
    }

    public function submit_visitor_feedback(
        int $tenant_id,
        string $visitor_token,
        array $payload,
        string $client_ip
    ): array|WP_Error {
        $headers = $this->tenant_headers($tenant_id);
        $headers["X-Visitor-Token"] = $visitor_token;
        $headers["X-AlphaRecall-Client-IP"] = $client_ip;
        return $this->request("POST", "/chat/{$tenant_id}/visitor/feedback", $payload, $headers);
    }

    public function request_draft_decision(
        int $tenant_id,
        string $visitor_token,
        string $draft_id,
        array $payload,
        string $client_ip
    ): array|WP_Error {
        $headers = $this->tenant_headers($tenant_id);
        $headers["X-Visitor-Token"] = $visitor_token;
        $headers["X-AlphaRecall-Client-IP"] = $client_ip;
        return $this->request(
            "POST",
            "/chat/{$tenant_id}/visitor/request-drafts/" . rawurlencode($draft_id),
            $payload,
            $headers
        );
    }

    /** A visitor's own action on their chat; the API checks the thread is theirs. */
    public function visitor_thread_post(
        int $tenant_id,
        string $visitor_token,
        int $thread_id,
        string $action,
        array $payload,
        string $client_ip
    ): array|WP_Error {
        $headers = $this->tenant_headers($tenant_id);
        $headers["X-Visitor-Token"] = $visitor_token;
        $headers["X-AlphaRecall-Client-IP"] = $client_ip;
        return $this->request(
            "POST",
            "/chat/{$tenant_id}/visitor/threads/{$thread_id}/{$action}",
            $payload,
            $headers
        );
    }

    public function list_visitors(int $tenant_id, array $params = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $query = http_build_query($params);
        return $this->request("GET", "/tenants/{$tenant_id}/visitors" . ($query ? "?{$query}" : ""), null, $headers);
    }

    public function get_visitor(int $tenant_id, int $id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/visitors/{$id}", null, $headers);
    }

    public function update_visitor(int $tenant_id, int $id, array $data): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PATCH", "/tenants/{$tenant_id}/visitors/{$id}", $data, $headers);
    }

    public function list_ingestions(int $tenant_id, int $limit = 20): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/ingestions/tenant?limit={$limit}", null, $headers);
    }

    public function list_documents(int $tenant_id, int $limit = 100): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/documents/tenant?limit={$limit}", null, $headers);
    }

    public function delete_document(int $tenant_id, string $source_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/documents/" . rawurlencode($source_id) . "/tenant", null, $headers);
    }

    public function tenant_analytics(int $tenant_id, int $limit = 200): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/analytics/tenant?limit={$limit}", null, $headers);
    }

    /** @param array $filters search / with_counts, passed through (see AlphaRecall_Rest::list_filters). */
    public function list_appointments(int $tenant_id, int $limit = 50, int $offset = 0, bool $with_total = false, array $filters = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $suffix = ($with_total ? "&with_total=1" : "") . ($filters ? "&" . http_build_query($filters) : "");
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/appointments?limit={$limit}&offset={$offset}{$suffix}",
            null,
            $headers
        );
    }

    public function delete_all_appointments(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/appointments?scope=all", null, $headers);
    }

    public function update_appointment(int $tenant_id, int $appointment_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "PUT",
            "/tenants/{$tenant_id}/appointments/{$appointment_id}",
            $payload,
            $headers
        );
    }

    public function delete_appointment(int $tenant_id, int $appointment_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "DELETE",
            "/tenants/{$tenant_id}/appointments/{$appointment_id}",
            null,
            $headers
        );
    }

    /** @param array $filters search / with_counts, passed through (see AlphaRecall_Rest::list_filters). */
    public function list_leads(int $tenant_id, int $limit = 50, int $offset = 0, bool $with_total = false, array $filters = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $suffix = ($with_total ? "&with_total=1" : "") . ($filters ? "&" . http_build_query($filters) : "");
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/leads?limit={$limit}&offset={$offset}{$suffix}",
            null,
            $headers
        );
    }

    public function delete_all_leads(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/leads?scope=all", null, $headers);
    }

    public function update_lead(int $tenant_id, int $lead_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "PUT",
            "/tenants/{$tenant_id}/leads/{$lead_id}",
            $payload,
            $headers
        );
    }

    public function delete_lead(int $tenant_id, int $lead_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "DELETE",
            "/tenants/{$tenant_id}/leads/{$lead_id}",
            null,
            $headers
        );
    }

    /** @param array $filters search / with_counts, passed through (see AlphaRecall_Rest::list_filters). */
    public function list_escalations(int $tenant_id, int $limit = 50, int $offset = 0, bool $with_total = false, array $filters = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $suffix = ($with_total ? "&with_total=1" : "") . ($filters ? "&" . http_build_query($filters) : "");
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/escalations?limit={$limit}&offset={$offset}{$suffix}",
            null,
            $headers
        );
    }

    public function delete_escalation(int $tenant_id, int $escalation_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/escalations/{$escalation_id}", null, $headers);
    }

    public function delete_all_escalations(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/escalations?scope=all", null, $headers);
    }

    public function update_escalation(int $tenant_id, int $escalation_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "PUT",
            "/tenants/{$tenant_id}/escalations/{$escalation_id}",
            $payload,
            $headers
        );
    }

    public function get_tenant_settings(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/settings/tenant", null, $headers);
    }

    public function update_tenant_settings(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PUT", "/tenants/{$tenant_id}/settings/tenant", $payload, $headers);
    }

    public function get_google_calendar_integration(int $tenant_id): array|WP_Error
    {
        return $this->request("GET", "/tenants/{$tenant_id}/integrations/google-calendar", null, $this->tenant_headers($tenant_id));
    }

    /**
     * @param string $return_url Admin page Google's consent comes back to; the API
     *                           only honours it on this site's own domain.
     */
    public function start_google_calendar_oauth(int $tenant_id, string $return_url = ""): array|WP_Error
    {
        $body = $return_url !== "" ? ["return_url" => $return_url] : [];
        return $this->request("POST", "/tenants/{$tenant_id}/integrations/google-calendar/oauth/start", $body, $this->tenant_headers($tenant_id));
    }

    public function update_google_calendar_integration(int $tenant_id, array $payload): array|WP_Error
    {
        return $this->request("PUT", "/tenants/{$tenant_id}/integrations/google-calendar", $payload, $this->tenant_headers($tenant_id));
    }

    public function delete_google_calendar_integration(int $tenant_id): array|WP_Error
    {
        return $this->request("DELETE", "/tenants/{$tenant_id}/integrations/google-calendar", null, $this->tenant_headers($tenant_id));
    }

    public function test_google_calendar_integration(int $tenant_id): array|WP_Error
    {
        return $this->request("POST", "/tenants/{$tenant_id}/integrations/google-calendar/test", [], $this->tenant_headers($tenant_id));
    }

    public function get_google_calendar_metadata(int $tenant_id): array|WP_Error
    {
        return $this->request("GET", "/tenants/{$tenant_id}/integrations/google-calendar/metadata", null, $this->tenant_headers($tenant_id));
    }

    public function sync_google_calendar_integration(int $tenant_id): array|WP_Error
    {
        return $this->request("POST", "/tenants/{$tenant_id}/integrations/google-calendar/sync", [], $this->tenant_headers($tenant_id));
    }

    public function check_google_calendar_availability(int $tenant_id, array $payload): array|WP_Error
    {
        return $this->request("POST", "/tenants/{$tenant_id}/integrations/google-calendar/availability", $payload, $this->tenant_headers($tenant_id));
    }

    public function list_google_calendar_deliveries(int $tenant_id, int $limit = 25, int $offset = 0): array|WP_Error
    {
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);
        return $this->request("GET", "/tenants/{$tenant_id}/integrations/google-calendar/deliveries?limit={$limit}&offset={$offset}", null, $this->tenant_headers($tenant_id));
    }

    public function replay_google_calendar_delivery(int $tenant_id, int $delivery_id): array|WP_Error
    {
        return $this->request("POST", "/tenants/{$tenant_id}/integrations/google-calendar/deliveries/{$delivery_id}/replay", [], $this->tenant_headers($tenant_id));
    }

    public function get_woocommerce_integration(int $tenant_id): array|WP_Error
    {
        return $this->request("GET", "/tenants/{$tenant_id}/integrations/woocommerce", null, $this->tenant_headers($tenant_id));
    }

    public function update_woocommerce_integration(int $tenant_id, array $payload): array|WP_Error
    {
        return $this->request("PUT", "/tenants/{$tenant_id}/integrations/woocommerce", $payload, $this->tenant_headers($tenant_id));
    }

    public function delete_woocommerce_integration(int $tenant_id): array|WP_Error
    {
        return $this->request("DELETE", "/tenants/{$tenant_id}/integrations/woocommerce", null, $this->tenant_headers($tenant_id));
    }

    public function test_woocommerce_integration(int $tenant_id): array|WP_Error
    {
        return $this->request("POST", "/tenants/{$tenant_id}/integrations/woocommerce/test", [], $this->tenant_headers($tenant_id));
    }

    public function send_woocommerce_event(int $tenant_id, array $payload): array|WP_Error
    {
        return $this->request("POST", "/tenants/{$tenant_id}/integrations/woocommerce/events", $payload, $this->tenant_headers($tenant_id));
    }

    public function send_weekly_report_test(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/weekly-report/test", [], $headers);
    }

    public function performance_report(int $tenant_id, int $days = 30): array|WP_Error
    {
        $days = in_array($days, [7, 30, 90], true) ? $days : 30;
        $headers = $this->tenant_headers($tenant_id);
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/performance-report?days={$days}",
            null,
            $headers
        );
    }

    public function knowledge_gaps(int $tenant_id, int $days = 30, string $status = "open", int $limit = 50): array|WP_Error
    {
        $query = http_build_query([
            "days" => max(1, min(365, $days)),
            "status" => in_array($status, ["open", "dismissed", "resolved"], true) ? $status : "open",
            "limit" => max(1, min(200, $limit)),
        ]);
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/knowledge-gaps?{$query}", null, $headers);
    }

    public function update_knowledge_gaps(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/knowledge-gaps/status", $payload, $headers);
    }

    public function top_questions(int $tenant_id, int $days = 7): array|WP_Error
    {
        $days = in_array($days, [7, 30, 90], true) ? $days : 7;
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/top-questions?days={$days}", null, $headers);
    }

    /**
     * GET /tenants/{id}/data-export saved to a temporary file (the answer is a ZIP that can
     * be large, so it never sits in PHP memory): ["path" => file, "filename" => name].
     * The caller deletes the file.
     */
    public function download_data_export(int $tenant_id): array|WP_Error
    {
        $base = $this->get_api_base();
        $headers = $this->tenant_headers($tenant_id);
        if (!$base || empty($headers["X-Tenant-Key"])) {
            return new WP_Error("alpharecall_not_connected", "Website not configured.");
        }
        if (!function_exists("wp_tempnam")) {
            require_once ABSPATH . "wp-admin/includes/file.php";
        }
        $path = wp_tempnam("alpharecall-export");
        $response = wp_remote_get($base . "/tenants/{$tenant_id}/data-export", [
            "timeout" => 300,
            "stream" => true,
            "filename" => $path,
            "headers" => array_merge(["Accept" => "application/zip"], $headers),
        ]);
        $status = is_wp_error($response) ? 0 : (int) wp_remote_retrieve_response_code($response);
        if ($status !== 200) {
            wp_delete_file($path);
            return is_wp_error($response)
                ? $response
                : new WP_Error("alpharecall_export_failed", "Export failed.", ["status" => $status]);
        }
        $disposition = (string) wp_remote_retrieve_header($response, "content-disposition");
        $filename = preg_match('/filename="([^"]+)"/', $disposition, $m) === 1 ? $m[1] : "alpharecall-dati.zip";
        return ["path" => $path, "filename" => $filename];
    }

    /** POST /tenants/{id}/terms-acceptance: one Terms acceptance with its evidence. */
    public function record_terms_acceptance(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/terms-acceptance", $payload, $headers);
    }

    public function update_tenant_retention(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PATCH", "/tenants/{$tenant_id}/retention", $payload, $headers);
    }

    public function list_helpdesk(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/helpdesk", null, $headers);
    }

    public function create_helpdesk(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/helpdesk", $payload, $headers);
    }

    public function update_helpdesk(int $tenant_id, int $entry_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PUT", "/tenants/{$tenant_id}/helpdesk/{$entry_id}", $payload, $headers);
    }

    public function delete_helpdesk(int $tenant_id, int $entry_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/helpdesk/{$entry_id}", null, $headers);
    }

    public function reorder_helpdesk(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/helpdesk/reorder", $payload, $headers);
    }

    public function generate_helpdesk(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        // An LLM pass over several pages: the default 20 s budget expired
        // before the API answered, which the dashboard showed as a hang.
        return $this->request_with_timeout("POST", "/tenants/{$tenant_id}/helpdesk/generate", $payload, $headers, 180);
    }

    public function import_helpdesk(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/helpdesk/import", $payload, $headers);
    }

    public function list_helpdesk_categories(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/helpdesk/categories", null, $headers);
    }

    public function create_helpdesk_category(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/helpdesk/categories", $payload, $headers);
    }

    public function update_helpdesk_category(int $tenant_id, int $category_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PUT", "/tenants/{$tenant_id}/helpdesk/categories/{$category_id}", $payload, $headers);
    }

    public function delete_helpdesk_category(int $tenant_id, int $category_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/helpdesk/categories/{$category_id}", null, $headers);
    }

    public function list_support_profiles(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/support-profiles", null, $headers);
    }

    /**
     * One support profile. The API has no single-profile GET (it answers 405),
     * so this reads the tenant's list. "support_profile_not_found" means the
     * list loaded and the profile is gone; any other error is the request.
     */
    public function get_support_profile(int $tenant_id, int $profile_id): array|WP_Error
    {
        $profiles = $this->list_support_profiles($tenant_id);
        if (is_wp_error($profiles)) {
            return $profiles;
        }
        foreach ($profiles as $profile) {
            if (is_array($profile) && (int) ($profile["id"] ?? 0) === $profile_id) {
                return $profile;
            }
        }
        return new WP_Error("support_profile_not_found", "Support profile not found.", ["status" => 404]);
    }

    /** {count, limit, tier, plan} of the operator profiles (limit null = no limit). */
    public function support_profiles_limit(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/support-profiles/limit", null, $headers);
    }

    public function create_support_profile(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/support-profiles", $payload, $headers);
    }

    public function update_support_profile(int $tenant_id, int $profile_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PUT", "/tenants/{$tenant_id}/support-profiles/{$profile_id}", $payload, $headers);
    }

    public function delete_support_profile(int $tenant_id, int $profile_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/support-profiles/{$profile_id}", null, $headers);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Team management methods (sub-project #15)
    // ──────────────────────────────────────────────────────────────────────────

    public function get_team_me(int $tenant_id): array|WP_Error
    {
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/team/me?tenant_id={$tenant_id}",
            null,
            $this->tenant_headers($tenant_id)
        );
    }

    public function list_team_members(int $tenant_id): array|WP_Error
    {
        return $this->request(
            "GET",
            "/tenants/{$tenant_id}/team/members?tenant_id={$tenant_id}",
            null,
            $this->tenant_headers($tenant_id)
        );
    }

    public function add_team_member(int $tenant_id, array $data): array|WP_Error
    {
        return $this->request(
            "POST",
            "/tenants/{$tenant_id}/team/members?tenant_id={$tenant_id}",
            $data,
            $this->tenant_headers($tenant_id)
        );
    }

    public function update_team_member(int $tenant_id, int $member_id, array $data): array|WP_Error
    {
        return $this->request(
            "PATCH",
            "/tenants/{$tenant_id}/team/members/{$member_id}?tenant_id={$tenant_id}",
            $data,
            $this->tenant_headers($tenant_id)
        );
    }

    public function delete_team_member(int $tenant_id, int $member_id): bool|WP_Error
    {
        $result = $this->request(
            "DELETE",
            "/tenants/{$tenant_id}/team/members/{$member_id}?tenant_id={$tenant_id}",
            null,
            $this->tenant_headers($tenant_id)
        );
        if (is_wp_error($result)) {
            return $result;
        }
        return true;
    }

    public function list_ip_rules(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/ip-rules", null, $headers);
    }

    public function create_ip_rule(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/ip-rules", $payload, $headers);
    }

    public function delete_ip_rule(int $tenant_id, int $rule_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/ip-rules/{$rule_id}", null, $headers);
    }

    public function log_analytics(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/analytics/log", $payload, $headers);
    }

    public function update_prompt(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PUT", "/tenants/{$tenant_id}/prompt/tenant", $payload, $headers);
    }

    public function generate_persona(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request_with_timeout("POST", "/tenants/{$tenant_id}/persona/generate", [], $headers, 60);
    }

    public function start_ingestion(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/ingestions/tenant", $payload, $headers);
    }

    public function upload_knowledge(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/knowledge/upload", $payload, $headers);
    }

    public function knowledge_stats(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/knowledge/stats", null, $headers);
    }

    public function upload_knowledge_pdf(int $tenant_id, string $file_path, string $filename): array|WP_Error
    {
        $base = $this->get_api_base();
        if (!$base) {
            return new WP_Error("alpharecall_no_base", "API base URL is not configured.");
        }
        $file_contents = file_get_contents($file_path);
        if ($file_contents === false) {
            return new WP_Error("alpharecall_file_read", "Could not read uploaded file.");
        }
        $boundary = "----AlphaRecallBoundary" . bin2hex(random_bytes(8));
        $body = "--{$boundary}\r\n";
        $body .= "Content-Disposition: form-data; name=\"file\"; filename=\"" . addslashes($filename) . "\"\r\n";
        $body .= "Content-Type: application/pdf\r\n\r\n";
        $body .= $file_contents . "\r\n";
        $body .= "--{$boundary}--\r\n";

        $headers = $this->tenant_headers($tenant_id);
        $headers["Content-Type"] = "multipart/form-data; boundary={$boundary}";

        $url = $base . "/tenants/{$tenant_id}/knowledge/upload-pdf?tenant_id={$tenant_id}";
        $args = [
            "method" => "POST",
            "timeout" => 120,
            "headers" => array_merge(["Accept" => "application/json"], $headers),
            "body" => $body,
        ];
        self::$last_upstream = null;
        $response = wp_remote_request($url, $args);
        if (is_wp_error($response)) {
            return $response;
        }
        $status = wp_remote_retrieve_response_code($response);
        $raw = wp_remote_retrieve_body($response);
        $data = $raw ? json_decode($raw, true) : null;
        if ($status < 200 || $status >= 300) {
            return $this->api_error($response, (int) $status, $data, "Non siamo riusciti a caricare il PDF. Riprova.");
        }
        return is_array($data) ? $data : [];
    }

    public function billing_checkout(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/billing/checkout?tenant_id={$tenant_id}", $payload, $headers);
    }

    public function billing_plans(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/billing/plans?tenant_id={$tenant_id}", null, $headers);
    }

    public function billing_checkout_status(int $tenant_id, array $payload): array|WP_Error
    {
        return $this->request("POST", "/billing/checkout-status?tenant_id={$tenant_id}", $payload, $this->tenant_headers($tenant_id));
    }

    public function billing_portal(int $tenant_id, array $payload = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/billing/portal?tenant_id={$tenant_id}", $payload, $headers);
    }

    public function billing_cancel(int $tenant_id, array $payload = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/billing/cancel?tenant_id={$tenant_id}", $payload, $headers);
    }

    public function billing_subscription(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/billing/subscription?tenant_id={$tenant_id}", null, $headers);
    }

    public function billing_change_plan(int $tenant_id, array $payload): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/billing/change-plan?tenant_id={$tenant_id}", $payload, $headers);
    }

    public function billing_reactivate(int $tenant_id, array $payload = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/billing/reactivate?tenant_id={$tenant_id}", $payload, $headers);
    }

    public function billing_orders(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/billing/orders?tenant_id={$tenant_id}", null, $headers);
    }

    // Events
    public function list_events(int $tenant_id, array $params = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $query = http_build_query($params);
        return $this->request("GET", "/tenants/{$tenant_id}/events" . ($query ? "?{$query}" : ""), null, $headers);
    }

    public function create_event(int $tenant_id, array $data): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/events", $data, $headers);
    }

    public function update_event(int $tenant_id, int $event_id, array $data): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PUT", "/tenants/{$tenant_id}/events/{$event_id}", $data, $headers);
    }

    public function delete_event(int $tenant_id, int $event_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/events/{$event_id}", null, $headers);
    }

    // Coupons
    public function list_coupons(int $tenant_id, array $params = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $query = http_build_query($params);
        return $this->request("GET", "/tenants/{$tenant_id}/coupons" . ($query ? "?{$query}" : ""), null, $headers);
    }

    public function create_coupon(int $tenant_id, array $data): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/coupons", $data, $headers);
    }

    public function update_coupon(int $tenant_id, int $coupon_id, array $data): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PUT", "/tenants/{$tenant_id}/coupons/{$coupon_id}", $data, $headers);
    }

    public function delete_coupon(int $tenant_id, int $coupon_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/coupons/{$coupon_id}", null, $headers);
    }

    // Contact Submissions
    public function list_contact_submissions(int $tenant_id, array $params = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $query = http_build_query($params);
        return $this->request("GET", "/tenants/{$tenant_id}/contact-submissions" . ($query ? "?{$query}" : ""), null, $headers);
    }

    public function update_contact_submission(int $tenant_id, int $id, array $data): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PATCH", "/tenants/{$tenant_id}/contact-submissions/{$id}", $data, $headers);
    }

    public function delete_contact_submission(int $tenant_id, int $id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/contact-submissions/{$id}", null, $headers);
    }

    public function delete_all_contact_submissions(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/contact-submissions?scope=all", null, $headers);
    }

    // Feedback
    public function list_feedback(int $tenant_id, array $params = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $query = http_build_query($params);
        return $this->request("GET", "/tenants/{$tenant_id}/feedback" . ($query ? "?{$query}" : ""), null, $headers);
    }

    public function update_feedback(int $tenant_id, int $id, array $data): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("PATCH", "/tenants/{$tenant_id}/feedback/{$id}", $data, $headers);
    }

    public function delete_feedback(int $tenant_id, int $id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/feedback/{$id}", null, $headers);
    }

    public function delete_all_feedback(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("DELETE", "/tenants/{$tenant_id}/feedback?scope=all", null, $headers);
    }

    // Event Registrations
    public function list_event_registrations(int $tenant_id, int $event_id, array $params = []): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        $query = http_build_query($params);
        return $this->request("GET", "/tenants/{$tenant_id}/events/{$event_id}/registrations" . ($query ? "?{$query}" : ""), null, $headers);
    }

    public function trigger_product_sync(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("POST", "/tenants/{$tenant_id}/product-store/sync", [], $headers);
    }

    public function get_product_sync_status(int $tenant_id): array|WP_Error
    {
        $headers = $this->tenant_headers($tenant_id);
        return $this->request("GET", "/tenants/{$tenant_id}/product-store/sync-status", null, $headers);
    }

    /** $timeout: seconds to wait for the whole answer (a chat turn needs far more than the default). */
    public function raw_request(string $method, string $path, ?array $body, array $headers = [], int $timeout = 20): array|WP_Error
    {
        return $this->request($method, $path, $body, $headers, false, $timeout);
    }

    public function tenant_headers(int $tenant_id): array
    {
        $tenant_key = $this->get_tenant_key();
        if (!$tenant_key) {
            return [];
        }

        // Forward the verified WP actor identity to the backend.
        // These headers are trusted because only PHP (the tenant-key holder)
        // sets them server-side after verifying the WP session via WP auth cookies.
        // A browser caller cannot forge them without also holding the tenant key.
        $user = wp_get_current_user();
        $role = "viewer";
        if ($user->has_cap("manage_options")) {
            $role = "manage_options";
        } elseif ($user->has_cap("alpharecall_admin")) {
            $role = "alpharecall_admin";
        } elseif ($user->has_cap("alpharecall_support")) {
            $role = "alpharecall_support";
        }

        $headers = [
            "X-Tenant-Key"    => $tenant_key,
            "X-Actor-Wp-User" => (string) $user->ID,
            "X-Actor-Email"   => $user->user_email,
            "X-Actor-Role"    => $role,
        ];
        // A Team di supporto member using the dashboard: the API checks the
        // site's plan for these calls (app/security.py enforce_support_team_plan).
        if (self::$support_team_scope && $role === "alpharecall_support") {
            $headers["X-Actor-Scope"] = "support-team";
        }
        return $headers;
    }

    /**
     * Mark this request as a Team di supporto member's dashboard call
     * (AlphaRecall_Rest::require_support()). The plugin does not check the
     * plan itself: the API answers 403 when the plan has no Team di supporto.
     */
    public static function mark_support_team_scope(bool $on = true): void
    {
        self::$support_team_scope = $on;
    }

    private function ensure_tenant_key(): string
    {
        $options = AlphaRecall_Settings::get_options();
        $domain = $options["tenant_domain"] ?: wp_parse_url(home_url(), PHP_URL_HOST);
        if (!$domain) {
            return "";
        }
        $response = $this->fetch_tenant_key($domain);
        if (is_wp_error($response)) {
            return "";
        }
        $api_key = (string) ($response["api_key"] ?? "");
        if (!$api_key) {
            return "";
        }
        $options["tenant_id"] = (string) ($response["tenant_id"] ?? $options["tenant_id"] ?? "");
        $options["tenant_status"] = (string) ($response["status"] ?? $options["tenant_status"] ?? "");
        $options["tenant_domain"] = (string) ($response["domain"] ?? $domain);
        $encrypted = AlphaRecall_Storage::encrypt($api_key);
        $options["tenant_key_enc"] = $encrypted;
        $options["tenant_key"] = $encrypted ? "" : $api_key;
        AlphaRecall_Settings::persist($options);
        $this->resolved_tenant_key = $api_key;
        return $api_key;
    }

    private function auto_create_headers(string $domain): array
    {
        $headers = [
            "X-Tenant-Domain" => $domain,
        ];
        $secret = AlphaRecall_Settings::get_options()["auto_create_secret"] ?? "";
        if ($secret) {
            $timestamp = (string) time();
            $payload = $domain . "|" . $timestamp;
            $signature = hash_hmac("sha256", $payload, $secret);
            $headers["X-Tenant-Timestamp"] = $timestamp;
            $headers["X-Tenant-Signature"] = $signature;
        }
        return $headers;
    }

    private function request_with_timeout(string $method, string $path, ?array $body, array $headers = [], int $timeout = 20): array|WP_Error
    {
        $base = $this->get_api_base();
        if (!$base) {
            return new WP_Error("alpharecall_no_base", "API base URL is not configured.");
        }
        $url = $base . $path;
        $args = [
            "method" => $method,
            "timeout" => $timeout,
            "headers" => array_merge(
                ["Accept" => "application/json"],
                $headers
            ),
        ];
        if ($body !== null) {
            $args["headers"]["Content-Type"] = "application/json";
            $args["body"] = wp_json_encode($body);
        }
        self::$last_upstream = null;
        $response = wp_remote_request($url, $args);
        if (is_wp_error($response)) {
            return $response;
        }
        $status = wp_remote_retrieve_response_code($response);
        $raw = wp_remote_retrieve_body($response);
        $data = $raw ? json_decode($raw, true) : null;
        if ($status < 200 || $status >= 300) {
            return $this->api_error($response, (int) $status, $data, "API request failed.");
        }
        return is_array($data) ? $data : [];
    }

    private function request(string $method, string $path, ?array $body, array $headers = [], bool $retried = false, int $timeout = 20): array|WP_Error
    {
        $base = $this->get_api_base();
        if (!$base) {
            return new WP_Error("alpharecall_no_base", "API base URL is not configured.");
        }
        $url = $base . $path;
        $args = [
            "method" => $method,
            "timeout" => $timeout,
            "headers" => array_merge(
                [
                    "Accept" => "application/json",
                ],
                $headers
            ),
        ];
        if ($body !== null) {
            $args["headers"]["Content-Type"] = "application/json";
            $args["body"] = wp_json_encode($body);
        }
        self::$last_upstream = null;
        $response = wp_remote_request($url, $args);
        if (is_wp_error($response)) {
            return $response;
        }
        $status = wp_remote_retrieve_response_code($response);
        $raw = wp_remote_retrieve_body($response);
        $data = $raw ? json_decode($raw, true) : null;
        if ($status === 401 && !$retried) {
            if (isset($headers["X-Tenant-Key"])) {
                $fresh = $this->get_tenant_key(true);
                if ($fresh) {
                    $headers["X-Tenant-Key"] = $fresh;
                    return $this->request($method, $path, $body, $headers, true, $timeout);
                }
            }
        }
        if ($status < 200 || $status >= 300) {
            return $this->api_error($response, (int) $status, $data, "API request failed.");
        }
        return is_array($data) ? $data : [];
    }

    /**
     * WP_Error for a non-2xx API answer. Nothing here retries a 429 or a 5xx:
     * the status goes back to the caller as is, and a 429 carries the API's
     * Retry-After (whole seconds) so AlphaRecall_Rest can hand it to the browser.
     */
    private function api_error(array $response, int $status, mixed $data, string $fallback_message): WP_Error
    {
        $message = is_array($data) && is_scalar($data["detail"] ?? null) ? (string) $data["detail"] : $fallback_message;
        // The API's machine code: in the body, or in X-AlphaRecall-Code for an
        // HTTPException (support_team_plan_required, support_profile_limit).
        $code = is_array($data) && is_string($data["code"] ?? null) ? $data["code"] : "";
        if ($code === "") {
            $header = wp_remote_retrieve_header($response, "x-alpharecall-code");
            $header = is_array($header) ? (string) reset($header) : (string) $header;
            $code = preg_match('/^[a-z][a-z0-9_]{0,63}$/', $header) === 1 ? $header : "";
        }
        $error_data = ["status" => $status, "response" => $data];
        if ($code !== "") {
            $error_data["code"] = $code;
        }
        $retry_after = 0;
        if ($status === 429) {
            $retry_after = self::parse_retry_after(wp_remote_retrieve_header($response, "retry-after"));
            if ($retry_after > 0) {
                $error_data["retry_after"] = $retry_after;
            }
        }
        self::$last_upstream = [
            "status" => $status,
            "retry_after" => $retry_after,
            "detail" => is_array($data) && is_scalar($data["detail"] ?? null) ? (string) $data["detail"] : "",
            "code" => $code,
        ];
        return new WP_Error("alpharecall_api_error", $message, $error_data);
    }

    /** Seconds from a Retry-After value (delta-seconds or HTTP date), at least 1; 0 when absent or unreadable. */
    public static function parse_retry_after(mixed $value): int
    {
        if (is_array($value)) {
            $value = reset($value);
        }
        $value = trim((string) $value);
        if ($value === "") {
            return 0;
        }
        if (ctype_digit($value)) {
            return max(1, (int) $value);
        }
        $at = strtotime($value);
        return $at === false ? 0 : max(1, $at - time());
    }

    /** ["status", "retry_after", "detail", "code"] of the last API call in this request when it failed, else null. */
    public static function last_upstream(): ?array
    {
        return self::$last_upstream;
    }
}
