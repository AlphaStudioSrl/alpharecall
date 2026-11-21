/**
 * Entry of plugin/assets/js/chat-maps.js, the lazily loaded map renderer.
 * The chat bundle injects this script the first time a map with a Protomaps
 * basemap mounts (src/lib/maps-runtime.ts), so visitors who never see a map
 * never download it.
 */
import type { GridLayer } from "leaflet";
import { PMTiles } from "pmtiles";
import { labelRules, leafletLayer, paintRules } from "protomaps-leaflet";
import type { MapsRuntime } from "@/lib/maps-runtime";
import { widgetFlavor } from "./flavors";
import { bindLeaflet } from "./leaflet-ref";

// One archive per URL: every map card shares the header and directory cache.
const archives = new Map<string, PMTiles>();

const runtime: MapsRuntime = {
  version: 1,
  async createPmtilesLayer(leaflet, { url, flavor, lang, attribution }) {
    let archive = archives.get(url);
    if (!archive) {
      archive = new PMTiles(url);
      archives.set(url, archive);
    }
    let maxZoom: number;
    try {
      // The header says how deep the extract goes (14 or 15); deeper zooms
      // overzoom that level instead of asking for tiles that do not exist.
      maxZoom = (await archive.getHeader()).maxZoom;
    } catch (error) {
      archives.delete(url);
      throw error;
    }
    const tuned = widgetFlavor(flavor);
    bindLeaflet(leaflet);
    return leafletLayer({
      url: archive,
      paintRules: paintRules(tuned),
      labelRules: labelRules(tuned, lang),
      backgroundColor: tuned.background,
      maxDataZoom: maxZoom,
      attribution,
    }) as unknown as GridLayer;
  },
};

window.AlphaRecallMapsRuntime = runtime;
