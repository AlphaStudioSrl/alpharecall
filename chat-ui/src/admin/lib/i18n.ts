import en from "../i18n/en.json";
import it from "../i18n/it.json";

type TranslationMap = Record<string, unknown>;
const translations: Record<string, TranslationMap> = { en, it };

function resolve(obj: unknown, path: string): string | null {
  return path.split(".").reduce<unknown>(
    (acc, part) =>
      acc && typeof acc === "object"
        ? (acc as Record<string, unknown>)[part]
        : null,
    obj
  ) as string | null;
}

export type TFunction = (key: string) => string;

export function createT(lang: string): TFunction {
  return (key: string): string => {
    return resolve(translations[lang], key) ?? resolve(translations.en, key) ?? key;
  };
}

export const SUPPORTED_LANGS = ["it", "en"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/**
 * The dashboard language for PHP (the wp-admin menu labels,
 * AlphaRecall_Admin_UI::get_menu_label). The cookie was "ar_lang" before
 * 0.1.86; WordPress.org asks for prefixes longer than two letters, so the old
 * one is cleared when the new one is written.
 */
export const LANG_COOKIE = "alpharecall_lang";

function syncLangCookie(lang: SupportedLang): void {
  document.cookie = `${LANG_COOKIE}=${lang};path=/;max-age=${365 * 86400};SameSite=Lax`;
  document.cookie = "ar_lang=;path=/;max-age=0;SameSite=Lax";
}

export function getStoredLang(): SupportedLang {
  try {
    const stored = localStorage.getItem("ar-lang");
    if (stored && SUPPORTED_LANGS.includes(stored as SupportedLang)) {
      // Ensure cookie is synced on load
      syncLangCookie(stored as SupportedLang);
      return stored as SupportedLang;
    }
  } catch {
    // localStorage may be unavailable (private browsing, iframe restrictions, etc.)
  }
  return "it";
}

export function setStoredLang(lang: SupportedLang): void {
  localStorage.setItem("ar-lang", lang);
  // Sync to cookie so PHP can read the language on next page load
  syncLangCookie(lang);
}

/** WP sidebar slug → i18n nav key (mirrors AlphaRecall_Admin_UI::SUBMENU_SLUGS). */
const WP_MENU_MAP: Record<string, string> = {
  "alpharecall-dashboard": "nav.sections.oggi",
  "alpharecall-conversations": "nav.sections.inbox",
  "alpharecall-conversions": "nav.sections.richieste",
  "alpharecall-stats": "nav.sections.statistiche",
  "alpharecall-content": "nav.sections.assistente",
  "alpharecall-widget": "nav.sections.widget",
  "alpharecall-settings": "nav.sections.impostazioni",
};

/** Update WordPress admin sidebar labels to match the current language. */
export function syncWpSidebarLang(t: TFunction): void {
  for (const [slug, key] of Object.entries(WP_MENU_MAP)) {
    // Only target submenu links — skip the top-level "AlphaRecall" menu item
    const links = document.querySelectorAll<HTMLAnchorElement>(
      `#adminmenu .wp-submenu a[href*="page=${slug}"]`
    );
    const label = t(key);
    if (!label || label === key) continue;
    links.forEach((link) => {
      // The label text is the direct text child (skip badges/counts)
      const textNode = Array.from(link.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
      );
      if (textNode) {
        textNode.textContent = label;
      } else {
        link.textContent = label;
      }
    });
  }
  // Also update the page <title> tag
  const pageTitle = document.querySelector("title");
  if (pageTitle) {
    const match = pageTitle.textContent?.match(/^(.+?)\s*[‹›–—]\s*(.+)$/);
    if (match) {
      const [, pageName, rest] = match;
      for (const [, navKey] of Object.entries(WP_MENU_MAP)) {
        // Check if current title matches any known English or Italian label
        const enLabel = resolve(translations.en, navKey);
        const itLabel = resolve(translations.it, navKey);
        if (pageName.trim() === enLabel || pageName.trim() === itLabel) {
          const newLabel = t(navKey);
          if (newLabel && newLabel !== navKey) {
            pageTitle.textContent = `${newLabel} ‹ ${rest}`;
          }
          break;
        }
      }
    }
  }
}

/**
 * One/many copy: `oneKey` when the count is exactly 1, else `manyKey` with
 * the count filled in (as `{count}` and `{n}`, whichever the string uses).
 * Pass an already formatted count in `vars.count` to override the number.
 */
export function plural(
  t: TFunction,
  oneKey: string,
  manyKey: string,
  count: number,
  vars: Record<string, string | number> = {}
): string {
  const filled = { count, n: count, ...vars };
  return interpolate(t(count === 1 ? oneKey : manyKey), filled);
}

/**
 * Copy that names the assistant when the owner gave it a name ("Luca lo sta
 * leggendo"), else the generic sentence ("L'assistente lo sta leggendo"):
 * `${key}Named` with `{name}`, or `key`. Two sentences rather than a fallback
 * name, so the Italian article and preposition stay right ("a Luca",
 * "all'assistente"). Pass the configured name, "" when there is none.
 */
export function named(
  t: TFunction,
  key: string,
  name: string,
  vars: Record<string, string | number> = {}
): string {
  return name ? interpolate(t(`${key}Named`), { ...vars, name }) : interpolate(t(key), vars);
}

/** Fill `{name}` placeholders in a translated string. */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/**
 * The Italian article before a number: "l'" when the number is read starting
 * with a vowel (uno, otto, undici, ottanta..., ottocento..., ottomila...),
 * else "il " or "del ". "il 83%" and "del 11%" are wrong; "l'83%",
 * "dell'11%" and "il 72%" are right. Italian strings put it right before the
 * number (`{il}{pct}%`, `{del}{pct}%`); English strings leave the slot out.
 */
export function numberArticle(n: number, form: "il" | "del" = "il"): string {
  const digits = String(Math.abs(Math.round(n)));
  const vowel = digits === "1" || digits === "11" || digits.startsWith("8") || (digits.length === 5 && digits.startsWith("11"));
  if (form === "del") return vowel ? "dell'" : "del ";
  return vowel ? "l'" : "il ";
}
