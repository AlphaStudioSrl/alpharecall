<?php
/**
 * AlphaRecall_Email_Notifications
 *
 * Sends email notifications via wp_mail() when new appointments,
 * contact submissions, or feedback are created. Uses WP-Cron to
 * poll the API every 2 minutes and compare against the last-checked
 * timestamp. Each notification type can be toggled in Settings.
 */

if (!defined("ABSPATH")) {
    exit;
}

class AlphaRecall_Email_Notifications
{
    private const CRON_HOOK = "alpharecall_check_notifications";
    private const INTERVAL_KEY = "alpharecall_2min";
    private const LAST_CHECK_OPTION = "alpharecall_notify_last_check";

    private static ?self $instance = null;

    public static function get_instance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct()
    {
        add_filter("cron_schedules", [$this, "register_interval"]);
        add_action(self::CRON_HOOK, [$this, "check_and_notify"]);
        add_action("init", [$this, "ensure_scheduled"]);

        // Clean up on deactivation
        register_deactivation_hook(ALPHARECALL_PLUGIN_PATH . "alpharecall.php", [$this, "deactivate"]);
    }

    public function register_interval(array $schedules): array
    {
        if (!isset($schedules[self::INTERVAL_KEY])) {
            $schedules[self::INTERVAL_KEY] = [
                "interval" => 120, // 2 minutes
                "display" => "Every 2 minutes (AlphaRecall)",
            ];
        }
        return $schedules;
    }

