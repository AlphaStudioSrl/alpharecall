<?php
/**
 * Plugin Name:       AlphaRecall
 * Plugin URI:        https://alpharecall.com/
 * Description:       Site assistant that answers from your content, takes requests and bookings, and works with your WooCommerce store (products, order status, coupons). Answers as cards, training in wp-admin. Requires an AlphaRecall account (starts with a free trial).
 * Version:           0.1.95
 * Requires at least: 6.5
 * Requires PHP:      8.1
 * Author:            ALPHA STUDIO SRLS
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       alpharecall
 *
 * @package AlphaRecall
 */

if (!defined("ABSPATH")) {
    exit;
}

define("ALPHARECALL_PLUGIN_VERSION", "0.1.95");
define("ALPHARECALL_PLUGIN_PATH", plugin_dir_path(__FILE__));
define("ALPHARECALL_PLUGIN_URL", plugin_dir_url(__FILE__));

// Platform connection defaults (API base + enrolment secret). Loaded before
// everything else so the constants exist by the time settings are first read,
// including during the activation hook.
if (file_exists(ALPHARECALL_PLUGIN_PATH . "config.php")) {
    require_once ALPHARECALL_PLUGIN_PATH . "config.php";
}

require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-sanitize.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-log.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-storage.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-client.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-branding.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-settings.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-support-role.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-woocommerce.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-rest.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-report.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-admin-ui.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-chat.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-chat-attachments.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-email-notifications.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-content-sync.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-connect.php";
require_once ALPHARECALL_PLUGIN_PATH . "includes/class-ar-sse-relay.php";

AlphaRecall_Connect::init();
// Who opens AlphaRecall: WordPress administrators, plus the Team di supporto
// while the plan includes it (Business). Registered before any menu or route.
AlphaRecall_Support_Role::register_hooks();


add_action("plugins_loaded", function () {
    AlphaRecall_Settings::get_instance();
    AlphaRecall_WooCommerce::get_instance();
    AlphaRecall_Rest::get_instance();
    AlphaRecall_Report::get_instance();
    AlphaRecall_Admin_UI::get_instance();
    AlphaRecall_Chat::get_instance();
    AlphaRecall_Email_Notifications::get_instance();
    AlphaRecall_Content_Sync::get_instance();

    // Ensure capabilities exist (runs once per version upgrade)
    $cap_version = get_option("alpharecall_cap_version", "");
    if ($cap_version !== ALPHARECALL_PLUGIN_VERSION) {
        wp_roles()->add_cap("administrator", "alpharecall_support");
        wp_roles()->add_cap("administrator", "alpharecall_admin");
        update_option("alpharecall_cap_version", ALPHARECALL_PLUGIN_VERSION, true);
        // Connections removed in 0.1.93: stop the jobs an earlier version scheduled for them.
        foreach ([
            "alpharecall_amelia_process_queue",
            "alpharecall_amelia_reverse_sync",
            "alpharecall_easy_property_listings_full_sync",
            "alpharecall_easy_property_listings_inquiry_sync",
            "alpharecall_easy_property_listings_process_queue",
            "alpharecall_estatik_full_sync",
            "alpharecall_estatik_inquiry_sync",
            "alpharecall_estatik_process_queue",
            "alpharecall_formidable_process_queue",
            "alpharecall_formidable_reverse_sync",
            "alpharecall_mailpoet_check_suppressions",
            "alpharecall_mailpoet_sync",
            "alpharecall_ninja_forms_process_queue",
            "alpharecall_ninja_forms_reverse_sync",
        ] as $retired_hook) {
            wp_unschedule_hook($retired_hook);
        }
    }
    // The "Supporto AlphaRecall" role, and moving users off the old per-WP-role setting.
    AlphaRecall_Support_Role::maybe_upgrade();
});

register_activation_hook(__FILE__, function () {
    AlphaRecall_Settings::activate();
    AlphaRecall_Report::add_rewrite_rule();
    flush_rewrite_rules(false);
    wp_roles()->add_cap("administrator", "alpharecall_support");
    wp_roles()->add_cap("administrator", "alpharecall_admin");
    AlphaRecall_Support_Role::ensure_role();
});

register_deactivation_hook(__FILE__, function () {
    AlphaRecall_WooCommerce::deactivate();
    AlphaRecall_Content_Sync::deactivate();
    $roles = wp_roles();
    foreach (array_keys($roles->roles) as $slug) {
        if ($slug === AlphaRecall_Support_Role::ROLE) {
            continue; // The role is ours and stays whole until uninstall.
        }
        $roles->remove_cap($slug, "alpharecall_support");
        $roles->remove_cap($slug, "alpharecall_admin");
    }
    // Clean up per-user capabilities. Not `alpharecall_support`: on a user it
    // is the "Supporto AlphaRecall" role itself, and the Team di supporto must
    // still be there when the plugin is turned back on (uninstall removes it).
    $all_user_ids = get_users(["fields" => "ID"]);
    foreach ($all_user_ids as $uid) {
        $u = new WP_User($uid);
        $u->remove_cap("alpharecall_admin");
    }
});

add_action("before_woocommerce_init", function () {
    $features_util = "\\Automattic\\WooCommerce\\Utilities\\FeaturesUtil";
    if (class_exists($features_util)) {
        $features_util::declare_compatibility("custom_order_tables", __FILE__, true);
    }
});
