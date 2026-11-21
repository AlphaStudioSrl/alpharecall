<?php
/**
 * Platform connection defaults.
 *
 * The values below are empty in the repository and are filled in at release
 * time by scripts/ci/build-plugin-zip.sh. The zip released to clients
 * (.forgejo/workflows/plugin-release.yml) carries the platform enrolment
 * secret, kept out of version control, so it connects with no manual
 * configuration. The WordPress.org build (wporg-release.yml) is public and
 * never carries the secret: only the API base and the map archive URL are
 * filled in, and the site connects after an administrator agrees on the
 * connection screen (includes/class-ar-connect.php).
 *
 * Precedence, highest first:
 *   1. a constant defined in wp-config.php  (per-site override, e.g. staging)
 *   2. the baked values in this file        (what ships to clients)
 *   3. an ALPHARECALL_* environment variable
 *   4. the value stored in the settings option
 *
 * Empty values are never defined as constants, because defining a constant to
 * "" would shadow the environment-variable fallback in AlphaRecall_Settings::env_setting().
 */

if (!defined("ABSPATH")) {
    exit;
}

$alpharecall_platform_defaults = [
    "ALPHARECALL_API_BASE" => "https://api.alpharecall.com",
    "ALPHARECALL_AUTO_CREATE_SECRET" => "",
    // Self-hosted Protomaps archive the widget maps draw from (an https URL
    // ending in .pmtiles, served with Range requests and CORS for the sites).
    "ALPHARECALL_MAP_PMTILES_URL" => "",
];

foreach ($alpharecall_platform_defaults as $alpharecall_key => $alpharecall_value) {
    if ($alpharecall_value !== "" && !defined($alpharecall_key)) {
        define($alpharecall_key, $alpharecall_value); // phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.VariableConstantNameFound -- every key above is ALPHARECALL_*.
    }
}

unset($alpharecall_platform_defaults, $alpharecall_key, $alpharecall_value);
