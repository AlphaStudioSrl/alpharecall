<?php
if (!defined("ABSPATH")) {
    exit;
}

/**
 * Diagnostic messages for the site's debug log. Nothing is written unless the
 * site owner has turned WordPress debugging on (WP_DEBUG), and a message never
 * carries visitor data: a status, a route, an error text of the HTTP API.
 */
final class AlphaRecall_Log
{
    public static function error(string $message): void
    {
        if (!defined("WP_DEBUG") || !WP_DEBUG) {
            return;
        }
        // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- only with WP_DEBUG on, for the owner's own debug log.
        error_log($message);
    }
}
