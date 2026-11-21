/**
 * The quick brand colors of the Widget editor (Aspetto > Colore) and how a
 * brand color reaches the rest of the widget.
 */
import { contrastColor } from "@/lib/brand-color";

/** Each value is the hue its label names (checked in widget-colors.test.ts). */
export const COLOR_SWATCHES = [
  { value: "#2b59a8", label: "colorBlue" },
  { value: "#2f6b55", label: "colorGreen" },
  { value: "#b4532a", label: "colorRust" },
  { value: "#6b3fa0", label: "colorViolet" },
  { value: "#3d4247", label: "colorGraphite" },
] as const;

type ColorConfig = {
  primaryColor?: unknown;
  buttonColor?: unknown;
  accentColor?: unknown;
  titleColor?: unknown;
  activeTabBackgroundColor?: unknown;
};

const lower = (value: unknown, fallback: string) => String(value || fallback).toLowerCase();

/**
 * Every chat_config color that is painted from the brand color, so a new
 * brand color can never leave one of them behind:
 * - buttonColor: the chat (launcher) button;
 * - accentColor: the Send button;
 * - titleColor: the header title, status line and buttons on the colored
 *   header. It is the ink ON the brand color, so it takes the readable
 *   contrast of the new color, not the color itself;
 * - activeTabBackgroundColor: the selected Chat/FAQ tab, only when the owner
 *   gave it a color (empty means the theme's neutral grey and stays empty).
 * User bubbles, avatar initials and the header gradient read primaryColor
 * directly; links use the theme ink.
 */
export const BRAND_FOLLOWER_KEYS = ["buttonColor", "accentColor", "titleColor", "activeTabBackgroundColor"] as const;

/** The value a brand-following key takes for a brand color. */
export function brandFollowerValue(key: (typeof BRAND_FOLLOWER_KEYS)[number], color: string): string {
  return key === "titleColor" ? contrastColor(color) : color;
}

/**
 * The chat_config patch for a new brand color.
 *
 * "whole" (a swatch, the color picker next to them, Riprendi dal sito, the
 * onboarding color): every brand-colored part takes the color. A Send color
 * or a header text color left from an earlier choice made an orange pick
 * show violet (card akq1m7oqwc05: titleColor #a855f7 stayed on the header
 * title, status line and close button after "Ruggine").
 *
 * "matching" (Colori > Colore principale, next to their own rows): only the
 * ones that still matched the old brand color follow it, so a color the owner
 * set in its own row stays.
 */
export function brandColorPatch(color: string, chat: ColorConfig, scope: "whole" | "matching"): Record<string, string> {
  const next = color;
  const patch: Record<string, string> = { primaryColor: next };
  const primary = lower(chat.primaryColor, "#10a37f");
  const followed = (key: (typeof BRAND_FOLLOWER_KEYS)[number]) => {
    if (scope === "whole") return true;
    if (key === "titleColor") return !chat.titleColor || lower(chat.titleColor, "") === contrastColor(primary);
    if (key === "activeTabBackgroundColor") return lower(chat.activeTabBackgroundColor, "") === primary;
    return lower(chat[key], primary) === primary;
  };
  for (const key of BRAND_FOLLOWER_KEYS) {
    if (key === "activeTabBackgroundColor" && !chat.activeTabBackgroundColor) continue;
    if (followed(key)) patch[key] = brandFollowerValue(key, next);
  }
  return patch;
}

/**
 * Aspetto > Colore's history (card qa3yfqhbam03): the brand colors this
 * widget was saved with, newest first. It lives in chat_config.recentColors,
 * so every admin of the site sees the same one, and the server writes it
 * (AlphaRecall_Settings::recent_colors): a color counts once it is saved, not while
 * the picker is dragged through it.
 */
export const RECENT_COLORS_MAX = 8;

/** "#ABC" or " #aabbcc " as "#aabbcc"; "" for anything that is not a hex color (a gradient, a name). */
export function normalizeHex(value: unknown): string {
  if (typeof value !== "string") return "";
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  return "";
}

/** A saved history as the editor shows it: hex colors only, no repeats (case-insensitive), at most RECENT_COLORS_MAX. */
export function recentColorsOf(value: unknown): string[] {
  const colors: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const hex = normalizeHex(item);
    if (hex && !colors.includes(hex)) colors.push(hex);
    if (colors.length >= RECENT_COLORS_MAX) break;
  }
  return colors;
}

/**
 * The history after a save, as AlphaRecall_Settings::recent_colors computes it (the
 * dev server's mock uses this): the saved brand color first, then the stored
 * history without it. With no history yet, only a save that changes the
 * color starts one, with the color the widget had before as its second entry
 * (so the first change can be undone in one click); saving the title or any
 * other setting keeps the default swatches.
 * What the client sends as recentColors is ignored: a tab open since
 * yesterday must not overwrite what another admin saved.
 */
export function nextRecentColors(saved: Record<string, unknown>, stored: Record<string, unknown>): string[] {
  const primary = normalizeHex(saved.primaryColor ?? stored.primaryColor);
  const history = recentColorsOf(stored.recentColors);
  if (history.length) return recentColorsOf([primary, ...history]);
  const previous = normalizeHex(stored.primaryColor);
  if (!primary || primary === previous) return [];
  return recentColorsOf([primary, previous]);
}

export type BrandChoice = {
  value: string;
  /** The i18n name of a default color (widget.editor.colorBlue ...), null for any other color. */
  label: string | null;
  /** From the history (chat_config.recentColors), not a default slot. */
  recent: boolean;
};

/**
 * The swatches after the picker (card xke7mxbwa4tk): always as many slots as
 * there are default colors, so one saved color does not empty the row. The
 * history takes the slots from the left, newest first; the slots left keep the
 * default colors in their order, without the ones the history already shows.
 * More history than slots: the oldest colors are not shown (the server keeps
 * up to RECENT_COLORS_MAX).
 */
export function brandChoices(history: string[]): BrandChoice[] {
  const slots = COLOR_SWATCHES.length;
  const recent = recentColorsOf(history).slice(0, slots);
  const nameOf = (value: string) => COLOR_SWATCHES.find((swatch) => swatch.value === value)?.label ?? null;
  const defaults = COLOR_SWATCHES.filter((swatch) => !recent.includes(swatch.value)).slice(0, slots - recent.length);
  return [
    ...recent.map((value) => ({ value, label: nameOf(value), recent: true })),
    ...defaults.map((swatch) => ({ value: swatch.value, label: swatch.label, recent: false })),
  ];
}

/**
 * The swatches while the owner is choosing among them. The saved history
 * moves a re-applied color to the front, and a first save turns a default
 * slot into a recent one, but a row that reorders under the pointer (or under
 * the arrow keys of the radio group) would put a different color under the
 * next click: a color already shown keeps its slot (and its name), a newly
 * saved one takes the slot of a color that left the row, and the row keeps
 * its length.
 */
export function stableChoices(shown: BrandChoice[], next: BrandChoice[]): BrandChoice[] {
  const nextValues = new Set(next.map((choice) => choice.value));
  const fresh = next.filter((choice) => !shown.some((old) => old.value === choice.value));
  const kept = shown.flatMap((choice) => {
    if (nextValues.has(choice.value)) return [choice];
    const replacement = fresh.shift();
    return replacement ? [replacement] : [];
  });
  return [...kept, ...fresh];
}
