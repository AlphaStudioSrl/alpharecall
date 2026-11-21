/**
 * How a product card shows its price and where its link opens.
 *
 * The price comes from the store as a plain decimal ("89.00") with the store's
 * own currency (WooCommerce Store API currency_code).
 * It is formatted for the site's locale with that currency ("89,00 €" in
 * it-IT); no currency is ever assumed when the store did not send one.
 */

/** Fired just before a product card link takes the visitor to another page of this site. */
export const PRODUCT_LINK_EVENT = "alpharecall:product-link";

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const CURRENCY = /^[A-Za-z]{3}$/;

/** The widget's locale: the tenant language, with the host page's region when they agree. */
export function widgetLocale(): string {
  const configured = typeof window !== "undefined" ? String((window as any).AlphaRecallChat?.language || "") : "";
  const pageLang = typeof document !== "undefined" ? String(document.documentElement.lang || "") : "";
  const language = (configured || pageLang || "it").replace(/_/g, "-");
  const page = pageLang.replace(/_/g, "-");
  const base = language.split("-")[0].toLowerCase();
  // "it" + <html lang="it-CH"> formats like the Swiss site; a page in another
  // language keeps the tenant language alone.
  const candidate = page && page.split("-")[0].toLowerCase() === base && page.includes("-") ? page : language;
  try {
    return Intl.getCanonicalLocales(candidate)[0] || "it";
  } catch {
    return "it";
  }
}

/**
 * "89.00" + "EUR" -> "89,00 €" (it). Text that is not a plain decimal
 * ("da 10 €", "Gratis") is shown as the store wrote it; a decimal without a
 * known currency is shown as a localized number with no symbol.
 */
export function formatProductPrice(price: unknown, currency?: unknown, locale: string = widgetLocale()): string {
  const raw = typeof price === "number" ? String(price) : typeof price === "string" ? price.trim() : "";
  if (!raw) return "";
  if (!DECIMAL.test(raw)) return raw;
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return raw;
  const code = typeof currency === "string" && CURRENCY.test(currency.trim()) ? currency.trim().toUpperCase() : "";
  try {
    return code
      ? new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(amount)
      : new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return code ? `${raw} ${code}` : raw;
  }
}

export type ProductLink = { href: string; sameSite: boolean };

/**
 * A product link the card may open: http(s) only. A page of this site opens
 * in the same tab (the chat restores itself there, the cart stays in one
 * tab); another site opens in a new tab so the conversation is not lost.
 */
export function productLink(value: unknown): ProductLink | null {
  if (typeof value !== "string" || !value.trim() || typeof window === "undefined") return null;
  try {
    const url = new URL(value.trim(), window.location.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { href: url.href, sameSite: url.host === window.location.host };
  } catch {
    return null;
  }
}
