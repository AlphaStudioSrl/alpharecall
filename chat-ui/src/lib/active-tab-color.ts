import type { CSSProperties } from "react";
import { contrastColor, parseHex } from "./brand-color";

/** Same solid #RGB/#RRGGBB contract as WordPress sanitize_hex_color. */
export function activeTabColorVars(value: unknown): CSSProperties {
  if (typeof value !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return {};
  const rgb = parseHex(value);
  if (!rgb) return {};
  const background = "#" + rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("");
  return {
    "--ar-active-tab-bg": background,
    "--ar-active-tab-fg": contrastColor(background),
  } as CSSProperties;
}

// Full CSS colors (not HSL channels). Missing/empty config keeps the existing
// light/dark neutral surfaces. Support chat can consume this same token pair.
export const activeTabStyle: CSSProperties = {
  backgroundColor: "var(--ar-active-tab-bg, hsl(var(--ar-selected)))",
  color: "var(--ar-active-tab-fg, hsl(var(--ar-control-text)))",
};
