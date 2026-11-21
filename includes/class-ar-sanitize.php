<?php
if (!defined("ABSPATH")) {
    exit;
}

/**
 * Sanitization of decoded JSON input.
 *
 * json_decode() only parses: every value it returns is still whatever the
 * client sent. Each place that reads a JSON body (the REST callbacks, the
 * admin-ajax replay of a REST call, the two streaming handlers) passes the
 * decoded value through here before using it, so no
 * callback ever sees a raw string, an unexpected type or an unbounded tree.
 * The callbacks then narrow each field to what it expects (absint,
 * sanitize_email, an allow-list, ...).
 */
final class AlphaRecall_Sanitize
{
    public const MAX_DEPTH = 12;
    public const MAX_ITEMS = 5000;
    private const MAX_KEY_LENGTH = 191;

    /**
     * A decoded JSON value with every key and every string sanitized.
     * Booleans, numbers and null pass through as they are; anything that is
     * not JSON (objects, resources) becomes null. A body deeper or wider than
     * the limits is refused before it gets here (too_large()); the same
     * limits are applied again while walking it.
     *
     * @param mixed $value
     * @return mixed
     */
    public static function json($value, int $depth = 0)
    {
        if (is_array($value)) {
            if ($depth >= self::MAX_DEPTH) {
                return [];
            }
            $clean = [];
            foreach ($value as $key => $item) {
                if (count($clean) >= self::MAX_ITEMS) {
                    break;
                }
                if (!is_int($key)) {
                    $key = self::key((string) $key);
                    if ($key === "") {
                        continue;
                    }
                }
                $clean[$key] = self::json($item, $depth + 1);
            }
            return $clean;
        }
        if (is_string($value)) {
            return self::text($value);
        }
        if (is_bool($value) || is_int($value) || is_float($value) || $value === null) {
            return $value;
        }
        return null;
    }

    /**
     * The JSON body of the current request, for the two streaming handlers:
     * they answer through admin-ajax.php, so WordPress hands them no
     * WP_REST_Request. The body is read and parsed by WordPress itself
     * (WP_REST_Server::get_raw_data(), WP_REST_Request::get_json_params()),
     * then every key and value is sanitized as in json(). Null when the body
     * is longer than $max_bytes; an empty array when it is not a JSON object.
     */
    public static function request_json(int $max_bytes): ?array
    {
        $raw = (string) WP_REST_Server::get_raw_data();
        if (strlen($raw) > $max_bytes) {
            return null;
        }
        $request = new WP_REST_Request("POST");
        $request->set_header("content-type", "application/json");
        $request->set_body($raw);
        return self::json_array($request->get_json_params());
    }

    /** The same, for a body that must be a JSON object or list. */
    public static function json_array($value): array
    {
        $clean = self::json($value);
        return is_array($clean) ? $clean : [];
    }

    /**
     * Whether a decoded body is nested deeper or holds longer lists than
     * json() walks. Such a request is answered with 413 and never reaches a
     * callback, so nothing is ever cut silently.
     *
     * @param mixed $value
     */
    public static function too_large($value, int $depth = 0): bool
    {
        if (!is_array($value)) {
            return false;
        }
        if ($depth >= self::MAX_DEPTH || count($value) > self::MAX_ITEMS) {
            return true;
        }
        foreach ($value as $item) {
            if (is_array($item) && self::too_large($item, $depth + 1)) {
                return true;
            }
        }
        return false;
    }

    /** A JSON object key: plain text, bounded. */
    public static function key(string $key): string
    {
        return mb_substr(sanitize_text_field($key), 0, self::MAX_KEY_LENGTH);
    }

    /**
     * One string of a JSON body: plain text that is stored or sent to the
     * AlphaRecall API and always printed as text, never as HTML.
     *
     * - A string that is only an http(s) address goes through esc_url_raw().
     * - A string with no "<" and no "%" goes through sanitize_textarea_field().
     * - Any other string goes through plain_text(). sanitize_textarea_field()
     *   cannot be used on those: it deletes percent-encoded characters, which
     *   breaks every link inside a sentence ("Listino%20prezzi.pdf"), and it
     *   deletes or encodes every "<", which loses "Mario <mario@example.com>"
     *   and turns "meno di < 10" into "meno di &lt; 10".
     */
    public static function text(string $value): string
    {
        // NUL and control characters (tab, line feed and carriage return stay) are never text.
        $value = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', "", $value);
        if ($value === "") {
            return "";
        }
        if (preg_match('#^https?://[A-Za-z0-9\-._~:/?\#@!$&\'()*+,;=%]+$#i', $value) === 1) {
            return esc_url_raw($value, ["http", "https"]);
        }
        if (strpbrk($value, "<%") === false) {
            return sanitize_textarea_field($value);
        }
        return self::plain_text($value);
    }

