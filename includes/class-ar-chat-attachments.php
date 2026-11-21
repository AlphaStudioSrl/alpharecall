<?php
/** Private upload bridge. No WordPress media-library/public upload URLs. */
if (!defined("ABSPATH")) { exit; }

class AlphaRecall_Chat_Attachments
{
    public const MAX_BYTES = 5242880;
    /** TXT cap, the same as the API's MAX_TEXT_FILE and the widget's. */
    public const MAX_TEXT_BYTES = 262144;
    public const MAX_PIXELS = 16000000;
    private const TYPES = ["jpg" => "image/jpeg", "jpeg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", "txt" => "text/plain", "pdf" => "application/pdf"];

    public static function register(): void
    {
        foreach (["chat-attachments", "support-chat/attachments", "operator-chat-attachments"] as $path) {
            $permission = $path === "chat-attachments" ? [self::class, "public_permission"] : [self::class, "staff_permission"];
            register_rest_route("alpharecall/v1", "/{$path}", [
                "methods" => "POST", "permission_callback" => $permission, "callback" => [self::class, "proxy"],
            ]);
            register_rest_route("alpharecall/v1", "/{$path}/(?P<id>[a-f0-9-]{36})", [
                "methods" => "GET,DELETE", "permission_callback" => $permission, "callback" => [self::class, "proxy"],
            ]);
        }
    }

    public static function public_permission(WP_REST_Request $request): bool|WP_Error
    {
        $gate = AlphaRecall_Rest::get_instance()->verify_public_request($request);
        if ($gate !== true) { return $gate; }
        $token = (string) $request->get_header("X-Visitor-Token");
        return preg_match('/^[A-Za-z0-9_-]{32,128}$/D', $token) === 1
            ? true : new WP_Error("attachment_session", "Visitor identification required", ["status" => 403]);
    }

    public static function staff_permission(WP_REST_Request $request): bool|WP_Error
    {
        $nonce = (string) $request->get_header("X-WP-Nonce");
        return AlphaRecall_Rest::get_instance()->require_support() && $nonce && wp_verify_nonce($nonce, "wp_rest")
            ? true : new WP_Error("attachment_permission", "Unauthorized", ["status" => 403]);
    }

    public static function ids($value): array|WP_Error
    {
        if ($value === null) { return []; }
        if (!is_array($value) || count($value) > 3 || !array_is_list($value)) {
            return new WP_Error("attachment_ids", "Choose up to 3 attachments", ["status" => 422]);
        }
        foreach ($value as $id) {
            if (!is_string($id) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/D', $id)) {
                return new WP_Error("attachment_ids", "Invalid attachment reference", ["status" => 422]);
            }
        }
        if (count(array_unique($value)) !== count($value)) {
            return new WP_Error("attachment_ids", "Duplicate attachment reference", ["status" => 422]);
        }
        return $value;
    }

