/**
 * IANA timezone options for the settings picker.
 *
 * The full tz database is ~420 entries, which is unusable in a plain scroll
 * list. Tenants are Italian businesses, so the zones they actually pick are
 * floated to the top and the rest stay available alphabetically.
 */
import { FALLBACK_TIMEZONE } from "./datetime";

/** Ordered by how likely an Italian tenant is to want them. */
const COMMON = [
  FALLBACK_TIMEZONE,
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Zurich",
  "Europe/Lisbon",
  "Europe/Athens",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Vienna",
  "Europe/Dublin",
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Australia/Sydney",
];

/** Every zone this browser knows, or the curated set on older engines. */
function allZones(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.("timeZone");
    if (Array.isArray(supported) && supported.length) return supported;
  } catch {
    // Intl.supportedValuesOf is ES2022; fall through on older engines.
  }
  return COMMON;
}

/** "GMT+2" for the zone right now, or "" if it cannot be resolved. */
function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function label(zone: string): string {
  const offset = offsetLabel(zone);
  // "Europe/Rome" reads better than "Europe/Rome" with an underscore in it.
  const name = zone.replace(/_/g, " ");
  return offset ? `${name} (${offset})` : name;
}

/**
 * Options for the timezone select.
 *
 * `current` is appended when it is not otherwise listed, so a zone set through
 * the API (or one this browser does not know) still shows as selected rather
 * than rendering the field empty.
 */
export function timezoneOptions(
  current?: string
): { value: string; label: string }[] {
  const zones = allZones();
  const common = COMMON.filter((z) => zones.includes(z));
  const seen = new Set(common);
  const rest = zones.filter((z) => !seen.has(z)).sort();

  const ordered = [...common, ...rest];
  if (current && !ordered.includes(current)) ordered.unshift(current);

  return ordered.map((zone) => ({ value: zone, label: label(zone) }));
}
