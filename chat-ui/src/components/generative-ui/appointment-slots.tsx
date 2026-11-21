import * as React from "react";
import { CalendarDays, CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { ChatSheet } from "@/components/chat/sheet";
import { cardCopy } from "@/lib/card-copy";
import { moveRadioFocus, radioTabIndex } from "./radio-keys";

type Slot = { start: string; end: string };
type DaySlot = Slot & { time: string };
type Day = {
  key: string;
  /** "lunedì 5 ottobre": the readable day the server matches back to the slot (app/slot_pick.py). */
  label: string;
  weekday: string;
  short: string;
  number: string;
  month: string;
  slots: DaySlot[];
};

interface AppointmentSlotsProps {
  component: {
    tool?: string;
    timezone?: string;
    reason?: string;
    slots?: Slot[];
  };
  onSendMessage?: (text: string) => void;
  /** Open the picker straight away (a fresh result, not one reloaded from history). */
  autoOpen?: boolean;
}

const DAYS_PER_PAGE = 5;
const autoOpened = new Set<string>();

function formatter(timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("it-IT", { ...options, timeZone });
  } catch {
    // An unknown zone from the server must not break the chat.
    return new Intl.DateTimeFormat("it-IT", options);
  }
}

const capital = (value: string) => (value ? value[0].toLocaleUpperCase("it-IT") + value.slice(1) : value);
const trimDot = (value: string) => value.replace(/\.$/, "");

function groupDays(slots: Slot[] | undefined, timeZone: string | undefined): Day[] {
  const dayFormat = formatter(timeZone, { weekday: "long", day: "numeric", month: "long" });
  const weekdayFormat = formatter(timeZone, { weekday: "short" });
  const numberFormat = formatter(timeZone, { day: "numeric" });
  const monthFormat = formatter(timeZone, { month: "long", year: "numeric" });
  const longWeekday = formatter(timeZone, { weekday: "long" });
  const timeFormat = formatter(timeZone, { hour: "numeric", minute: "2-digit" });
  const days: Day[] = [];
  for (const slot of slots || []) {
    const start = new Date(slot.start);
    if (Number.isNaN(start.getTime())) continue;
    const label = dayFormat.format(start);
    const time = timeFormat.format(start);
    const last = days[days.length - 1];
    if (last && last.label === label) {
      last.slots.push({ ...slot, time });
      continue;
    }
    const weekday = trimDot(weekdayFormat.format(start));
    days.push({
      key: `${label}-${days.length}`,
      label,
      weekday: capital(longWeekday.format(start)),
      short: capital(weekday),
      number: numberFormat.format(start),
      month: capital(monthFormat.format(start)),
      slots: [{ ...slot, time }],
    });
  }
  return days;
}

function slotMinutes(slot: Slot | undefined) {
  if (!slot) return 0;
  const minutes = Math.round((Date.parse(slot.end) - Date.parse(slot.start)) / 60000);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 8 * 60 ? minutes : 0;
}

function visitorZoneDiffers(timeZone: string | undefined) {
  if (!timeZone) return false;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone !== timeZone;
  } catch {
    return false;
  }
}

