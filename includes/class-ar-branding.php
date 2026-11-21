<?php

if (!defined("ABSPATH")) {
    exit;
}

/**
 * Extracts branding signals (colors, logo, name) from the WordPress site
 * and returns them for auto-applying to chat widget styling.
 *
 * All methods are static — no hooks, no state, no side-effects.
 */
class AlphaRecall_Branding
{
    /** Theme mod keys commonly used by popular themes for primary/accent color. */
    private const COLOR_THEME_MOD_KEYS = [
        "accent_color",
        "primary_color",
        "link_color",
        "header_background_color",
        // Astra
        "astra-settings",
        // GeneratePress
        "generate_settings",
        // OceanWP
        "ocean_primary_color",
        "ocean_accent_color",
    ];

    /**
     * Extract branding signals from the current WordPress site.
     *
     * neutral_color is true when the only color found was a black, grey or
     * white one (the WordPress core default button #32373c, Twenty
     * Twenty-Five's black button): that is the theme's default, not the
     * site's brand, so primary_color stays empty and nothing recolors the
     * widget. alpharecall.com, whose buttons are teal, came back as #32373c
     * and "Riprendi dal sito" painted the widget grey (card akq1m7oqwc05).
     *
     * @return array{business_name: string, logo_url: string, primary_color: string, accent_color: string, source: string, neutral_color: bool, extracted_at: int}
     */
    public static function extract(): array
    {
        $result = [
            "business_name" => self::extract_business_name(),
            "logo_url"      => self::extract_logo_url(),
            "primary_color" => "",
            "accent_color"  => "",
            "source"        => "none",
            "neutral_color" => false,
            "extracted_at"  => time(),
        ];

        $color = self::extract_primary_color();
        if ($color && !empty($color["neutral"])) {
            $result["neutral_color"] = true;
        } elseif ($color) {
            $result["primary_color"] = $color["color"];
            $result["source"] = $color["source"];
            // The Send button takes the site color too. It used to get a hue
            // shifted 30 degrees, which turned a blue site's Send button violet
            // and an orange one's yellow (card akq1m7oqwc05).
            $result["accent_color"] = $color["color"];
        }

        return $result;
    }

    /* ─── Business Name ─── */

    private static function extract_business_name(): string
    {
        return sanitize_text_field(get_bloginfo("name") ?: "");
    }

    /* ─── Logo URL ─── */

    private static function extract_logo_url(): string
    {
        // 1. Custom logo (Customizer → Site Identity → Logo)
        $custom_logo_id = (int) get_theme_mod("custom_logo", 0);
        if ($custom_logo_id) {
            $img = wp_get_attachment_image_src($custom_logo_id, "full");
            if ($img && !empty($img[0])) {
                return esc_url($img[0]);
            }
        }

        // 2. Site icon (favicon, available at various sizes)
        $site_icon_url = get_site_icon_url(512);
        if ($site_icon_url) {
            return esc_url($site_icon_url);
        }

        return "";
    }

    /* ─── Primary Color (priority chain) ─── */

    /**
     * @return array{color: string, source: string, neutral?: true}|null
     */
    private static function extract_primary_color(): ?array
    {
        // 1. Theme mods
        $color = self::extract_from_theme_mods();
        if ($color) {
            return $color;
        }

        // 2. Block theme (theme.json) global settings
        $theme_json = self::extract_from_theme_json();
        if ($theme_json && empty($theme_json["fallback"])) {
            return $theme_json;
        }

        // 3. Custom CSS (Customizer > CSS aggiuntivo)
        $palette = self::theme_palette_colors();
        $css = function_exists("wp_get_custom_css") ? (string) wp_get_custom_css() : "";
        $color = $css !== "" ? self::pick_from_css($css, null, $palette) : null;
        if ($color) {
            return ["color" => $color["color"], "source" => "theme_additional_css"];
        }

        // 4. The front page: its theme-color meta, then the background of the
        // buttons it really shows and the brand custom properties, read from
        // its inline styles and the theme's own stylesheets.
        $color = self::extract_from_homepage($palette);
        if ($color) {
            return $color;
        }

        // 5. Only a black or grey button: no brand color (flagged neutral).
        if ($theme_json) {
            return ["color" => $theme_json["color"], "source" => $theme_json["source"], "neutral" => true];
        }

        return null;
    }

    /* ─── Source 1: Theme Mods ─── */

