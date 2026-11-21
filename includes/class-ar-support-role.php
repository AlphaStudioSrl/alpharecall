<?php
/**
 * The one support role AlphaRecall adds to WordPress ("Supporto AlphaRecall")
 * and the "Team di supporto" an admin manages with it.
 *
 * The role carries `read` and the `alpharecall_support` capability and nothing
 * else: its users open Messaggi and Richieste in the dashboard and no other
 * wp-admin screen. It replaced the old setting that handed the capability to
 * whole WordPress roles (`support_roles`); maybe_upgrade() moves those users
 * onto this role once.
 *
 * Managing the team and the role is local WordPress work and is never tied to
 * the plan. What the members see in Messaggi and Richieste is data of the
 * AlphaRecall service, and the service decides that: the Team di supporto is
 * a Business plan feature (`support_team`, app/plans.py), and the API refuses
 * the dashboard calls the plugin makes for a member (X-Actor-Scope:
 * support-team, AlphaRecall_Client::tenant_headers()) on a lower plan
 * (app/security.py enforce_support_team_plan). Only WordPress administrators
 * manage AlphaRecall: the old per-user "Accesso completo" grant
 * (`alpharecall_admin`) is gone, and revoke_admin_access() takes it off
 * everyone who still has it.
 *
 * @package AlphaRecall
 */

if (!defined("ABSPATH")) {
    exit;
}

final class AlphaRecall_Support_Role
{
    public const ROLE = "alpharecall_support";
    public const CAP = "alpharecall_support";
    public const LABEL = "Supporto AlphaRecall";
    /** Bump when the role's capabilities or the migration below change. */
    public const VERSION = "2";
    public const VERSION_OPTION = "alpharecall_support_role_version";
    private const SETTINGS_OPTION = "alpharecall_settings";
    /** The capability "Accesso completo" handed to single users; now administrators only. */
    public const ADMIN_CAP = "alpharecall_admin";

    /** @return array<string, bool> */
    public static function capabilities(): array
    {
        return ["read" => true, self::CAP => true];
    }

    /** The capability filter (no plan check: see the class comment). */
    public static function register_hooks(): void
    {
        add_filter("user_has_cap", [self::class, "filter_user_caps"], 10, 4);
    }

    /** Once per role version (plugins_loaded): register the role and migrate. */
    public static function maybe_upgrade(): void
    {
        if ((string) get_option(self::VERSION_OPTION, "") === self::VERSION) {
            return;
        }
        self::ensure_role();
        self::migrate_legacy_roles();
        self::revoke_admin_access();
        update_option(self::VERSION_OPTION, self::VERSION, true);
    }

    /**
     * "Accesso completo" is gone: only WordPress administrators manage
     * AlphaRecall. Every non-administrator loses the per-user
     * `alpharecall_admin` it handed out, and every role but administrator the
     * role-level one. The `alpharecall_support` key it granted alongside is
     * this role's own key, so those people stay in the Team di supporto
     * (Messaggi and Richieste) and an administrator can remove them there. Safe to run again: nothing left to revoke.
     */
    public static function revoke_admin_access(): void
    {
        $wp_roles = wp_roles();
        foreach (array_keys((array) $wp_roles->roles) as $slug) {
            if ($slug !== "administrator" && !empty($wp_roles->roles[$slug]["capabilities"][self::ADMIN_CAP])) {
                $wp_roles->remove_cap($slug, self::ADMIN_CAP);
            }
        }
        // `capability` matches both role and per-user grants (WordPress 5.9+).
        foreach (get_users(["capability" => self::ADMIN_CAP, "fields" => "ID"]) as $user_id) {
            $user = new WP_User((int) $user_id);
            if (!$user->exists() || self::is_site_admin($user) || !array_key_exists(self::ADMIN_CAP, (array) $user->caps)) {
                continue;
            }
            $user->remove_cap(self::ADMIN_CAP);
        }
    }

    /**
     * user_has_cap: WordPress administrators keep everything, and nobody else
     * holds `alpharecall_admin` (it was the "Accesso completo" grant). The
     * role's own `alpharecall_support` is left as WordPress resolved it.
     *
     * @param array<string, bool> $allcaps
     * @param string[] $caps
     */
    public static function filter_user_caps(array $allcaps, array $caps, array $args = [], mixed $user = null): array
    {
        if (!empty($allcaps["manage_options"])) {
            return $allcaps;
        }
        if (!empty($allcaps[self::ADMIN_CAP])) {
            $allcaps[self::ADMIN_CAP] = false;
        }
        return $allcaps;
    }

