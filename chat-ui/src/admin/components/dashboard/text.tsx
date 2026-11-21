/**
 * Copy helpers shared by Oggi and Statistiche: sentences with a bold name
 * inside, durations ("18 minuti"), feed times ("10:31", "Ieri", "12 ott").
 */
import React from "react";
import { interpolate } from "@/admin/lib/i18n";
import { formatShortDate, formatTime, parseApiDate, toZonedDateKey } from "@/admin/lib/datetime";

type T = (key: string) => string;

/**
 * Fill `{placeholders}` and return React nodes, wrapping the `bold` ones in
 * <b>. Translators keep the word order of their language.
 */
export function rich(template: string, vars: Record<string, React.ReactNode>, bold: string[] = []): React.ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (!m || !(m[1] in vars)) return <React.Fragment key={i}>{part}</React.Fragment>;
    const value = vars[m[1]];
    return bold.includes(m[1]) ? <b key={i}>{value}</b> : <React.Fragment key={i}>{value}</React.Fragment>;
  });
}

/** "Una", "Cinque", ... up to ten, digits after: sentence starts read better as words. */
export function countWord(t: T, n: number): string {
  const words = t("today.numberWords").split(",");
  return n >= 0 && n < words.length && words.length > 1 ? words[n] : String(n);
}

/** A duration in words: "18 minuti", "2 ore", "3 giorni". */
export function duration(t: T, ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  if (minutes < 60) return minutes === 1 ? t("today.minuteOne") : interpolate(t("today.minutes"), { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? t("today.hourOne") : interpolate(t("today.hours"), { count: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t("today.dayOne") : interpolate(t("today.days"), { count: days });
}

/** Feed time: the clock today, "Ieri" yesterday, a short date before. */
export function feedTime(t: T, value: unknown, now = Date.now()): string {
  const d = parseApiDate(value);
  if (!d) return "";
  const key = toZonedDateKey(d);
  if (key === toZonedDateKey(new Date(now))) return formatTime(d);
  if (key === toZonedDateKey(new Date(now - 86_400_000))) return t("today.yesterday");
  return formatShortDate(d);
}

/** The first word of a display name ("Elena Rossi" -> "Elena"); empty for e-mails and placeholders. */
export function firstName(name: string | null | undefined): string {
  const clean = String(name ?? "").trim();
  if (!clean || clean.includes("@")) return "";
  const first = clean.split(/\s+/)[0];
  return /^(admin|administrator|amministratore)$/i.test(first) ? "" : first;
}