    /**
     * @return array{color: string, source: string}|null
     */
    private static function extract_from_theme_mods(): ?array
    {
        foreach (self::COLOR_THEME_MOD_KEYS as $key) {
            $value = get_theme_mod($key);
            if (!$value) {
                continue;
            }

            // Some themes store nested arrays (Astra, GeneratePress)
            if (is_array($value)) {
                // Astra stores colors in nested arrays
                $candidates = [];
                if (isset($value["theme-color"])) {
                    $candidates[] = $value["theme-color"];
                }
                if (isset($value["link-color"])) {
                    $candidates[] = $value["link-color"];
                }
                // GeneratePress global_colors array
                if (isset($value[0]["color"])) {
                    $candidates[] = $value[0]["color"];
                }
                foreach ($candidates as $c) {
                    $hex = self::normalize_hex($c);
                    if ($hex && !self::is_neutral($hex)) {
                        return ["color" => $hex, "source" => "theme_mod:{$key}"];
                    }
                }
                continue;
            }

            $hex = self::normalize_hex((string) $value);
            if ($hex && !self::is_neutral($hex)) {
                return ["color" => $hex, "source" => "theme_mod:{$key}"];
            }
        }

        return null;
    }

    /* ─── Source 2: Block Theme (theme.json) ─── */

    /** Palette slugs that name the brand color outright. */
    private const BRAND_SLUGS = ["primary", "accent", "brand", "theme", "link", "secondary"];

    /**
     * @return array{color: string, source: string}|null
     */
    private static function extract_from_theme_json(): ?array
    {
        if (!function_exists("wp_get_global_settings")) {
            return null;
        }
        $styles = function_exists("wp_get_global_styles") ? wp_get_global_styles() : [];
        return self::pick_from_global_styles((array) wp_get_global_settings(), (array) $styles);
    }

    /**
     * The brand color of a block theme, from its merged settings and styles.
     *
     * Block themes rarely call a palette entry "primary": Twenty Twenty-Five
     * names them base, contrast and accent-1 to accent-6, so the old lookup of
     * semantic slugs found nothing and "Riprendi dal sito" changed no color
     * (card akq1m7oqwc05). In order: a palette entry named for the brand, the
     * color the theme paints its buttons with, the link color, a color the
     * owner added to the palette, then a black or grey button (flagged
     * "fallback": custom CSS and the homepage get their turn before it), and
     * last the theme's own accent entries dark enough to carry white text.
     * Twenty Twenty-Five's stock accents (a violet among them) are defaults
     * of the theme, not the owner's brand, so they never beat its black buttons.
     *
     * @return array{color: string, source: string, fallback?: true}|null
     */
    public static function pick_from_global_styles(array $settings, array $styles): ?array
    {
        $palette = self::merged_palette($settings);

        foreach (self::BRAND_SLUGS as $slug) {
            $hex = self::normalize_hex((string) ($palette[$slug] ?? ""));
            if ($hex && !self::is_neutral($hex)) {
                return ["color" => $hex, "source" => "theme_json:palette:{$slug}"];
            }
        }
        // "primary-500", "brand-green", "color-primary": an entry whose slug
        // names the brand. Numbered stock accents (accent-1..6) do not.
        foreach ($palette as $slug => $value) {
            if (!preg_match('/(?:^|-)(?:primary|brand)(?:-|$)/', (string) $slug)) {
                continue;
            }
            $hex = self::normalize_hex((string) $value);
            if ($hex && !self::is_neutral($hex) && !self::is_light($hex)) {
                return ["color" => $hex, "source" => "theme_json:palette:{$slug}"];
            }
        }

        $button = self::resolve_style_color($styles["elements"]["button"]["color"]["background"] ?? "", $palette);
        if ($button && !self::is_light($button) && !self::is_neutral($button)) {
            return ["color" => $button, "source" => "theme_json:button"];
        }

        $link = self::resolve_style_color($styles["elements"]["link"]["color"]["text"] ?? "", $palette);
        if ($link && !self::is_neutral($link)) {
            return ["color" => $link, "source" => "theme_json:link_color"];
        }

        foreach ((array) ($settings["color"]["palette"]["custom"] ?? []) as $entry) {
            $hex = is_array($entry) ? self::normalize_hex((string) ($entry["color"] ?? "")) : null;
            if ($hex && !self::is_neutral($hex) && !self::is_light($hex)) {
                return ["color" => $hex, "source" => "theme_json:palette:custom"];
            }
        }

        if ($button && !self::is_light($button)) {
            return ["color" => $button, "source" => "theme_json:button", "fallback" => true];
        }

        foreach ($palette as $slug => $value) {
            if (strpos((string) $slug, "accent") !== 0) {
                continue;
            }
            $hex = self::normalize_hex((string) $value);
            if ($hex && !self::is_neutral($hex) && !self::is_light($hex)) {
                return ["color" => $hex, "source" => "theme_json:palette:{$slug}"];
            }
        }

        return null;
    }