    /** Create the role, or bring an existing one back to exactly its capabilities. */
    public static function ensure_role(): void
    {
        $wanted = self::capabilities();
        $role = get_role(self::ROLE);
        if (!$role) {
            add_role(self::ROLE, self::LABEL, $wanted);
            return;
        }
        foreach (array_keys((array) $role->capabilities) as $cap) {
            if (!isset($wanted[$cap])) {
                $role->remove_cap($cap);
            }
        }
        foreach ($wanted as $cap => $grant) {
            if (empty($role->capabilities[$cap])) {
                $role->add_cap($cap, $grant);
            }
        }
    }

    /**
     * Users who reached the inbox through a WordPress role (the old setting, or
     * a role that was handed the capability directly) get this role added next
     * to theirs; then only administrator and this role keep the capability and
     * the old setting is dropped. Safe to run again: nothing left to move.
     */
    public static function migrate_legacy_roles(): void
    {
        $wp_roles = wp_roles();
        $raw = get_option(self::SETTINGS_OPTION, []);
        $options = is_array($raw) ? $raw : [];
        $legacy = [];
        foreach ((array) ($options["support_roles"] ?? []) as $slug) {
            $legacy[] = sanitize_key(is_scalar($slug) ? (string) $slug : "");
        }
        foreach ((array) $wp_roles->roles as $slug => $details) {
            if (!empty($details["capabilities"][self::CAP])) {
                $legacy[] = (string) $slug;
            }
        }
        $legacy = array_values(array_unique(array_filter($legacy, static function (string $slug) use ($wp_roles): bool {
            return $slug !== "" && $slug !== "administrator" && $slug !== self::ROLE && isset($wp_roles->roles[$slug]);
        })));

        if ($legacy) {
            foreach (get_users(["role__in" => $legacy, "fields" => "ID"]) as $user_id) {
                $user = new WP_User((int) $user_id);
                if (!$user->exists() || in_array(self::ROLE, (array) $user->roles, true)) {
                    continue;
                }
                $user->add_role(self::ROLE);
            }
        }

        foreach (array_keys((array) $wp_roles->roles) as $slug) {
            if ($slug !== "administrator" && $slug !== self::ROLE) {
                $wp_roles->remove_cap($slug, self::CAP);
            }
        }

        if (array_key_exists("support_roles", $options)) {
            unset($options["support_roles"]);
            update_option(self::SETTINGS_OPTION, $options);
        }
    }

    /** Uninstall: the role goes; its users keep their other roles. */
    public static function remove_role(): void
    {
        remove_role(self::ROLE);
        delete_option(self::VERSION_OPTION);
    }

    /* ------------------------------------------------------------------ */
    /*  Team di supporto                                                   */
    /* ------------------------------------------------------------------ */

    /** WordPress administrators already see everything; they never need or lose this role. */
    public static function is_site_admin(WP_User $user): bool
    {
        return $user->has_cap("manage_options") || in_array("administrator", (array) $user->roles, true);
    }

    /** User meta holding the name an admin typed when creating the account here. */
    public const PUBLIC_NAME_META = "alpharecall_public_name";

    /**
     * The name a visitor may see for this person: the display name, then the
     * name typed when the account was created in Team di supporto (kept as
     * typed), then first + last name, then the nickname. Any other candidate
     * that is exactly the login, the e-mail or the e-mail's local part is
     * skipped, because WordPress fills empty names with the login verbatim. The comparison is
     * case-sensitive: "Marco" for the login "marco" is a name someone chose.
     * Anything with "@" is skipped too. "" when there is nothing better.
     *
     * @param WP_User $user
     */
    public static function public_name(object $user): string
    {
        $login = (string) ($user->user_login ?? "");
        $email = (string) ($user->user_email ?? "");
        $local = (string) strstr($email, "@", true);
        $private = static function (string $name) use ($login, $email, $local): bool {
            return $name === "" || $name === $login || $name === $email || ($local !== "" && $name === $local) || str_contains($name, "@");
        };
        $id = (int) ($user->ID ?? 0);
        // [name, chosen]: the name typed at invite was chosen for the chat, so
        // it is public even when it equals the login.
        $candidates = [
            [(string) ($user->display_name ?? ""), false],
            [$id > 0 ? (string) get_user_meta($id, self::PUBLIC_NAME_META, true) : "", true],
            [trim((string) ($user->first_name ?? "") . " " . (string) ($user->last_name ?? "")), false],
            [(string) ($user->nickname ?? ""), false],
        ];
        foreach ($candidates as [$candidate, $chosen]) {
            $candidate = trim(wp_strip_all_tags($candidate));
            if ($chosen ? ($candidate !== "" && !str_contains($candidate, "@")) : !$private($candidate)) {
                return mb_substr($candidate, 0, 100);
            }
        }
        return "";
    }