export function AppointmentSlots({ component, onSendMessage, autoOpen = false }: AppointmentSlotsProps) {
  const copy = cardCopy();
  const timeZone = component.timezone;
  const days = React.useMemo(() => groupDays(component.slots, timeZone), [component.slots, timeZone]);
  const signature = React.useMemo(() => (component.slots || []).map((s) => s.start).join("|"), [component.slots]);
  const [open, setOpen] = React.useState(false);
  const [dayIndex, setDayIndex] = React.useState(0);
  const [picked, setPicked] = React.useState<DaySlot | null>(null);
  const [confirmed, setConfirmed] = React.useState<{ day: Day; slot: DaySlot } | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!autoOpen || !signature || autoOpened.has(signature)) return;
    autoOpened.add(signature);
    setOpen(true);
  }, [autoOpen, signature]);

  if (!days.length) return null;

  const total = days.reduce((sum, day) => sum + day.slots.length, 0);
  const minutes = slotMinutes(component.slots?.[0]);
  const day = days[Math.min(dayIndex, days.length - 1)];
  const page = Math.floor(dayIndex / DAYS_PER_PAGE);
  const pageDays = days.slice(page * DAYS_PER_PAGE, page * DAYS_PER_PAGE + DAYS_PER_PAGE);
  const pages = Math.ceil(days.length / DAYS_PER_PAGE);
  const reason = component.reason ? copy.bookingReasons[component.reason] : "";
  const summary = [minutes ? copy.bookingMinutes(minutes) : "", copy.bookingFreeSlots(total)].filter(Boolean).join(" · ");
  const shortLabel = (d: Day) => `${d.short.toLocaleLowerCase("it-IT")} ${d.number}`;

  const openAt = (index: number) => {
    if (confirmed) return;
    setDayIndex(index);
    setPicked(null);
    setOpen(true);
  };

  const pickDay = (index: number) => {
    if (index === dayIndex) return;
    setDayIndex(index);
    setPicked(null);
  };

  const confirm = () => {
    if (!picked || confirmed) return;
    setConfirmed({ day, slot: picked });
    setOpen(false);
    // Readable local time only: the server matches it back to the exact slot
    // it offered (app/slot_pick.py), so the visitor never sees a raw timestamp.
    onSendMessage?.(copy.bookingMessage(day.label, picked.time));
  };

  if (confirmed) {
    return (
      <section className="ar-card ar-booking-card" data-state="confirmed" role="status">
        <div className="ar-card-head">
          <CalendarCheck aria-hidden="true" className="ar-card-icon" />
          <div className="ar-card-heading">
            <h3 className="ar-card-title">{copy.bookingRequested(confirmed.day.label, confirmed.slot.time)}</h3>
            <p className="ar-card-sub">{copy.bookingRequestedSub}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="ar-card ar-booking-card" aria-label={copy.bookingTitle}>
        <div className="ar-card-head">
          <CalendarDays aria-hidden="true" className="ar-card-icon" />
          <div className="ar-card-heading">
            <h3 className="ar-card-title">{copy.bookingTitle}</h3>
            <p className="ar-card-sub">{summary}</p>
          </div>
        </div>
        {reason ? <p className="ar-card-text">{reason}</p> : null}
        <div className="ar-days" role="group" aria-label={copy.bookingDays}>
          {days.slice(0, DAYS_PER_PAGE).map((d, index) => (
            <button key={d.key} type="button" className="ar-day" aria-label={`${d.label}, ${copy.bookingFreeSlots(d.slots.length)}`}
              onClick={() => openAt(index)}>
              <span>{d.short}</span><b>{d.number}</b>
            </button>
          ))}
        </div>
        <button type="button" className="ar-btn ar-btn--primary" onClick={() => openAt(0)}>
          {copy.bookingOpen}
        </button>
      </section>

      <ChatSheet open={open} onClose={() => setOpen(false)} labelledBy={titleId} closeLabel={copy.close} className="ar-booking-sheet">
        <div className="ar-sheet-head">
          <h2 id={titleId} className="ar-sheet-title ar-sheet-title--sm">{copy.bookingTitle}</h2>
          <p className="ar-sheet-text">{summary}</p>
        </div>
        <div className="ar-booking-month">
          <b>{pageDays[0]?.month}</b>
          {pages > 1 ? (
            <span className="ar-booking-pager">
              <button type="button" className="ar-icon-btn" aria-label={copy.bookingPrevDays} disabled={page === 0}
                onClick={() => pickDay((page - 1) * DAYS_PER_PAGE)}>
                <ChevronLeft aria-hidden="true" />
              </button>
              <button type="button" className="ar-icon-btn" aria-label={copy.bookingNextDays} disabled={page >= pages - 1}
                onClick={() => pickDay((page + 1) * DAYS_PER_PAGE)}>
                <ChevronRight aria-hidden="true" />
              </button>
            </span>
          ) : null}
        </div>
        <div className="ar-days" role="radiogroup" aria-label={copy.bookingDays}
          onKeyDown={(event) => moveRadioFocus(event, (el) => pickDay(Number(el.dataset.index)))}>
          {pageDays.map((d, i) => {
            const index = page * DAYS_PER_PAGE + i;
            const checked = index === dayIndex;
            return (
              <button key={d.key} type="button" role="radio" className="ar-day" data-index={index}
                aria-checked={checked} tabIndex={radioTabIndex(checked, i, true)}
                aria-label={d.label} onClick={() => pickDay(index)}>
                <span>{d.short}</span><b>{d.number}</b>
              </button>
            );
          })}
        </div>
        <p className="ar-booking-day">{copy.bookingDayFree(`${day.weekday} ${day.number}`, day.slots.length)}</p>
        <div className="ar-slots" role="radiogroup" aria-label={day.label}
          onKeyDown={(event) => moveRadioFocus(event, (el) => setPicked(day.slots[Number(el.dataset.index)] || null))}>
          {day.slots.map((slot, index) => {
            const checked = picked?.start === slot.start;
            return (
              <button key={slot.start} type="button" role="radio" className="ar-slot" data-index={index}
                aria-checked={checked} tabIndex={radioTabIndex(checked, index, !!picked)}
                onClick={() => setPicked(slot)}>
                {slot.time}
              </button>
            );
          })}
        </div>
        <button type="button" className="ar-btn ar-btn--primary ar-btn--lg" disabled={!picked} onClick={confirm}>
          {picked ? copy.bookingConfirm(shortLabel(day), picked.time) : copy.bookingPickTime}
        </button>
        {visitorZoneDiffers(timeZone) ? <p className="ar-note">{copy.bookingTimezone(String(timeZone))}</p> : null}
      </ChatSheet>
    </>
  );
}
