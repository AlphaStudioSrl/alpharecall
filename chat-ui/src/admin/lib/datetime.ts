/**
 * Timestamp parsing and formatting for the admin dashboard.
 *
 * Two bugs live here, and both are easy to reintroduce by calling
 * `new Date(x).toLocaleString()` directly:
 *
 * 1. The API stores naive UTC. Older builds serialized it with no designator
 *    ("2026-08-04T15:04:20"), and ECMA-262 parses an offset-less date-*time*
 *    string as **local** time -- so a Rome browser read our UTC instants two
 *    hours early, and "just now" rendered as "2h fa". `parseApiDate` stamps
 *    the missing UTC marker back on. The API emits "...Z" now; this stays as
 *    the defence that makes old and new payloads agree.
 *
 * 2. `toLocaleString()` with no `timeZone` follows whatever zone the admin's
 *    laptop is set to, so the same appointment read differently for a client
 *    in Milan and their developer in London. Everything here renders in the
 *    tenant's configured zone instead.
 */
import { getConfig } from "./config";
import { getStoredLang } from "./i18n";

/** Matches the tenant's business hours, not the viewer's laptop. */
export const FALLBACK_TIMEZONE = "Europe/Rome";

/**
 * A date-time with no trailing "Z" and no "+HH:MM"/"-HH:MM" offset.
 *
 * Deliberately does not match date-only strings ("2026-08-04"): the spec
 * already parses those as UTC, so appending anything would shift them.
 */
const NAIVE_DATETIME =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

let cachedTimezone: string | null = null;

/** The tenant's configured display zone, or Europe/Rome. */
export function getTimezone(): string {
  if (cachedTimezone) return cachedTimezone;
  let zone = FALLBACK_TIMEZONE;
  try {
    const configured = getConfig()?.settings?.tenant_settings?.timezone;
    if (typeof configured === "string" && configured.trim()) {
      // Reject anything Intl cannot resolve -- an unknown zone throws on
      // every subsequent format() call and would blank the whole page.
      new Intl.DateTimeFormat("en-US", { timeZone: configured.trim() });
      zone = configured.trim();
    }
  } catch {
    zone = FALLBACK_TIMEZONE;
  }
  cachedTimezone = zone;
  return zone;
}

/** Drop the memoised zone after the setting changes. */
export function resetTimezoneCache(): void {
  cachedTimezone = null;
}

/** The BCP-47 tag matching the dashboard's current language. */
export function getLocale(): string {
  return getStoredLang() === "it" ? "it-IT" : "en-US";
}

/**
 * Parse a timestamp from the API into a Date, or null if unusable.
 *
 * Accepts epoch milliseconds and Date instances too, so callers can hand it
 * whatever a payload happens to carry.
 */
export function parseApiDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const fromEpoch = new Date(value);
    return Number.isNaN(fromEpoch.getTime()) ? null : fromEpoch;
  }
  if (typeof value !== "string") return null;

  const raw = value.trim();
  if (!raw) return null;
  // "2026-08-04 15:04:20" is valid Postgres output but not valid ES input.
  const normalized = NAIVE_DATETIME.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function format(
  value: unknown,
  options: Intl.DateTimeFormatOptions,
  fallback: string
): string {
  const date = parseApiDate(value);
  if (!date) return fallback;
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      timeZone: getTimezone(),
      ...options,
    }).format(date);
  } catch {
    return fallback;
  }
}

/** "4 ago 2026, 15:04" -- the default for anything with a clock component. */
export function formatDateTime(value: unknown, fallback = ""): string {
  return format(
    value,
    {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    fallback
  );
}

/** "4 ago 2026" -- no clock. */
export function formatDate(value: unknown, fallback = ""): string {
  return format(
    value,
    { day: "numeric", month: "short", year: "numeric" },
    fallback
  );
}

/** "15:04" */
export function formatTime(value: unknown, fallback = ""): string {
  return format(value, { hour: "2-digit", minute: "2-digit" }, fallback);
}

/** "martedì 4 agosto 2026" -- headers and date pickers. */
export function formatLongDate(value: unknown, fallback = ""): string {
  return format(
    value,
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    fallback
  );
}

/** "martedì 4 agosto 2026, 15:04" -- appointment detail rows. */
export function formatLongDateTime(value: unknown, fallback = ""): string {
  return format(
    value,
    {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    fallback
  );
}

/** "4 ago" -- compact axis labels. */
export function formatShortDate(value: unknown, fallback = ""): string {
  return format(value, { day: "numeric", month: "short" }, fallback);
}

const RELATIVE_IT = { now: "adesso", m: "m fa", h: "h fa", d: "g fa" };
const RELATIVE_EN = { now: "just now", m: "m ago", h: "h ago", d: "d ago" };

/**
 * "adesso" / "12m fa" / "3h fa" / "2g fa".
 *
 * A pure delta, so no timezone is involved -- but it still needs
 * `parseApiDate`, which is exactly what made everything read as two hours
 * old the moment it was written.
 */
export function formatRelativeTime(value: unknown, fallback = ""): string {
  const date = parseApiDate(value);
  if (!date) return fallback;
  const labels = getStoredLang() === "it" ? RELATIVE_IT : RELATIVE_EN;
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  // Clock skew between the browser and the API must not print "-3m fa".
  if (minutes < 1) return labels.now;
  if (minutes < 60) return `${minutes}${labels.m}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${labels.h}`;
  return `${Math.floor(hours / 24)}${labels.d}`;
}

/**
 * Label a "YYYY-MM-DD" bucket key without re-interpreting it in another zone.
 *
 * The key is already a calendar date, so formatting it in the tenant's zone
 * would shift it again: `new Date("2026-08-04T00:00:00Z")` rendered in Rome
 * is 02:00 on the 4th, and any zone behind UTC would show the 3rd.
 */
export function formatDateKey(
  key: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      timeZone: "UTC",
      ...options,
    }).format(new Date(`${key}T00:00:00Z`));
  } catch {
    return key;
  }
}

/**
 * "2026-08-04" for the tenant's zone -- not the viewer's.
 *
 * Chart buckets and CSV filenames key off this. `toISOString().slice(0,10)`
 * silently rolls over at 22:00 Rome time in summer, splitting a single
 * business day across two buckets.
 */
export function toZonedDateKey(value: unknown = new Date()): string {
  const date = parseApiDate(value);
  if (!date) return "";
  // en-CA formats as YYYY-MM-DD, which is what every bucket key expects.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