    public static function payload(WP_User $user): array
    {
        $wp_roles = wp_roles();
        $other_roles = [];
        foreach ((array) $user->roles as $slug) {
            if ($slug !== self::ROLE && isset($wp_roles->roles[$slug])) {
                $other_roles[] = translate_user_role($wp_roles->roles[$slug]["name"]);
            }
        }
        return [
            "id" => (int) $user->ID,
            "name" => (string) ($user->display_name ?: $user->user_login),
            "email" => (string) $user->user_email,
            "avatar_url" => (string) get_avatar_url($user->ID, ["size" => 64]),
            "other_roles" => $other_roles,
            "is_site_admin" => self::is_site_admin($user),
            "is_self" => (int) $user->ID === get_current_user_id(),
        ];
    }

    /** People holding the role on this site, A-Z. */
    public static function members(): array
    {
        $users = get_users(["role" => self::ROLE, "orderby" => "display_name", "order" => "ASC"]);
        return array_values(array_map([self::class, "payload"], $users));
    }

    /**
     * Existing accounts an admin can add, matched on name, login or e-mail.
     * Holders of the role and site administrators are left out.
     */
    public static function search(string $term): array
    {
        $term = trim($term);
        if (mb_strlen($term) < 2) {
            return [];
        }
        $users = get_users([
            "search" => "*" . $term . "*",
            "search_columns" => ["user_login", "user_email", "user_nicename", "display_name"],
            "role__not_in" => [self::ROLE],
            "orderby" => "display_name",
            "order" => "ASC",
            "number" => 25,
        ]);
        $found = [];
        foreach ($users as $user) {
            if ($user instanceof WP_User && !self::is_site_admin($user)) {
                $found[] = self::payload($user);
            }
            if (count($found) >= 10) {
                break;
            }
        }
        return $found;
    }

    /** @return array|WP_Error the member, or why the account cannot be added */
    public static function add(int $user_id): array|WP_Error
    {
        $user = $user_id > 0 ? get_userdata($user_id) : false;
        if (!$user instanceof WP_User || (is_multisite() && !is_user_member_of_blog($user_id))) {
            return new WP_Error("not_found", "User not found.", ["status" => 404]);
        }
        if (self::is_site_admin($user)) {
            return new WP_Error("site_admin", "Administrators already have full access.", ["status" => 409]);
        }
        if (!in_array(self::ROLE, (array) $user->roles, true)) {
            $user->add_role(self::ROLE);
        }
        return self::payload($user);
    }

    /**
     * A new account with this role only. WordPress e-mails the person the
     * standard link to choose a password.
     *
     * @return array|WP_Error
     */
    public static function invite(string $email, string $name = ""): array|WP_Error
    {
        $email = sanitize_email($email);
        if (!$email || !is_email($email)) {
            return new WP_Error("invalid_email", "Invalid e-mail address.", ["status" => 422]);
        }
        $existing = email_exists($email);
        if ($existing) {
            return new WP_Error("email_exists", "An account with this e-mail already exists.", ["status" => 409, "user_id" => (int) $existing]);
        }
        if (is_multisite() && !current_user_can("create_users")) {
            return new WP_Error("forbidden", "You cannot create accounts on this network.", ["status" => 403]);
        }
        $base = sanitize_user((string) strstr($email, "@", true), true) ?: "supporto";
        $login = $base;
        for ($i = 2; username_exists($login); $i++) {
            $login = $base . $i;
        }
        $name = sanitize_text_field($name);
        $user_id = wp_insert_user([
            "user_login" => $login,
            "user_email" => $email,
            "user_pass" => wp_generate_password(24, true, true),
            "display_name" => $name !== "" ? $name : $login,
            "first_name" => $name,
            "nickname" => $name !== "" ? $name : $login,
            "role" => self::ROLE,
        ]);
        if (is_wp_error($user_id)) {
            return new WP_Error("create_failed", $user_id->get_error_message(), ["status" => 422]);
        }
        // The admin typed this name for the chat; keep it even when it equals
        // the login built from the e-mail ("marco" for marco@...).
        if ($name !== "" && !str_contains($name, "@")) {
            update_user_meta((int) $user_id, self::PUBLIC_NAME_META, $name);
        }
        wp_new_user_notification((int) $user_id, null, "user");
        $user = get_userdata((int) $user_id);
        return $user instanceof WP_User ? self::payload($user) : ["id" => (int) $user_id, "email" => $email];
    }

    /** @return true|WP_Error */
    public static function remove(int $user_id): bool|WP_Error
    {
        if ($user_id === get_current_user_id()) {
            return new WP_Error("self", "You cannot remove yourself.", ["status" => 409]);
        }
        $user = $user_id > 0 ? get_userdata($user_id) : false;
        if (!$user instanceof WP_User) {
            return new WP_Error("not_found", "User not found.", ["status" => 404]);
        }
        if (self::is_site_admin($user)) {
            return new WP_Error("site_admin", "Administrators keep their access.", ["status" => 409]);
        }
        if (in_array(self::ROLE, (array) $user->roles, true)) {
            $user->remove_role(self::ROLE);
        }
        return true;
    }
}