    /**
     * Plain text with markup removed and everything else kept as typed.
     *
     * Invalid UTF-8, NUL bytes and control characters go. HTML comments,
     * <script> and <style> blocks with their content, and every HTML tag
     * (a "<" followed by a letter or "/" and closed by ">") are removed, and
     * the removal repeats until nothing tag-shaped is left, so pieces cannot
     * join into a tag ("<scr<script>ipt>"). A "<" that opens no tag, an
     * address in angle brackets and percent-encoded characters stay.
     */
    public static function plain_text(string $value): string
    {
        $value = wp_kses_no_null(wp_check_invalid_utf8($value), ["slash_zero" => "keep"]);
        $value = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', "", $value);
        $value = str_replace("\r\n", "\n", $value);
        for ($pass = 0; $pass < 20; $pass++) {
            $before = $value;
            $value = (string) preg_replace('@<!--.*?(?:-->|$)@s', "", $value);
            $value = (string) preg_replace('@<(script|style)\b[^>]*>.*?(?:</\1\s*>|$)@is', "", $value);
            $value = (string) preg_replace('@</?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/][^<>]*)?>@', "", $value);
            if ($value === $before) {
                break;
            }
        }
        if (preg_match('@<(?:script|style)\b|</?[a-zA-Z][a-zA-Z0-9-]*(?:[\s/][^<>]*)?>@i', $value) === 1) {
            // Still tag-shaped after 20 passes: not text anyone typed.
            return sanitize_textarea_field($value);
        }
        return trim($value);
    }

    /**
     * The content sync queued while the site has no account yet
     * (AlphaRecall_Rest::run_ingestion()), as stored in the plugin option.
     * Only the fields the sync understands, each with its own type.
     *
     * @param mixed $value
     */
    public static function pending_ingestion($value): ?array
    {
        if (!is_array($value) || !$value) {
            return null;
        }
        $patterns = [];
        foreach ((array) ($value["exclude_patterns"] ?? []) as $pattern) {
            if (!is_string($pattern)) {
                continue;
            }
            $pattern = esc_url_raw($pattern, ["http", "https"]);
            if ($pattern !== "") {
                $patterns[] = $pattern;
            }
            if (count($patterns) >= 500) {
                break;
            }
        }
        $mode = is_scalar($value["mode"] ?? null) ? sanitize_key((string) $value["mode"]) : "";
        $site_url = esc_url_raw((string) ($value["site_url"] ?? ""), ["http", "https"]);
        return [
            "include_posts" => !empty($value["include_posts"]),
            "include_pages" => !empty($value["include_pages"]),
            "exclude_patterns" => $patterns,
            "mode" => $mode !== "" ? $mode : null,
            "replace_all" => isset($value["replace_all"]) ? (bool) $value["replace_all"] : null,
            "site_url" => $site_url,
        ];
    }

    /**
     * Opening hours as stored: a short map of day or range name to the hours
     * written as text ("mon_fri" => "8:30 - 19:30").
     *
     * @param mixed $value
     */
    public static function business_hours($value): ?array
    {
        return self::text_map($value, false);
    }

    /**
     * Social profiles as stored: a short map of platform name to the
     * profile's http(s) address.
     *
     * @param mixed $value
     */
    public static function business_social_links($value): ?array
    {
        return self::text_map($value, true);
    }

    /** @param mixed $value */
    private static function text_map($value, bool $urls): ?array
    {
        if (!is_array($value)) {
            return null;
        }
        $clean = [];
        foreach ($value as $key => $text) {
            if (!is_string($key) || !is_scalar($text)) {
                continue;
            }
            $name = sanitize_key($key);
            $text = $urls
                ? esc_url_raw(trim((string) $text), ["http", "https"])
                : sanitize_text_field((string) $text);
            if ($name === "" || $text === "") {
                continue;
            }
            $clean[$name] = mb_substr($text, 0, 500);
            if (count($clean) >= 20) {
                break;
            }
        }
        return $clean ?: null;
    }
}
