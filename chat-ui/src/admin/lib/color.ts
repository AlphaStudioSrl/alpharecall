/**
 * Color math for the admin color picker: parse what an owner pastes
 * (#RRGGBB, #RGB, rgb()) into the #rrggbb the widget settings store, and
 * move between hex and HSV for the saturation/brightness area and hue slider.
 */

export interface Hsv {
  /** 0-360 */
  h: number;
  /** 0-1 */
  s: number;
  /** 0-1 */
  v: number;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
// rgb(43, 89, 168), rgb(43 89 168), rgb(17%, 35%, 66%); rgba() only when fully opaque.
const RGB_RE = /^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

function channel(raw: string): number | null {
  const percent = raw.endsWith("%");
  const value = Number(percent ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(value)) return null;
  const scaled = percent ? (value / 100) * 255 : value;
  return scaled >= 0 && scaled <= 255 ? Math.round(scaled) : null;
}

function toHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

/**
 * The color the owner typed, as lowercase #rrggbb, or null when it is not one
 * we accept. The "#" is optional for hex codes ("2b59a8" works too).
 */
export function parseColorInput(input: string): string | null {
  const text = input.trim();
  const hex = HEX_RE.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return `#${digits.toLowerCase()}`;
  }
  const rgb = RGB_RE.exec(text);
  if (rgb) {
    const [r, g, b] = [channel(rgb[1]), channel(rgb[2]), channel(rgb[3])];
    if (r === null || g === null || b === null) return null;
    if (rgb[4] !== undefined) {
      const alpha = rgb[4].endsWith("%") ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
      // A see-through brand color would not be the color the widget paints.
      if (alpha !== 1) return null;
    }
    return toHex(r, g, b);
  }
  return null;
}

export function hexToHsv(hex: string): Hsv {
  const color = parseColorInput(hex) ?? "#000000";
  const r = parseInt(color.slice(1, 3), 16) / 255;
  const g = parseInt(color.slice(3, 5), 16) / 255;
  const b = parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return toHex(f(5) * 255, f(3) * 255, f(1) * 255);
}
