<?php

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_Chat
{
    private static ?AlphaRecall_Chat $instance = null;
    public const PUBLIC_SIGNATURE_TTL = 3600;
    public const PUBLIC_SESSION_COOKIE = "alpharecall_chat_session";
    /** The same cookie before 0.1.86 (two-letter prefix): still accepted until it expires. */
    private const LEGACY_PUBLIC_SESSION_COOKIE = "ar_chat_session";
    private const PUBLIC_MAX_BODY_BYTES = 262144;
    /** Seconds until the stream limiter that refused this request admits it again. */
    private int $retry_after = 0;
    // Mirrors the backend history clamp (app/agent.py::_sanitize_history).
    private const HISTORY_MAX_MESSAGES = 12;
    private const HISTORY_MAX_CHARS = 4000;

    public static function get_instance(): AlphaRecall_Chat
    {
        if (!self::$instance) {
            self::$instance = new AlphaRecall_Chat();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_action("template_redirect", [$this, "start_public_session"]);
        add_action("wp_enqueue_scripts", [$this, "enqueue_assets"]);
        add_action("wp_footer", [$this, "render_container"]);
        add_shortcode("alpharecall_chat", [$this, "shortcode"]);
        add_action("wp_ajax_nopriv_alpharecall_chat_stream", [$this, "chat_stream"]);
        add_action("wp_ajax_alpharecall_chat_stream", [$this, "chat_stream"]);
    }

    /** Check the authenticated WP user, never client-supplied role or user data. */
    public static function demo_access_allowed(?array $config = null): bool
    {
        $config = $config ?? (array) (AlphaRecall_Settings::get_options()["chat_config"] ?? []);
        $mode = $config["displayMode"] ?? "production";
        if ($mode === "production") {
            return true;
        }
        if ($mode !== "demo" || !is_user_logged_in()) {
            return false;
        }
        $allowed = $config["demoRoles"] ?? ["administrator"];
        if (!is_array($allowed)) {
            return false;
        }
        $registered = wp_roles()->roles;
        $allowed = array_filter($allowed, static fn($role): bool => is_string($role) && isset($registered[$role]));
        return (bool) array_intersect((array) wp_get_current_user()->roles, $allowed);
    }

    /**
     * The owner testing the assistant from wp-admin (Assistente > Prova).
     *
     * Only the REST routes the test page calls use this, never the widget's
     * render, assets or SSE stream, so the visitor-facing role gate is
     * unchanged. REST cookie auth logs the user out unless the request carries
     * a valid wp_rest nonce, so another site cannot ride an admin's cookie.
     */
    public static function admin_test_allowed(): bool
    {
        return is_user_logged_in()
            && (current_user_can("manage_options") || current_user_can("alpharecall_admin"));
    }

    /**
     * Issue the widget session cookie before the template starts output.
     * wp_enqueue_scripts fires from wp_head, and block themes have already
     * echoed the document head by then, so a setcookie() there is silently
     * dropped once headers are sent.
     */
    public function start_public_session(): void
    {
        $options = AlphaRecall_Settings::get_options();
        $config = (array) ($options["chat_config"] ?? []);
        if (($config["displayMode"] ?? "production") !== "production") {
            // A role-specific page must not enter a shared full-page cache.
            if (!defined("DONOTCACHEPAGE")) { define("DONOTCACHEPAGE", true); } // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.NonPrefixedConstantFound -- the shared constant page caches read.
            nocache_headers();
        }
        if (empty($config["enabled"]) || !self::demo_access_allowed($config)) {
            return;
        }
        self::ensure_public_session_cookie();
    }

    public function enqueue_assets(): void
    {
        $options = AlphaRecall_Settings::get_options();
        $config = (array) ($options["chat_config"] ?? []);
        // Numbers saved before the save clamped them (-50, 99999, "") reach the widget in range.
        foreach (array_keys(AlphaRecall_Settings::WIDGET_NUMBERS) as $key) {
            if (array_key_exists($key, $config) || $key === "panelWidth" || $key === "panelHeight") {
                $config[$key] = AlphaRecall_Settings::widget_number($key, $config);
            }
        }
        unset($config["recentColors"]);  // the editor's colour history is for admins, not visitors
        $tenant_settings = (array) ($options["tenant_settings"] ?? []);
        if (empty($config["enabled"]) || !self::demo_access_allowed($config) || !AlphaRecall_Connect::has_consent()) {
            return;
        }
        if (!empty($tenant_settings["chatbot_name"])) {
            $config["chatbotName"] = (string) $tenant_settings["chatbot_name"];
        }
        if (!empty($tenant_settings["chatbot_tone"])) {
            $config["chatbotTone"] = (string) $tenant_settings["chatbot_tone"];
        }
        $config["requireVisitorInfo"] = array_key_exists("require_visitor_info", $tenant_settings)
            && !empty($tenant_settings["require_visitor_info"]);
        $config["consentMode"] = $config["requireVisitorInfo"] ? "pre_chat" : "just_in_time";
        // GDPR Phase 1: expose privacy notice + auto-register flag to the widget
        if (!empty($tenant_settings["privacy_notice_url"])) {
            $config["privacyNoticeUrl"] = (string) $tenant_settings["privacy_notice_url"];
        }
        if (!empty($tenant_settings["privacy_policy_version"])) {
            $config["privacyPolicyVersion"] = (string) $tenant_settings["privacy_policy_version"];
        }
        if (array_key_exists("auto_register_wp_users", $tenant_settings)) {
            $config["autoRegisterWpUsers"] = (bool) $tenant_settings["auto_register_wp_users"];
        }
        $bot_shield_mode = (string) ($tenant_settings["bot_shield_mode"] ?? "standard");
        $config["botShieldMode"] = in_array($bot_shield_mode, ["off", "standard", "strict"], true)
            ? $bot_shield_mode
            : "standard";
        // Maps draw from a self-hosted Protomaps archive. "carto" is the
        // retired default and now means the same as "protomaps".
        if (array_key_exists("map_tile_provider", $tenant_settings)) {
            $val = $tenant_settings["map_tile_provider"];
            if ($val === null || in_array($val, ["protomaps", "carto", "osm_selfhost", "none"], true)) {
                $config["mapTileProvider"] = $val === "carto" ? "protomaps" : $val;
            }
        }
        $map_sources = AlphaRecall_Settings::map_sources();
        if ($map_sources["pmtiles"] !== "") {
            $config["mapPmtilesUrl"] = $map_sources["pmtiles"];
        }
        if ($map_sources["osm_selfhost"] !== "") {
            $config["mapOsmSelfhostUrl"] = $map_sources["osm_selfhost"];
        }
        $maps_version = file_exists(ALPHARECALL_PLUGIN_PATH . "assets/js/chat-maps.js")
            ? filemtime(ALPHARECALL_PLUGIN_PATH . "assets/js/chat-maps.js")
            : ALPHARECALL_PLUGIN_VERSION;
        $config["mapsRuntimeUrl"] = add_query_arg("ver", $maps_version, ALPHARECALL_PLUGIN_URL . "assets/js/chat-maps.js");
        // Plan feature flags for the widget (features[], chat availability). Cached
        // in a transient to avoid an uncached backend call on every page load.
        $plan_features = AlphaRecall_Client::get_instance()->get_plan_features();
        if (!self::plan_allows_chat($plan_features)) {
            // Trial expired / quota used up: no widget at all, rather than a
            // launcher that answers every message with an error.
            return;
        }
        $config["features"] = $plan_features["features"];
        // The credit link shows only where the owner opted in (WordPress.org
        // guideline 10); the plan has no say in it (guideline 5).
        $config["logoRemoval"] = !AlphaRecall_Connect::attribution_allowed();
        // Feedback (the feedback tool and POST visitor-feedback) needs a paid
        // tier: the backend refuses tools on the free tier. Every paid tier
        // carries the base paid features and the free tier none, so an empty
        // verified list means free. Unverified plan data keeps it on, so a
        // backend hiccup never hides feedback from a licensed site.
        $config["feedbackEnabled"] = empty($plan_features["_verified"])
            || !empty($plan_features["features"]);
        // The owner can also switch the feedback tool off in the tool settings
        // (tenant_settings.enabled_tools, a missing key meaning on, as in the
        // backend). The visitor-feedback route checks only the plan, so the
        // widget hides the entry point itself.
        $enabled_tools = $tenant_settings["enabled_tools"] ?? null;
        if (is_array($enabled_tools) && array_key_exists("feedback", $enabled_tools)
            && filter_var($enabled_tools["feedback"], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) === false) {
            $config["feedbackEnabled"] = false;
        }

        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if ($tenant_id) {
            $cache_key = "alpharecall_helpdesk_chat_" . $tenant_id;
            $cached = get_transient($cache_key);
            if (is_array($cached)) {
                $config["helpdeskEntries"] = $cached;
            } else {
                $client = AlphaRecall_Client::get_instance();
                $result = $client->list_helpdesk($tenant_id);
                if (!is_wp_error($result)) {
                    $entries = array_values(array_filter((array) $result, function ($item) {
                        return !empty($item["enabled"]);
                    }));
                    $config["helpdeskEntries"] = $entries;
                    set_transient($cache_key, $entries, 300);
                }
            }
        }
        $css_version = file_exists(ALPHARECALL_PLUGIN_PATH . "assets/css/chat.css")
            ? filemtime(ALPHARECALL_PLUGIN_PATH . "assets/css/chat.css")
            : ALPHARECALL_PLUGIN_VERSION;
        $js_version = file_exists(ALPHARECALL_PLUGIN_PATH . "assets/js/chat.js")
            ? filemtime(ALPHARECALL_PLUGIN_PATH . "assets/js/chat.js")
            : ALPHARECALL_PLUGIN_VERSION;
        // Bind the capability to a site cookie so a copied signature cannot be
        // replayed from a different browser session.
        self::ensure_public_session_cookie();
        // Anonymous clients receive this short-lived anti-abuse capability.
        // It limits blind API calls but does not authenticate a visitor or
        // authorize access to visitor-owned resources.
        $public_signature = self::build_public_signature(
            (string) ($options["chat_public_token"] ?? "")
        );
        wp_enqueue_style(
            "alpharecall-chat",
            ALPHARECALL_PLUGIN_URL . "assets/css/chat.css",
            [],
            $css_version
        );
        wp_enqueue_script(
            "alpharecall-chat",
            ALPHARECALL_PLUGIN_URL . "assets/js/chat.js",
            [],
            $js_version,
            true
        );
        wp_localize_script(
            "alpharecall-chat",
            "AlphaRecallChat",
            [
                "restUrl" => esc_url_raw(rest_url("alpharecall/v1")),
                "streamUrl" => admin_url("admin-ajax.php?action=alpharecall_chat_stream"),
                "nonce" => wp_create_nonce("wp_rest"),
                "config" => $config,
                "user" => $this->get_current_user_data(),
                "chatSig" => $public_signature["chatSig"],
                "chatTs" => $public_signature["chatTs"],
                "chatSigTtl" => self::PUBLIC_SIGNATURE_TTL,
                "strings" => $this->get_chat_strings($tenant_settings),
                "language" => (string) ($tenant_settings["response_language"] ?? "it"),
            ]
        );
    }

    /**
     * Create the short-lived anti-abuse capability used by the widget. The
     * HMAC is bound to the HttpOnly browser session cookie and must never be
     * treated as visitor authentication or resource authorization.
     */
    public static function build_public_signature(string $secret, ?int $timestamp = null, ?string $session = null): array
    {
        $chat_ts = (string) ($timestamp ?? time());
        $session = $session ?? self::public_session_cookie();
        return [
            "chatSig" => self::public_signature_hash($secret, $chat_ts, $session),
            "chatTs" => $chat_ts,
            "expiresIn" => self::PUBLIC_SIGNATURE_TTL,
        ];
    }

    private static function public_signature_hash(string $secret, string $chat_ts, string $session): string
    {
        $host = wp_parse_url(home_url(), PHP_URL_HOST) ?: "";
        return hash_hmac("sha256", sprintf("chat|%s|%s|%s", $chat_ts, $host, $session), $secret);
    }

    /**
     * Check a widget capability against the browser session of the current
     * request. The chat stream and the public REST routes both go through
     * here so the page-issued signature is accepted everywhere.
     */
    public static function public_signature_is_valid(string $secret, string $timestamp, string $signature): bool
    {
        if ($secret === "" || $timestamp === "" || $signature === "" || !ctype_digit($timestamp)) {
            return false;
        }
        if (abs(time() - (int) $timestamp) > self::PUBLIC_SIGNATURE_TTL) {
            return false;
        }
        $session = self::public_session_cookie();
        if ($session === "") {
            return false;
        }
        return hash_equals(self::public_signature_hash($secret, $timestamp, $session), $signature);
    }

    public static function public_session_cookie(): string
    {
        $name = isset($_COOKIE[self::PUBLIC_SESSION_COOKIE]) ? self::PUBLIC_SESSION_COOKIE : self::LEGACY_PUBLIC_SESSION_COOKIE;
        $value = isset($_COOKIE[$name])
            ? sanitize_text_field(wp_unslash((string) $_COOKIE[$name]))
            : "";
        return preg_match('/^[a-f0-9]{64}$/', $value) === 1 ? $value : "";
    }

    public static function ensure_public_session_cookie(): string
    {
        $existing = self::public_session_cookie();
        if ($existing !== "") {
            return $existing;
        }
        try {
            $value = bin2hex(random_bytes(32));
        } catch (Throwable $e) {
            return "";
        }
        if (!headers_sent()) {
            setcookie(self::PUBLIC_SESSION_COOKIE, $value, [
                "expires" => time() + self::PUBLIC_SIGNATURE_TTL,
                "path" => "/",
                "secure" => is_ssl(),
                "httponly" => true,
                "samesite" => "Lax",
            ]);
            $_COOKIE[self::PUBLIC_SESSION_COOKIE] = $value;
        }
        return $value;
    }

    private function get_chat_strings(array $tenant_settings): array
    {
        $lang = $tenant_settings["response_language"] ?? "it";
        if ($lang === "it") {
            return [
                "greeting" => "Ciao!",
                "welcomeSubtitle" => "Come posso aiutarti oggi?",
                "inputPlaceholder" => "Scrivi un messaggio...",
                "latestMessages" => "Ultimi messaggi",
                "onlineStatus" => "Online ora, rispondiamo subito",
                "sendMessage" => "Invia messaggio",
                "stopGenerating" => "Interrompi",
                "clearConversation" => "Cancella conversazione",
                "closeChat" => "Chiudi chat",
                "muteSounds" => "Disattiva suoni",
                "unmuteSounds" => "Attiva suoni",
                "copyMessage" => "Copia",
                "retryMessage" => "Riprova",
                "messageInput" => "Scrivi il tuo messaggio",
                "errorPrefix" => "Errore:",
                "thinking" => "Sto analizzando le informazioni...",
                "securityCheck" => "Un attimo, controllo di sicurezza...",
                "securityCheckFailed" => "Il controllo di sicurezza non è andato a buon fine. Riprova tra poco.",
                "thinkingLabel" => "Sto analizzando le informazioni",
                "doneThinking" => "Analisi completata",
                "thoughtForSeconds" => "Analisi completata in {n} secondi",
                "thoughtForMinutes" => "Analisi completata in {n} minuti",
                "thoughtForHours" => "Analisi completata in {n} ore",
                "thoughtForSecondsOne" => "Analisi completata in 1 secondo",
                "thoughtForMinutesOne" => "Analisi completata in 1 minuto",
                "thoughtForHoursOne" => "Analisi completata in 1 ora",
                "toolStatuses" => [
                    "appointment" => "Sto controllando l'appuntamento...",
                    "appointment_get" => "Sto cercando l'appuntamento...",
                    "appointment_update" => "Sto aggiornando l'appuntamento...",
                    "appointment_delete" => "Sto annullando l'appuntamento...",
                    "email_lead" => "Sto salvando i tuoi contatti...",
                    "email_lead_get" => "Sto cercando i tuoi contatti...",
                    "email_lead_update" => "Sto aggiornando i tuoi contatti...",
                    "email_lead_delete" => "Sto rimuovendo i tuoi contatti...",
                    "contact_form" => "Sto preparando il messaggio...",
                    "callback_request" => "Sto chiedendo al team di richiamarti...",
                    "quote_request" => "Sto preparando la tua richiesta di preventivo...",
                    "newsletter_subscribe" => "Ti sto iscrivendo alla newsletter...",
                    "product_search" => "Cerco i prodotti più adatti a te...",
                    "knowledge_search" => "Cerco le informazioni giuste...",
                    "faq_search" => "Cerco la risposta tra le FAQ...",
                    "business_info" => "Controllo le informazioni sull'attività...",
                    "event_list" => "Cerco gli eventi in programma...",
                    "event_register" => "Sto confermando la tua iscrizione all'evento...",
                    "coupon_check" => "Sto controllando il codice sconto...",
                    "feedback" => "Sto salvando il tuo feedback...",
                    "escalate" => "Sto avvisando il team...",
                    "clarify" => "Preparo una domanda per te...",
                    "display" => "Metto in ordine i risultati...",
                    "default" => "Ci sto lavorando...",
                ],
                "preChatTitle" => "Ci siamo quasi",
                "preChatSubtitle" => "Lasciaci i tuoi dati e inviamo il messaggio.",
                "nameLabel" => "Nome",
                "namePlaceholder" => "Come ti chiami?",
                "emailLabel" => "Email",
                "emailPlaceholder" => "nome@azienda.it",
                "notifyOptIn" => "Avvisami via email quando arriva una risposta",
                "marketingOptIn" => "Ogni tanto mandami novità e offerte via email",
                "startChat" => "Invia il messaggio",
                "privacyConsentText" => "Ho letto e accetto l'",
                "privacyNoticeLinkLabel" => "informativa sulla privacy",
                "privacyNoticeFooter" => "Usando la chat accetti l'",
                "chatConsentLabel" => "Acconsento al trattamento dei dati necessari per usare questa chat.",
                "nameRequired" => "Inserisci il tuo nome.",
                "emailRequired" => "Inserisci la tua email.",
                "emailInvalid" => "Inserisci un indirizzo email valido.",
                "consentRequired" => "Ci serve il tuo consenso per inviare il messaggio.",
                "registrationError" => "Non siamo riusciti a salvare i tuoi dati. Riprova.",
                "savingConsent" => "Un attimo...",
                "consentDismissLabel" => "Torna alla chat",
                "consentCardTitle" => "Ci serve il tuo consenso",
                "consentCardBody" => "Per continuare devo {purpose}.",
                "consentCardSummaryTitle" => "Cosa salveremo",
                "consentCardPrivacy" => "Leggi l'informativa sulla privacy",
                "consentCardAccept" => "Acconsento",
                "consentCardDecline" => "Non ora",
                "consentCardAccepted" => "Grazie, consenso registrato.",
                "consentCardDeclined" => "Va bene, non salverò i tuoi dati.",
                "consentCardExpired" => "Questa richiesta è scaduta. Chiedimelo di nuovo in chat.",
                "consentCardError" => "Non siamo riusciti a registrare la tua scelta. Riprova.",
                "consentCardRetry" => "Riprova",
                "consentAcceptedMessage" => "Va bene, procedi pure.",
                "consentDeclinedMessage" => "No grazie, preferisco non lasciare i miei dati.",
                "consentFieldName" => "Nome",
                "consentFieldEmail" => "Email",
                "consentFieldPhone" => "Telefono",
                "from" => "Da",
                "to" => "A",
                "sortBy" => "Ordina per",
                "noDataAvailable" => "Ancora nessun dato",
                "next" => "Avanti",
                "complete" => "Concludi",
                "step" => "Passo",
                "chatTab" => "Chat",
                "faqTab" => "Domande",
                "faqSearchPlaceholder" => "Cerca una risposta...",
                "faqClearSearch" => "Cancella ricerca",
                "faqEmptyTitle" => "Ancora nessuna FAQ",
                "faqEmptyDesc" => "Le risposte alle domande più comuni arriveranno presto.",
                "faqNoResults" => "Nessuna domanda corrisponde alla ricerca.",
                "faqAskAbout" => "Chiedi in chat",
                "faqGeneralCategory" => "Generale",
                "faqHomeTitle" => "Come possiamo aiutarti?",
                "faqTopQuestions" => "Le più cercate",
                "faqBrowseTopics" => "Sfoglia per argomento",
                "faqBack" => "Indietro",
                "faqAnswerCount" => "{n} risposte",
                "faqAnswerCountOne" => "1 risposta",
                "faqResultsCount" => "{n} risultati",
                "faqResultsCountOne" => "1 risultato",
                "humanReplyLabel" => "Risposta dal team",
                "humanHandlingLabel" => "Ti risponde il team · IA in pausa",
                "copiedLabel" => "Copiato",
                "dismissLabel" => "Chiudi",
                "moreOptions" => "Altre opzioni",
                "welcomeIntro" => "Ciao, sono {name}.",
                "welcomeHelp" => "Come posso aiutarti?",
                "aiDisclosure" => "Stai parlando con un assistente virtuale basato su intelligenza artificiale",
                "aiDisclosureHuman" => "Le risposte dell'assistente virtuale sono generate con intelligenza artificiale",
                "privacyShort" => "Privacy",
                "faqAskAssistant" => "Non trovi? Chiedi a {name}",
                "faqViewLabel" => "Domande frequenti",
                "connectionError" => "Connessione persa, il messaggio non è partito.",
                "replyError" => "Al momento non riesco a rispondere. Riprova tra poco.",
                "noReplyError" => "{name} non ha risposto. Riprova.",
                "rateLimitError" => "Stai scrivendo un po' troppo in fretta. Aspetta qualche secondo e riprova.",
                "sourcesLabel" => "Fonti",
                "workingLabel" => "{name} sta rispondendo",
                "rateChat" => "Valuta la conversazione",
                "personaStatus" => "{business} · risponde subito",
            ];
        }
        return [
            "greeting" => "Hi there!",
            "welcomeSubtitle" => "How can I help you today?",
            "inputPlaceholder" => "Type a message...",
            "latestMessages" => "Latest messages",
            "onlineStatus" => "Online now, we reply right away",
            "sendMessage" => "Send message",
            "stopGenerating" => "Stop",
            "clearConversation" => "Clear conversation",
            "closeChat" => "Close chat",
            "muteSounds" => "Mute sounds",
            "unmuteSounds" => "Unmute sounds",
            "copyMessage" => "Copy",
            "retryMessage" => "Retry",
            "messageInput" => "Type your message",
            "errorPrefix" => "Error:",
            "thinking" => "Analyzing the information...",
            "securityCheck" => "Running a quick security check...",
            "securityCheckFailed" => "The security check didn't go through. Please try again in a moment.",
            "thinkingLabel" => "Analyzing the information",
            "doneThinking" => "Analysis complete",
            "thoughtForSeconds" => "Analysis took {n} seconds",
            "thoughtForMinutes" => "Analysis took {n} minutes",
            "thoughtForHours" => "Analysis took {n} hours",
            "thoughtForSecondsOne" => "Analysis took 1 second",
            "thoughtForMinutesOne" => "Analysis took 1 minute",
            "thoughtForHoursOne" => "Analysis took 1 hour",
            "toolStatuses" => [
                "appointment" => "Checking the appointment...",
                "appointment_get" => "Looking up the appointment...",
                "appointment_update" => "Updating the appointment...",
                "appointment_delete" => "Cancelling the appointment...",
                "email_lead" => "Saving your contact details...",
                "email_lead_get" => "Looking up your contact details...",
                "email_lead_update" => "Updating your contact details...",
                "email_lead_delete" => "Removing your contact details...",
                "contact_form" => "Preparing the message...",
                "callback_request" => "Asking the team to call you back...",
                "quote_request" => "Preparing your quote request...",
                "newsletter_subscribe" => "Signing you up for the newsletter...",
                "product_search" => "Finding the best products for you...",
                "knowledge_search" => "Looking up the right information...",
                "faq_search" => "Checking the FAQs for an answer...",
                "business_info" => "Checking the business details...",
                "event_list" => "Looking for upcoming events...",
                "event_register" => "Confirming your event registration...",
                "coupon_check" => "Checking the discount code...",
                "feedback" => "Saving your feedback...",
                "escalate" => "Letting the team know...",
                "clarify" => "Preparing a quick question...",
                "display" => "Putting the results together...",
                "default" => "Working on it...",
            ],
            "preChatTitle" => "Almost there",
            "preChatSubtitle" => "Leave your details and we'll send your message.",
            "nameLabel" => "Name",
            "namePlaceholder" => "What's your name?",
            "emailLabel" => "Email",
            "emailPlaceholder" => "name@company.com",
            "notifyOptIn" => "Email me when there's a reply",
            "marketingOptIn" => "Send me the occasional news and offers by email",
            "startChat" => "Send message",
            "privacyConsentText" => "I've read and accept the ",
            "privacyNoticeLinkLabel" => "privacy notice",
            "privacyNoticeFooter" => "By using this chat, you accept the ",
            "chatConsentLabel" => "I agree to the data processing needed to use this chat.",
            "nameRequired" => "Enter your name.",
            "emailRequired" => "Enter your email.",
            "emailInvalid" => "Enter a valid email address.",
            "consentRequired" => "We need your consent to send your message.",
            "registrationError" => "We couldn't save your details. Please try again.",
            "savingConsent" => "One moment...",
            "consentDismissLabel" => "Back to chat",
            "consentCardTitle" => "We need your consent",
            "consentCardBody" => "To continue, I need to {purpose}.",
            "consentCardSummaryTitle" => "What we'll save",
            "consentCardPrivacy" => "Read the privacy notice",
            "consentCardAccept" => "I consent",
            "consentCardDecline" => "Not now",
            "consentCardAccepted" => "Thanks, consent saved.",
            "consentCardDeclined" => "No problem, I won't save your data.",
            "consentCardExpired" => "This request has expired. Just ask me again in the chat.",
            "consentCardError" => "We couldn't save your choice. Please try again.",
            "consentCardRetry" => "Retry",
            "consentAcceptedMessage" => "Sure, go ahead.",
            "consentDeclinedMessage" => "No thanks, I'd rather not share my data.",
            "consentFieldName" => "Name",
            "consentFieldEmail" => "Email",
            "consentFieldPhone" => "Phone",
            "from" => "From",
            "to" => "To",
            "sortBy" => "Sort by",
            "noDataAvailable" => "No data yet",
            "next" => "Next",
            "complete" => "Finish",
            "step" => "Step",
            "chatTab" => "Chat",
            "faqTab" => "Questions",
            "faqSearchPlaceholder" => "Search for an answer...",
            "faqClearSearch" => "Clear search",
            "faqEmptyTitle" => "No FAQs yet",
            "faqEmptyDesc" => "Check back soon for answers to common questions.",
            "faqNoResults" => "No questions match your search.",
            "faqAskAbout" => "Ask in chat",
            "faqGeneralCategory" => "General",
            "faqHomeTitle" => "How can we help?",
            "faqTopQuestions" => "Top questions",
            "faqBrowseTopics" => "Browse by topic",
            "faqBack" => "Back",
            "faqAnswerCount" => "{n} answers",
            "faqAnswerCountOne" => "1 answer",
            "faqResultsCount" => "{n} results",
            "faqResultsCountOne" => "1 result",
            "humanReplyLabel" => "Reply from the team",
            "humanHandlingLabel" => "The team is replying · AI paused",
            "copiedLabel" => "Copied",
            "dismissLabel" => "Dismiss",
            "moreOptions" => "More options",
            "welcomeIntro" => "Hi, I'm {name}.",
            "welcomeHelp" => "How can I help?",
            "aiDisclosure" => "You are chatting with a virtual assistant based on artificial intelligence",
            "aiDisclosureHuman" => "The virtual assistant's answers are generated with artificial intelligence",
            "privacyShort" => "Privacy",
            "faqAskAssistant" => "Can't find it? Ask {name}",
            "faqViewLabel" => "Frequently asked questions",
            "connectionError" => "Connection lost, the message was not sent.",
            "replyError" => "I could not answer this time. Please try again shortly.",
            "noReplyError" => "{name} did not reply. Please try again.",
            "rateLimitError" => "You're sending messages a bit too fast. Wait a few seconds and try again.",
            "sourcesLabel" => "Sources",
            "workingLabel" => "{name} is replying",
            "rateChat" => "Rate the conversation",
            "personaStatus" => "{business} · replies right away",
        ];
    }

    private function get_current_user_data()
    {
        if (!is_user_logged_in()) {
            return null;
        }
        $user = wp_get_current_user();
        return [
            "wp_user_id" => $user->ID,
            "user_email" => $user->user_email,
            "display_name" => $user->display_name,
            "avatar_url" => get_avatar_url($user->ID, ["size" => 64]),
        ];
    }

    public function render_container(): void
    {
        $options = AlphaRecall_Settings::get_options();
        $config = (array) ($options["chat_config"] ?? []);
        if (empty($config["enabled"]) || !self::demo_access_allowed($config)) {
            return;
        }
        if (is_admin()) {
            return;
        }
        if (!$this->is_chat_available()) {
            return;
        }
        echo '<div id="alpharecall-chat-root"></div>';
    }

    public function shortcode(): string
    {
        $config = (array) (AlphaRecall_Settings::get_options()["chat_config"] ?? []);
        if (empty($config["enabled"]) || !self::demo_access_allowed($config) || !$this->is_chat_available()) {
            return "";
        }
        return '<div id="alpharecall-chat-root"></div>';
    }

    /**
     * Whether the tenant's plan currently lets the widget accept messages.
     * Reads the cached plan (one transient lookup), never the network.
     */
    private function is_chat_available(): bool
    {
        // Nothing of the widget is rendered before an administrator connected the site.
        if (class_exists("AlphaRecall_Connect") && !AlphaRecall_Connect::has_consent()) {
            return false;
        }
        return self::plan_allows_chat(AlphaRecall_Client::get_instance()->get_plan_features());
    }

    private static function plan_allows_chat(array $plan): bool
    {
        return !array_key_exists("chat_available", $plan) || !empty($plan["chat_available"]);
    }

    /**
     * Map an upstream failure to what a visitor should read. The API's own
     * detail ("Free trial expired; please purchase a package.") is addressed to
     * the site owner, not to the person typing in the widget, so it is never
     * echoed. Returns [code, message].
     */
    private function stream_failure(int $status, string $detail, string $lang, int $retry_after = 0): array
    {
        $it = $lang === "it";
        if ($status === 402) {
            return [
                "plan_inactive",
                $it
                    ? "L'assistente al momento non è disponibile su questo sito."
                    : "The assistant isn't available on this site right now.",
            ];
        }
        if ($status === 429) {
            if (stripos($detail, "quota") !== false) {
                return [
                    "quota_exhausted",
                    $it
                        ? "L'assistente ha raggiunto il limite di messaggi per ora. Riprova più tardi."
                        : "The assistant has reached its message limit for now. Please try again later.",
                ];
            }
            if ($retry_after > 0) {
                return [
                    "rate_limited",
                    $it
                        ? sprintf("Stai scrivendo un po' troppo in fretta. Aspetta %s e riprova.", AlphaRecall_Rest::italian_wait($retry_after))
                        : sprintf("You're sending messages a bit too fast. Wait %d %s and try again.", $retry_after, $retry_after === 1 ? "second" : "seconds"),
                ];
            }
            return [
                "rate_limited",
                $it
                    ? "Stai scrivendo un po' troppo in fretta. Aspetta qualche secondo e riprova."
                    : "You're sending messages a bit too fast. Wait a few seconds and try again.",
            ];
        }
        if ($status === 428) {
            return [
                "pow_required",
                $it
                    ? "Serve un rapido controllo di sicurezza. Riprova tra un attimo."
                    : "We need a quick security check. Please try again in a moment.",
            ];
        }
        if ($status === 401 || $status === 403) {
            return [
                "forbidden",
                $it
                    ? "Da questa sessione non è possibile inviare messaggi. Prova a ricaricare la pagina."
                    : "Messages can't be sent from this session. Try reloading the page.",
            ];
        }
        return [
            "unavailable",
            $it
                ? "Qualcosa non ha funzionato. Riprova tra qualche istante."
                : "Something went wrong on our side. Please try again in a moment.",
        ];
    }

    private function emit_stream_failure(int $status, string $detail, string $lang, int $retry_after = 0): void
    {
        [$code, $message] = $this->stream_failure($status, $detail, $lang, $retry_after);
        // Only persist the gate when the API itself named the reason. A bare 402
        // from a proxy in between must not switch a paying site's widget off;
        // the visitor still gets the friendly message for this one request.
        if ($code === "plan_inactive" && stripos($detail, "trial") !== false) {
            AlphaRecall_Client::mark_chat_unavailable("trial_expired");
        } elseif ($code === "quota_exhausted") {
            AlphaRecall_Client::mark_chat_unavailable("quota_exhausted");
        }
        $event = ["error" => $message, "code" => $code, "status" => $status];
        if ($status === 429 && $retry_after > 0) {
            $event["retry_after"] = $retry_after;
        }
        echo "data: " . wp_json_encode($event) . "\n\n";
        @ob_flush();
        @flush();
    }

    public function chat_stream(): void
    {
        if (!$this->verify_stream_request()) {
            status_header(403);
            echo "data: " . wp_json_encode(["error" => __("Unauthorized stream request.", "alpharecall")]) . "\n\n";
            exit;
        }
        $options = AlphaRecall_Settings::get_options();
        if (!$this->rate_limit_check()) {
            // Answer the way an API 429 is answered: an SSE error event the
            // widget shows in the thread. A non-2xx would make the widget turn
            // streaming off for the session and resend through /chat at once.
            $wait = max(1, $this->retry_after);
            header("Content-Type: text/event-stream; charset=utf-8");
            header("Cache-Control: no-cache, no-store, must-revalidate");
            header("Retry-After: " . $wait);
            $this->emit_stream_failure(429, "", (string) ((($options["tenant_settings"] ?? [])["response_language"] ?? "it")), $wait);
            exit;
        }
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        $client = AlphaRecall_Client::get_instance();
        $tenant_key = $client->get_tenant_key();
        if (!$tenant_id || !$tenant_key) {
            status_header(400);
            echo esc_html(__("Website not configured.", "alpharecall"));
            exit;
        }
        // Every key and string of the visitor's body is sanitized here, then each
        // field is narrowed below before anything is forwarded.
        $payload = AlphaRecall_Sanitize::request_json(self::PUBLIC_MAX_BODY_BYTES);
        if ($payload === null) {
            status_header(413);
            echo "data: " . wp_json_encode(["error" => __("Your message is too long.", "alpharecall")]) . "\n\n";
            exit;
        }
        $visitor_token = sanitize_text_field((string) ($payload["visitor_token"] ?? ""));
        $attachment_ids = AlphaRecall_Chat_Attachments::ids($payload["attachment_ids"] ?? null);
        if (is_wp_error($attachment_ids)) {
            status_header(422);
            echo "data: " . wp_json_encode(["error" => $attachment_ids->get_error_message()]) . "\n\n";
            exit;
        }
        if ($visitor_token !== "" && !preg_match('/^[A-Za-z0-9_-]{32,128}$/', $visitor_token)) {
            status_header(400);
            echo "data: " . wp_json_encode(["error" => __("Your chat session has expired. Please reload the page.", "alpharecall")]) . "\n\n";
            exit;
        }
        if (isset($payload["tools"])) {
            $payload["tools"] = $this->normalize_requested_tools($payload["tools"]);
            if (empty($payload["tools"])) {
                unset($payload["tools"]);
            }
        }
        // Never forward the decoded body verbatim: the caller is unauthenticated and
        // every field ends up in the model context. Keep only the keys the inference
        // API understands and clamp the client-supplied history the same way the
        // backend does, so forged/unknown roles can never reach the model.
        $forwarded = [];
        $forwarded["attachment_ids"] = $attachment_ids;
        if (isset($payload["workflow"]) && is_scalar($payload["workflow"])) {
            $forwarded["workflow"] = self::normalize_public_workflow($payload["workflow"]);
        }
        if (isset($payload["input"]) && is_array($payload["input"])) {
            $forwarded["input"] = $payload["input"];
        }
        if (isset($payload["history"])) {
            $forwarded["history"] = self::sanitize_chat_history($payload["history"]);
        }
        if (!empty($payload["tools"])) {
            $forwarded["tools"] = $payload["tools"];
        }
        if (isset($payload["conversation_id"])) {
            $conversation_id = (int) $payload["conversation_id"];
            if ($conversation_id > 0) {
                $forwarded["conversation_id"] = $conversation_id;
            }
        }
        if ($visitor_token !== "") {
            $forwarded["visitor_token"] = $visitor_token;
        }
        $turn_id = self::normalize_turn_id($payload["turn_id"] ?? null);
        if ($turn_id !== "") {
            // The id the widget's Stop names in /chat/cancel.
            $forwarded["turn_id"] = $turn_id;
        }
        $payload = $forwarded;
        $api_base = $client->get_api_base();
        if (!$api_base) {
            status_header(502);
            echo esc_html(__("API base URL is not configured.", "alpharecall"));
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

        $lang = (string) ((($options["tenant_settings"] ?? [])["response_language"] ?? "it"));
        if (!$this->is_chat_available()) {
            // Plan gate already known from the cached plan: answer locally.
            $this->emit_stream_failure(402, "", $lang);
            exit;
        }

        $url = rtrim($api_base, "/") . "/inference/{$tenant_id}/invoke/stream";
        $headers = [
            "X-Tenant-Key" => $tenant_key,
            "X-AlphaRecall-Client-IP" => $this->client_ip(),
        ];
        if ($visitor_token !== "") {
            $headers["X-Visitor-Token"] = $visitor_token;
        }
        $device_id = sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_X_ALPHARECALL_DEVICE_ID"] ?? "")));
        if (preg_match('/^[a-f0-9]{32}$/', $device_id) === 1) {
            $headers["X-AlphaRecall-Device-Id"] = $device_id;
        }
        $pow = sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_X_ALPHARECALL_POW"] ?? "")));
        if (preg_match('/^[A-Za-z0-9_-]{16,64}\.[0-9]{1,20}$/', $pow) === 1) {
            $headers["X-AlphaRecall-PoW"] = $pow;
        }
        // Streamed through the WordPress HTTP API (AlphaRecall_SSE_Relay); the answer can
        // take up to 90 seconds, so allow well beyond that.
        $relayed = AlphaRecall_SSE_Relay::post($url, $headers, $payload, 300);
        if (!empty($relayed["client_gone"])) {
            // The visitor stopped or left: the relay hung up on the API, which
            // stops the answer. Nobody is left to read an error.
            exit;
        }
        $ok = $relayed["ok"];
        $status = $relayed["status"];
        $error = $relayed["error"];
        $error_body = $relayed["body"];
        $upstream_retry_after = $relayed["retry_after"];
        if (!$ok || $status >= 400) {
            $detail = '';
            $decoded = $error_body !== '' ? json_decode($error_body, true) : null;
            $decoded_detail = is_array($decoded) ? ($decoded["detail"] ?? null) : null;
            if ($ok
                && $status === 428
                && is_array($decoded_detail)
                && ($decoded_detail["error"] ?? "") === "pow_required"
                && isset($decoded_detail["challenge"])
                && is_array($decoded_detail["challenge"])) {
                [, $message] = $this->stream_failure(428, "", $lang);
                echo "data: " . wp_json_encode([
                    "error" => $message,
                    "code" => "pow_required",
                    "status" => 428,
                    "challenge" => $decoded_detail["challenge"],
                ]) . "\n\n";
                @ob_flush();
                @flush();
                exit;
            }
            if (is_array($decoded) && isset($decoded["detail"]) && is_scalar($decoded["detail"])) {
                $detail = (string) $decoded["detail"];
            }
            if (!$ok) {
                AlphaRecall_Log::error(sprintf("[alpharecall] chat stream transport failure: %s", $error));
            } else {
                AlphaRecall_Log::error(sprintf("[alpharecall] chat stream upstream %d: %s", $status, $detail));
            }
            $this->emit_stream_failure($ok ? $status : 0, $detail, $lang, $upstream_retry_after);
        }
        exit;
    }

    /**
     * Clamp a client-supplied conversation history before it is proxied to the
     * inference API. Only user/assistant turns with string content survive, so a
     * caller cannot inject "system" (or any other) role into the model context.
     * Limits mirror the backend clamp in app/agent.py::_sanitize_history().
     */
    public static function sanitize_chat_history($history): array
    {
        if (!is_array($history)) {
            return [];
        }
        $items = array_slice(array_values($history), -self::HISTORY_MAX_MESSAGES);
        $cleaned = [];
        $total_chars = 0;
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $role = isset($item["role"]) && is_scalar($item["role"])
                ? strtolower(trim((string) $item["role"]))
                : "";
            if (!in_array($role, ["user", "assistant"], true)) {
                continue;
            }
            if (!isset($item["content"]) || !is_scalar($item["content"])) {
                continue;
            }
            $content = (string) $item["content"];
            if (trim($content) === "") {
                continue;
            }
            $remaining = self::HISTORY_MAX_CHARS - $total_chars;
            if ($remaining <= 0) {
                break;
            }
            if (mb_strlen($content, "UTF-8") > $remaining) {
                $content = mb_substr($content, 0, $remaining, "UTF-8");
            }
            $cleaned[] = ["role" => $role, "content" => $content];
            $total_chars += mb_strlen($content, "UTF-8");
        }
        return $cleaned;
    }

    /** The client's id for one question (16-64 of [A-Za-z0-9_-]), or "" when it sent none or a bad one. */
    public static function normalize_turn_id($turn_id): string
    {
        if (!is_string($turn_id) || preg_match('/^[A-Za-z0-9_-]{16,64}$/', $turn_id) !== 1) {
            return "";
        }
        return $turn_id;
    }

    /**
     * What a public chat client gets of the API's reply: the fields the
     * stream's events carry to the widget (text, conversation and message ids,
     * follow-ups, source chips, the tool card) plus the hand-off, stop and
     * guard flags. The API's /invoke answer also holds usage, cost, model,
     * workflow, tool rounds, routing and raw citations (score, source_id,
     * is_byok): internals for Prova's "Cosa ha usato", never for a visitor.
     * An allowlist, so a field the API adds later stays private.
     */
    private const PUBLIC_REPLY_STRINGS = ["output", "text", "message", "tool", "status"];
    private const PUBLIC_REPLY_FLAGS = ["handoff", "ai_enabled", "cancelled", "blocked"];

    public static function public_chat_reply($result): array
    {
        if (!is_array($result)) {
            return [];
        }
        $reply = [];
        foreach (self::PUBLIC_REPLY_STRINGS as $key) {
            if (isset($result[$key]) && is_string($result[$key])) {
                $reply[$key] = $result[$key];
            }
        }
        foreach (self::PUBLIC_REPLY_FLAGS as $key) {
            if (isset($result[$key]) && is_bool($result[$key])) {
                $reply[$key] = $result[$key];
            }
        }
        foreach (["conversation_id", "message_id"] as $key) {
            if (isset($result[$key]) && (is_int($result[$key]) || (is_string($result[$key]) && ctype_digit($result[$key])))) {
                $reply[$key] = $result[$key];
            }
        }
        if (isset($result["followups"]) && is_array($result["followups"])) {
            $reply["followups"] = array_values(array_filter($result["followups"], "is_string"));
        }
        // The source chips. Never the raw `citations`: they list every chunk
        // retrieved, weak matches and internal upload://pdf/{tenant}/{id}
        // addresses included, and only Prova reads them (full reply).
        if (isset($result["sources"]) && is_array($result["sources"])) {
            $reply["sources"] = self::public_source_names($result["sources"]);
        }
        // The card the widget draws. The API already strips record tools'
        // internals from tool_output (app.tool_visibility), as on the stream.
        // A retrieval round's output is never a card: it holds the raw chunks
        // (text of private uploads, rerank_score, upload://pdf/{tenant}/{id}
        // source_url) and the stream never sends it, so neither does /chat.
        if (isset($result["tool_output"]) && is_array($result["tool_output"]) && !self::is_retrieval_output($result)) {
            $reply["tool_output"] = $result["tool_output"];
        }
        if (isset($result["components"]) && is_array($result["components"])) {
            $reply["components"] = array_values(array_filter($result["components"], "is_array"));
        }
        return $reply;
    }

    /**
     * knowledge_search / faq_search output ({results: [{text, title,
     * source_url, rerank_score}], query}). Checked by shape too: the reply's
     * `tool` names the last tool run, which can differ from the round that
     * left this tool_output when a later tool returned nothing.
     */
    private static function is_retrieval_output(array $result): bool
    {
        if (in_array($result["tool"] ?? null, ["knowledge_search", "faq_search"], true)) {
            return true;
        }
        return array_key_exists("results", $result["tool_output"]);
    }

    /**
     * Sources as the visitor sees them: a title and a link, nothing else. A
     * link only when it is http(s), as app.agent.answer_sources does: an
     * upload:// or file address names the tenant and source ids.
     */
    private static function public_source_names(array $items): array
    {
        $names = [];
        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }
            $name = [];
            if (isset($item["title"]) && is_string($item["title"])) {
                $name["title"] = $item["title"];
            }
            if (isset($item["url"]) && is_string($item["url"]) && preg_match('#^https?://#i', trim($item["url"]))) {
                $name["url"] = trim($item["url"]);
            }
            if ($name) {
                $names[] = $name;
            }
        }
        return $names;
    }

    /**
     * Prova (the admin's own test chat) shows what the answer used, so it gets
     * the whole reply. Only a logged-in plugin admin whose request says it is
     * Prova: the REST nonce alone is public (every visitor's widget has one),
     * and the header alone is something any visitor can send.
     */
    public static function wants_full_chat_reply($request): bool
    {
        $flag = is_object($request) && method_exists($request, "get_header")
            ? (string) ($request->get_header("X-AlphaRecall-Prova") ?? "")
            : "";
        return $flag === "1" && self::admin_test_allowed();
    }

    public static function normalize_public_workflow($workflow): string
    {
        $workflow = sanitize_key(is_scalar($workflow) ? (string) $workflow : "");
        return $workflow === "chat" ? $workflow : "chat";
    }

    public static function normalize_requested_tools($tools): array
    {
        if (!is_array($tools)) {
            return [];
        }
        $allowed = [
            "appointment",
            "appointment_get",
            "appointment_update",
            "appointment_delete",
            "email_lead",
            "email_lead_get",
            "email_lead_update",
            "email_lead_delete",
            "product_search",
            "escalate",
        ];
        $normalized = [];
        $had_scalar = false;
        $first_invalid = "";
        foreach ($tools as $tool) {
            if (!is_scalar($tool)) {
                continue;
            }
            $had_scalar = true;
            $tool_name = sanitize_key((string) $tool);
            if ($tool_name !== "" && in_array($tool_name, $allowed, true)) {
                $normalized[$tool_name] = true;
            } elseif ($tool_name !== "" && $first_invalid === "") {
                $first_invalid = $tool_name;
            }
        }
        if (!$normalized && $had_scalar && $first_invalid !== "") {
            // Keep one invalid value so API returns a 400 instead of broadening scope.
            return [$first_invalid];
        }
        return array_keys($normalized);
    }

    private function client_ip(): string
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

    private function verify_stream_request(): bool
    {
        $options = AlphaRecall_Settings::get_options();
        if (!self::demo_access_allowed((array) ($options["chat_config"] ?? []))) {
            return false;
        }
        $secret = (string) ($options["chat_public_token"] ?? "");
        if (!$secret) {
            return false;
        }
        // The signature is public and replayable within its TTL. Ownership and
        // identity checks must be enforced independently by the target route.
        if (!self::public_signature_is_valid(
            $secret,
            sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_X_ALPHARECALL_TIMESTAMP"] ?? ""))),
            sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_X_ALPHARECALL_SIGNATURE"] ?? "")))
        )) {
            return false;
        }
        $origin = esc_url_raw(wp_unslash((string) ($_SERVER["HTTP_ORIGIN"] ?? "")));
        // Read the actual HTTP header; wp_get_raw_referer() also accepts the
        // attacker-controlled `_wp_http_referer` request parameter.
        $referer = esc_url_raw(wp_unslash((string) ($_SERVER["HTTP_REFERER"] ?? "")));
        // A logged-out wp_rest nonce is public (uid 0) and does not prove
        // that the request came from this site. Require a browser origin
        // instead of accepting that nonce as an origin substitute.
        $fetch_site = strtolower(sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_SEC_FETCH_SITE"] ?? ""))));
        if (!$this->is_same_origin($origin) && !$this->is_same_origin($referer) && $fetch_site !== "same-origin") {
            return false;
        }
        return true;
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

    private function rate_limit_check(): bool
    {
        $ip = sanitize_text_field(wp_unslash((string) ($_SERVER["REMOTE_ADDR"] ?? "unknown")));
        $signature = sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_X_ALPHARECALL_SIGNATURE"] ?? "missing")));
        $salt = wp_salt("nonce");
        $buckets = [
            ["alpharecall_rl_ip_" . hash_hmac("sha256", "chat_stream|" . (string) $ip, $salt), 60],
            ["alpharecall_rl_sig_" . hash_hmac("sha256", "chat_stream|" . (string) $signature, $salt), 120],
        ];
        $device_id = sanitize_text_field(wp_unslash((string) ($_SERVER["HTTP_X_ALPHARECALL_DEVICE_ID"] ?? "")));
        if (preg_match('/^[a-f0-9]{32}$/', $device_id) === 1) {
            $buckets[] = ["alpharecall_rl_dev_" . hash_hmac("sha256", "chat_stream|" . $device_id, $salt), 60];
        }
        // Look at every bucket before counting in any, so a request refused
        // by one bucket does not use up the others.
        foreach ($buckets as [$key, $limit]) {
            if (!$this->rate_limit_increment($key, $limit, 60, false)) {
                return false;
            }
        }
        foreach ($buckets as [$key, $limit]) {
            if (!$this->rate_limit_increment($key, $limit, 60)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Fixed-window limiter (same rules as AlphaRecall_Rest::rate_limit_check). A refused
     * attempt is not counted, so retrying through the lockout does not extend
     * it; the wait is kept in $retry_after. $count = false only looks.
     */
    private function rate_limit_increment(string $key, int $limit, int $window, bool $count = true): bool
    {
        $read = function () use ($key, $limit, $window): ?array {
            $now = time();
            $data = get_transient($key);
            if (!is_array($data) || ($now - (int) ($data["start"] ?? 0)) > $window) {
                $data = ["count" => 0, "start" => $now];
            }
            if ((int) $data["count"] >= $limit) {
                // The window resets once more than $window seconds have passed.
                $this->retry_after = max($this->retry_after, (int) $data["start"] + $window + 1 - $now, 1);
                return null;
            }
            return $data;
        };
        if (!$count) {
            return $read() !== null;
        }
        $lock_key = "_alpharecall_rl_lock_" . md5($key);
        if (!$this->acquire_rate_limit_lock($lock_key)) {
            $this->retry_after = max($this->retry_after, 1);
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
            delete_option($lock_key);
        }
    }

    private function acquire_rate_limit_lock(string $key): bool
    {
        global $wpdb;
        $wpdb->query($wpdb->prepare(
            "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value < %s",
            $key,
            (string) time()
        ));
        return add_option($key, (string) (time() + 5), "", false);
    }
}
