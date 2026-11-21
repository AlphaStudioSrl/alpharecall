import type * as Leaflet from "leaflet";
import type { GridLayer } from "leaflet";
import type { BasemapFlavor } from "./map-tiles";

/**
 * Loader for plugin/assets/js/chat-maps.js (entry src/maps-runtime/main.ts),
 * the Protomaps renderer. The chat bundle is a single IIFE that cannot split
 * chunks, so the renderer ships as a sibling script and is injected the first
 * time a map needs it: a visitor who never sees a map never downloads it.
 */

export interface PmtilesLayerOptions {
  url: string;
  flavor: BasemapFlavor;
  lang: string;
  attribution: string;
}

export interface MapsRuntime {
  version: 1;
  createPmtilesLayer(leaflet: typeof Leaflet, options: PmtilesLayerOptions): Promise<GridLayer>;
}

declare global {
  interface Window {
    AlphaRecallMapsRuntime?: MapsRuntime;
  }
}

// document.currentScript is only set while the bundle itself evaluates.
const loadingScriptSrc =
  typeof document !== "undefined"
    ? ((document.currentScript as HTMLScriptElement | null)?.src ?? "")
    : "";

/**
 * Where chat-maps.js lives: the plugin passes config.mapsRuntimeUrl; without
 * it (admin previews) the file sits next to the bundle that loaded this code.
 */
export function mapsRuntimeUrl(
  configured: unknown = typeof window !== "undefined"
    ? (window as any).AlphaRecallChat?.config?.mapsRuntimeUrl
    : undefined,
  scriptSrc: string = loadingScriptSrc,
): string | null {
  if (typeof configured === "string" && /^(https?:)?\/\//.test(configured)) return configured;
  if (!scriptSrc) return null;
  try {
    const url = new URL(scriptSrc);
    if (!/\/assets\/js\/[^/]+\.js$/.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/[^/]+$/, "chat-maps.js");
    return url.href;
  } catch {
    return null;
  }
}

let pending: Promise<MapsRuntime> | null = null;

export function loadMapsRuntime(): Promise<MapsRuntime> {
  if (window.AlphaRecallMapsRuntime) return Promise.resolve(window.AlphaRecallMapsRuntime);
  if (pending) return pending;
  const src = mapsRuntimeUrl();
  if (!src) return Promise.reject(new Error("AlphaRecall: map renderer URL unknown"));
  pending = new Promise<MapsRuntime>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.alpharecall = "maps-runtime";
    script.onload = () => {
      const runtime = window.AlphaRecallMapsRuntime;
      if (runtime) resolve(runtime);
      else reject(new Error("AlphaRecall: map renderer did not register"));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`AlphaRecall: map renderer failed to load (${src})`));
    };
    document.head.appendChild(script);
  }).catch((error) => {
    // Let a later map retry instead of caching the failure for the page.
    pending = null;
    throw error;
  });
  return pending;
}