    /**
     * slug => color of the palette the site uses: the owner's custom colors
     * over the theme's, over WordPress's defaults.
     *
     * @return array<string, string>
     */
    private static function merged_palette(array $settings): array
    {
        $palette = [];
        foreach (["default", "theme", "custom"] as $origin) {
            foreach ((array) ($settings["color"]["palette"][$origin] ?? []) as $entry) {
                if (is_array($entry) && isset($entry["slug"], $entry["color"])) {
                    $palette[(string) $entry["slug"]] = (string) $entry["color"];
                }
            }
        }
        return $palette;
    }

    /**
     * A theme.json style value as a hex color: a literal, or a palette
     * reference written as var(--wp--preset--color--slug) or var:preset|color|slug.
     *
     * @param array<string, string> $palette
     */
    private static function resolve_style_color($value, array $palette): ?string
    {
        if (!is_string($value) || $value === "") {
            return null;
        }
        if (preg_match('/^var\(--wp--preset--color--([a-z0-9-]+)\)$/i', trim($value), $m)
            || preg_match('/^var:preset\|color\|([a-z0-9-]+)$/i', trim($value), $m)) {
            $value = $palette[$m[1]] ?? "";
        }
        return self::normalize_hex((string) $value);
    }

    /* ─── Source 3 and 4: stylesheets ─── */

    /** At most this many theme stylesheets, and bytes of each, are read. */
    private const MAX_THEME_STYLESHEETS = 12;
    private const MAX_STYLESHEET_BYTES = 1048576;

    /** Class words that mark a button that is not the primary one. */
    private const NON_PRIMARY_BUTTON_WORDS = [
        "secondary", "tertiary", "outline", "ghost", "toggle", "close", "menu", "nav", "search",
        "icon", "social", "light", "white", "disabled", "cancel", "share", "cookie", "back", "top",
    ];

    /** Custom property names that name the brand color, best first. */
    private const BRAND_PROPERTY_WORDS = ["primary", "brand", "accent", "main", "theme"];

    /** Words that make a custom property a surface or text color, not the brand. */
    private const NON_BRAND_PROPERTY_WORDS = [
        "on", "text", "ink", "fg", "foreground", "surface", "bg", "background", "border", "line",
        "hover", "active", "focus", "muted", "soft", "light", "pale", "shadow", "contrast", "rgb", "hsl",
    ];

    /**
     * The brand color a stylesheet gives, as a browser would paint it:
     * 1. the background of the primary buttons (`.wp-block-button__link`,
     *    `.btn-primary`, a theme's own `.ar-button` ...), resolving var()
     *    through the custom properties the CSS declares; with $html, only the
     *    button classes the page really uses count;
     * 2. a custom property that names the brand (`--brand-color`,
     *    `--ar-accent`, `--wp--preset--color--primary` ...).
     * Black, grey and white never count. A property declared once per color
     * scheme takes the value that is also in the theme palette, if any.
     *
     * @param string[] $palette hex colors of the theme palette
     * @return array{color: string, source: string}|null
     */
    public static function pick_from_css(string $css, ?string $html, array $palette = []): ?array
    {
        $css = (string) preg_replace('~/\*.*?\*/~s', "", $css);
        $properties = [];
        if (preg_match_all('/(--[a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)/', $css, $declarations, PREG_SET_ORDER)) {
            foreach ($declarations as $declaration) {
                $properties[strtolower($declaration[1])][] = trim($declaration[2]);
            }
        }
        $used_classes = $html !== null ? self::used_classes($html) : null;

        if (preg_match_all('/([^{}]+)\{([^{}]*)\}/', $css, $rules, PREG_SET_ORDER)) {
            foreach ($rules as $rule) {
                $selector = trim($rule[1]);
                if ($selector === "" || $selector[0] === "@" || preg_match('/:(?:hover|focus|active|visited|disabled)|::/i', $selector)) {
                    continue;
                }
                if (!self::is_primary_button_selector($selector, $used_classes)) {
                    continue;
                }
                if (!preg_match_all('/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i', $rule[2], $backgrounds)) {
                    continue;
                }
                foreach ($backgrounds[1] as $value) {
                    $hex = self::resolve_css_color($value, $properties, $palette);
                    if ($hex && !self::is_neutral($hex) && !self::is_light($hex)) {
                        return ["color" => $hex, "source" => "css:button"];
                    }
                }
            }
        }

        foreach (self::BRAND_PROPERTY_WORDS as $word) {
            foreach ($properties as $name => $values) {
                if (!self::names_brand($name, $word)) {
                    continue;
                }
                $hex = self::resolve_css_color("var({$name})", $properties, $palette);
                if ($hex && !self::is_neutral($hex) && !self::is_light($hex)) {
                    return ["color" => $hex, "source" => "css:{$name}"];
                }
            }
        }

        return null;
    }

