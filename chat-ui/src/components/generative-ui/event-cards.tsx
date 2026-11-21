import { CalendarDays, MapPin } from "lucide-react";
import { cardCopy } from "@/lib/card-copy";
import { widgetCopy } from "@/lib/widget-copy";

interface EventItem {
  title: string;
  date?: string;
  start_at?: string;
  location?: string;
  description?: string;
  image?: string;
  image_url?: string;
  max_capacity?: number;
  current_registrations?: number;
  cta_label?: string;
}

interface EventCardsProps {
  component: {
    title?: string;
    items?: EventItem[];
    events?: EventItem[];
  };
  onSendMessage?: (text: string) => void;
}

const safeImage = (value?: string) => (value && /^https?:\/\//i.test(value) ? value : null);

function when(raw?: string) {
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return {
    month: date.toLocaleString("it-IT", { month: "short" }).replace(/\.$/, ""),
    day: date.getDate(),
    label: date.toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
  };
}

/** Upcoming events as swipeable cards; each one can be joined from the chat. */
export function EventCards({ component, onSendMessage }: EventCardsProps) {
  const copy = cardCopy();
  const events = (component.items || component.events || []).slice(0, 8);
  if (!events.length) return null;

  return (
    <section className="ar-events" aria-label={component.title || undefined}>
      <ul className="ar-carousel-track ar-events-track">
        {events.map((event, idx) => {
          const date = when(event.start_at || event.date);
          const image = safeImage(event.image_url || event.image);
          const max = Number(event.max_capacity) || 0;
          const taken = Number(event.current_registrations) || 0;
          return (
            <li key={`${event.title}-${idx}`} className="ar-carousel-card ar-event-card">
              {image ? <img className="ar-carousel-img" src={image} alt="" loading="lazy" decoding="async" /> : null}
              <div className="ar-carousel-body">
                {date ? (
                  <span className="ar-event-date"><CalendarDays aria-hidden="true" />{date.label}</span>
                ) : null}
                <b className="ar-carousel-title">{event.title}</b>
                {event.location ? (
                  <small className="ar-carousel-sub ar-event-place"><MapPin aria-hidden="true" />{event.location}</small>
                ) : null}
                {max > 0 ? (
                  <span className="ar-event-seats">
                    <span className="ar-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round((taken / max) * 100))}%` }} /></span>
                    <small>{copy.eventSeats(taken, max)}</small>
                  </span>
                ) : null}
                <span className="ar-spacer" aria-hidden="true" />
                <button type="button" className="ar-btn ar-btn--primary ar-btn--sm"
                  onClick={() => onSendMessage?.(widgetCopy().registerFor(event.title))}>
                  {event.cta_label && !/^register$/i.test(event.cta_label) ? event.cta_label : copy.eventRegister}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
