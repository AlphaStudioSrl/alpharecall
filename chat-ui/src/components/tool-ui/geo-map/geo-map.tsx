"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Phone } from "lucide-react";
import { hoursRows, localNow, normalizeHours, openState, type BusinessHours } from "./geo-map-hours";
import { cn } from "./_adapter";
import { GeoMapEngine } from "./geo-map-engine";
import styles from "./geo-map-theme.module.css";
import type { GeoMapMarker, GeoMapProps, GeoMapStyle } from "./schema";
import { resolveBasemap, widgetMapConfig } from "@/lib/map-tiles";
import { widgetCopy } from "@/lib/widget-copy";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getDocumentTheme(): "light" | "dark" | null {
  if (typeof document === "undefined") return null;

  const root = document.documentElement;
  const dataTheme = root.getAttribute("data-theme")?.toLowerCase();
  if (dataTheme === "dark") return "dark";
  if (dataTheme === "light") return "light";
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";

  return null;
}

function useInheritedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return getDocumentTheme() ?? getSystemTheme();
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const update = () => setTheme(getDocumentTheme() ?? getSystemTheme());

    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    mql?.addEventListener("change", update);

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => {
      mql?.removeEventListener("change", update);
      observer.disconnect();
    };
  }, []);

  return theme;
}

function resolveMapAriaLabel(title?: string, description?: string): string {
  if (title && description) {
    return `${title}. ${description}`;
  }

  return title ?? description ?? widgetCopy().map;
}

