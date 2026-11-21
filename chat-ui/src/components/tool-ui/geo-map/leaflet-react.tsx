"use client";

/**
 * Minimal React bindings for Leaflet (BSD-2-Clause), just the components the
 * geo-map card uses. They replace react-leaflet, whose Hippocratic License is
 * not GPL-compatible, so the plugin could not ship it on WordPress.org.
 *
 * Same model as react-leaflet: <MapContainer> creates the map and provides it
 * through context; a layer component creates its Leaflet layer once, keeps it
 * in step with its props and adds it to the map; <Popup> and <Tooltip> bind to
 * the layer they are nested in and render their children into it with a
 * portal.
 */

import * as L from "leaflet";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type LatLngTuple = [number, number];
type EventHandlers = L.LeafletEventHandlerFnMap;

const MapContext = createContext<L.Map | null>(null);

/** Drops undefined keys: Leaflet's setOptions would let them shadow its defaults. */
function defined<T extends object>(options: T): Partial<T> {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as Partial<T>;
}
/** The marker or path a nested <Popup>/<Tooltip> attaches to. */
const LayerContext = createContext<L.Layer | null>(null);

export function useMap(): L.Map {
  const map = useContext(MapContext);
  if (!map) {
    throw new Error("useMap() must be used inside <MapContainer>");
  }
  return map;
}

/** Subscribes to map events for as long as the component is mounted. */
export function useMapEvents(handlers: EventHandlers): L.Map {
  const map = useMap();
  useEffect(() => {
    map.on(handlers);
    return () => {
      map.off(handlers);
    };
  }, [map, handlers]);
  return map;
}

/** Binds `handlers` to a Leaflet evented object while they are set. */
function useEventHandlers(target: L.Evented, handlers: EventHandlers | undefined) {
  useEffect(() => {
    if (!handlers) return;
    target.on(handlers);
    return () => {
      target.off(handlers);
    };
  }, [target, handlers]);
}

/** Adds `layer` to the map on mount and removes it on unmount. */
function useAddToMap(layer: L.Layer) {
  const map = useMap();
  useEffect(() => {
    layer.addTo(map);
    return () => {
      // The map may already be gone (MapContainer unmounts first): nothing to detach then.
      if (map.hasLayer(layer)) map.removeLayer(layer);
    };
  }, [map, layer]);
}

export function MapContainer({
  center,
  zoom,
  zoomControl = true,
  scrollWheelZoom = true,
  className,
  children,
}: {
  center: LatLngTuple;
  zoom: number;
  zoomControl?: boolean;
  scrollWheelZoom?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  // Like react-leaflet, center/zoom/options are initial values only: the card
  // moves the view itself (ViewportController) after the map exists.
  const initial = useRef({ center, zoom, zoomControl, scrollWheelZoom });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const { center: c, zoom: z, zoomControl: zc, scrollWheelZoom: swz } = initial.current;
    const instance = L.map(element, { center: c, zoom: z, zoomControl: zc, scrollWheelZoom: swz });
    // Only the map data's own licence notice is shown: no "Leaflet" link on the owner's site.
    instance.attributionControl?.setPrefix(false);
    setMap(instance);
    return () => {
      instance.remove();
      setMap(null);
    };
  }, []);

  return (
    <div ref={containerRef} className={className}>
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
    </div>
  );
}

export function ZoomControl({ position = "topleft" }: { position?: L.ControlPosition }) {
  const map = useMap();
  useEffect(() => {
    const control = L.control.zoom({ position });
    control.addTo(map);
    return () => {
      control.remove();
    };
  }, [map, position]);
  return null;
}

export function TileLayer({
  url,
  attribution,
  eventHandlers,
}: {
  url: string;
  attribution?: string;
  eventHandlers?: EventHandlers;
}) {
  const map = useMap();
  const [layer, setLayer] = useState<L.TileLayer | null>(null);
  useEffect(() => {
    const created = L.tileLayer(url, defined({ attribution }));
    created.addTo(map);
    setLayer(created);
    return () => {
      created.remove();
    };
  }, [map, url, attribution]);
  useEffect(() => {
    if (!layer || !eventHandlers) return;
    layer.on(eventHandlers);
    return () => {
      layer.off(eventHandlers);
    };
  }, [layer, eventHandlers]);
  return null;
}

