import { widgetCopy } from "@/lib/widget-copy";

/** Opening hours as the business profile stores them: day key -> free text ("9:00-19:00", "9-13, 15-19"). */
export type BusinessHours = Partial<Record<string, string | null>>;

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type Range = { start: number; end: number };

// Day names a model or a profile may use, all mapped to DAY_KEYS indexes.
const DAY_ALIASES: Record<string, number> = {};
[
  ["mon", "monday", "lun", "lunedi", "lunedì"],
  ["tue", "tues", "tuesday", "mar", "martedi", "martedì"],
  ["wed", "wednesday", "mer", "mercoledi", "mercoledì"],
  ["thu", "thur", "thurs", "thursday", "gio", "giovedi", "giovedì"],
  ["fri", "friday", "ven", "venerdi", "venerdì"],
  ["sat", "saturday", "sab", "sabato"],
  ["sun", "sunday", "dom", "domenica"],
].forEach((names, index) => names.forEach((name) => { DAY_ALIASES[name] = index; }));

function dayIndexes(key: string): number[] {
  const name = key.trim().toLowerCase().replace(/\.$/, "");
  if (name in DAY_ALIASES) return [DAY_ALIASES[name]];
  // "mon-fri", "lun – ven": a span of days sharing the same hours.
  const span = name.split(/\s*(?:-|–|—)\s*/);
  if (span.length !== 2 || !(span[0] in DAY_ALIASES) || !(span[1] in DAY_ALIASES)) return [];
  const from = DAY_ALIASES[span[0]];
  const to = DAY_ALIASES[span[1]];
  const days: number[] = [];
  for (let day = from; ; day = (day + 1) % 7) {
    days.push(day);
    if (day === to || days.length === 7) break;
  }
  return days;
}

function hoursText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.filter((part) => typeof part === "string" && part.trim()).map((part) => part.trim());
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

/**
 * Hours as a model or profile sends them, keyed mon..sun. Accepts English
 * and Italian day names (full or short) and day spans, joins arrays, and
 * drops anything else. Null when no day is left, so the card shows no hours
 * at all rather than a week of "Chiuso".
 */
export function normalizeHours(raw: unknown): BusinessHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const hours: BusinessHours = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const text = hoursText(value);
    if (text === null) continue;
    for (const day of dayIndexes(key)) hours[DAY_KEYS[day]] = text;
  }
  return Object.keys(hours).length ? hours : null;
}

const RANGE = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|a|to)\s*(\d{1,2})(?:[:.](\d{2}))?/gi;
const CLOSED = /^(chiuso|closed|-|—|–)$/i;

const minutes = (h: string, m?: string) => Number(h) * 60 + Number(m || 0);
export const formatTime = (value: number) => `${Math.floor(value / 60) % 24}:${String(value % 60).padStart(2, "0")}`;

/** Ranges in minutes after midnight, [] when closed, null when the text is not a time range. */
export function parseDay(text: unknown): Range[] | null {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw || CLOSED.test(raw)) return [];
  const ranges: Range[] = [];
  for (const match of raw.matchAll(RANGE)) {
    const start = minutes(match[1], match[2]);
    const end = minutes(match[3], match[4]);
    if (start >= 24 * 60 || end > 24 * 60) return null;
    ranges.push({ start, end: end <= start ? end + 24 * 60 : end });
  }
  return ranges.length ? ranges : null;
}

export type HoursRow = { label: string; value: string; today: boolean };
export type OpenState = { open: boolean; text: string } | null;

/** Weekday (0 = Monday) and minutes after midnight, in the business time zone when known. */
export function localNow(timeZone?: string, now = new Date()): { day: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || undefined, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
    const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
    return { day: day < 0 ? (now.getDay() + 6) % 7 : day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
  } catch {
    return { day: (now.getDay() + 6) % 7, minute: now.getHours() * 60 + now.getMinutes() };
  }
}

/** Consecutive days with the same hours collapse into one row ("Lun – Ven"). */
export function hoursRows(hours: BusinessHours, today: number): HoursRow[] {
  const copy = widgetCopy();
  const display = DAY_KEYS.map((key) => {
    const value = hours[key];
    const raw = typeof value === "string" ? value.trim() : "";
    const ranges = parseDay(raw);
    if (ranges === null) return raw;
    if (!ranges.length) return copy.closed;
    return ranges.map((r) => `${formatTime(r.start)} – ${formatTime(r.end)}`).join(", ");
  });
  const rows: HoursRow[] = [];
  let from = 0;
  for (let day = 1; day <= DAY_KEYS.length; day += 1) {
    if (day < DAY_KEYS.length && display[day] === display[from]) continue;
    const to = day - 1;
    rows.push({
      label: from === to ? copy.days[from] : `${copy.days[from]} – ${copy.days[to]}`,
      value: display[from],
      today: today >= from && today <= to,
    });
    from = day;
  }
  return rows;
}

/** "Aperto ora · chiude alle 19:00", or when it opens next. Null when the hours cannot be read. */
export function openState(hours: BusinessHours, now: { day: number; minute: number }): OpenState {
  const copy = widgetCopy();
  const week = DAY_KEYS.map((key) => parseDay(hours[key]));
  if (week.some((day) => day === null)) return null;
  const days = week as Range[][];
  const yesterday = days[(now.day + 6) % 7];
  for (const range of yesterday) {
    if (range.end > 24 * 60 && now.minute < range.end - 24 * 60) {
      return { open: true, text: copy.closesAt(formatTime(range.end)) };
    }
  }
  for (const range of days[now.day]) {
    if (now.minute >= range.start && now.minute < range.end) return { open: true, text: copy.closesAt(formatTime(range.end)) };
  }
  const later = days[now.day].find((range) => range.start > now.minute);
  if (later) return { open: false, text: copy.opensAt(formatTime(later.start)) };
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = (now.day + offset) % 7;
    const first = days[day][0];
    if (first) return { open: false, text: copy.opensDayAt(offset === 1 ? copy.tomorrow : copy.daysLong[day], formatTime(first.start)) };
  }
  return null;
}
