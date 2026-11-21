/**
 * Agenda time and error rules, kept pure so they are unit-tested.
 *
 * One zone rules the Agenda: the tenant's (getTimezone()). Times are shown
 * in it, typed in it, saved in it, and calendar days are its days, whatever
 * zone the browser happens to be in.
 */
import { ApiRequestError } from "@/admin/lib/api";

/** Wall-clock date ("2026-10-16") + time ("14:00") in `zone`, as a UTC instant. */
export function zonedToUtc(date: string, time: string, zone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const h = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !h) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +h[1], +h[2]);
  const offset = (instant: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
        .formatToParts(new Date(instant))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute) - instant;
  };
  let utc = guess - offset(guess);
  utc = guess - offset(utc);
  return new Date(utc);
}

/** The wall-clock date and time of an instant in `zone`, as the move dialog's fields. */
export function zonedParts(instant: Date, zone: string): { date: string; time: string } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant);
  return { date, time };
}

/**
 * The PUT body for a move. `zone` must be the zone the fields were filled in
 * (zonedParts), so saving an untouched dialog keeps the same instant.
 */
export function moveWindow(date: string, time: string, minutes: number, zone: string): { starts_at: string; ends_at: string; timezone: string } | null {
  const start = zonedToUtc(date, time, zone);
  if (!start) return null;
  const end = new Date(start.getTime() + Math.max(5, minutes) * 60_000);
  return { starts_at: start.toISOString(), ends_at: end.toISOString(), timezone: zone };
}

/*
 * react-day-picker works in browser-local dates (midnight local). A tenant
 * day key is turned into a picker date, and back, by its year/month/day
 * parts, never through the instant, so a browser in another zone still
 * lands on the same calendar day.
 */

/** "2026-10-16" -> the picker's local midnight of 16 October. */
export function pickerDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** The picker's local date -> "2026-10-16". */
export function pickerKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The i18n key for a failed move. The backend's details are English and
 * meant for logs, so they are only matched, never shown. The WordPress proxy
 * (class-ar-rest.php::update_appointment) answers every upstream failure
 * with HTTP 502 and the detail as `error`, so the text decides first and the
 * status only covers what the text does not.
 */
export function moveErrorKey(error: unknown): string {
  const status = error instanceof ApiRequestError ? error.status : 0;
  const detail = error instanceof Error ? error.message.toLowerCase() : "";
  const key = (name: string) => `conversions.agenda.moveErrors.${name}`;
  if (/already booked|conflicts with another|time is busy/.test(detail)) return key("busy");
  if (/outside the bookable hours/.test(detail)) return key("outsideHours");
  if (/too soon/.test(detail)) return key("tooSoon");
  if (/google calendar/.test(detail)) return key("calendar");
  if (/not found/.test(detail) || status === 404) return key("gone");
  if (/must be|must include|valid iana|exact appointment date/.test(detail) || status === 400 || status === 422) return key("invalid");
  if (status === 409) return key("busy");
  return key("generic");
}
