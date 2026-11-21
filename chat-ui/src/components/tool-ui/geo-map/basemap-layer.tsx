"use client";

import * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import { TileLayer, useMap } from "./_adapter";
import type { Basemap } from "@/lib/map-tiles";
import { loadMapsRuntime } from "@/lib/maps-runtime";

export type BasemapState = "ready" | "failed";

/**
 * The map's background layer: a self-hosted Protomaps archive drawn by the
 * lazily loaded renderer, or a tenant's own raster tile server.
 */
export function BasemapLayer({
  basemap,
  onStateChange,
}: {
  basemap: Basemap;
  onStateChange?: (state: BasemapState) => void;
}) {
  if (basemap.kind === "raster") {
    return (
      <TileLayer
        attribution={basemap.attribution}
        url={basemap.url}
        eventHandlers={{
          load: () => onStateChange?.("ready"),
        }}
      />
    );
  }
  return <PmtilesLayer basemap={basemap} onStateChange={onStateChange} />;
}

function PmtilesLayer({
  basemap,
  onStateChange,
}: {
  basemap: Extract<Basemap, { kind: "pmtiles" }>;
  onStateChange?: (state: BasemapState) => void;
}) {
  const map = useMap();
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const { url, flavor, lang, attribution } = basemap;

  useEffect(() => {
    let layer: Leaflet.GridLayer | null = null;
    let cancelled = false;
    loadMapsRuntime()
      .then((runtime) => runtime.createPmtilesLayer(Leaflet, { url, flavor, lang, attribution }))
      .then((created) => {
        if (cancelled) return;
        layer = created;
        layer.once("load", () => onStateChangeRef.current?.("ready"));
        layer.addTo(map);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn("[AlphaRecall] map background unavailable:", error);
        onStateChangeRef.current?.("failed");
      });
    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, url, flavor, lang, attribution]);

  return null;
}