    public function ensure_scheduled(): void
    {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time(), self::INTERVAL_KEY, self::CRON_HOOK);
        }
    }

    public function deactivate(): void
    {
        wp_clear_scheduled_hook(self::CRON_HOOK);
    }

    /**
     * Main cron callback — fetch recent records and email admins about new ones.
     */
    public function check_and_notify(): void
    {
        $options = AlphaRecall_Settings::get_options();
        $tenant_id = (int) ($options["tenant_id"] ?? 0);
        if (!$tenant_id) {
            return;
        }

        $ts = $options["tenant_settings"] ?? [];
        $notify_appointments = !empty($ts["email_notify_appointments"]);
        $notify_submissions = !empty($ts["email_notify_submissions"]);
        $notify_feedback = !empty($ts["email_notify_feedback"]);

        if (!$notify_appointments && !$notify_submissions && !$notify_feedback) {
            return; // All disabled
        }

        $last_check = get_option(self::LAST_CHECK_OPTION, "");
        if (!$last_check) {
            // First run — set to now, don't flood with old records
            update_option(self::LAST_CHECK_OPTION, gmdate("Y-m-d\TH:i:s\Z"), false);
            return;
        }

        $client = AlphaRecall_Client::get_instance();
        $recipients = $this->get_recipients($ts);
        if (empty($recipients)) {
            return;
        }

        $new_count = 0;

        if ($notify_appointments) {
            $result = $client->list_appointments($tenant_id, 20, 0);
            if (!is_wp_error($result)) {
                $items = is_array($result) ? $result : ($result["items"] ?? []);
                foreach ($items as $item) {
                    $created = $item["created_at"] ?? "";
                    if ($created && $created > $last_check) {
                        $this->send_appointment_email($recipients, $item, $ts);
                        $new_count++;
                    }
                }
            }
        }

        if ($notify_submissions) {
            $result = $client->list_contact_submissions($tenant_id, ["limit" => 20]);
            if (!is_wp_error($result)) {
                $items = is_array($result) ? $result : ($result["items"] ?? []);
                foreach ($items as $item) {
                    $created = $item["created_at"] ?? "";
                    if ($created && $created > $last_check) {
                        $this->send_submission_email($recipients, $item, $ts);
                        $new_count++;
                    }
                }
            }
        }

        if ($notify_feedback) {
            $result = $client->list_feedback($tenant_id, ["limit" => 20]);
            if (!is_wp_error($result)) {
                $items = is_array($result) ? $result : ($result["items"] ?? []);
                foreach ($items as $item) {
                    $created = $item["created_at"] ?? "";
                    if ($created && $created > $last_check) {
                        $this->send_feedback_email($recipients, $item, $ts);
                        $new_count++;
                    }
                }
            }
        }

        update_option(self::LAST_CHECK_OPTION, gmdate("Y-m-d\TH:i:s\Z"), false);
    }

    private function get_recipients(array $ts): array
    {
        $override = trim($ts["notification_emails"] ?? "");
        if ($override) {
            return array_filter(array_map("trim", explode(",", $override)));
        }
        $admin_email = get_option("admin_email", "");
        return $admin_email ? [$admin_email] : [];
    }

    private function site_name(): string
    {
        return wp_specialchars_decode(get_bloginfo("name"), ENT_QUOTES);
    }

    private function send_appointment_email(array $to, array $item, array $ts): void
    {
        $user_info = $item["user_info"] ?? [];
        $name = (string) ($user_info["name"] ?? $user_info["full_name"] ?? "Visitor");
        $email = (string) ($user_info["email"] ?? "");
        $phone = (string) ($user_info["phone"] ?? "");
        $timeslot = (string) ($item["timeslot"] ?? "");
        $site = $this->site_name();

        $subject = $this->safe_subject(sprintf("[%s] New appointment: %s", $site, $name));
        $body = $this->build_html(
            "New appointment request",
            [
                "Name" => esc_html($name),
                "Email" => esc_html($email),
                "Phone" => esc_html($phone),
                "When" => esc_html($timeslot),
                "Status" => esc_html($item["status"] ?? "scheduled"),
            ],
        );

        $this->send($to, $subject, $body);
    }

    private function send_submission_email(array $to, array $item, array $ts): void
    {
        $name = (string) ($item["name"] ?? "Visitor");
        $email = (string) ($item["email"] ?? "");
        $type = sanitize_text_field((string) ($item["type"] ?? "contact"));
        $message = (string) ($item["message"] ?? "");
        $site = $this->site_name();

        $subject = $this->safe_subject(sprintf("[%s] New %s request: %s", $site, ucfirst($type), $name));
        $title = "New " . $type . " request";
        $body = $this->build_html(
            $title,
            [
                "Name" => esc_html($name),
                "Email" => esc_html($email),
                "Phone" => esc_html($item["phone"] ?? ""),
                "Type" => esc_html(ucfirst($type)),
                "Subject" => esc_html($item["subject"] ?? ""),
                "Message" => esc_html($message),
            ],
        );

        $this->send($to, $subject, $body);
    }

    private function send_feedback_email(array $to, array $item, array $ts): void
    {
        $name = (string) ($item["name"] ?? $item["email"] ?? "Anonymous");
        $rating = $item["rating"] ?? 0;
        $comment = $item["comment"] ?? "";
        $site = $this->site_name();

        $stars = str_repeat("★", (int) $rating) . str_repeat("☆", 5 - (int) $rating);
        $subject = $this->safe_subject(sprintf("[%s] New feedback: %s %s", $site, $stars, $name));
        $body = $this->build_html(
            "You have new feedback",
            [
                "From" => esc_html($name),
                "Rating" => $stars . " (" . intval($rating) . "/5)",
                "Comment" => esc_html($comment),
                "Category" => esc_html($item["category"] ?? ""),
            ],
        );

        $this->send($to, $subject, $body);
    }

    private function send(array $to, string $subject, string $html_body): void
    {
        $headers = ["Content-Type: text/html; charset=UTF-8"];
        wp_mail($to, $subject, $html_body, $headers);
    }

    /** Remove markup and header delimiters before passing untrusted text to wp_mail(). */
    private function safe_subject(string $subject): string
    {
        $subject = wp_strip_all_tags($subject);
        $subject = preg_replace('/[\r\n]+/', ' ', $subject) ?? '';
        return trim($subject);
    }

    private function build_html(string $title, array $fields): string
    {
        $rows = "";
        foreach ($fields as $label => $value) {
            if ($value === "" || $value === null) {
                continue;
            }
            $rows .= sprintf(
                '<tr><td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap;vertical-align:top;">%s</td><td style="padding:6px 12px;color:#222;">%s</td></tr>',
                esc_html($label),
                $value,
            );
        }

        $site = esc_html($this->site_name());
        $title = esc_html($title);
        $admin_url = esc_url(admin_url("admin.php?page=alpharecall-conversions&view=elenco"));

        return '<!DOCTYPE html>' . "\n"
            . '<html>' . "\n"
            . '<head><meta charset="utf-8"></head>' . "\n"
            . '<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;background:#f5f5f5;">' . "\n"
            . '<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e5e5;">' . "\n"
            . '  <div style="background:#171717;padding:16px 20px;">' . "\n"
            . '    <h2 style="margin:0;color:#fff;font-size:16px;">' . $title . '</h2>' . "\n"
            . '    <p style="margin:4px 0 0;color:#999;font-size:12px;">' . $site . '</p>' . "\n"
            . '  </div>' . "\n"
            . '  <div style="padding:16px 8px;">' . "\n"
            . '    <table style="width:100%;border-collapse:collapse;font-size:14px;">' . $rows . '</table>' . "\n"
            . '  </div>' . "\n"
            . '  <div style="padding:12px 20px;border-top:1px solid #e5e5e5;text-align:center;">' . "\n"
            . '    <a href="' . $admin_url . '" style="display:inline-block;padding:8px 20px;background:#171717;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;">Open in AlphaRecall</a>' . "\n"
            . '  </div>' . "\n"
            . '</div>' . "\n"
            . '</body>' . "\n"
            . '</html>' . "\n";
    }
}
