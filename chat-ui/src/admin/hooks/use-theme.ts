import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/admin/lib/api";

export type Theme = "light" | "dark";

/** Where the toggle persists its choice. Read it, do not re-spell it. */
export const THEME_STORAGE_KEY = "ar-theme";
/** The element this hook stamps `data-theme` on; admin.css keys off it. */
export const THEME_ROOT_ID = "alpharecall-admin-app";
/** Mirrored onto <html> so WordPress's own chrome can be styled early. */
export const THEME_HTML_ATTR = "data-ar-theme";

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/**
 * The theme in force, from whichever source has it first.
 *
 * The attribute is authoritative once React has mounted (the PHP early script
 * stamps it from WP user meta / localStorage / prefers-color-scheme before
 * first paint); the fallbacks below mirror that same resolution order.
 */
export function readTheme(): Theme {
  if (typeof document !== "undefined") {
    const marked =
      document.getElementById(THEME_ROOT_ID)?.getAttribute("data-theme") ??
      document.documentElement.getAttribute(THEME_HTML_ATTR);
    if (marked === "light" || marked === "dark") return marked;
  }
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage can throw outright when the browser blocks it.
  }
  return systemTheme();
}

function getStoredTheme(): Theme {
  return readTheme();
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      // Not persisting is survivable; failing the toggle is not.
    }
    // Also save to WP user meta so the explicit choice follows the user to
    // other browsers and machines; fire-and-forget, the toggle never waits.
    void apiFetch("/ui-prefs", {
      method: "POST",
      body: JSON.stringify({ theme: t }),
    }).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  // Apply theme to admin root element and html (for WP body early styles)
  useEffect(() => {
    const root = document.getElementById(THEME_ROOT_ID);
    if (root) {
      root.setAttribute("data-theme", theme);
    }
    document.documentElement.setAttribute(THEME_HTML_ATTR, theme);
  }, [theme]);

  return { theme, setTheme, toggleTheme };
}