export function Marker({
  position,
  icon,
  title,
  alt,
  eventHandlers,
  children,
}: {
  position: LatLngTuple;
  icon?: L.Icon | L.DivIcon;
  title?: string;
  alt?: string;
  eventHandlers?: EventHandlers;
  children?: ReactNode;
}) {
  const [marker] = useState(() =>
    L.marker(position, { ...(icon ? { icon } : {}), title: title ?? "", alt: alt ?? "" }),
  );
  useAddToMap(marker);
  useEventHandlers(marker, eventHandlers);
  useEffect(() => {
    marker.setLatLng(position);
  }, [marker, position[0], position[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (icon) marker.setIcon(icon);
  }, [marker, icon]);
  useEffect(() => {
    // title/alt are creation options in Leaflet; keep the rendered element in step.
    const element = marker.getElement();
    if (!element) return;
    if (title !== undefined) element.setAttribute("title", title);
    if (alt !== undefined && element instanceof HTMLImageElement) element.alt = alt;
  }, [marker, title, alt]);
  return <LayerContext.Provider value={marker}>{children}</LayerContext.Provider>;
}

export function CircleMarker({
  center,
  radius,
  pathOptions,
  eventHandlers,
  children,
}: {
  center: LatLngTuple;
  radius: number;
  pathOptions?: L.PathOptions;
  eventHandlers?: EventHandlers;
  children?: ReactNode;
}) {
  const [circle] = useState(() => L.circleMarker(center, { ...pathOptions, radius }));
  useAddToMap(circle);
  useEventHandlers(circle, eventHandlers);
  useEffect(() => {
    circle.setLatLng(center);
  }, [circle, center[0], center[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    circle.setRadius(radius);
  }, [circle, radius]);
  const style = JSON.stringify(pathOptions ?? {});
  useEffect(() => {
    if (pathOptions) circle.setStyle(pathOptions);
  }, [circle, style]); // eslint-disable-line react-hooks/exhaustive-deps
  return <LayerContext.Provider value={circle}>{children}</LayerContext.Provider>;
}

export function Polyline({
  positions,
  pathOptions,
  eventHandlers,
  children,
}: {
  positions: LatLngTuple[];
  pathOptions?: L.PolylineOptions;
  eventHandlers?: EventHandlers;
  children?: ReactNode;
}) {
  const [line] = useState(() => L.polyline(positions, pathOptions));
  useAddToMap(line);
  useEventHandlers(line, eventHandlers);
  const points = JSON.stringify(positions);
  useEffect(() => {
    line.setLatLngs(positions);
  }, [line, points]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = JSON.stringify(pathOptions ?? {});
  useEffect(() => {
    if (pathOptions) line.setStyle(pathOptions);
  }, [line, style]); // eslint-disable-line react-hooks/exhaustive-deps
  return <LayerContext.Provider value={line}>{children}</LayerContext.Provider>;
}

function useParentLayer(component: string): L.Layer {
  const layer = useContext(LayerContext);
  if (!layer) {
    throw new Error(`<${component}> must be nested in a marker or a path`);
  }
  return layer;
}

export function Popup({
  className,
  closeButton = true,
  closeOnEscapeKey = true,
  minWidth,
  maxWidth,
  eventHandlers,
  children,
}: {
  className?: string;
  closeButton?: boolean;
  closeOnEscapeKey?: boolean;
  minWidth?: number;
  maxWidth?: number;
  eventHandlers?: EventHandlers;
  children?: ReactNode;
}) {
  const layer = useParentLayer("Popup");
  const [content] = useState(() => document.createElement("div"));
  const [popup] = useState(() => {
    const created = L.popup(defined({ className, closeButton, closeOnEscapeKey, minWidth, maxWidth }));
    created.setContent(content);
    return created;
  });
  useEventHandlers(popup, eventHandlers);
  useEffect(() => {
    layer.bindPopup(popup);
    return () => {
      layer.unbindPopup();
    };
  }, [layer, popup]);
  useEffect(() => {
    // Re-measure after React changed the content of an open popup.
    if (popup.isOpen()) popup.update();
  });
  return createPortal(children, content);
}

export function Tooltip({
  direction = "auto",
  permanent = false,
  className,
  children,
}: {
  direction?: L.Direction;
  permanent?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const layer = useParentLayer("Tooltip");
  const [content] = useState(() => document.createElement("div"));
  useEffect(() => {
    const tooltip = L.tooltip(defined({ direction, permanent, className }));
    tooltip.setContent(content);
    layer.bindTooltip(tooltip);
    return () => {
      layer.unbindTooltip();
    };
  }, [layer, content, direction, permanent, className]);
  return createPortal(children, content);
}
