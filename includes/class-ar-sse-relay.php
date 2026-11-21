<?php
/**
 * Relay a Server-Sent Events response from the AlphaRecall API to the browser
 * as it arrives, through the WordPress HTTP API.
 *
 * wp_remote_post() buffers the whole body, but its transports report every
 * chunk they receive through the Requests "request.progress" hook, which
 * WordPress exposes as the action "requests-request.progress". Listening to
 * that action while the request runs lets the plugin forward each complete
 * SSE line immediately, with no cURL calls of its own.
 *
 * Only lines that are SSE fields (data:, event:, id:, retry:, comments and
 * blank separators) are forwarded. An error response from the API is JSON,
 * none of its lines match, so nothing of it reaches the browser and the
 * caller maps the final status instead.
 *
 * When the browser goes away (the visitor pressed Stop, closed the tab) the
 * relay hangs up on the API, which then stops the answer (app.turn_cancel).
 * PHP only learns the client is gone when a write to it fails, and the API
 * is silent while the assistant works, so every second without output the
 * relay writes an SSE comment (": keepalive", ignored by EventSource and the
 * widget) and checks connection_aborted() from cURL's progress callback.
 *
 * @package AlphaRecall
 */

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_SSE_Relay
{
    private const SSE_LINE = '/^(?:(?:data|event|id|retry)(?::|$)|:)/';
    // Longest partial line kept between chunks (one SSE data line carries one event).
    private const MAX_LINE_BYTES = 1048576;

    // Seconds without output before the relay probes the browser with a comment.
    private const PROBE_SECONDS = 1.0;

    /** Bytes received but not yet forwarded (an incomplete last line). */
    private string $pending = "";

    /** The output so far ends an SSE event, so a comment line can go in between. */
    private bool $at_boundary = true;

    /** Last characters written (carriage returns dropped), to find the event boundary. */
    private string $tail = "\n\n";

    private float $last_output = 0.0;

    /** The browser hung up; the transfer was aborted. */
    public bool $client_gone = false;

    /** @var callable(): bool Whether the browser hung up (connection_aborted(); tests swap it). */
    public static $client_aborted = null;

    /**
     * POST $body as JSON to $url and forward the SSE stream as it arrives.
     *
     * @param string                $url     Streaming endpoint of the AlphaRecall API.
     * @param array<string, string> $headers Request headers (name => value).
     * @param array                 $body    JSON body.
     * @param int                   $timeout Seconds before the request is abandoned.
     * @return array{ok: bool, status: int, body: string, retry_after: int, error: string}
     */
    public static function post(string $url, array $headers, array $body, int $timeout = 300): array
    {
        $relay = new self();
        $relay->last_output = microtime(true);
        $listener = [$relay, "on_chunk"];
        $curl = [$relay, "watch_client"];
        add_action("requests-request.progress", $listener, 10, 1);
        add_action("http_api_curl", $curl, 10, 1);
        try {
            $response = wp_remote_post($url, [
                "timeout" => $timeout,
                "redirection" => 0,
                // Uncompressed, so every chunk is text that can be forwarded as is.
                "decompress" => false,
                "headers" => array_merge($headers, [
                    "Content-Type" => "application/json",
                    "Accept" => "text/event-stream",
                    "Accept-Encoding" => "identity",
                ]),
                "body" => wp_json_encode($body),
            ]);
        } finally {
            remove_action("requests-request.progress", $listener, 10);
            remove_action("http_api_curl", $curl, 10);
        }
        if ($relay->client_gone) {
            return ["ok" => false, "status" => 0, "body" => "", "retry_after" => 0, "error" => "client gone", "client_gone" => true];
        }
        if (is_wp_error($response)) {
            return ["ok" => false, "status" => 0, "body" => "", "retry_after" => 0, "error" => $response->get_error_message(), "client_gone" => false];
        }
        $status = (int) wp_remote_retrieve_response_code($response);
        if ($status < 400) {
            $relay->flush_pending();
        }
        return [
            "ok" => true,
            "status" => $status,
            "body" => $status >= 400 ? substr((string) wp_remote_retrieve_body($response), 0, 8192) : "",
            "retry_after" => AlphaRecall_Client::parse_retry_after(wp_remote_retrieve_header($response, "retry-after")),
            "error" => "",
            "client_gone" => false,
        ];
    }

    /** "http_api_curl" listener: have cURL report progress, so the relay can hang up. */
    public function watch_client($handle): void
    {
        if (!(is_resource($handle) || $handle instanceof CurlHandle)) {
            return;
        }
        // The request itself is made by wp_remote_post(); "http_api_curl" is the
        // WordPress HTTP API's hook for adjusting its cURL transport, and these two
        // options only let the relay notice a closed browser and hang up.
        curl_setopt($handle, CURLOPT_NOPROGRESS, false); // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_setopt -- option on the HTTP API's own handle (http_api_curl).
        // XFERINFOFUNCTION is PHP 8.2+; the older option takes the same callback.
        curl_setopt($handle, defined("CURLOPT_XFERINFOFUNCTION") ? CURLOPT_XFERINFOFUNCTION : CURLOPT_PROGRESSFUNCTION, [$this, "on_progress"]); // phpcs:ignore WordPress.WP.AlternativeFunctions.curl_curl_setopt -- as above.
    }

    /**
     * cURL progress callback (about once a second while the API is silent, and
     * on every chunk): a non-zero return aborts the transfer, which closes the
     * connection to the API.
     */
    public function on_progress($handle = null, $download_total = 0, $downloaded = 0, $upload_total = 0, $uploaded = 0): int
    {
        if ($this->client_gone) {
            return 1;
        }
        if ($this->at_boundary && microtime(true) - $this->last_output >= self::PROBE_SECONDS) {
            // A write is the only way PHP notices the browser left.
            $this->write(": keepalive\n\n");
        }
        $aborted = self::$client_aborted ?? "connection_aborted";
        if ((bool) $aborted()) {
            $this->client_gone = true;
            return 1;
        }
        return 0;
    }

    /** "requests-request.progress" listener: forward the complete SSE lines of this chunk. */
    public function on_chunk($data): void
    {
        if (!is_string($data) || $data === "") {
            return;
        }
        $this->pending .= $data;
        $last_newline = strrpos($this->pending, "\n");
        if ($last_newline === false) {
            if (strlen($this->pending) > self::MAX_LINE_BYTES) {
                // No SSE line is this long; drop it rather than buffer without bound.
                $this->pending = "";
            }
            return;
        }
        $complete = substr($this->pending, 0, $last_newline + 1);
        $this->pending = substr($this->pending, $last_newline + 1);
        $this->emit($complete);
    }

    private function flush_pending(): void
    {
        if ($this->pending !== "") {
            $this->emit($this->pending . "\n");
            $this->pending = "";
        }
    }

    /**
     * Write the SSE lines of $text (which ends with "\n") to the open
     * text/event-stream response and flush. Blank lines are kept: they end an event.
     */
    private function emit(string $text): void
    {
        $lines = explode("\n", $text);
        array_pop($lines); // The empty piece after the final "\n".
        $safe = "";
        foreach ($lines as $line) {
            $raw = rtrim($line, "\r");
            if ($raw === "" || preg_match(self::SSE_LINE, $raw) === 1) {
                $safe .= $line . "\n";
            }
        }
        if ($safe === "") {
            return;
        }
        $this->write($safe);
        $this->tail = substr($this->tail . str_replace("\r", "", $safe), -2);
        $this->at_boundary = $this->tail === "\n\n";
    }

    private function write(string $safe): void
    {
        // text/event-stream relay of the API's own SSE fields, not HTML: escaping
        // would corrupt the JSON payloads the widget parses.
        echo $safe; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
        if (ob_get_level() > 0) {
            @ob_flush(); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a notice here would land in the event stream.
        }
        flush();
        $this->last_output = microtime(true);
    }
}
