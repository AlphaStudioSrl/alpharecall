/**
 * Brand-derived header colors, shared by the widget (app.tsx) and the admin
 * live preview so the two can never drift apart (board card 1d1k60cjaawb).
 *
 * The branded header paints a gradient from the tenant's primary color; the
 * title (15px/600) and the status line (12px) sit on top of it, so both
 * gradient stops must clear WCAG AA (4.5:1) against the text color
 * (board card rjvide6yfrwt). Tenants pick arbitrary brand colors, so the
 * stops are computed, not fixed: the light stop is darkened (or lightened,
 * for dark-on-light headers) until the contrast holds.
 */

export interface BrandHeaderColors {
  /** Text color used for the header title, status and buttons. */
  onBrand: string;
  /** 135deg gradient start — AA-safe against onBrand. */
  gradStart: string;
  /** Gradient end — darker (or lighter) than the start, also AA-safe. */
  gradEnd: string;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const toHex = (rgb: [number, number, number]): string =>
  "#" + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");

function channelLum(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(rgb: [number, number, number]): number {
  return 0.2126 * channelLum(rgb[0]) + 0.7152 * channelLum(rgb[1]) + 0.0722 * channelLum(rgb[2]);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB mix, matching CSS `color-mix(in srgb, color amount%, target)`. */
function mix(
  rgb: [number, number, number],
  target: [number, number, number],
  amountOfTarget: number
): [number, number, number] {
  return [
    rgb[0] + (target[0] - rgb[0]) * amountOfTarget,
    rgb[1] + (target[1] - rgb[1]) * amountOfTarget,
    rgb[2] + (target[2] - rgb[2]) * amountOfTarget,
  ] as [number, number, number];
}

/** AA text on the actual tenant fill. YIQ brightness misclassifies saturated
 * blues/greens; use WCAG luminance, with pure black for the narrow interval
 * where neither white nor near-black reaches 4.5:1. */
export function contrastColor(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#ffffff";
  if (contrastRatio(rgb, [255, 255, 255]) >= 4.5) return "#ffffff";
  return contrastRatio(rgb, [11, 11, 11]) >= 4.5 ? "#0b0b0b" : "#000000";
}

const AA = 4.5;
// Slight headroom so rounding to hex never lands a stop at 4.49:1.
const TARGET = 4.6;

/** The pole (black or white) that can reach the higher contrast vs `text`. */
function contrastPole(text: [number, number, number]): [number, number, number] {
  const lum = relativeLuminance(text);
  const blackReach = (lum + 0.05) / 0.05;
  const whiteReach = 1.05 / (lum + 0.05);
  return blackReach >= whiteReach ? [0, 0, 0] : [255, 255, 255];
}

/** Push `stop` toward the better pole until AA holds (or the pole is reached). */
function ensureContrast(
  stop: [number, number, number],
  text: [number, number, number]
): [number, number, number] {
  if (contrastRatio(stop, text) >= AA) return stop;
  const target = contrastPole(text);
  let adjusted = stop;
  for (let amount = 0.05; amount <= 1.0; amount += 0.05) {
    adjusted = mix(stop, target, amount);
    if (contrastRatio(adjusted, text) >= TARGET) break;
  }
  return adjusted;
}

export function brandHeaderColors(primaryHex: string, titleColorHex?: string): BrandHeaderColors {
  const primary = parseHex(primaryHex) ?? ([16, 163, 127] as [number, number, number]);
  const configured = titleColorHex ? parseHex(titleColorHex) : null;
  const onBrand = configured ? toHex(configured) : contrastColor(toHex(primary));
  const text = parseHex(onBrand) as [number, number, number];

  const start = ensureContrast(primary, text);
  // Preserve the original 135deg depth: the far stop sits 26% deeper toward
  // the same pole the contrast fix uses, then gets the same AA guarantee.
  const end = ensureContrast(mix(start, contrastPole(text), 0.26), text);

  return { onBrand, gradStart: toHex(start), gradEnd: toHex(end) };
}
