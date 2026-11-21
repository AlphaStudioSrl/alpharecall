<?php
/**
 * Remove everything AlphaRecall stored in this WordPress install when the
 * plugin is deleted from the Plugins screen.
 *
 * Only local data is removed: settings, queues, caches, scheduled events, user
 * preferences and capabilities. Conversations, contacts and the account kept
 * by the AlphaRecall service are deleted from the AlphaRecall dashboard or on
 * request (see readme.txt, "Where is my data and how do I delete it?").
 *
 * @package AlphaRecall
 */

if (!defined("WP_UNINSTALL_PLUGIN")) {
    exit;
}

/**
 * Delete this site's AlphaRecall data.
 */
function alpharecall_uninstall_site(): void
{
    global $wpdb;

    $hooks = [
        "alpharecall_amelia_process_queue",
        "alpharecall_amelia_reverse_sync",
        "alpharecall_check_notifications",
        "alpharecall_content_changed_sync",
        "alpharecall_easy_property_listings_full_sync",
        "alpharecall_easy_property_listings_inquiry_sync",
        "alpharecall_easy_property_listings_process_queue",
        "alpharecall_estatik_full_sync",
        "alpharecall_estatik_inquiry_sync",
        "alpharecall_estatik_process_queue",
        "alpharecall_formidable_process_queue",
        "alpharecall_formidable_reverse_sync",
        "alpharecall_log_analytics",
        "alpharecall_mailpoet_check_suppressions",
        "alpharecall_mailpoet_sync",
        "alpharecall_ninja_forms_process_queue",
        "alpharecall_ninja_forms_reverse_sync",
        "alpharecall_woocommerce_deferred_event",
        "alpharecall_woocommerce_process_queue",
    ];
    foreach ($hooks as $hook) {
        // Unlike wp_clear_scheduled_hook(), also removes events queued with arguments.
        wp_unschedule_hook($hook);
    }
    if (function_exists("as_unschedule_all_actions")) {
        as_unschedule_all_actions("", [], "alpharecall-woocommerce");
    }

    // Options, locks and transients all share the plugin's prefixes. A LIKE
    // delete is the only way to reach the per-tenant and per-user keys.
    // The `ar_` / `_ar_` keys are the names used before 0.1.86, still on
    // sites that upgraded (locks and rate limits expire within minutes).
    $patterns = [
        "alpharecall\\_%",
        "\\_alpharecall\\_%",
        "\\_ar\\_assign\\_lock\\_%",
        "\\_ar\\_profile\\_create\\_%",
        "\\_transient\\_alpharecall\\_%",
        "\\_transient\\_timeout\\_alpharecall\\_%",
        "\\_transient\\_ar\\_actor\\_perms\\_%",
        "\\_transient\\_timeout\\_ar\\_actor\\_perms\\_%",
        "\\_transient\\_ar\\_coupon\\_rl\\_%",
        "\\_transient\\_timeout\\_ar\\_coupon\\_rl\\_%",
        "\\_transient\\_ar\\_woo\\_%",
        "\\_transient\\_timeout\\_ar\\_woo\\_%",
    ];
    foreach ($patterns as $pattern) {
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- one-off cleanup on uninstall.
        $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", $pattern));
    }

    // The "Supporto AlphaRecall" role (AlphaRecall_Support_Role); its users keep their other roles.
    remove_role("alpharecall_support");
    foreach (array_keys(wp_roles()->roles) as $role) {
        wp_roles()->remove_cap($role, "alpharecall_support");
        wp_roles()->remove_cap($role, "alpharecall_admin");
    }
    // The rows above were deleted behind the options API: drop its cached copies.
    wp_cache_delete("alloptions", "options");
    wp_cache_delete("notoptions", "options");
}

if (is_multisite()) {
    foreach (get_sites(["fields" => "ids", "number" => 0]) as $alpharecall_site_id) {
        switch_to_blog((int) $alpharecall_site_id);
        alpharecall_uninstall_site();
        restore_current_blog();
    }
} else {
    alpharecall_uninstall_site();
}

// User meta is shared by every site of a network.
delete_metadata("user", 0, "alpharecall_support_profile_id", "", true);
delete_metadata("user", 0, "alpharecall_public_name", "", true);
delete_metadata("user", 0, "alpharecall_theme", "", true);
delete_metadata("user", 0, "ar_theme", "", true); // before 0.1.86
global $wpdb;
foreach (["alpharecall\\_notification\\_preferences\\_%", "ar\\_notification\\_preferences\\_%"] as $alpharecall_meta_pattern) {
    // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- per-site/per-tenant keys, one-off cleanup on uninstall.
    $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->usermeta} WHERE meta_key LIKE %s", $alpharecall_meta_pattern));
}
// Per-user capabilities granted from the Team page.
foreach (get_users(["fields" => "ID", "blog_id" => 0]) as $alpharecall_user_id) {
    $alpharecall_user = new WP_User((int) $alpharecall_user_id);
    $alpharecall_user->remove_cap("alpharecall_admin");
    $alpharecall_user->remove_cap("alpharecall_support");
}
