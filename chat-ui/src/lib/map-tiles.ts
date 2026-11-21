/**
 * Basemap selection for the widget maps.
 *
 * Maps render from a self-hosted Protomaps archive (one .pmtiles file served
 * with HTTP Range requests), so a visitor's browser never calls a third-party
 * tile service. The platform bakes the archive URL into the plugin
 * (ALPHARECALL_MAP_PMTILES_URL, see plugin/config.php) and a site can override
 * it in wp-config.php; the widget reads it as config.mapPmtilesUrl.
 *
 * Providers (tenant setting map_tile_provider, config.mapTileProvider):
 *   - "protomaps" (default; the legacy "carto" value means the same now)
 *   - "osm_selfhost": the tenant's own raster tile server (https only)
 *   - "none": privacy kill switch, no basemap at all
 * With no usable archive URL the result is null and the card shows its
 * address, hours and buttons without a map, never a watermarked image.
 */

export type TileProvider = "protomaps" | "osm_selfhost" | "none";
export type TileTheme = "default" | "dark" | "light" | "satellite";
export type BasemapFlavor = "light" | "dark";

export type Basemap =
  | { kind: "pmtiles"; url: string; flavor: BasemapFlavor; lang: string; attribution: string }
  | { kind: "raster"; url: string; attribution: string };

export interface MapTileConfig {
  mapTileProvider?: string | null;
  mapPmtilesUrl?: string | null;
  mapOsmSelfhostUrl?: string | null;
  /** Label language, e.g. "it". Defaults to the widget language. */
  mapLanguage?: string | null;
}

export const MAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> &middot; <a href="https://protomaps.com" target="_blank" rel="noopener noreferrer">Protomaps</a>';
const RASTER_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

function normalizeProvider(value: unknown): TileProvider {
  if (value === "none" || value === "osm_selfhost") return value;
  // null, undefined, "protomaps" and the retired "carto" all mean the default.
  return "protomaps";
}

/**
 * An archive URL the widget may fetch: https anywhere, plain http only on the
 * page's own origin (a local test site), and the path must name a .pmtiles
 * file because protomaps-leaflet picks the source type from it.
 */
export function safePmtilesUrl(value: unknown, pageUrl?: string): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const base = pageUrl ?? (typeof window !== "undefined" ? window.location.href : "https://localhost/");
  let parsed: URL;
  try {
    parsed = new URL(value.trim(), base);
  } catch {
    return null;
  }
  if (!parsed.pathname.endsWith(".pmtiles")) return null;
  if (parsed.protocol === "https:") return parsed.href;
  if (parsed.protocol === "http:" && parsed.origin === new URL(base).origin) return parsed.href;
  return null;
}

function labelLanguage(config?: MapTileConfig): string {
  const configured = config?.mapLanguage
    ?? (typeof window !== "undefined" ? (window as any).AlphaRecallChat?.language : null);
  const code = String(configured || "it").toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(code) ? code : "it";
}

/** Resolve the basemap for a light or dark map, or null when there is none. */
export function resolveBasemap(theme: BasemapFlavor, config?: MapTileConfig): Basemap | null {
  const provider = normalizeProvider(config?.mapTileProvider);
  if (provider === "none") return null;
  if (provider === "osm_selfhost") {
    const url = config?.mapOsmSelfhostUrl || "";
    return url.startsWith("https://") ? { kind: "raster", url, attribution: RASTER_ATTRIBUTION } : null;
  }
  const url = safePmtilesUrl(config?.mapPmtilesUrl);
  if (!url) return null;
  return { kind: "pmtiles", url, flavor: theme, lang: labelLanguage(config), attribution: MAP_ATTRIBUTION };
}

/**
 * The tambo map's tile themes. "default" and "satellite" used to call
 * tile.openstreetmap.org and ArcGIS; nothing in the widget needs satellite
 * imagery, so both now draw the light self-hosted basemap.
 */
export function resolveThemedBasemap(tileTheme: TileTheme, config?: MapTileConfig): Basemap | null {
  return resolveBasemap(tileTheme === "dark" ? "dark" : "light", config);
}

/** The basemap settings the plugin passes in window.AlphaRecallChat.config. */
export function widgetMapConfig(): MapTileConfig | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as any).AlphaRecallChat?.config;
}
