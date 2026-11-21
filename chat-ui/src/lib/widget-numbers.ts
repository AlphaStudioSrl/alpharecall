/**
 * Numeric widget settings and the range each one is kept in (card b2ikiv66usde).
 * The editor clamps before autosaving, the visitor widget clamps what it reads,
 * and PHP clamps on save (AlphaRecall_Settings::WIDGET_NUMBERS): keep the three in step.
 */
export const WIDGET_NUMBERS = {
  marginX: { min: 0, max: 100, fallback: 24 },
  marginY: { min: 0, max: 100, fallback: 24 },
  radius: { min: 14, max: 32, fallback: 18 },
  buttonRadius: { min: 8, max: 999, fallback: 999 },
  panelHeight: { min: 400, max: 900, fallback: 640 },
  panelWidth: { min: 320, max: 720, fallback: 420 },
  fontScale: { min: 0.9, max: 1.2, fallback: 1, decimal: true },
  auto_open_delay: { min: 0, max: 60, fallback: 0 },
  launcherInterval: { min: 8, max: 60, fallback: 15 },
  soundVolume: { min: 0, max: 100, fallback: 35 },
} as const;

export type WidgetNumberKey = keyof typeof WIDGET_NUMBERS;

/** A usable number from a config value: numbers and numeric strings only, never "" or NaN. */
function parse(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value.trim());
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function bound(key: WidgetNumberKey, number: number): number {
  const rule = WIDGET_NUMBERS[key];
  const clamped = Math.min(rule.max, Math.max(rule.min, number));
  return "decimal" in rule ? clamped : Math.round(clamped);
}

/** `value` within its range; anything that is not a number falls back to the default. */
export function widgetNumber(key: WidgetNumberKey, value: unknown): number {
  const number = parse(value);
  return number === null ? WIDGET_NUMBERS[key].fallback : bound(key, number);
}

export type WidgetNumberInput =
  | { kind: "value"; value: number }
  | { kind: "clamped"; value: number; edge: "min" | "max" }
  | { kind: "empty" };

/**
 * What the editor does with a typed value: save it as is, save it clamped to the
 * nearest edge (and say so), or, for an empty or partial entry ("", "-"), save nothing.
 */
export function readWidgetNumber(key: WidgetNumberKey, typed: string): WidgetNumberInput {
  const number = parse(typed);
  if (number === null) return { kind: "empty" };
  const value = bound(key, number);
  const rule = WIDGET_NUMBERS[key];
  if (number < rule.min) return { kind: "clamped", value, edge: "min" };
  if (number > rule.max) return { kind: "clamped", value, edge: "max" };
  return { kind: "value", value };
}