    public static function proxy(WP_REST_Request $request): WP_REST_Response
    {
        $client = AlphaRecall_Client::get_instance();
        $tenant_id = (int) (AlphaRecall_Settings::get_options()["tenant_id"] ?? 0);
        $base = $client->get_api_base();
        if (!$tenant_id || !$base || !$client->get_tenant_key()) {
            return self::response(["error" => "Website not configured"], 503);
        }
        // Read the ID only from the matched URL, never get_param()/ArrayAccess:
        // WordPress allows query/body parameters to shadow route parameters.
        if (!preg_match('#^/alpharecall/v1/(chat-attachments|support-chat/attachments|operator-chat-attachments)(?:/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}))?/?$#iD', $request->get_route(), $matched)) {
            return self::response(["error" => "Invalid attachment route"], 404);
        }
        $scope = strtolower($matched[1]);
        $id = strtolower($matched[2] ?? "");
        $method = $request->get_method();
        if (!(($method === "POST" && $id === "") || (in_array($method, ["GET", "DELETE"], true) && $id !== ""))) {
            return self::response(["error" => "Invalid attachment method"], 405);
        }
        $public = $scope === "chat-attachments";
        $support = $scope === "support-chat/attachments";
        $path = $public ? "/chat/{$tenant_id}/attachments" : ($support ? "/support/{$tenant_id}/attachments" : "/tenants/{$tenant_id}/chat-attachments");
        if ($id !== "") { $path .= "/" . $id; }
        $headers = AlphaRecall_Rest::get_instance()->chat_attachment_headers($request, $public);
        $args = ["method" => $method, "headers" => $headers, "timeout" => 45,
                 "redirection" => 0, "sslverify" => true, "limit_response_size" => 4 * 1024 * 1024];
        if ($method === "POST") {
            // Every refusal carries a stable code (and its limit): the widget and the
            // admin show their own text for it, never this English.
            if (absint(wp_unslash($_SERVER["CONTENT_LENGTH"] ?? 0)) > self::MAX_BYTES + 65536) {
                return self::refuse(413, "Attachments can be up to 5 MB", "attachment_too_large", ["limit" => self::MAX_BYTES]);
            }
            $files = $request->get_file_params();
            $upload = $files["file"] ?? null;
            if (is_array($upload) && in_array($upload["error"] ?? null, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
                // The host's upload_max_filesize is below ours: that is the real limit here.
                return self::refuse(413, "This file is too big", "attachment_too_large", ["limit" => self::host_upload_limit()]);
            }
            if (!$files && absint(wp_unslash($_SERVER["CONTENT_LENGTH"] ?? 0)) > 0 && self::host_upload_limit() < self::MAX_BYTES
                && absint(wp_unslash($_SERVER["CONTENT_LENGTH"] ?? 0)) > self::host_upload_limit()) {
                // Over post_max_size PHP drops the whole body, $_FILES included.
                return self::refuse(413, "This file is too big", "attachment_too_large", ["limit" => self::host_upload_limit()]);
            }
            if (count($files) !== 1 || !is_array($upload) || !is_string($upload["name"] ?? null)
                || !is_string($upload["tmp_name"] ?? null) || !is_string($upload["type"] ?? null)
                || ($upload["error"] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
                || !is_uploaded_file($upload["tmp_name"])) {
                return self::refuse(422, "Choose a valid file", "attachment_missing");
            }
            $filename = sanitize_file_name($upload["name"]);
            $ext = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
            $types = self::TYPES;
            if (!isset($types[$ext])) {
                return self::refuse(415, "Supported files: JPEG, PNG, WebP, TXT and PDF", "attachment_type_not_allowed", ["allowed" => array_keys($types)]);
            }
            $size = filesize($upload["tmp_name"]);
            if (!$size) {
                return self::refuse(422, "This file is empty", "attachment_empty");
            }
            if ($size > self::MAX_BYTES) {
                return self::refuse(413, "This file is too big", "attachment_too_large", ["limit" => self::MAX_BYTES]);
            }
            if ($ext === "txt" && $size > self::MAX_TEXT_BYTES) {
                return self::refuse(413, "TXT files can be up to 256 KB", "attachment_too_large", ["type" => "txt", "limit" => self::MAX_TEXT_BYTES]);
            }
            if (!class_exists("finfo")) {
                return self::refuse(503, "File type detection is unavailable on this site", "attachment_unavailable");
            }
            $actual = (new finfo(FILEINFO_MIME_TYPE))->file($upload["tmp_name"]);
            $declared = strtolower(trim(explode(";", $upload["type"])[0]));
            if ($actual !== $types[$ext] || !in_array($declared, ["", "application/octet-stream", $types[$ext]], true)) {
                return self::refuse(415, "The file type doesn't match its extension", "attachment_type_mismatch", ["type" => $ext]);
            }
            $bytes = file_get_contents($upload["tmp_name"], false, null, 0, self::MAX_BYTES + 1);
            if ($bytes === false || strlen($bytes) !== $size) {
                return self::refuse(422, "This file isn't valid", "attachment_undecodable", ["type" => $ext]);
            }
            if (($ext === "pdf" && substr($bytes, 0, 5) !== "%PDF-") || ($ext === "txt" && strpos($bytes, "\0") !== false)) {
                return self::refuse(415, "The file type doesn't match its extension", "attachment_type_mismatch", ["type" => $ext]);
            }
            if ($ext === "txt" && preg_match('//u', $bytes) !== 1) {
                return self::refuse(422, "TXT files must be UTF-8 text", "attachment_undecodable", ["type" => $ext]);
            }
            if (strpos($actual, "image/") === 0) {
                $dimensions = @getimagesize($upload["tmp_name"]);
                if (!$dimensions) {
                    return self::refuse(422, "This image can't be read", "attachment_undecodable", ["type" => $ext]);
                }
                if ($dimensions[0] * $dimensions[1] > self::MAX_PIXELS) {
                    return self::refuse(422, "Images can be up to 16 megapixels", "attachment_image_too_large", ["limit" => self::MAX_PIXELS]);
                }
            }
            $boundary = "ar-upload-" . bin2hex(random_bytes(16));
            $filename = str_replace(["\r", "\n", '"', "\\"], "_", $filename);
            $args["headers"]["Content-Type"] = "multipart/form-data; boundary={$boundary}";
            $args["body"] = "--{$boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{$filename}\"\r\n"
                . "Content-Type: {$actual}\r\n\r\n{$bytes}\r\n--{$boundary}--\r\n";
        }
        $result = wp_remote_request(rtrim($base, "/") . $path, $args);
        if (is_wp_error($result)) { return self::refuse(502, "Attachments aren't available right now. Please try again.", "attachment_unavailable"); }
        $status = wp_remote_retrieve_response_code($result);
        if ($status === 204) { return self::response(null, 204); }
        $data = json_decode(wp_remote_retrieve_body($result), true);
        return is_array($data) ? self::response($data, $status) : self::refuse(502, "Invalid attachment service response", "attachment_unavailable");
    }

    /** {"error", "code", ...params}: the API's coded body, from the bridge. */
    private static function refuse(int $status, string $message, string $code, array $params = []): WP_REST_Response
    {
        return self::response(["error" => $message, "code" => $code, ...$params], $status);
    }

    /** The smaller of our cap and this host's upload_max_filesize / post_max_size. */
    private static function host_upload_limit(): int
    {
        $limit = self::MAX_BYTES;
        if (function_exists("wp_max_upload_size")) {
            $host = (int) wp_max_upload_size();
            if ($host > 0) { $limit = min($limit, $host); }
        } else {
            foreach (["upload_max_filesize", "post_max_size"] as $key) {
                $host = self::ini_bytes((string) ini_get($key));
                if ($host > 0) { $limit = min($limit, $host); }
            }
        }
        return $limit;
    }

    private static function ini_bytes(string $value): int
    {
        $value = trim($value);
        if ($value === "" || !preg_match('/^(\d+)\s*([kmg]?)$/i', $value, $parts)) { return 0; }
        return (int) $parts[1] * (["" => 1, "k" => 1024, "m" => 1048576, "g" => 1073741824][strtolower($parts[2])]);
    }

    private static function response($data, int $status): WP_REST_Response
    {
        return new WP_REST_Response($data, $status, ["Cache-Control" => "private, no-store", "X-Content-Type-Options" => "nosniff"]);
    }
}

add_action("rest_api_init", [AlphaRecall_Chat_Attachments::class, "register"]);
