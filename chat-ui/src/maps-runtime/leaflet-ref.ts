import type * as Leaflet from "leaflet";

/**
 * protomaps-leaflet reads a global `L`. The maps bundle rewrites those reads
 * to this binding (vite.maps.config.ts, transform.inject), so the layer
 * extends the chat bundle's own Leaflet instead of whatever `window.L` the
 * host page loaded, and the widget never writes to `window.L`.
 */
export let L: typeof Leaflet;

export function bindLeaflet(leaflet: typeof Leaflet): void {
  L = leaflet;
}