    /** Whether a custom property is the brand color named by $word. */
    private static function names_brand(string $name, string $word): bool
    {
        $preset = "--wp--preset--color--";
        if (strpos($name, $preset) === 0) {
            // Palette slugs: only the brand's own name, never accent-1..6.
            return in_array(substr($name, strlen($preset)), [$word, "{$word}-color"], true);
        }
        // WordPress's own properties (--wp-admin-theme-color is core's admin
        // blue on every front page), never the site's brand.
        if (preg_match('/^--wp-[a-z]/', $name)) {
            return false;
        }
        $words = array_values(array_filter(explode("-", trim(str_replace("_", "-", $name), "-")), "strlen"));
        if (end($words) === "color") {
            array_pop($words);
        }
        if (!$words || end($words) !== $word) {
            return false;
        }
        return !array_intersect($words, self::NON_BRAND_PROPERTY_WORDS);
    }

    /** @param array<string, true>|null $used_classes */
    private static function is_primary_button_selector(string $selector, ?array $used_classes): bool
    {
        if (!preg_match_all('/\.([a-zA-Z0-9_-]+)/', $selector, $classes)) {
            return false;
        }
        $button = false;
        foreach ($classes[1] as $class) {
            $class = strtolower($class);
            if (!preg_match('/button|btn/', $class)) {
                continue;
            }
            foreach (self::NON_PRIMARY_BUTTON_WORDS as $word) {
                if (preg_match('/(?:^|[-_])' . $word . '(?:$|[-_])/', $class)) {
                    return false;
                }
            }
            if ($used_classes === null || isset($used_classes[$class])) {
                $button = true;
            }
        }
        return $button;
    }

    /** @return array<string, true> every class the page's markup uses */
    private static function used_classes(string $html): array
    {
        $used = [];
        if (preg_match_all('/\sclass\s*=\s*["\']([^"\']*)["\']/i', $html, $attributes)) {
            foreach ($attributes[1] as $attribute) {
                foreach (preg_split('/\s+/', strtolower($attribute), -1, PREG_SPLIT_NO_EMPTY) as $class) {
                    $used[$class] = true;
                }
            }
        }
        return $used;
    }

    /**
     * A CSS color value as hex: a literal, rgb(), or var() through the
     * declared custom properties (and the var() fallback).
     *
     * @param array<string, string[]> $properties
     * @param string[] $palette
     */
    private static function resolve_css_color(string $value, array $properties, array $palette, int $depth = 0): ?string
    {
        $value = trim(preg_replace('/!important/i', "", $value));
        if ($depth > 6 || $value === "") {
            return null;
        }
        if (preg_match('/^var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*(.+))?\)$/s', $value, $m)) {
            $candidates = [];
            foreach ($properties[strtolower($m[1])] ?? [] as $declared) {
                $hex = self::resolve_css_color($declared, $properties, $palette, $depth + 1);
                if ($hex) {
                    $candidates[] = $hex;
                }
            }
            // One value per color scheme: the one in the theme palette is the brand's.
            foreach ($candidates as $hex) {
                if (in_array($hex, $palette, true) && !self::is_neutral($hex)) {
                    return $hex;
                }
            }
            if ($candidates) {
                return $candidates[0];
            }
            return isset($m[2]) ? self::resolve_css_color($m[2], $properties, $palette, $depth + 1) : null;
        }
        if (preg_match('/^#[0-9a-fA-F]{3,8}$/', $value)) {
            return self::normalize_hex($value);
        }
        if (preg_match('/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\s*(?:[,\/]\s*([\d.]+%?))?\s*\)$/i', $value, $m)) {
            if (isset($m[4]) && (float) $m[4] < (substr($m[4], -1) === "%" ? 50 : 0.5)) {
                return null;
            }
            return sprintf("#%02x%02x%02x", min(255, (int) $m[1]), min(255, (int) $m[2]), min(255, (int) $m[3]));
        }
        // A shorthand ("background: var(--x) url(...)"): its first color.
        if (preg_match('/(var\(\s*--[a-zA-Z0-9_-]+\s*\)|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\))/', $value, $m) && $m[1] !== $value) {
            return self::resolve_css_color($m[1], $properties, $palette, $depth + 1);
        }
        return null;
    }