function safeHref(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

type PlaceDetails = { key: string; name: string; lines: string[]; directions: string | null };

/** A marker as text: name, then its description and address when the model sent them. */
function placeDetails(marker: GeoMapMarker, index: number, copy: ReturnType<typeof widgetCopy>): PlaceDetails {
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const valid = Number.isFinite(marker.lat) && Number.isFinite(marker.lng);
  const name = text(marker.label) ?? text(marker.description)
    ?? (valid ? copy.marker(marker.lat.toFixed(4), marker.lng.toFixed(4)) : copy.map);
  const lines = [text(marker.description), text((marker as { address?: unknown }).address)]
    .filter((line): line is string => line !== null && line !== name);
  return {
    key: marker.id ?? `place-${index}`,
    name,
    lines: [...new Set(lines)],
    directions: valid
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${marker.lat},${marker.lng}`)}`
      : null,
  };
}

function telHref(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 5 ? `tel:${digits}` : null;
}

/** The widget's own theme (data-theme on the shell) beats the host page's. */
function useWidgetTheme(ref: React.RefObject<HTMLElement | null>, fallback: "light" | "dark") {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>("[data-theme]");
    if (!host) return;
    const read = () => setTheme(host.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const observer = new MutationObserver(read);
    observer.observe(host, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [ref]);
  return theme ?? fallback;
}

export const GeoMap = memo(function GeoMap({
  id,
  role: _role,
  receipt: _receipt,
  title,
  description,
  markers,
  routes,
  clustering,
  viewport,
  showZoomControl = false,
  theme,
  className,
  style,
  tooltipClassName,
  popupClassName,
  onMarkerClick,
  onRouteClick,
  address,
  phone,
  hours,
  timezone,
  mapUrl,
  map_url,
}: GeoMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inheritedTheme = useInheritedTheme();
  const widgetTheme = useWidgetTheme(rootRef, inheritedTheme);
  const resolvedTheme = theme ?? widgetTheme;
  const [isMapReady, setIsMapReady] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const copy = widgetCopy();
  const mapFlavor = resolvedTheme === "dark" ? "dark" : "light";
  const basemap = useMemo(() => resolveBasemap(mapFlavor, widgetMapConfig()), [mapFlavor]);
  const mapAriaLabel = resolveMapAriaLabel(title, description || address);
  const resolvedRootStyle: GeoMapStyle = {
    "--geo-map-canvas-bg": "var(--ar-fill-2, hsl(var(--muted)))",
    "--geo-map-tooltip-bg": "var(--ar-brand, hsl(var(--primary)))",
    "--geo-map-tooltip-fg": "var(--ar-brand-ink, #fff)",
    "--geo-map-tooltip-radius": "999px",
    "--geo-map-tooltip-padding": "4px 10px",
    "--geo-map-tooltip-font-size": "12px",
    "--geo-map-tooltip-shadow": "var(--ar-sh-float, 0 6px 16px rgb(0 0 0 / 18%))",
    ...style,
  };

  // Model-written components arrive unvalidated: odd day keys or non-text
  // values must not render a week of "Chiuso", nor throw.
  const weekHours: BusinessHours | null = useMemo(() => normalizeHours(hours), [hours]);
  const hasHours = weekHours !== null;
  const now = weekHours ? localNow(timezone) : null;
  const rows = weekHours && now ? hoursRows(weekHours, now.day) : [];
  const status = weekHours && now ? openState(weekHours, now) : null;
  const single = markers.length === 1 ? markers[0] : null;
  // A lone place keeps its name pinned on the map, like a label on a sign.
  const shownMarkers = useMemo(
    () => (markers.length === 1 ? markers.map((m) => ({ ...m, tooltip: m.tooltip ?? ("always" as const) })) : markers),
    [markers],
  );
  const directions = safeHref(mapUrl || map_url) || (single
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${single.lat},${single.lng}`)}`
    : null);
  const call = telHref(phone);
  // Without a basemap (none configured, privacy switch, or it failed to load)
  // a pin on a blank canvas says nothing: the card keeps its address, hours
  // and buttons, and only an otherwise empty card shows the placeholder.
  const showMap = basemap !== null && !basemapFailed;
  // Without the map the places themselves become the content: several pins,
  // or a lone pin whose card carries no address of its own.
  const places = !showMap && (markers.length > 1 || !(address || description))
    ? markers.map((marker, index) => placeDetails(marker, index, copy))
    : [];
  const hasDetails = !!(address || description || rows.length || call || directions || places.length);

  return (
    <div
      ref={rootRef}
      className={cn("ar-card ar-map-card", styles.root, className)}
      style={resolvedRootStyle}
      data-slot="geo-map"
      data-tool-ui-id={id}
    >
      {showMap || !hasDetails ? (
      <div className="ar-map" role="region" aria-label={mapAriaLabel}>
        {!showMap || !basemap ? (
          <div className="ar-map-empty">
            <p>{copy.mapUnavailable}</p>
          </div>
        ) : (
        <GeoMapEngine
          id={id}
          markers={shownMarkers}
          routes={routes}
          clustering={clustering}
          viewport={viewport}
          showZoomControl={showZoomControl}
          basemap={basemap}
          mapAriaLabel={mapAriaLabel}
          tooltipClassName={tooltipClassName}
          popupClassName={popupClassName}
          onMarkerClick={onMarkerClick}
          onRouteClick={onRouteClick}
          onReadyChange={setIsMapReady}
          onBasemapStateChange={(state) => setBasemapFailed(state === "failed")}
        />
        )}

        {!isMapReady && showMap && (
          <div data-slot="geo-map-loading" className="ar-map-loading">
            <span data-slot="geo-map-loading-label">{copy.mapLoading}</span>
          </div>
        )}
      </div>
      ) : null}

      {places.length ? (
        <ul className={styles.places} aria-label={title || copy.map}>
          {places.map((place) => (
            <li key={place.key} className={styles.place}>
              <div className={styles.placeText}>
                <b>{place.name}</b>
                {place.lines.map((line) => <span key={line}>{line}</span>)}
              </div>
              {place.directions && markers.length > 1 ? (
                <a className={styles.placeLink} href={place.directions} target="_blank" rel="noopener noreferrer">
                  <MapPin aria-hidden="true" />{copy.directions}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {(address || description) && (!hasHours || !showMap) ? (
        <p className="ar-map-address">{address || description}</p>
      ) : null}

      {status ? (
        <p className="ar-map-status" data-open={status.open ? "true" : "false"}>
          <span className="ar-status-dot" aria-hidden="true" />
          <b>{status.open ? copy.openNow : copy.closedNow}</b>
          <span>· {status.text}</span>
        </p>
      ) : null}

      {rows.length ? (
        <dl className="ar-map-hours" aria-label={copy.hours}>
          {rows.map((row) => (
            <div key={row.label} className={row.today ? "is-today" : undefined}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {call || directions ? (
        <div className="ar-btn-row">
          {call ? (
            <a className="ar-btn ar-btn--secondary" href={call}>
              <Phone aria-hidden="true" />{copy.call}
            </a>
          ) : null}
          {directions ? (
            <a className="ar-btn ar-btn--primary" href={directions} target="_blank" rel="noopener noreferrer">
              <MapPin aria-hidden="true" />{copy.directions}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
