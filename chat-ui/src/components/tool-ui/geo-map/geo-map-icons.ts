import type { DivIcon } from "leaflet";
import type { GeoMapMarker } from "./schema";

type LeafletIconRuntime = Pick<typeof import("leaflet"), "divIcon">;

function isSafeHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Icon colours are interpolated into Leaflet's divIcon HTML. Keep the same
// constrained colour syntax used by chart rendering and reject CSS escapes,
// comments, and url() values before they reach innerHTML.
const SAFE_COLOR_PATTERN = /^[A-Za-z0-9_#().,%/*+\- ]+$/;

function safeColor(value: string | undefined, fallback: string): string {
  if (!value || !SAFE_COLOR_PATTERN.test(value) || /\/\*|\*\//.test(value) || /url\s*\(/i.test(value)) {
    return fallback;
  }
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")" && --depth < 0) return fallback;
  }
  return depth === 0 ? value : fallback;
}

function createEmojiIcon(
  icon: Extract<NonNullable<GeoMapMarker["icon"]>, { type: "emoji" }>,
  leafletRuntime: LeafletIconRuntime,
): DivIcon {
  const size = icon.size ?? 24;
  const background = safeColor(icon.bgColor, "var(--card)");
  const border = safeColor(icon.borderColor, "var(--border)");

  return leafletRuntime.divIcon({
    className: "",
    html: `<span style="
display:flex;
align-items:center;
justify-content:center;
width:${size}px;
height:${size}px;
border-radius:999px;
background:${background};
border:1px solid ${border};
font-size:${Math.round(size * 0.62)}px;
line-height:1;
box-shadow:0 1px 3px oklch(from var(--foreground) l c h / 0.22);
">${escapeHtml(icon.value)}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -Math.round(size / 2)],
    tooltipAnchor: [0, -Math.round(size / 2)],
  });
}

function createImageIcon(
  icon: Extract<NonNullable<GeoMapMarker["icon"]>, { type: "image" }>,
  leafletRuntime: LeafletIconRuntime,
): DivIcon {
  const width = icon.width ?? 28;
  const height = icon.height ?? 28;
  const borderRadius = icon.borderRadius ?? Math.min(width, height) / 2;
  const border = safeColor(icon.borderColor, "var(--border)");

  return leafletRuntime.divIcon({
    className: "",
    html: `<span style="
display:block;
width:${width}px;
height:${height}px;
border-radius:${borderRadius}px;
overflow:hidden;
border:1px solid ${border};
background:var(--card);
box-shadow:0 1px 3px oklch(from var(--foreground) l c h / 0.22);
"><img src="${escapeHtml(icon.url)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;" /></span>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
    popupAnchor: [0, -Math.round(height / 2)],
    tooltipAnchor: [0, -Math.round(height / 2)],
  });
}

export function createClusterIcon(
  count: number,
  leafletRuntime: LeafletIconRuntime,
): DivIcon {
  const size = count >= 100 ? 42 : count >= 10 ? 38 : 34;
  const background = "var(--primary)";
  const border = "var(--background)";

  return leafletRuntime.divIcon({
    className: "",
    html: `<span style="
display:flex;
align-items:center;
justify-content:center;
width:${size}px;
height:${size}px;
border-radius:999px;
background:${background};
border:2px solid ${border};
color:var(--primary-foreground);
font-size:12px;
font-weight:700;
line-height:1;
box-shadow:0 2px 6px oklch(from var(--foreground) l c h / 0.25);
">${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -Math.round(size / 2)],
    tooltipAnchor: [0, -Math.round(size / 2)],
  });
}

export function resolveMarkerIcon(
  icon: GeoMapMarker["icon"] | undefined,
  leafletRuntime: LeafletIconRuntime,
): DivIcon | null {
  if (icon?.type === "emoji") {
    return createEmojiIcon(icon, leafletRuntime);
  }

  if (icon?.type === "image" && isSafeHttpUrl(icon.url)) {
    return createImageIcon(icon, leafletRuntime);
  }

  return null;
}
