<?php

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_Settings
{
    private static ?AlphaRecall_Settings $instance = null;
    private const OPTION_KEY = "alpharecall_settings";
    private const NOTICE_KEY = "alpharecall_notice";
    public const NOTIFICATION_TYPES = ["chat", "message", "escalation", "lead", "submission", "appointment", "feedback"];
    public const BOT_AVATAR_COUNT = 16;
    /** The welcome title (Widget > Benvenuto); the editor input has the same maxlength. */
    public const WIDGET_TITLE_MAX = 80;
    /** The welcome text under it; the editor counts to the same limit and the widget clamps older, longer ones. */
    public const WELCOME_MESSAGE_MAX = 300;
    /**
     * The business name in the widget header and the launcher text (card
     * 3xsmdn92aj09): one line each, the editor inputs have the same maxlength.
     * A save cuts an edited value to the limit (cap_edited_text); an untouched
     * longer value saved before the limit stays, and the widget ends it with
     * an ellipsis.
     */
    public const HEADER_TITLE_MAX = 60;
    public const LAUNCHER_LABEL_MAX = 40;
    /**
     * Numeric widget settings: [min, max, default]. The editor clamps before it
     * autosaves and the widget clamps what it reads (src/lib/widget-numbers.ts):
     * keep the three in step.
     */
    public const WIDGET_NUMBERS = [
        "marginX" => [0, 100, 24], "marginY" => [0, 100, 24],
        "radius" => [14, 32, 18], "buttonRadius" => [8, 999, 999],
        "panelHeight" => [400, 900, 640], "panelWidth" => [320, 720, 420],
        "fontScale" => [0.9, 1.2, 1.0],
        "auto_open_delay" => [0, 60, 0], "launcherInterval" => [8, 60, 15], "soundVolume" => [0, 100, 35],
    ];

    /**
     * A numeric widget setting within its range. A value that is not a number
     * ("", "abc", null, true, [], NAN, INF) is not a 0: the stored value stays,
     * or the default when there is none. Integers except fontScale.
     */
    public static function widget_number(string $key, array $chat, array $current = [])
    {
        [$min, $max, $default] = self::WIDGET_NUMBERS[$key];
        foreach ([$chat[$key] ?? null, $current[$key] ?? null] as $candidate) {
            if (is_string($candidate)) { $candidate = trim($candidate); }
            if (!(is_int($candidate) || is_float($candidate) || (is_string($candidate) && is_numeric($candidate)))) { continue; }
            $number = (float) $candidate;
            if (!is_finite($number)) { continue; }
            $number = max($min, min($max, $number));
            return is_float($default) ? (float) $number : (int) round($number);
        }
        return $default;
    }

    /**
     * Caps an edited welcome title or text. The editor saves the whole chat
     * config, so a text saved before the limit existed comes back on every
     * save: when it is unchanged it stays as it is, and the widget clamps it on
     * a word, rather than being cut mid-word the first time a colour changes.
     */
    public static function cap_edited_text(string $value, $stored, int $max): string
    {
        if (is_string($stored) && $value === $stored) {
            return $value;
        }
        return mb_substr($value, 0, $max);
    }

    /** A site's tenant keeps one randomly assigned portrait across requests.
     * The separate option avoids losing the assignment to a concurrent settings
     * save. add_option's unique key makes the first successful assignment win.
     */
    public static function default_bot_avatar_url(array $options): string
    {
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if ($tenant_id <= 0) { return ""; }
        $identity = rtrim((string) ($options["api_base_url"] ?? ""), "/") . ":" . $tenant_id;
        $key = "alpharecall_bot_avatar_" . substr(hash("sha256", $identity), 0, 24);
        $index = (int) get_option($key, 0);
        if ($index < 1 || $index > self::BOT_AVATAR_COUNT) {
            $candidate = wp_rand(1, self::BOT_AVATAR_COUNT);
            if (add_option($key, $candidate, "", false)) {
                $index = $candidate;
            } else {
                // Another request may have assigned it while we were reading.
                wp_cache_delete($key, "options");
                $index = (int) get_option($key, 0);
                if ($index < 1 || $index > self::BOT_AVATAR_COUNT) {
                    $index = $candidate;
                    update_option($key, $index, false);
                }
            }
        }
        return ALPHARECALL_PLUGIN_URL . sprintf("assets/img/bot-avatars/portrait-%02d.webp", $index);
    }

    /** User meta with the dashboard theme ("light" / "dark"); "ar_theme" before 0.1.86. */
    public const THEME_META = "alpharecall_theme";
    private const LEGACY_THEME_META = "ar_theme";

    public static function notification_preferences_key(): string
    {
        $options = self::get_options();
        return "alpharecall_notification_preferences_" . get_current_blog_id() . "_" . (int) ($options["tenant_id"] ?? 0);
    }

    /** The same key before 0.1.86 (two-letter prefix), read until the next save moves it. */
    private static function legacy_notification_preferences_key(): string
    {
        $options = self::get_options();
        return "ar_notification_preferences_" . get_current_blog_id() . "_" . (int) ($options["tenant_id"] ?? 0);
    }

    /** The current user's saved dashboard theme, "" when none. */
    public static function get_user_theme(): string
    {
        $user_id = get_current_user_id();
        $theme = (string) get_user_meta($user_id, self::THEME_META, true);
        if ($theme === "") {
            $theme = (string) get_user_meta($user_id, self::LEGACY_THEME_META, true);
        }
        return in_array($theme, ["light", "dark"], true) ? $theme : "";
    }

    public static function save_user_theme(string $theme): void
    {
        $user_id = get_current_user_id();
        update_user_meta($user_id, self::THEME_META, $theme);
        delete_user_meta($user_id, self::LEGACY_THEME_META);
    }

    /** @param array<string, bool> $preferences */
    public static function save_notification_preferences(array $preferences): void
    {
        $user_id = get_current_user_id();
        update_user_meta($user_id, self::notification_preferences_key(), array_replace(self::get_notification_preferences(), $preferences));
        delete_user_meta($user_id, self::legacy_notification_preferences_key());
    }

    public static function get_notification_preferences(): array
    {
        $stored = get_user_meta(get_current_user_id(), self::notification_preferences_key(), true);
        if (!is_array($stored)) {
            $stored = get_user_meta(get_current_user_id(), self::legacy_notification_preferences_key(), true);
        }
        $stored = is_array($stored) ? $stored : [];
        $preferences = [];
        foreach (self::NOTIFICATION_TYPES as $type) {
            $preferences[$type] = ($stored[$type] ?? true) !== false;
        }
        return $preferences;
    }

    public static function get_instance(): AlphaRecall_Settings
    {
        if (!self::$instance) {
            self::$instance = new AlphaRecall_Settings();
        }
        return self::$instance;
    }

    // Remote requests can outlive a simultaneous widget settings save. Drop
    // this request's option cache before merging a tenant refresh into it.
    public static function reload_options(): array
    {
        wp_cache_delete(self::OPTION_KEY, "options");
        wp_cache_delete("alloptions", "options");
        return self::get_options();
    }

    /** Aspetto > Colore keeps this many recently used brand colors (widget-colors.ts RECENT_COLORS_MAX). */
    public const RECENT_COLORS_MAX = 8;

    /** "#ABC" or "#AaBbCc" as "#aabbcc"; "" for anything that is not a hex color (a gradient, a name). */
    private static function normalize_hex($value): string
    {
        if (!is_string($value)) { return ""; }
        $hex = sanitize_hex_color(trim($value));
        if (!$hex) { return ""; }
        $hex = strtolower($hex);
        return strlen($hex) === 4 ? "#" . $hex[1] . $hex[1] . $hex[2] . $hex[2] . $hex[3] . $hex[3] : $hex;
    }

    /**
     * Aspetto > Colore's history (card qa3yfqhbam03): the brand colors saved,
     * newest first, no repeats (case-insensitive), at most RECENT_COLORS_MAX.
     * Written here, never taken from the client: the editor saves its whole
     * chat config, and a tab left open must not put back an old history over
     * the one another admin saved. A saved color moves to the front. With no
     * history yet, only a save that changes the color starts one (the color
     * the widget had before is kept as its second entry): saving the title or
     * any other setting must not replace the default swatches with the one
     * color the owner never picked. Every saved color counts, so the editor
     * saves the picker's color once, when it closes (use-settings.ts
     * holdChatSaves), not each shade it passes through.
     * Mirrored by nextRecentColors() in widget-colors.ts.
     */
    public static function recent_colors(array $chat, array $current = []): array
    {
        $before = is_array($current["recentColors"] ?? null) ? $current["recentColors"] : [];
        $has_history = false;
        foreach ($before as $value) {
            if (self::normalize_hex($value) !== "") { $has_history = true; break; }
        }
        $saved = self::normalize_hex($chat["primaryColor"] ?? $current["primaryColor"] ?? "");
        if (!$has_history) {
            $previous = self::normalize_hex($current["primaryColor"] ?? "");
            if ($saved === "" || $saved === $previous) {
                return [];
            }
            $before = [$previous];
        }
        $colors = [];
        foreach (array_merge([$saved], $before) as $value) {
            $hex = self::normalize_hex($value);
            if ($hex !== "" && !in_array($hex, $colors, true)) {
                $colors[] = $hex;
            }
            if (count($colors) >= self::RECENT_COLORS_MAX) {
                break;
            }
        }
        return $colors;
    }

    public static function sanitize_widget_appearance(array $chat, array $current = []): array
    {
        $enum = static function (string $key, array $allowed, string $fallback) use ($chat, $current): string {
            $value = $chat[$key] ?? $current[$key] ?? $fallback;
            return in_array($value, $allowed, true) ? $value : $fallback;
        };
        $active_tab_background = $chat["activeTabBackgroundColor"] ?? $current["activeTabBackgroundColor"] ?? "";
        return [
            // Empty means the theme's neutral selected surface, not the brand color.
            "activeTabBackgroundColor" => is_string($active_tab_background)
                ? (sanitize_hex_color($active_tab_background) ?: "")
                : "",
            "launcherStyle" => $enum("launcherStyle", ["pill", "circle", "rounded-square", "text-only"], "pill"),
            "launcherImageMode" => $enum("launcherImageMode", ["custom", "logo", "icon"], "custom"),
            "headerStyle" => $enum("headerStyle", ["soft", "brand"], "soft"),
            "starterLayout" => $enum("starterLayout", ["cards", "chips"], "cards"),
            "headerSubtitle" => mb_substr(sanitize_text_field((string) ($chat["headerSubtitle"] ?? $current["headerSubtitle"] ?? "")), 0, 120),
            "inputPlaceholder" => mb_substr(sanitize_text_field((string) ($chat["inputPlaceholder"] ?? $current["inputPlaceholder"] ?? "")), 0, 120),
            "showAvatars" => true,
            "motionStyle" => $enum("motionStyle", ["none", "subtle", "expressive"], "subtle"),
            "motionSpeed" => $enum("motionSpeed", ["snappy", "balanced", "relaxed"], "balanced"),
            "animateMessages" => filter_var($chat["animateMessages"] ?? $current["animateMessages"] ?? true, FILTER_VALIDATE_BOOLEAN),
            "launcherRepeat" => $enum("launcherRepeat", ["once", "interval"], "once"),
            "launcherInterval" => self::widget_number("launcherInterval", $chat, $current),
            "soundVolume" => self::widget_number("soundVolume", $chat, $current),
            "sendSound" => $enum("sendSound", ["none", "chime", "pop", "ding", "bubble", "gentle"], "none"),
            "openSound" => $enum("openSound", ["none", "chime", "pop", "ding", "bubble", "gentle"], "none"),
            "notificationSound" => $enum("notificationSound", ["none", "chime", "pop", "ding", "bubble", "gentle"], "none"),
            "recentColors" => self::recent_colors($chat, $current),
        ];
    }

    /**
     * An image URL setting: http(s) only, else empty. Used by the dark avatar,
     * which the widget only shows when set; anything else (a data: or
     * javascript: URL, an array) means "same avatar as the light theme".
     */
    public static function image_url($value): string
    {
        if (!is_string($value)) {
            return "";
        }
        $url = esc_url_raw(trim($value), ["http", "https"]);
        return preg_match('#^https?://#i', $url) === 1 ? $url : "";
    }

    public static function sanitize_widget_visibility(array $chat, array $current = []): array
    {
        $current_mode = $current["displayMode"] ?? "production";
        $mode = $chat["displayMode"] ?? $current_mode;
        // Invalid edits must never turn a private demo into a public widget.
        if (!in_array($mode, ["production", "demo"], true)) {
            $mode = $current_mode === "production" ? "production" : "demo";
        }
        $roles = array_key_exists("demoRoles", $chat)
            ? $chat["demoRoles"] : ($current["demoRoles"] ?? ["administrator"]);
        $registered = wp_roles()->roles;
        $roles = is_array($roles) ? array_values(array_unique(array_filter(
            $roles,
            static fn($role): bool => is_string($role) && isset($registered[$role])
        ))) : [];
        return ["displayMode" => $mode, "demoRoles" => $roles];
    }

    public static function activate(): void
    {
        $defaults = self::defaults();
        if (get_option(self::OPTION_KEY, null) === null) {
            add_option(self::OPTION_KEY, $defaults);
        } else {
            $current = self::get_options();
            self::persist(wp_parse_args($current, $defaults));
        }
        $options = self::get_options();
        if (empty($options["tenant_id"])) {
            $options["pending_bootstrap"] = true;
            self::persist($options);
        }
        $env_secret = self::env_setting("ALPHARECALL_AUTO_CREATE_SECRET");
        if (empty($env_secret) && empty($options["auto_create_secret_enc"])) {
            $secret = wp_generate_password(48, true, true);
            $options["auto_create_secret_enc"] = AlphaRecall_Storage::encrypt($secret);
            $options["auto_create_secret"] = "";
            self::persist($options);
        }
    }

    public static function get_options(): array
    {
        $raw = (array) get_option(self::OPTION_KEY, []);
        $options = wp_parse_args($raw, self::defaults());
        // Message avatars are always enabled, including on sites with an old
        // saved opt-out. The "Powered by" credit is the owner's opt-in (AlphaRecall_Connect).
        $options["chat_config"] = (array) $options["chat_config"];
        $options["chat_config"]["showAvatars"] = true;
        unset(
            $options["chat_config"]["show_message_avatar"],
            $options["chat_config"]["hideBranding"],
            $options["chat_config"]["show_branding"]
        );
        $api_base = self::env_setting("ALPHARECALL_API_BASE");
        if ($api_base) {
            $options["api_base_url"] = $api_base;
        } elseif (empty($options["api_base_url"])) {
            $options["api_base_url"] = self::default_api_base();
        }
        if (!empty($options["tenant_key_enc"])) {
            $decrypted = AlphaRecall_Storage::decrypt((string) $options["tenant_key_enc"]);
            $options["tenant_key"] = $decrypted !== "" ? $decrypted : (string) ($options["tenant_key"] ?? "");
        } elseif (!empty($options["tenant_key"])) {
            $plain = (string) $options["tenant_key"];
            $encrypted = AlphaRecall_Storage::encrypt($plain);
            if ($encrypted !== "") {
                $options["tenant_key_enc"] = $encrypted;
                $options["tenant_key"] = $plain;
                self::persist(array_merge($options, ["tenant_key" => ""]));
            } else {
                // Encryption unavailable: preserve existing encrypted key, don't overwrite.
                AlphaRecall_Log::error("AlphaRecall: encryption unavailable — key update rejected. Please ensure OpenSSL is available.");
                // Restore previous encrypted value if available
                $prev = get_option(self::OPTION_KEY, []);
                $options["tenant_key_enc"] = $prev["tenant_key_enc"] ?? "";
                $options["tenant_key"] = "";
            }
        } else {
            $options["tenant_key"] = "";
        }
        $env_secret = self::env_setting("ALPHARECALL_AUTO_CREATE_SECRET");
        if ($env_secret) {
            $options["auto_create_secret"] = $env_secret;
        } elseif (!empty($options["auto_create_secret_enc"])) {
            $decrypted = AlphaRecall_Storage::decrypt((string) $options["auto_create_secret_enc"]);
            $options["auto_create_secret"] =
                $decrypted !== "" ? $decrypted : (string) ($options["auto_create_secret"] ?? "");
        } elseif (!empty($options["auto_create_secret"])) {
            $plain = (string) $options["auto_create_secret"];
            $encrypted = AlphaRecall_Storage::encrypt($plain);
            if ($encrypted !== "") {
                $options["auto_create_secret_enc"] = $encrypted;
                $options["auto_create_secret"] = $plain;
                self::persist(array_merge($options, ["auto_create_secret" => ""]));
            } else {
                $options["auto_create_secret_enc"] = "";
                $options["auto_create_secret"] = $plain;
            }
        } else {
            $options["auto_create_secret"] = "";
        }
        if (empty($options["chat_public_token"])) {
            $options["chat_public_token"] = wp_generate_password(32, false, false);
            self::persist($options);
        }
        // Runtime-only fallback: custom image fields stay empty/editable, and
        // clearing an upload restores this same tenant portrait immediately.
        $options["chat_config"]["defaultAvatarUrl"] = self::default_bot_avatar_url($options);
        return $options;
    }

    /**
     * Write the settings array back to wp_options without ever storing the
     * decrypted credentials.
     *
     * get_options() hands callers the *plaintext* tenant key and auto-create
     * secret. Persisting that array verbatim drops both secrets into the
     * autoloaded option next to their encrypted copies, defeating
     * AlphaRecall_Storage's encryption at rest (the register_setting() sanitizer that
     * would strip them only runs on admin_init, so REST, front-end and cron
     * writes are unprotected). Every write of the settings array goes through
     * here instead: the encrypted `*_enc` copy is refreshed when the caller
     * supplies a value it does not already cover, and the cleartext copy is
     * dropped.
     */
    public static function persist(array $options): void
    {
        unset($options["chat_config"]["defaultAvatarUrl"]);
        // A secret provided through the environment lives there, not in the
        // database; never copy it into the option.
        $env_secret = self::env_setting("ALPHARECALL_AUTO_CREATE_SECRET");
        if ($env_secret !== "" && (string) ($options["auto_create_secret"] ?? "") === $env_secret) {
            $options["auto_create_secret"] = "";
        }
        foreach (["tenant_key", "auto_create_secret"] as $field) {
            $plain = (string) ($options[$field] ?? "");
            if ($plain === "") {
                $options[$field] = "";
                continue;
            }
            $encrypted = (string) ($options[$field . "_enc"] ?? "");
            if ($encrypted === "" || AlphaRecall_Storage::decrypt($encrypted) !== $plain) {
                $encrypted = AlphaRecall_Storage::encrypt($plain);
                if ($encrypted !== "") {
                    $options[$field . "_enc"] = $encrypted;
                }
            }
            // Keep the cleartext copy only when encryption is unavailable, so
            // such a site does not lose its credentials (same fallback as
            // get_options()).
            $options[$field] = $encrypted === "" ? $plain : "";
        }
        update_option(self::OPTION_KEY, $options);
    }

    private static function defaults(): array
    {
        $host = wp_parse_url(home_url(), PHP_URL_HOST);
        $api_base = self::env_setting("ALPHARECALL_API_BASE");
        $auto_secret = self::env_setting("ALPHARECALL_AUTO_CREATE_SECRET");
        return [
            "api_base_url" => $api_base ?: self::default_api_base(),
            "tenant_domain" => $host ?: "",
            "tenant_id" => "",
            "tenant_status" => "",
            "tenant_key" => "",
            "tenant_key_enc" => "",
            "auto_create_secret" => $auto_secret ?: "",
            "auto_create_secret_enc" => "",
            "onboarding_step" => 1,
            "onboarding_completed" => false,
            "tutorial_completed" => false,
            "tutorial_sections" => [],
            "integrations" => [],
            "pending_bootstrap" => false,
            "bootstrap_last_attempt" => 0,
            "pending_ingestion" => null,
            "exclude_page_ids" => [],
            "business_profile" => [],
            "tool_preferences" => [
                "appointment" => true,
                "email_marketing" => true,
                "product_search" => true,
                "escalate" => true,
            ],
            "tenant_settings" => [
                "chatbot_name" => "AlphaRecall",
                "chatbot_role" => "",
                "bot_role" => "",
                "chatbot_tone" => "professionale",
                "response_language" => "it",
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
                "polar_subscription_id" => "",
                "polar_customer_id" => "",
                "business_address" => "",
                "business_phone" => "",
                "business_email" => "",
                "business_hours" => null,
                "business_social_links" => null,
                "business_map_url" => "",
                "business_lat" => "",
                "business_lng" => "",
            ],
            "chat_config" => [
                "enabled" => true,
                "displayMode" => "production",
                "demoRoles" => ["administrator"],
                "position" => "right",
                "primaryColor" => "#1877f2",
                "accentColor" => "#1877f2",
                "buttonColor" => "#1877f2",
                "titleColor" => "#ffffff",
                "activeTabBackgroundColor" => "",
                "launcherLabel" => "Chiedici",
                "headerTitle" => "AlphaRecall",
                "widgetTitle" => "Come possiamo aiutarti?",
                "logoUrl" => "",
                // Optional avatar for the dark widget; empty uses logoUrl for both themes.
                "logoUrlDark" => "",
                "launcherIconUrl" => "",
                "launcherImageMode" => "custom",
                "welcomeMessage" => "",
                "radius" => 18,
                "buttonRadius" => 999,
                "panelHeight" => 640,
                "panelWidth" => 420,
                "fontScale" => 1,
                "theme" => "system",
                "marginX" => 24,
                "marginY" => 24,
                "notificationSound" => "none",
                "motionStyle" => "subtle",
                "motionSpeed" => "balanced",
                "animateMessages" => true,
                "launcherRepeat" => "once",
                "launcherInterval" => 15,
                "soundVolume" => 35,
                "sendSound" => "none",
                "openSound" => "none",
                "widgetStyle" => "sidepanel",
                "launcherStyle" => "pill",
                "headerStyle" => "soft",
                "starterLayout" => "cards",
                "headerSubtitle" => "",
                "inputPlaceholder" => "",
                "showAvatars" => true,
                "starterQuestions" => [],
                "starter_questions" => [],
                "launcher_animation" => "pulse",
                "auto_open_delay" => 0,
                "auto_open_greeting" => "",
                "attention_sound" => "none",
            ],
            "chat_public_token" => "",
        ];
    }

    /**
     * The widget's map sources: the self-hosted Protomaps archive and the
     * optional raster server for provider "osm_selfhost". A wp-config.php
     * constant overrides the platform value baked into config.php; the
     * settings option is the last fallback.
     */
    public static function map_sources(): array
    {
        $options = (array) get_option(self::OPTION_KEY, []);
        $pmtiles = self::env_setting("ALPHARECALL_MAP_PMTILES_URL")
            ?: (string) ($options["map_pmtiles_url"] ?? "");
        $raster = self::env_setting("ALPHARECALL_MAP_OSM_SELFHOST_URL")
            ?: (string) ($options["map_osm_selfhost_url"] ?? "");
        return [
            "pmtiles" => self::safe_pmtiles_url($pmtiles),
            "osm_selfhost" => str_starts_with(trim($raster), "https://") ? trim($raster) : "",
        ];
    }

    /**
     * A .pmtiles archive over https, or over http only on this site's own origin
     * (a local test site). Same rule as the widget's safePmtilesUrl.
     */
    private static function safe_pmtiles_url(string $value): string
    {
        $value = trim($value);
        if ($value === "") {
            return "";
        }
        if (str_starts_with($value, "/") && !str_starts_with($value, "//")) {
            $path = (string) (wp_parse_url($value, PHP_URL_PATH) ?? "");
            return str_ends_with($path, ".pmtiles") ? esc_url_raw($value) : "";
        }
        $url = esc_url_raw($value, ["https", "http"]);
        $parts = $url !== "" ? wp_parse_url($url) : false;
        if (!is_array($parts) || !str_ends_with((string) ($parts["path"] ?? ""), ".pmtiles")) {
            return "";
        }
        $scheme = strtolower((string) ($parts["scheme"] ?? ""));
        if ($scheme === "https") {
            return $url;
        }
        $site = wp_parse_url(home_url());
        $origin = static function ($p): string {
            if (!is_array($p)) {
                return "";
            }
            $scheme = strtolower((string) ($p["scheme"] ?? ""));
            $port = isset($p["port"]) ? (int) $p["port"] : ($scheme === "https" ? 443 : 80);
            return $scheme . "://" . strtolower((string) ($p["host"] ?? "")) . ":" . $port;
        };
        return $scheme === "http" && $origin($parts) === $origin($site) ? $url : "";
    }

    /** Whether the platform enrolment secret is configured (baked release, wp-config.php or environment). */
    public static function has_platform_secret(): bool
    {
        return self::env_setting("ALPHARECALL_AUTO_CREATE_SECRET") !== "";
    }

    private static function env_setting(string $key): string
    {
        if (defined($key)) {
            $value = constant($key);
            return is_string($value) ? $value : "";
        }
        $value = getenv($key);
        return $value ? (string) $value : "";
    }

    private function __construct()
    {
        add_action("update_option_alpharecall_settings", [self::class, "purge_widget_visibility_cache"], 10, 2);
        add_action("admin_init", [$this, "register_settings"]);
        add_action("admin_init", [$this, "redirect_legacy_settings_page"], 1);
        add_action("admin_post_alpharecall_resolve", [$this, "handle_resolve"]);
        add_action("admin_notices", [$this, "render_notice"]);
        add_action("init", [$this, "maybe_bootstrap"]);
    }

    public static function purge_widget_visibility_cache($old, $new): void
    {
        $before = (array) ($old["chat_config"] ?? []);
        $after = (array) ($new["chat_config"] ?? []);
        $visibility = static fn(array $config): array => [
            $config["enabled"] ?? true,
            $config["displayMode"] ?? "production",
            $config["demoRoles"] ?? ["administrator"],
        ];
        if ($visibility($before) === $visibility($after)) { return; }
        // Retire cached public markup when switching a site into demo mode.
        do_action("litespeed_purge_all");
        foreach (["rocket_clean_domain", "wp_cache_clear_cache", "w3tc_flush_all", "wpfc_clear_all_cache"] as $purge) {
            if (function_exists($purge)) { $purge(); }
        }
        do_action("alpharecall_widget_visibility_changed", $after, $before);
    }

    public function redirect_legacy_settings_page(): void
    {
        if (!is_admin() || wp_doing_ajax() || !current_user_can("manage_options")) {
            return;
        }
        global $pagenow;
        $page = isset($_GET["page"]) ? sanitize_text_field(wp_unslash((string) $_GET["page"])) : "";
        if ($page !== "alpharecall") {
            return;
        }
        if ($pagenow === "options-general.php" || $pagenow === "admin.php") {
            wp_safe_redirect(admin_url("admin.php?page=alpharecall-dashboard"));
            exit;
        }
    }

    public function register_menu(): void
    {
        add_options_page(
            "AlphaRecall",
            "AlphaRecall",
            "manage_options",
            "alpharecall",
            [$this, "render_page"]
        );
    }

    public function register_settings(): void
    {
        register_setting(
            "alpharecall_settings_group",
            self::OPTION_KEY,
            [
                "type" => "array",
                "sanitize_callback" => [$this, "sanitize"],
            ]
        );
    }

    /**
     * The register_setting() sanitizer of the plugin option. The result starts
     * from what is stored and takes from the input only the fields listed
     * below, each through its own type: a URL, an e-mail address, a colour, a
     * number within its range, one value of a fixed list, or plain text. A
     * key that is not listed is not saved.
     *
     * @param mixed $input
     */
    public function sanitize($input): array
    {
        $input = is_array($input) ? $input : [];
        $stored = (array) get_option(self::OPTION_KEY, []);
        $output = wp_parse_args(self::get_options(), self::defaults());
        $output["api_base_url"] = esc_url_raw(trim((string) ($input["api_base_url"] ?? $output["api_base_url"] ?? "")));
        $output["tenant_domain"] = sanitize_text_field((string) ($input["tenant_domain"] ?? $output["tenant_domain"] ?? ""));
        $output["tenant_id"] = sanitize_text_field((string) ($input["tenant_id"] ?? $output["tenant_id"] ?? ""));
        $output["tenant_status"] = sanitize_text_field((string) ($input["tenant_status"] ?? $output["tenant_status"] ?? ""));
        $tenant_key = sanitize_text_field((string) ($input["tenant_key"] ?? ""));
        $auto_secret = sanitize_text_field((string) ($input["auto_create_secret"] ?? ""));
        // persist() hands over a freshly issued key already encrypted; keep it
        // instead of the stored one, or a key obtained during an admin request
        // (after admin_init registered this sanitizer) would be dropped.
        $handed_over = (string) ($input["tenant_key_enc"] ?? "");
        if ($handed_over !== "" && AlphaRecall_Storage::decrypt($handed_over) === "") {
            $handed_over = "";
        }
        $output["tenant_key_enc"] = $tenant_key
            ? AlphaRecall_Storage::encrypt($tenant_key)
            : ($handed_over !== "" ? $handed_over : (string) ($stored["tenant_key_enc"] ?? ""));
        $output["tenant_key"] = "";
        $output["auto_create_secret_enc"] = $auto_secret
            ? AlphaRecall_Storage::encrypt($auto_secret)
            : (string) ($stored["auto_create_secret_enc"] ?? "");
        $output["auto_create_secret"] = "";
        $output["pending_bootstrap"] = !empty($input["pending_bootstrap"]);
        $output["bootstrap_last_attempt"] = (int) ($input["bootstrap_last_attempt"] ?? 0);
        $output["pending_ingestion"] = AlphaRecall_Sanitize::pending_ingestion($input["pending_ingestion"] ?? null);
        $output["onboarding_step"] = max(1, (int) ($input["onboarding_step"] ?? $output["onboarding_step"]));
        $output["onboarding_completed"] = !empty($input["onboarding_completed"]);
        $output["tutorial_completed"] = !empty($input["tutorial_completed"] ?? $output["tutorial_completed"]);
        $output["tutorial_sections"] = self::sanitize_tutorial_sections(
            $input["tutorial_sections"] ?? ($output["tutorial_sections"] ?? [])
        );
        $output["integrations"] = self::sanitize_integrations(
            $input["integrations"] ?? ($output["integrations"] ?? [])
        );
        $output["exclude_page_ids"] = array_map("intval", (array) ($input["exclude_page_ids"] ?? []));
        $profile = (array) ($input["business_profile"] ?? []);
        $output["business_profile"] = [
            "name" => sanitize_text_field((string) ($profile["name"] ?? "")),
            "description" => sanitize_textarea_field((string) ($profile["description"] ?? "")),
            "tone" => sanitize_text_field((string) ($profile["tone"] ?? "")),
            "policies" => sanitize_textarea_field((string) ($profile["policies"] ?? "")),
            "faqs" => sanitize_textarea_field((string) ($profile["faqs"] ?? "")),
            "contact" => sanitize_text_field((string) ($profile["contact"] ?? "")),
        ];
        $chat = (array) ($input["chat_config"] ?? $output["chat_config"]);
        $stored_chat = (array) ($output["chat_config"] ?? []);
        $radius = self::widget_number("radius", $chat, $stored_chat);
        $button_radius = self::widget_number("buttonRadius", $chat, $stored_chat);
        $panel_height = self::widget_number("panelHeight", $chat, $stored_chat);
        $panel_width = self::widget_number("panelWidth", $chat, $stored_chat);
        $font_scale = self::widget_number("fontScale", $chat, $stored_chat);
        $starter_raw = $chat["starterQuestions"]
            ?? $chat["starter_questions"]
            ?? $output["chat_config"]["starterQuestions"]
            ?? $output["chat_config"]["starter_questions"]
            ?? [];
        $starter_questions = [];
        if (is_array($starter_raw)) {
            foreach ($starter_raw as $item) {
                if (!is_scalar($item)) {
                    continue;
                }
                $question = trim(sanitize_text_field((string) $item));
                if ($question === "") {
                    continue;
                }
                $starter_questions[] = $question;
                if (count($starter_questions) >= 6) {
                    break;
                }
            }
        }
        $appearance = self::sanitize_widget_appearance($chat, (array) ($output["chat_config"] ?? []));
        $output["chat_config"] = [
            ...$appearance,
            ...self::sanitize_widget_visibility($chat, (array) ($output["chat_config"] ?? [])),
            "enabled" => !empty($chat["enabled"]),
            "position" => in_array(($chat["position"] ?? ($output["chat_config"]["position"] ?? "right")), ["left", "right"], true)
                ? ($chat["position"] ?? $output["chat_config"]["position"])
                : "right",
            "primaryColor" => sanitize_hex_color((string) ($chat["primaryColor"] ?? $output["chat_config"]["primaryColor"] ?? "#1877f2")) ?: "#1877f2",
            "accentColor" => sanitize_hex_color((string) ($chat["accentColor"] ?? $output["chat_config"]["accentColor"] ?? "#1877f2")) ?: "#1877f2",
            "buttonColor" => sanitize_hex_color((string) ($chat["buttonColor"] ?? $output["chat_config"]["buttonColor"] ?? "#1877f2")) ?: "#1877f2",
            "titleColor" => sanitize_hex_color((string) ($chat["titleColor"] ?? $output["chat_config"]["titleColor"] ?? "#ffffff")) ?: "#ffffff",
            "launcherLabel" => self::cap_edited_text(sanitize_text_field((string) ($chat["launcherLabel"] ?? $output["chat_config"]["launcherLabel"] ?? "Chiedici")), $output["chat_config"]["launcherLabel"] ?? null, self::LAUNCHER_LABEL_MAX),
            "headerTitle" => self::cap_edited_text(sanitize_text_field((string) ($chat["headerTitle"] ?? $output["chat_config"]["headerTitle"] ?? "AlphaRecall")), $output["chat_config"]["headerTitle"] ?? null, self::HEADER_TITLE_MAX),
            "widgetTitle" => self::cap_edited_text(sanitize_text_field((string) ($chat["widgetTitle"] ?? $output["chat_config"]["widgetTitle"] ?? "Come possiamo aiutarti?")), $output["chat_config"]["widgetTitle"] ?? null, self::WIDGET_TITLE_MAX),
            "logoUrl" => esc_url_raw((string) ($chat["logoUrl"] ?? $output["chat_config"]["logoUrl"] ?? "")),
            "logoUrlDark" => self::image_url($chat["logoUrlDark"] ?? $output["chat_config"]["logoUrlDark"] ?? ""),
            "launcherIconUrl" => esc_url_raw((string) ($chat["launcherIconUrl"] ?? $output["chat_config"]["launcherIconUrl"] ?? "")),
            "welcomeMessage" => self::cap_edited_text(sanitize_textarea_field((string) ($chat["welcomeMessage"] ?? $output["chat_config"]["welcomeMessage"] ?? "")), $output["chat_config"]["welcomeMessage"] ?? null, self::WELCOME_MESSAGE_MAX),
            "radius" => $radius,
            "buttonRadius" => $button_radius,
            "panelHeight" => $panel_height,
            "panelWidth" => $panel_width,
            "fontScale" => $font_scale,
            "theme" => in_array(($chat["theme"] ?? ($output["chat_config"]["theme"] ?? "system")), ["dark", "light", "system"], true)
                ? ($chat["theme"] ?? $output["chat_config"]["theme"])
                : "system",
            "marginX" => self::widget_number("marginX", $chat, $stored_chat),
            "marginY" => self::widget_number("marginY", $chat, $stored_chat),
            "widgetStyle" => in_array(($chat["widgetStyle"] ?? ($output["chat_config"]["widgetStyle"] ?? "sidepanel")), ["sidepanel", "popup"], true)
                ? ($chat["widgetStyle"] ?? $output["chat_config"]["widgetStyle"])
                : "sidepanel",
            "starterQuestions" => $starter_questions,
            "starter_questions" => $starter_questions,
            "launcher_animation" => in_array(
                ($chat["launcher_animation"] ?? ($output["chat_config"]["launcher_animation"] ?? "pulse")),
                ["none", "pulse", "bounce", "wiggle", "breathe", "rubberBand"],
                true
            )
                ? ($chat["launcher_animation"] ?? $output["chat_config"]["launcher_animation"])
                : "pulse",
            "auto_open_delay" => self::widget_number("auto_open_delay", $chat, $stored_chat),
            "auto_open_greeting" => mb_substr(
                sanitize_text_field((string) ($chat["auto_open_greeting"] ?? $output["chat_config"]["auto_open_greeting"] ?? "")),
                0,
                200
            ),
            "attention_sound" => in_array(
                ($chat["attention_sound"] ?? ($output["chat_config"]["attention_sound"] ?? "none")),
                ["none", "chime", "pop", "ding", "bubble", "gentle"],
                true
            )
                ? ($chat["attention_sound"] ?? $output["chat_config"]["attention_sound"])
                : "none",
        ];
        $tenant_settings = (array) ($input["tenant_settings"] ?? []);
        $tenant_base = (array) ($output["tenant_settings"] ?? []);
        $role = sanitize_textarea_field(
            (string) (
                $tenant_settings["chatbot_role"]
                ?? $tenant_settings["bot_role"]
                ?? $tenant_base["chatbot_role"]
                ?? $tenant_base["bot_role"]
                ?? ""
            )
        );
        $base_bot_shield_mode = (string) ($tenant_base["bot_shield_mode"] ?? "standard");
        if (!in_array($base_bot_shield_mode, ["off", "standard", "strict"], true)) {
            $base_bot_shield_mode = "standard";
        }
        $bot_shield_mode = (string) ($tenant_settings["bot_shield_mode"] ?? $base_bot_shield_mode);
        if (!in_array($bot_shield_mode, ["off", "standard", "strict"], true)) {
            $bot_shield_mode = $base_bot_shield_mode;
        }
        $output["tenant_settings"] = [
            "chatbot_name" => sanitize_text_field((string) ($tenant_settings["chatbot_name"] ?? $tenant_base["chatbot_name"] ?? "AlphaRecall")),
            "chatbot_role" => $role,
            "bot_role" => $role,
            "chatbot_tone" => sanitize_text_field((string) ($tenant_settings["chatbot_tone"] ?? $tenant_base["chatbot_tone"] ?? "professionale")),
            "response_language" => in_array(($tenant_settings["response_language"] ?? ($tenant_base["response_language"] ?? "it")), ["it", "en-US"], true)
                ? ($tenant_settings["response_language"] ?? $tenant_base["response_language"])
                : "it",
            "appointment_require_phone" => array_key_exists("appointment_require_phone", $tenant_settings)
                ? !empty($tenant_settings["appointment_require_phone"])
                : !empty($tenant_base["appointment_require_phone"]),
            "appointment_alerts_enabled" => !array_key_exists("appointment_alerts_enabled", $tenant_settings)
                ? !array_key_exists("appointment_alerts_enabled", $tenant_base) || !empty($tenant_base["appointment_alerts_enabled"])
                : !empty($tenant_settings["appointment_alerts_enabled"]),
            "custom_prompt" => sanitize_textarea_field((string) ($tenant_settings["custom_prompt"] ?? $tenant_base["custom_prompt"] ?? "")),
            "helpdesk_enabled" => array_key_exists("helpdesk_enabled", $tenant_settings)
                ? !empty($tenant_settings["helpdesk_enabled"])
                : !empty($tenant_base["helpdesk_enabled"]),
            "escalation_email" => sanitize_email((string) ($tenant_settings["escalation_email"] ?? $tenant_base["escalation_email"] ?? "")),
            "escalation_webhook" => esc_url_raw((string) ($tenant_settings["escalation_webhook"] ?? $tenant_base["escalation_webhook"] ?? "")),
            "allow_handoff" => array_key_exists("allow_handoff", $tenant_settings)
                ? !empty($tenant_settings["allow_handoff"])
                : !empty($tenant_base["allow_handoff"]),
            "handoff_active" => array_key_exists("handoff_active", $tenant_settings)
                ? !empty($tenant_settings["handoff_active"])
                : !empty($tenant_base["handoff_active"]),
            "require_visitor_info" => array_key_exists("require_visitor_info", $tenant_settings)
                ? !empty($tenant_settings["require_visitor_info"])
                : !empty($tenant_base["require_visitor_info"]),
            "privacy_notice_url" => esc_url_raw(
                (string) ($tenant_settings["privacy_notice_url"] ?? $tenant_base["privacy_notice_url"] ?? ""),
                ["http", "https"]
            ),
            "privacy_policy_version" => mb_substr(
                sanitize_text_field((string) ($tenant_settings["privacy_policy_version"] ?? $tenant_base["privacy_policy_version"] ?? "")),
                0,
                32
            ),
            "auto_register_wp_users" => array_key_exists("auto_register_wp_users", $tenant_settings)
                ? !empty($tenant_settings["auto_register_wp_users"])
                : !empty($tenant_base["auto_register_wp_users"] ?? false),
            "bot_shield_mode" => $bot_shield_mode,
            "email_notify_appointments" => array_key_exists("email_notify_appointments", $tenant_settings)
                ? !empty($tenant_settings["email_notify_appointments"])
                : !empty($tenant_base["email_notify_appointments"]),
            "email_notify_submissions" => array_key_exists("email_notify_submissions", $tenant_settings)
                ? !empty($tenant_settings["email_notify_submissions"])
                : !empty($tenant_base["email_notify_submissions"]),
            "email_notify_feedback" => array_key_exists("email_notify_feedback", $tenant_settings)
                ? !empty($tenant_settings["email_notify_feedback"])
                : !empty($tenant_base["email_notify_feedback"]),
            "notification_emails" => sanitize_text_field((string) ($tenant_settings["notification_emails"] ?? $tenant_base["notification_emails"] ?? "")),
            "weekly_report_enabled" => array_key_exists("weekly_report_enabled", $tenant_settings)
                ? !empty($tenant_settings["weekly_report_enabled"])
                : !empty($tenant_base["weekly_report_enabled"]),
            "weekly_report_recipients" => sanitize_text_field((string) ($tenant_settings["weekly_report_recipients"] ?? $tenant_base["weekly_report_recipients"] ?? "")),
            "weekly_report_currency" => preg_match('/^[A-Z]{3}$/', strtoupper((string) ($tenant_settings["weekly_report_currency"] ?? $tenant_base["weekly_report_currency"] ?? "EUR")))
                ? strtoupper((string) ($tenant_settings["weekly_report_currency"] ?? $tenant_base["weekly_report_currency"] ?? "EUR"))
                : "EUR",
            "weekly_report_lead_value_cents" => max(0, (int) ($tenant_settings["weekly_report_lead_value_cents"] ?? $tenant_base["weekly_report_lead_value_cents"] ?? 0)),
            "weekly_report_appointment_value_cents" => max(0, (int) ($tenant_settings["weekly_report_appointment_value_cents"] ?? $tenant_base["weekly_report_appointment_value_cents"] ?? 0)),
            "weekly_report_registration_value_cents" => max(0, (int) ($tenant_settings["weekly_report_registration_value_cents"] ?? $tenant_base["weekly_report_registration_value_cents"] ?? 0)),
            "weekly_report_hourly_cost_cents" => max(0, (int) ($tenant_settings["weekly_report_hourly_cost_cents"] ?? $tenant_base["weekly_report_hourly_cost_cents"] ?? 0)),
            "weekly_report_minutes_saved_per_conversation" => max(0, min(120, (int) ($tenant_settings["weekly_report_minutes_saved_per_conversation"] ?? $tenant_base["weekly_report_minutes_saved_per_conversation"] ?? 0))),
            "polar_subscription_id" => sanitize_text_field((string) ($tenant_settings["polar_subscription_id"] ?? $tenant_base["polar_subscription_id"] ?? "")),
            "polar_customer_id" => sanitize_text_field((string) ($tenant_settings["polar_customer_id"] ?? $tenant_base["polar_customer_id"] ?? "")),
            "business_address" => sanitize_text_field((string) ($tenant_settings["business_address"] ?? $tenant_base["business_address"] ?? "")),
            "business_phone" => sanitize_text_field((string) ($tenant_settings["business_phone"] ?? $tenant_base["business_phone"] ?? "")),
            "business_email" => sanitize_email((string) ($tenant_settings["business_email"] ?? $tenant_base["business_email"] ?? "")),
            "business_hours" => AlphaRecall_Sanitize::business_hours($tenant_settings["business_hours"] ?? $tenant_base["business_hours"] ?? null),
            "business_social_links" => AlphaRecall_Sanitize::business_social_links($tenant_settings["business_social_links"] ?? $tenant_base["business_social_links"] ?? null),
            "business_map_url" => esc_url_raw((string) ($tenant_settings["business_map_url"] ?? $tenant_base["business_map_url"] ?? "")),
            "business_lat" => sanitize_text_field((string) ($tenant_settings["business_lat"] ?? $tenant_base["business_lat"] ?? "")),
            "business_lng" => sanitize_text_field((string) ($tenant_settings["business_lng"] ?? $tenant_base["business_lng"] ?? "")),
        ];
        $token = sanitize_text_field((string) ($input["chat_public_token"] ?? ""));
        $output["chat_public_token"] = $token;
        return $output;
    }

    /**
     * Admin sections that have a guided tutorial. Persisted values are
     * whitelisted against this list (see tutorial_sections setting).
     */
    public const TUTORIAL_SECTIONS = [
        "dashboard",
        "conversations",
        "conversions",
        "content",
        "helpdesk",
        "tools",
        "settings",
        "upgrade",
    ];

    public static function sanitize_integrations($value): array
    {
        if (!is_array($value)) {
            return [];
        }
        $out = [];
        foreach ($value as $slug => $enabled) {
            $key = sanitize_key((string) $slug);
            if ($key === "" || strlen($key) > 64) {
                continue;
            }
            $out[$key] = (bool) $enabled;
        }
        return $out;
    }

    public static function sanitize_tutorial_sections($value): array
    {
        if (!is_array($value)) {
            return [];
        }
        $sections = [];
        foreach ($value as $item) {
            if (!is_scalar($item)) {
                continue;
            }
            $section = sanitize_key((string) $item);
            if (in_array($section, self::TUTORIAL_SECTIONS, true)) {
                $sections[$section] = true;
            }
        }
        return array_keys($sections);
    }

    public function handle_resolve(): void
    {
        if (!current_user_can("manage_options")) {
            wp_die("Unauthorized", 403);
        }
        check_admin_referer("alpharecall_resolve");
        $options = self::get_options();
        $domain = $options["tenant_domain"];
        if (!$domain) {
            $this->set_notice("Manca il dominio del sito web.", "error");
            wp_safe_redirect(admin_url("admin.php?page=alpharecall-dashboard"));
            exit;
        }
        $client = AlphaRecall_Client::get_instance();
        $response = $client->resolve_tenant($domain);
        if (is_wp_error($response)) {
            $this->set_notice($response->get_error_message(), "error");
            wp_safe_redirect(admin_url("admin.php?page=alpharecall-dashboard"));
            exit;
        }
        if (!isset($response["tenant"]["id"])) {
            $this->set_notice("Non siamo riusciti a collegare il sito web: risposta inattesa. Riprova.", "error");
            wp_safe_redirect(admin_url("admin.php?page=alpharecall-dashboard"));
            exit;
        }
        $options["tenant_id"] = (string) $response["tenant"]["id"];
        $options["tenant_domain"] = (string) ($response["tenant"]["domain"] ?? $domain);
        $options["tenant_status"] = (string) ($response["tenant"]["status"] ?? "");
        self::persist($options);
        $this->set_notice("Sito web collegato.", "success");
        wp_safe_redirect(admin_url("admin.php?page=alpharecall-dashboard"));
        exit;
    }

    private function set_notice(string $message, string $type): void
    {
        set_transient(self::NOTICE_KEY, ["message" => $message, "type" => $type], 30);
    }

    public function render_notice(): void
    {
        $notice = get_transient(self::NOTICE_KEY);
        if (!$notice) {
            return;
        }
        delete_transient(self::NOTICE_KEY);
        $type = $notice["type"] === "error" ? "notice-error" : "notice-success";
        printf(
            '<div class="notice %s"><p>%s</p></div>',
            esc_attr($type),
            esc_html($notice["message"])
        );
    }

    public function render_page(): void
    {
        $options = self::get_options();
        ?>
        <div class="wrap">
            <h1>AlphaRecall</h1>
            <p>Collega il tuo sito web ad AlphaRecall per attivare il tuo workspace e sbloccare i workflow AI.</p>
            <form method="post" action="options.php">
                <?php
                settings_fields("alpharecall_settings_group");
                ?>
                <table class="form-table" role="presentation">
                    <tr>
                        <th scope="row"><label for="alpharecall_api_base">URL base API</label></th>
                        <td>
                            <input class="regular-text" type="url" id="alpharecall_api_base" name="<?php echo esc_attr(self::OPTION_KEY); ?>[api_base_url]" value="<?php echo esc_attr($options["api_base_url"]); ?>" placeholder="https://api.example.com" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="alpharecall_domain">Dominio del sito web</label></th>
                        <td>
                            <input class="regular-text" type="text" id="alpharecall_domain" name="<?php echo esc_attr(self::OPTION_KEY); ?>[tenant_domain]" value="<?php echo esc_attr($options["tenant_domain"]); ?>" />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="alpharecall_secret">Segreto auto-creazione</label></th>
                        <td>
                            <input class="regular-text" type="password" id="alpharecall_secret" name="<?php echo esc_attr(self::OPTION_KEY); ?>[auto_create_secret]" value="<?php echo esc_attr($options["auto_create_secret"]); ?>" autocomplete="new-password" />
                            <p class="description">Opzionale: usato per firmare la creazione automatica del sito web.</p>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">ID sito web</th>
                        <td>
                            <input class="regular-text" type="text" value="<?php echo esc_attr($options["tenant_id"]); ?>" readonly />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row">Stato sito web</th>
                        <td>
                            <input class="regular-text" type="text" value="<?php echo esc_attr($options["tenant_status"]); ?>" readonly />
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="alpharecall_key">Chiave API del sito web</label></th>
                        <td>
                            <input class="regular-text" type="password" id="alpharecall_key" name="<?php echo esc_attr(self::OPTION_KEY); ?>[tenant_key]" value="<?php echo esc_attr($options["tenant_key"]); ?>" autocomplete="new-password" />
                            <p class="description">Incolla la chiave API del sito web fornita dalla dashboard admin.</p>
                        </td>
                    </tr>
                </table>
                <?php submit_button("Salva impostazioni"); ?>
            </form>
            <hr />
            <form method="post" action="<?php echo esc_url(admin_url("admin-post.php")); ?>">
                <?php wp_nonce_field("alpharecall_resolve"); ?>
                <input type="hidden" name="action" value="alpharecall_resolve" />
                <?php submit_button("Risolvi sito web", "secondary"); ?>
            </form>
        </div>
        <?php
    }

    public function maybe_bootstrap(): void
    {
        if ((!is_admin() && !wp_doing_cron()) || !AlphaRecall_Connect::has_consent()) {
            return;
        }
        $options = self::get_options();
        if (!empty($options["tenant_id"])) {
            // Already provisioned -- but a sync queued before provisioning can
            // still be sitting in the queue on sites that bootstrapped through
            // the REST path back when it did not drain. Recover those here.
            self::drain_pending_ingestion($options);
            return;
        }
        if (empty($options["pending_bootstrap"])) {
            $options["pending_bootstrap"] = true;
            self::persist($options);
        }
        $now = time();
        $last = (int) ($options["bootstrap_last_attempt"] ?? 0);
        if ($last && ($now - $last) < 180) {
            return;
        }
        $options["bootstrap_last_attempt"] = $now;
        self::persist($options);
        if (empty($options["api_base_url"])) {
            return;
        }
        $domain = $options["tenant_domain"] ?: wp_parse_url(home_url(), PHP_URL_HOST);
        if (!$domain) {
            return;
        }
        $client = AlphaRecall_Client::get_instance();
        $response = $client->fetch_tenant_key($domain);
        if (is_wp_error($response)) {
            self::record_bootstrap_error($options, $response);
            return;
        }
        self::finalize_bootstrap($options, $response, $domain);
    }

    /**
     * Apply a successful /tenants/current/key response and run every follow-up
     * that depends on having a tenant: branding, prompt sync, and the content
     * sync queued during onboarding.
     *
     * Both bootstrap entry points go through here -- the admin/cron hook above
     * and AlphaRecall_Rest::bootstrap_website(), which is what the dashboard actually
     * calls. They previously carried separate copies of this logic, and the
     * REST copy skipped clearing pending_bootstrap and draining
     * pending_ingestion, so a client's onboarding sync was queued and then
     * stranded forever.
     */
    public static function finalize_bootstrap(array $options, array $response, string $domain): array
    {
        $options["tenant_id"] = (string) ($response["tenant_id"] ?? "");
        $options["tenant_status"] = (string) ($response["status"] ?? "");
        $options["tenant_domain"] = (string) ($response["domain"] ?? $domain);
        if (!empty($response["api_key"])) {
            $options["tenant_key_enc"] = AlphaRecall_Storage::encrypt((string) $response["api_key"]);
            $options["tenant_key"] = "";
        }
        $options["pending_bootstrap"] = false;
        $options["bootstrap_last_error"] = "";
        $options["bootstrap_last_error_at"] = 0;

        // Auto-extract branding from the WordPress site (runs once)
        if (empty($options["branding_auto_applied"])) {
            $branding = AlphaRecall_Branding::extract();
            self::apply_branding_defaults($options, $branding);
            $options["branding_auto_applied"] = true;
        }

        $pending_profile = $options["business_profile"] ?? [];
        self::persist($options);

        if (!empty($options["tenant_id"]) && !empty($pending_profile)) {
            $prompt = self::build_prompt_from_profile($pending_profile);
            AlphaRecall_Client::get_instance()->update_prompt((int) $options["tenant_id"], [
                "prompt_text" => $prompt,
                "notes" => "Synced after bootstrap",
            ]);
        }

        self::drain_pending_ingestion($options);

        return $options;
    }

    /**
     * Start the content sync that was queued while the site had no tenant yet.
     *
     * AlphaRecall_Rest::run_ingestion() parks the request in pending_ingestion when the
     * tenant is missing, so this is what actually gets a client's pages and
     * posts into the agent once provisioning completes. Safe to call on every
     * admin request: it no-ops without a tenant or a queued request, throttles
     * retries, and only clears the queue once the API has accepted it.
     */
    public static function drain_pending_ingestion(array &$options): bool
    {
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $pending = $options["pending_ingestion"] ?? null;
        if (!$tenant_id || !is_array($pending) || empty($pending)) {
            return false;
        }

        // Don't retry a failing API on every single admin page load.
        $now = time();
        $last = (int) ($options["ingestion_drain_last_attempt"] ?? 0);
        if ($last && ($now - $last) < 300) {
            return false;
        }
        $options["ingestion_drain_last_attempt"] = $now;
        self::persist($options);

        // The deferred payload is built without a site_url (the request that
        // queued it had no tenant to send one for), so fill it in here.
        if (empty($pending["site_url"])) {
            $pending["site_url"] = home_url();
        }

        $result = AlphaRecall_Client::get_instance()->start_ingestion($tenant_id, $pending);
        if (is_wp_error($result)) {
            return false;
        }
        // The onboarding's choice of pages and posts, for the sync after an edit.
        if (class_exists("AlphaRecall_Content_Sync")) {
            AlphaRecall_Content_Sync::remember_scope($pending);
        }

        $options["pending_ingestion"] = null;
        $options["last_ingestion_queued_at"] = $now;
        self::persist($options);
        return true;
    }

    /**
     * Keep the reason a bootstrap attempt failed so the dashboard can show it.
     * Without this the admin only ever saw an empty "not ready" card.
     */
    public static function record_bootstrap_error(array $options, $error): void
    {
        $message = is_wp_error($error) ? $error->get_error_message() : (string) $error;
        $options["pending_bootstrap"] = true;
        $options["bootstrap_last_error"] = $message;
        $options["bootstrap_last_error_at"] = time();
        self::persist($options);
    }

    /**
     * Apply extracted branding to chat_config and business_profile,
     * but only if fields still hold their factory defaults.
     */
    private static function apply_branding_defaults(array &$options, array $branding): void
    {
        $config = (array) ($options["chat_config"] ?? []);
        $profile = (array) ($options["business_profile"] ?? []);

        // Primary color — only if still factory default. A theme's black or
        // grey button is no brand color: a new install keeps the factory one.
        $neutral = !empty($branding["neutral_color"]);
        if (!empty($branding["primary_color"]) && !$neutral) {
            if (empty($config["primaryColor"]) || $config["primaryColor"] === "#1877f2") {
                $config["primaryColor"] = $branding["primary_color"];
            }
            if (empty($config["buttonColor"]) || $config["buttonColor"] === "#1877f2") {
                $config["buttonColor"] = $branding["primary_color"];
            }
        }

        // Accent color
        if (!empty($branding["accent_color"]) && !$neutral) {
            if (empty($config["accentColor"]) || $config["accentColor"] === "#1877f2") {
                $config["accentColor"] = $branding["accent_color"];
            }
        }

        // Assistant portraits are the default. A site logo is applied only by
        // an explicit image choice / "Reset to site branding" in the editor.

        // Header title from business name
        if (!empty($branding["business_name"])) {
            if (empty($config["headerTitle"]) || $config["headerTitle"] === "AlphaRecall") {
                $config["headerTitle"] = mb_substr((string) $branding["business_name"], 0, self::HEADER_TITLE_MAX);
            }
            if (empty($profile["name"])) {
                $profile["name"] = $branding["business_name"];
            }
        }

        $options["chat_config"] = $config;
        $options["business_profile"] = $profile;

        // Cache extraction results for the REST endpoint
        set_transient("alpharecall_branding_extracted", $branding, 30 * DAY_IN_SECONDS);
    }

    private static function default_api_base(): string
    {
        // No platform default was baked in (see plugin/config.php). Guessing
        // an address only produced connection errors that looked like a broken
        // plugin, so leave it empty: the settings screen then asks for the API
        // base explicitly. Local development sets ALPHARECALL_API_BASE in
        // wp-config.php (the shipped plugin has no Docker-specific fallback).
        return "";
    }

    public static function build_prompt_from_profile(array $profile): string
    {
        $lines = [];
        $lines[] = "You are the AlphaRecall assistant for this business.";
        if (!empty($profile["name"])) {
            $lines[] = "Business name: " . sanitize_text_field((string) $profile["name"]) . ".";
        }
        if (!empty($profile["description"])) {
            $lines[] = "Business description: " . sanitize_text_field((string) $profile["description"]) . ".";
        }
        if (!empty($profile["tone"])) {
            $lines[] = "Tone of voice: " . sanitize_text_field((string) $profile["tone"]) . ".";
        }
        if (!empty($profile["policies"])) {
            $lines[] = "Policies: " . sanitize_text_field((string) $profile["policies"]) . ".";
        }
        if (!empty($profile["faqs"])) {
            $lines[] = "FAQs: " . sanitize_text_field((string) $profile["faqs"]) . ".";
        }
        if (!empty($profile["contact"])) {
            $lines[] = "Contact details: " . sanitize_text_field((string) $profile["contact"]) . ".";
        }
        $lines[] = "Always be helpful, concise, and accurate. Ask clarifying questions when needed.";
        return implode("\n", $lines);
    }
}