    /** @return string[] hex colors of the theme's and the owner's palette */
    private static function theme_palette_colors(): array
    {
        if (!function_exists("wp_get_global_settings")) {
            return [];
        }
        $settings = (array) wp_get_global_settings();
        $colors = [];
        foreach (["theme", "custom"] as $origin) {
            foreach ((array) ($settings["color"]["palette"][$origin] ?? []) as $entry) {
                $hex = is_array($entry) ? self::normalize_hex((string) ($entry["color"] ?? "")) : null;
                if ($hex) {
                    $colors[] = $hex;
                }
            }
        }
        return $colors;
    }

    /**
     * @param string[] $palette
     * @return array{color: string, source: string}|null
     */
    private static function extract_from_homepage(array $palette = []): ?array
    {
        $is_local = function_exists("wp_is_local_environment") && wp_is_local_environment();
        $response = wp_remote_get(home_url("/"), [
            "timeout"   => 3,
            "sslverify" => !$is_local,
        ]);

        $html = "";
        if (!is_wp_error($response) && (int) wp_remote_retrieve_response_code($response) === 200) {
            $html = (string) wp_remote_retrieve_body($response);
        }
        $head_end = stripos($html, "</head>");
        $head = $head_end !== false ? substr($html, 0, $head_end + 7) : $html;

        // 1. <meta name="theme-color" content="#hex"> (either attribute order)
        if (preg_match('/<meta[^>]+name=["\']theme-color["\'][^>]+content=["\']([^"\']+)["\']/i', $head, $m)
            || preg_match('/<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']theme-color["\']/i', $head, $m)) {
            $hex = self::normalize_hex(trim($m[1]));
            if ($hex && !self::is_neutral($hex)) {
                return ["color" => $hex, "source" => "meta:theme-color"];
            }
        }

        // 2. The page's CSS in document order: inline <style> blocks and the
        // theme's own linked stylesheets (read from disk, never fetched).
        $css = self::page_css($head);
        if ($css === "") {
            return null;
        }
        $color = self::pick_from_css($css, $html !== "" ? $html : null, $palette);
        if ($color) {
            return ["color" => $color["color"], "source" => $color["source"] === "css:button" ? "homepage:button" : "homepage:" . substr($color["source"], 4)];
        }
        return null;
    }

    /** The CSS of a page's <head>: inline styles plus the theme's stylesheets. */
    private static function page_css(string $head): string
    {
        $themes = self::theme_roots();
        $parts = [];
        $read = [];
        $files = 0;
        if (preg_match_all('/<style\b[^>]*>(.*?)<\/style>|<link\b[^>]*>/si', $head, $tags, PREG_SET_ORDER)) {
            foreach ($tags as $tag) {
                if (isset($tag[1]) && stripos($tag[0], "<style") === 0) {
                    $parts[] = $tag[1];
                    continue;
                }
                if (!preg_match('/rel\s*=\s*["\']?stylesheet/i', $tag[0]) || !preg_match('/href\s*=\s*["\']([^"\']+)["\']/i', $tag[0], $href)) {
                    continue;
                }
                $path = self::theme_file_for_url(html_entity_decode($href[1]), $themes);
                if ($path && !isset($read[$path]) && $files < self::MAX_THEME_STYLESHEETS) {
                    $read[$path] = true;
                    $files++;
                    $parts[] = self::read_stylesheet($path);
                }
            }
        }
        // style.css always: a theme can declare its colors there without enqueueing it.
        foreach ($themes as [, $dir]) {
            $path = realpath($dir . "/style.css");
            if ($path && !isset($read[$path])) {
                $read[$path] = true;
                $parts[] = self::read_stylesheet($path);
            }
        }
        return implode("\n", array_filter($parts, "strlen"));
    }

    /** @return array<int, array{0: string, 1: string}> [uri, dir] of the child and parent theme */
    private static function theme_roots(): array
    {
        $roots = [];
        if (function_exists("get_stylesheet_directory") && function_exists("get_stylesheet_directory_uri")) {
            $roots[] = [(string) get_stylesheet_directory_uri(), (string) get_stylesheet_directory()];
        }
        if (function_exists("get_template_directory") && function_exists("get_template_directory_uri")) {
            $roots[] = [(string) get_template_directory_uri(), (string) get_template_directory()];
        }
        $unique = [];
        foreach ($roots as [$uri, $dir]) {
            $real = $dir !== "" ? realpath($dir) : false;
            if ($uri !== "" && $real) {
                $unique[$real] = [rtrim($uri, "/"), $real];
            }
        }
        return array_values($unique);
    }

    /**
     * The local file of a theme stylesheet URL, or null for anything else
     * (plugins, other hosts, paths that leave the theme folder).
     *
     * @param array<int, array{0: string, 1: string}> $themes
     */
    private static function theme_file_for_url(string $url, array $themes): ?string
    {
        $url = (string) preg_replace('/[?#].*$/s', "", $url);
        $bare = (string) preg_replace('~^https?:~i', "", $url);
        foreach ($themes as [$uri, $dir]) {
            $base = (string) preg_replace('~^https?:~i', "", $uri) . "/";
            if (strpos($bare, $base) !== 0) {
                continue;
            }
            $relative = rawurldecode(substr($bare, strlen($base)));
            if (substr($relative, -4) !== ".css" || strpos($relative, "..") !== false) {
                return null;
            }
            $path = realpath($dir . "/" . $relative);
            return $path && strpos($path, $dir . DIRECTORY_SEPARATOR) === 0 && is_file($path) ? $path : null;
        }
        return null;
    }

    private static function read_stylesheet(string $path): string
    {
        $css = @file_get_contents($path, false, null, 0, self::MAX_STYLESHEET_BYTES);
        return is_string($css) ? $css : "";
    }

    /* ─── Utility Functions ─── */

    /**
     * Normalize a color value to a 6-digit hex string or null.
     */
    private static function normalize_hex(string $value): ?string
    {
        $value = trim($value, " \t\n\r\0\x0B;");
        if (empty($value)) {
            return null;
        }

        // Strip # prefix if present
        $clean = ltrim($value, "#");

        // 3-digit shorthand → 6-digit
        if (preg_match('/^[0-9a-fA-F]{3}$/', $clean)) {
            $clean = $clean[0] . $clean[0] . $clean[1] . $clean[1] . $clean[2] . $clean[2];
        }

        // 8-digit (with alpha) → take first 6
        if (preg_match('/^[0-9a-fA-F]{8}$/', $clean)) {
            $clean = substr($clean, 0, 6);
        }

        if (!preg_match('/^[0-9a-fA-F]{6}$/', $clean)) {
            return null;
        }

        return "#" . strtolower($clean);
    }

    /**
     * Check if a hex color is neutral (white, black, or very close to gray).
     * These are not useful as brand colors.
     */
    private static function is_neutral(string $hex): bool
    {
        $rgb = self::hex_to_rgb($hex);
        if (!$rgb) {
            return false;
        }
        [$r, $g, $b] = $rgb;

        // Too light (near-white)
        if ($r > 240 && $g > 240 && $b > 240) {
            return true;
        }
        // Too dark (near-black)
        if ($r < 15 && $g < 15 && $b < 15) {
            return true;
        }
        // Pure gray (low saturation)
        $max = max($r, $g, $b);
        $min = min($r, $g, $b);
        if ($max - $min < 15) {
            return true;
        }

        return false;
    }

    /**
     * Too pale to carry the widget's white header text (a pastel or a
     * near-white): WCAG relative luminance above 0.6.
     */
    private static function is_light(string $hex): bool
    {
        $rgb = self::hex_to_rgb($hex);
        if (!$rgb) {
            return false;
        }
        $lum = 0.0;
        foreach ([0.2126, 0.7152, 0.0722] as $i => $weight) {
            $c = $rgb[$i] / 255;
            $lum += $weight * ($c <= 0.04045 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4);
        }
        return $lum > 0.6;
    }

    /** @return int[]|null [r, g, b] */
    private static function hex_to_rgb(string $hex): ?array
    {
        $hex = ltrim($hex, "#");
        if (strlen($hex) !== 6) {
            return null;
        }
        return [
            (int) hexdec(substr($hex, 0, 2)),
            (int) hexdec(substr($hex, 2, 2)),
            (int) hexdec(substr($hex, 4, 2)),
        ];
    }
}
