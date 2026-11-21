import {
  formatRelativeTime as relativeTime,
  getLocale,
  getTimezone,
  parseApiDate,
} from "./datetime";

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/**
 * "50.000" in Italian, "50,000" in English: the whole number with the
 * locale's grouping. The old "50.0K" read as a decimal to Italian owners.
 */
export function formatNumber(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  const locale = getLocale();
  let format = numberFormats.get(locale);
  if (!format) {
    // "always": Italian leaves four digits ungrouped by default ("8000"), which
    // read wrong beside "50.000" and the sidebar's "1.284/8.000".
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
    numberFormats.set(locale, format);
  }
  return format.format(n);
}

/**
 * "4 ago, 15:04" in the tenant's timezone.
 *
 * Keeps the original field set (no year) so existing screens look the same;
 * the parsing and the zone are what changed. See ./datetime for why.
 */
export function formatDate(dateStr: string): string {
  const date = parseApiDate(dateStr);
  if (!date) return dateStr;
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      timeZone: getTimezone(),
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return dateStr;
  }
}

/** Echoes the raw string when it cannot be parsed, as this always has. */
export function formatRelativeTime(dateStr: string): string {
  return relativeTime(dateStr, dateStr);
}
