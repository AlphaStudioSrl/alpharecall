import { Building2, Clock, Mail, MapPin, Moon, Phone } from "lucide-react";
import { cardCopy } from "@/lib/card-copy";
import { widgetCopy } from "@/lib/widget-copy";
import { hoursRows, localNow, normalizeHours, openState, type BusinessHours } from "@/components/tool-ui/geo-map/geo-map-hours";

export type BusinessInfo = {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  hours?: BusinessHours | string | null;
  timezone?: string;
  map_url?: string;
  mapUrl?: string;
};

const safeHref = (value?: string) => {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};
const telHref = (phone?: string) => {
  const digits = (phone || "").replace(/[^\d+]/g, "");
  return digits.length >= 5 ? `tel:${digits}` : null;
};
const mailHref = (email?: string) => (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : null);

/**
 * Business details when the profile has no coordinates for a map: where, when
 * (open now or when it reopens) and one tap to call or get directions.
 */
export function InfoCard({ info }: { info: BusinessInfo }) {
  const copy = cardCopy();
  const wcopy = widgetCopy();
  // Model-written hours use any day keys ("monday", "lun-ven"): normalised to mon..sun or nothing.
  const hours = normalizeHours(info.hours);
  const hoursText = typeof info.hours === "string" ? info.hours.trim() : "";
  const hasHours = !!hours && Object.values(hours).some((v) => typeof v === "string" && v.trim());
  const now = hasHours ? localNow(info.timezone) : null;
  const rows = hours && hasHours && now ? hoursRows(hours, now.day) : [];
  const status = hours && hasHours && now ? openState(hours, now) : null;
  const call = telHref(info.phone);
  const mail = mailHref(info.email);
  const directions = safeHref(info.mapUrl || info.map_url)
    || (info.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address)}` : null);
  if (!info.name && !info.address && !hasHours && !hoursText && !call && !mail) return null;

  return (
    <section className="ar-card ar-info-card" aria-label={info.name || wcopy.hours}>
      <div className="ar-card-head">
        <Building2 aria-hidden="true" className="ar-card-icon" />
        <div className="ar-card-heading">
          {info.name ? <h3 className="ar-card-title">{info.name}</h3> : null}
          {info.address ? <p className="ar-card-sub">{info.address}</p> : null}
        </div>
      </div>
      {status ? (
        <p className="ar-info-status" data-open={status.open ? "true" : "false"}>
          {status.open ? <span className="ar-live-dot" aria-hidden="true" /> : <Moon aria-hidden="true" />}
          <b>{status.open ? wcopy.openNow : wcopy.closedNow}</b>
          <span>· {status.text}</span>
        </p>
      ) : null}
      {rows.length ? (
        <dl className="ar-map-hours" aria-label={copy.infoHours}>
          {rows.map((row) => (
            <div key={row.label} className={row.today ? "is-today" : undefined}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : hoursText ? (
        <p className="ar-info-line"><Clock aria-hidden="true" />{hoursText}</p>
      ) : null}
      {call || directions || mail ? (
        <div className="ar-btn-row">
          {call ? <a className="ar-btn ar-btn--secondary" href={call}><Phone aria-hidden="true" />{copy.infoCall}</a> : null}
          {!call && mail ? <a className="ar-btn ar-btn--secondary" href={mail}><Mail aria-hidden="true" />{copy.infoEmail}</a> : null}
          {directions ? (
            <a className="ar-btn ar-btn--primary" href={directions} target="_blank" rel="noopener noreferrer">
              <MapPin aria-hidden="true" />{copy.infoDirections}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
