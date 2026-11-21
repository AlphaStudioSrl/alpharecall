/**
 * Richieste > Agenda (mockup agenda B): the appointments, leading with the
 * ones to confirm, then day by day with a "now" line, and a detail panel with
 * the actions that matter: confirm, move, cancel. Google Calendar's
 * connection state sits in the head, with the existing one-click connect.
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarWidget } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SurfacePortal } from "@/components/ui/surface-portal";
import { useApp } from "@/admin/app-context";
import { assistantName } from "@/admin/components/assistant/shared";
import { named } from "@/admin/lib/i18n";
import { apiFetch } from "@/admin/lib/api";
import { useConversionsData, type AppointmentRecord } from "@/admin/hooks/use-conversions-data";
import { Avatar, IconButton, PageHead, Segmented, Tag, type Tone } from "@/admin/components/shared/kit";
import { Bones } from "@/admin/components/shared/bones";
import { useNav, useNavBadge, useNavIntent, useView } from "@/admin/lib/nav-context";
import { hrefForRoute } from "@/admin/lib/nav";
import { cn } from "@/admin/lib/utils";
import { formatDateKey, getTimezone, toZonedDateKey } from "@/admin/lib/datetime";
import { moveErrorKey, moveWindow, pickerDate, pickerKey, zonedParts } from "./agenda-logic";
import { appointmentEmail, appointmentName, appointmentPhone, statusLabel } from "@/admin/lib/record-fields";
import type { GoogleCalendarConnection } from "@/admin/components/integrations/google-calendar-setup";
import { googleCalendarErrorCopy, useGoogleCalendarConnect, useGoogleCalendarReturn } from "@/admin/components/integrations/use-google-calendar-connect";
import { Calendar, CalendarDays, Check, Clock, Download, List, Mail, MoreHorizontal, RefreshCw, Trash2, X } from "@/components/icons";
import { ConfigureResultsTools, ResultsError, ResultsState } from "./results-state";
import { ConfirmDialog, LoadMoreBar, applyStatus, exportAll, type ConfirmRequest } from "./parts";
import {
  appointmentChatNote,
  appointmentDate,
  appointmentMinutes,
  appointmentService,
  clock,
  dayDiff,
  longWhen,
  receivedLabel,
  shortDay,
} from "./request-model";
import { urlParam, useVisibleCollections } from "./collections";
import { EXPORT_PATHS, exportWriter } from "./exports";

type T = (key: string) => string;
type View = "list" | "calendar";
const VIEW_KEY = "ar-agenda-view";
const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "completed", "cancelled"] as const;

interface Entry {
  a: AppointmentRecord;
  when: Date | null;
  day: string;
  status: string;
}

/** The colour of a booking: waiting (warn), confirmed (accent), done/cancelled (mute/red). */
function entryTone(e: Entry, now: number): Tone {
  if (e.status === "cancelled") return "red";
  if (e.status === "confirmed") return "accent";
  if (e.status === "completed") return "mute";
  return e.when && e.when.getTime() < now ? "mute" : "warn";
}

function entryLabel(e: Entry, now: number, t: T): string {
  if (e.status === "scheduled" && (!e.when || e.when.getTime() >= now)) return t("conversions.agenda.toConfirm");
  if (e.status === "scheduled") return t("conversions.agenda.notConfirmed");
  return statusLabel(t, e.status);
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "Oggi, lunedì 13" / "Domani, martedì 14" / "Giovedì 16" / "Lunedì 3 novembre". */
function dayHeading(key: string, today: string, t: T): string {
  const diff = dayDiff(today, key);
  const sameMonth = key.slice(0, 7) === today.slice(0, 7);
  const label = formatDateKey(key, sameMonth ? { weekday: "long", day: "numeric" } : { weekday: "long", day: "numeric", month: "long" });
  if (diff === 0) return `${t("conversions.agenda.today")}, ${label}`;
  if (diff === 1) return `${t("conversions.agenda.tomorrow")}, ${label}`;
  return capitalize(label);
}

/** Re-render every minute so the "now" line moves. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function useWidth(ref: React.RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(1200);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function AgendaPage() {
  const { t, lang, settings } = useApp();
  const { params } = useView();
  const { clearParams } = useNav();
  const visible = useVisibleCollections();
  const data = useConversionsData();
  const { appointments, appointmentsTotal, loading, loadingMore, errors, loadMoreErrors, reload, loadMore } = data;
  const now = useNow();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidth(rootRef);
  const docked = width >= 900;

  const [view, setViewState] = useState<View>(() => {
    try { return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "list"; } catch { return "list"; }
  });
  const setView = (next: View) => {
    setViewState(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* this visit only */ }
  };
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  /** The calendar's chosen day, as a tenant day key ("2026-10-16"). */
  const [calendarDay, setCalendarDay] = useState<string | undefined>(undefined);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [moving, setMoving] = useState<AppointmentRecord | null>(null);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<Set<number>>(() => new Set());

  /* ----- Google Calendar ----- */
  const [gcal, setGcal] = useState<GoogleCalendarConnection | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    apiFetch<GoogleCalendarConnection>("/integrations/google-calendar")
      .then((c) => alive && setGcal(c && typeof c === "object" ? c : null))
      .catch(() => alive && setGcal(null));
    return () => { alive = false; };
  }, []);
  const { connect, connecting } = useGoogleCalendarConnect({ en: lang === "en", onConnected: setGcal });
  // Back from Google in this tab (popup blocked): ?google_calendar=connected|error.
  useGoogleCalendarReturn({ en: lang === "en", onConnected: setGcal });

  /* ----- Entries and groups ----- */
  const today = toZonedDateKey(new Date(now));
  const entries = useMemo<Entry[]>(() => appointments.map((a) => {
    const when = appointmentDate(a);
    return { a, when, day: when ? toZonedDateKey(when) : "", status: overrides[a.id] ?? (a.status || "scheduled") };
  }), [appointments, overrides]);

  const groups = useMemo(() => {
    const asc = (x: Entry, y: Entry) => (x.when!.getTime() - y.when!.getTime());
    const dated = entries.filter((e) => e.when);
    const toConfirm = dated.filter((e) => e.status === "scheduled" && e.when!.getTime() >= now).sort(asc);
    const confirmSet = new Set(toConfirm);
    const upcoming = dated.filter((e) => !confirmSet.has(e) && e.day >= today).sort(asc);
    const byDay = new Map<string, Entry[]>();
    byDay.set(today, []);
    for (const e of upcoming) byDay.set(e.day, [...(byDay.get(e.day) || []), e]);
    const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    const past = dated.filter((e) => e.day < today && !confirmSet.has(e)).sort((x, y) => -asc(x, y));
    const undated = entries.filter((e) => !e.when);
    return { toConfirm, days, past, undated };
  }, [entries, now, today]);

  const weekCount = entries.filter((e) => e.when && e.status !== "cancelled" && dayDiff(today, e.day) >= 0 && dayDiff(today, e.day) < 7).length;
  useNavBadge("richieste/agenda", loading ? null : groups.toConfirm.length || null);

  const selected = entries.find((e) => e.a.id === selectedId) ?? null;
  // On a wide page the panel always shows something: the first booking to confirm, else the next one.
  useEffect(() => {
    if (loading || !docked || selected) return;
    const first = groups.toConfirm[0] ?? groups.days.flatMap(([, list]) => list)[0] ?? groups.undated[0] ?? groups.past[0];
    if (first) setSelectedId(first.a.id);
  }, [loading, docked, selected, groups]);

  /* ----- Deep link: ?item=<appointment id> ----- */
  const itemParam = params.item || urlParam("item");
  useEffect(() => {
    if (loading || !itemParam) return;
    const found = entries.find((e) => e.a.id === Number(itemParam));
    if (found) {
      setSelectedId(found.a.id);
      if (found.day && found.day < today) setShowPast(true);
      setSheetOpen(true);
      // Highlight: bring the row into view once the past group (if needed) has rendered.
      requestAnimationFrame(() => document
        .querySelector(`.a3-agenda-row[data-appointment-id="${found.a.id}"]`)
        ?.scrollIntoView({ block: "center" }));
    }
    // Out of the router too, or Aggiorna would reopen a sheet the user closed.
    clearParams(["item"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, itemParam]);

  useNavIntent("export", () => void exportAll(EXPORT_PATHS.appointments, t, exportWriter("appointments", "csv", t)));

  const select = (e: Entry) => {
    setSelectedId(e.a.id);
    if (!docked) setSheetOpen(true);
  };

  /* ----- Actions ----- */
  const setStatus = useCallback(async (a: AppointmentRecord, status: string) => {
    setOverrides((prev) => ({ ...prev, [a.id]: status }));
    setBusy((prev) => new Set(prev).add(a.id));
    try {
      await applyStatus(t, () => data.updateAppointmentStatus(a.id, status), status);
    } catch {
      // Already explained by a toast; the row goes back.
    } finally {
      setOverrides((prev) => { const next = { ...prev }; delete next[a.id]; return next; });
      setBusy((prev) => { const next = new Set(prev); next.delete(a.id); return next; });
    }
  }, [data, t]);

  const askCancel = (a: AppointmentRecord) => setConfirm({
    title: t("conversions.agenda.cancelTitle"),
    description: t("conversions.agenda.cancelBody").replace("{name}", appointmentName(a) || appointmentEmail(a) || `#${a.id}`),
    confirmLabel: t("conversions.agenda.cancelConfirm"),
    run: () => setStatus(a, "cancelled"),
  });

  const askDelete = (a: AppointmentRecord) => setConfirm({
    title: t("conversions.board.deleteTitle"),
    description: t("conversions.board.deleteBody").replace("{name}", appointmentName(a) || appointmentEmail(a) || `#${a.id}`),
    confirmLabel: t("conversions.delete"),
    run: async () => {
      await data.deleteAppointment(a.id);
      if (selectedId === a.id) { setSelectedId(null); setSheetOpen(false); }
    },
  });

  const askDeleteAll = () => setConfirm({
    title: t("conversions.board.deleteAll.appointments"),
    description: t(appointmentsTotal === 1 ? "conversions.board.deleteAllBodyOne" : "conversions.board.deleteAllBody").replace("{count}", String(appointmentsTotal)),
    confirmLabel: t("conversions.deleteAll"),
    run: () => data.deleteAllAppointments(),
  });

  if (!visible.includes("appointments")) {
    return (
      <div className="a3-agenda">
        <PageHead title={t("conversions.agenda.title")} />
        <ResultsState icon={Calendar} title={t("conversions.empty.appointments.title")} description={t("conversions.agenda.toolOff")} action={<ConfigureResultsTools />} />
      </div>
    );
  }

  const subtitle = loading ? t("conversions.agenda.subtitleLoading") : t("conversions.agenda.subtitle")
    .replace("{week}", String(weekCount))
    .replace("{confirm}", String(groups.toConfirm.length));

  const rowProps = { t, now, busy, selectedId, onSelect: select, onConfirm: (a: AppointmentRecord) => void setStatus(a, "confirmed") };

  const listView = (
    <div className="a3-agenda-groups">
      {groups.toConfirm.length > 0 && (
        <AgendaGroup label={t("conversions.agenda.toConfirmGroup")}>
          {groups.toConfirm.map((e) => <AgendaRow key={e.a.id} entry={e} showDay {...rowProps} />)}
        </AgendaGroup>
      )}
      {groups.days.map(([day, list]) => (
        <AgendaGroup key={day} label={dayHeading(day, today, t)}>
          {day === today ? <TodayRows list={list} now={now} t={t} rowProps={rowProps} /> : list.map((e) => <AgendaRow key={e.a.id} entry={e} {...rowProps} />)}
        </AgendaGroup>
      ))}
      {groups.undated.length > 0 && (
        <AgendaGroup label={t("conversions.agenda.undated")}>
          {groups.undated.map((e) => <AgendaRow key={e.a.id} entry={e} {...rowProps} />)}
        </AgendaGroup>
      )}
      {groups.past.length > 0 && (
        showPast ? (
          <AgendaGroup label={t("conversions.agenda.past")}>
            {groups.past.map((e) => <AgendaRow key={e.a.id} entry={e} showDay {...rowProps} />)}
          </AgendaGroup>
        ) : (
          <button type="button" className="a3-agenda-past" onClick={() => setShowPast(true)}>
            {t("conversions.agenda.showPast").replace("{count}", String(groups.past.length))}
          </button>
        )
      )}
    </div>
  );

  // The picker speaks browser-local dates: hand it the tenant's days by their parts.
  const dates = [...new Set(entries.filter((e) => e.day).map((e) => e.day))].map(pickerDate);
  const calKey = calendarDay ?? (groups.toConfirm[0]?.day || groups.days.find(([, l]) => l.length)?.[1][0]?.day || today);
  const calDay = pickerDate(calKey);
  const calendarView = (
    <div className="a3-agenda-cal">
      <div className="a3-agenda-calbox">
        <CalendarWidget
          mode="single"
          selected={calDay}
          onSelect={(d) => d && setCalendarDay(pickerKey(d))}
          defaultMonth={calDay}
          today={pickerDate(today)}
          modifiers={{ hasAppointment: dates }}
          modifiersClassNames={{ hasAppointment: "ar-cal-has-appointment" }}
        />
      </div>
      <AgendaGroup label={dayHeading(calKey, today, t)}>
        {entries.filter((e) => e.day === calKey).sort((x, y) => x.when!.getTime() - y.when!.getTime()).map((e) => <AgendaRow key={e.a.id} entry={e} {...rowProps} />)}
        {!entries.some((e) => e.day === calKey) && <p className="a3-agenda-none">{t("conversions.noAppointmentsOnDate")}</p>}
      </AgendaGroup>
    </div>
  );

  const detail = selected && (
    <AgendaDetail
      entry={selected}
      now={now}
      t={t}
      busy={busy.has(selected.a.id)}
      onStatus={setStatus}
      onCancel={askCancel}
      onMove={setMoving}
      onDelete={askDelete}
      onClose={docked ? undefined : () => setSheetOpen(false)}
    />
  );

  let body: ReactNode;
  if (errors.appointments) {
    body = <ResultsError title={t("conversions.errors.appointments")} description={t("conversions.errors.description")} retryLabel={t("conversions.errors.retry")} onRetry={() => void reload()} />;
  } else if (!appointments.length) {
    body = appointmentsTotal === 0
      ? <ResultsState icon={Calendar} title={t("conversions.empty.appointments.title")} description={named(t, "conversions.empty.appointments.description", assistantName(settings, ""))} action={<ConfigureResultsTools />} />
      : <ResultsState icon={RefreshCw} title={t("conversions.empty.unloadedTitle")} description={t("conversions.empty.unloadedDescription")}
          action={<Button variant="secondary" disabled={!!loadingMore} onClick={() => void loadMore("appointments")}>{t("conversions.loadMore")}</Button>} />;
  } else {
    body = (
      <div className="a3-agenda-list" data-tour="conversions-table">
        {view === "list" ? listView : calendarView}
        {loadMoreErrors.appointments ? (
          <ResultsError title={t("conversions.errors.moreTitle")} description={t("conversions.errors.moreDescription")} retryLabel={t("conversions.errors.retry")} onRetry={() => void loadMore("appointments")} loading={loadingMore === "appointments"} />
        ) : (
          <LoadMoreBar shown={appointments.length} total={appointmentsTotal} loading={loadingMore === "appointments"} onLoadMore={() => void loadMore("appointments")} t={t} />
        )}
      </div>
    );
  }

  return (
    <div className="a3-agenda" ref={rootRef}>
      <div className="a3-agenda-split">
      <div className="a3-agenda-main">
      <PageHead
        title={t("conversions.agenda.title")}
        subtitle={subtitle}
        actions={
          <>
            <CalendarState connection={gcal} connecting={connecting} onConnect={connect} t={t} lang={lang} />
            <IconButton icon={RefreshCw} label={t("common.refresh")} onClick={() => void reload()} disabled={loading} className={loading ? "a3-spin" : undefined} />
            {!loading && appointmentsTotal > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton icon={MoreHorizontal} label={t("conversions.board.moreActions")} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="a3-menu">
                  {(["csv", "json"] as const).map((format) => (
                    <DropdownMenuItem key={format} onSelect={() => void exportAll(EXPORT_PATHS.appointments, t, exportWriter("appointments", format, t))}>
                      <Download aria-hidden="true" />
                      {`${t("conversions.agenda.export")} · ${format.toUpperCase()}`}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="a3-danger" onSelect={askDeleteAll}>
                    <Trash2 aria-hidden="true" />
                    {t("conversions.board.deleteAll.appointments")}
                    <span className="a3-menu-count">{appointmentsTotal}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Segmented<View>
              size="sm"
              aria-label={t("conversions.board.viewLabel")}
              value={view}
              onValueChange={setView}
              options={[
                { value: "list", icon: List, label: t("conversions.agenda.listView") },
                { value: "calendar", icon: CalendarDays, label: t("conversions.calendarView") },
              ]}
            />
          </>
        }
      />

      <div className="a3-content" aria-busy={loading}>
        {loading && <span role="status" className="sr-only">{t("conversions.loading")}</span>}
        <Bones name="conversions-agenda" loading={loading} className="a3-bones">
          <>{body}</>
        </Bones>
      </div>
      </div>
      {docked && !loading && detail && <aside className="a3-agenda-detail ark-on-fill" aria-label={t("conversions.agenda.detail")}>{detail}</aside>}
      {/* Loading holds the detail's place, so the list's skeleton has the list's width. */}
      {docked && loading && <div className="a3-agenda-detail a3-agenda-detail-wait" aria-hidden="true" />}
      </div>

      {!docked && (
        <DialogPrimitive.Root open={sheetOpen && !!selected} onOpenChange={setSheetOpen}>
          <SurfacePortal portal={DialogPrimitive.Portal}>
            <DialogPrimitive.Overlay className="a3-scrim" />
            <DialogPrimitive.Content className="a3-sheet a3-sheet-agenda ark-on-fill" aria-describedby={undefined}>
              {detail}
            </DialogPrimitive.Content>
          </SurfacePortal>
        </DialogPrimitive.Root>
      )}
      <RescheduleDialog appointment={moving} onClose={() => setMoving(null)} t={t} onSave={data.rescheduleAppointment} />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} t={t} />
    </div>
  );
}

/* ---------- Pieces ---------- */

function AgendaGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="a3-agenda-group" aria-label={label}>
      <h2 className="a3-lbl">{label}</h2>
      <div className="a3-agenda-rows">{children}</div>
    </section>
  );
}

interface RowProps {
  t: T;
  now: number;
  busy: Set<number>;
  selectedId: number | null;
  onSelect: (e: Entry) => void;
  onConfirm: (a: AppointmentRecord) => void;
}

/** Today's rows with the "now" line between what is over and what is next. */
function TodayRows({ list, now, t, rowProps }: { list: Entry[]; now: number; t: T; rowProps: RowProps }) {
  const split = list.findIndex((e) => e.when!.getTime() > now);
  const at = split === -1 ? list.length : split;
  const marker = (
    <div className="a3-now" key="now" role="note" aria-label={t("conversions.agenda.now").replace("{time}", clock(new Date(now)))}>
      <span>{t("conversions.agenda.now").replace("{time}", clock(new Date(now)))}</span>
    </div>
  );
  return (
    <>
      {list.slice(0, at).map((e) => <AgendaRow key={e.a.id} entry={e} {...rowProps} />)}
      {marker}
      {list.slice(at).map((e) => <AgendaRow key={e.a.id} entry={e} {...rowProps} />)}
      {list.length === 0 && <p className="a3-agenda-none">{t("conversions.agenda.nothingToday")}</p>}
    </>
  );
}

function AgendaRow({ entry, showDay, t, now, busy, selectedId, onSelect, onConfirm }: RowProps & { entry: Entry; showDay?: boolean }) {
  const { a, when } = entry;
  const name = appointmentName(a) || appointmentEmail(a) || t("conversions.board.visitor");
  const service = appointmentService(a);
  const tone = entryTone(entry, now);
  const waiting = entry.status === "scheduled" && (!when || when.getTime() >= now);
  const second = [
    service,
    showDay && when ? shortDay(when) : waiting ? "" : entryLabel(entry, now, t),
  ].filter(Boolean).join(" · ") || (when ? "" : a.timeslot);
  const on = selectedId === a.id;
  return (
    <div className={cn("a3-agenda-row", on && "a3-on", entry.status === "cancelled" && "a3-cancelled", busy.has(a.id) && "a3-row-busy")} data-appointment-id={a.id}>
      <button type="button" className="a3-agenda-open" aria-current={on || undefined} onClick={() => onSelect(entry)}>
        <span className="a3-agenda-time">{when ? clock(when) : "–"}</span>
        <span className={cn("a3-dot", `ark-c-${tone}`)} aria-hidden="true" />
        <span className="a3-agenda-text">
          <b>{name}</b>
          {second && <small>{second}</small>}
        </span>
        <span className="sr-only">{entryLabel(entry, now, t)}</span>
      </button>
      {waiting && when && (
        <Button size="sm" variant={on ? "default" : "secondary"} className="a3-agenda-confirm" disabled={busy.has(a.id)} onClick={() => onConfirm(a)}
          aria-label={`${t("conversions.agenda.confirm")}: ${name}`}>
          {t("conversions.agenda.confirm")}
        </Button>
      )}
    </div>
  );
}

function AgendaDetail({ entry, now, t, busy, onStatus, onCancel, onMove, onDelete, onClose }: {
  entry: Entry;
  now: number;
  t: T;
  busy: boolean;
  onStatus: (a: AppointmentRecord, status: string) => void;
  onCancel: (a: AppointmentRecord) => void;
  onMove: (a: AppointmentRecord) => void;
  onDelete: (a: AppointmentRecord) => void;
  onClose?: () => void;
}) {
  const { a, when } = entry;
  const name = appointmentName(a) || appointmentEmail(a) || t("conversions.board.visitor");
  const phone = appointmentPhone(a);
  const email = appointmentEmail(a);
  const minutes = appointmentMinutes(a);
  const service = appointmentService(a);
  const chat = appointmentChatNote(a);
  const Title = onClose ? DialogPrimitive.Title : "h2";
  const sub = [service, minutes ? t("conversions.agenda.minutes").replace("{n}", String(minutes)) : ""].filter(Boolean).join(" · ");
  return (
    <div className="a3-detail">
      <div className="a3-detail-top">
        <Tag tone={entryTone(entry, now)}>{entryLabel(entry, now, t)}</Tag>
        <span className="a3-sp" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={MoreHorizontal} label={t("common.actions")} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="a3-menu min-w-[210px]">
            <DropdownMenuLabel className="a3-menu-label">{t("labels.status")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={entry.status} onValueChange={(s) => s !== entry.status && onStatus(a, s)}>
              {APPOINTMENT_STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>{statusLabel(t, s)}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            {email && (
              <DropdownMenuItem asChild>
                <a href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Re: ${t("conversions.appointment")}`)}`}>
                  <Mail aria-hidden="true" />
                  {t("conversions.board.replyEmail")}
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="a3-danger" onSelect={() => onDelete(a)}>
              <Trash2 aria-hidden="true" />
              {t("conversions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && <IconButton icon={X} label={t("common.close")} onClick={onClose} />}
      </div>

      <div className="a3-detail-title">
        <Title>{when ? longWhen(when) : a.timeslot || t("conversions.agenda.undated")}</Title>
        {sub && <p>{sub}</p>}
      </div>

      <div className="a3-detail-who">
        <Avatar name={name} size="m" />
        <div>
          <b>{name}</b>
          {phone && <a href={`tel:${phone}`}>{phone}</a>}
          {email && <a href={`mailto:${email}`}>{email}</a>}
        </div>
      </div>

      {chat && (
        <div className="a3-note a3-note-panel">
          <span>{t("conversions.agenda.chatNote")}</span>
          <p>{chat}</p>
        </div>
      )}
      {a.notes && (
        <div className="a3-note a3-note-panel">
          <span>{t("conversions.notes")}</span>
          <p>{a.notes}</p>
        </div>
      )}
      {a.tags && a.tags.length > 0 && <p className="a3-faint">{t("conversions.tags")}: {a.tags.join(", ")}</p>}
      <div className="a3-detail-meta">
        <Clock aria-hidden="true" />
        {t("conversions.agenda.received").replace("{when}", receivedLabel(a.created_at, t))}
      </div>

      <span className="a3-sp" />
      <div className="a3-detail-actions">
        {entry.status === "scheduled" ? (
          <Button className="a3-detail-primary" disabled={busy} onClick={() => onStatus(a, "confirmed")}>
            <Check aria-hidden="true" />
            {t("conversions.agenda.confirmAppointment")}
          </Button>
        ) : entry.status === "confirmed" ? (
          <Button className="a3-detail-primary" disabled={busy} onClick={() => onStatus(a, "completed")}>
            <Check aria-hidden="true" />
            {t("conversions.agenda.markCompleted")}
          </Button>
        ) : (
          <Button variant="secondary" className="a3-detail-primary" disabled={busy} onClick={() => onStatus(a, "scheduled")}>
            {t("conversions.board.reopen")}
          </Button>
        )}
        <div className="a3-detail-pair">
          <Button variant="secondary" onClick={() => onMove(a)}>{t("conversions.agenda.move")}</Button>
          {entry.status !== "cancelled" && (
            <Button variant="secondary" className="a3-red" disabled={busy} onClick={() => onCancel(a)}>{t("conversions.agenda.cancel")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The Google Calendar line in the head: connected, needs attention, or a connect button. */
function CalendarState({ connection, connecting, onConnect, t, lang }: {
  connection: GoogleCalendarConnection | null | undefined;
  connecting: boolean;
  onConnect: () => void;
  t: T;
  lang: string;
}) {
  if (connection === undefined) return null;
  // Nothing to offer where AlphaRecall has no Google OAuth client yet.
  if (connection && !connection.connected && connection.oauth_ready === false) return null;
  const settingsHref = hrefForRoute({ section: "assistente", view: "carattere" });
  const openTools = () => {
    try {
      localStorage.setItem("ar-settings-collapse:agent-persona", "0");
      localStorage.setItem("ar-settings-collapse:agent-tools", "1");
    } catch { /* the page still opens */ }
  };
  const live = connection?.connected && connection.status === "enabled" && !connection.error_code;
  if (live) {
    return (
      <a className="a3-gcal a3-gcal-on" href={settingsHref} onClick={openTools} title={connection!.calendar_name || undefined}>
        <Check aria-hidden="true" />
        {t("conversions.agenda.gcalConnected")}
      </a>
    );
  }
  const problem = connection?.connected && connection.error_code ? googleCalendarErrorCopy(connection.error_code, lang === "en") : null;
  if (connection?.connected && !problem?.reconnect) {
    return (
      <a className="a3-gcal a3-gcal-warn" href={settingsHref} onClick={openTools} title={problem?.text}>
        {problem ? t("conversions.agenda.gcalProblem") : t("conversions.agenda.gcalPaused")}
      </a>
    );
  }
  return (
    <Button variant="ghost" size="sm" className="a3-gcal-connect" onClick={onConnect} disabled={connecting} title={problem?.text}>
      <Calendar aria-hidden="true" />
      {connecting ? t("conversions.agenda.gcalWaiting") : problem ? t("conversions.agenda.gcalReconnect") : t("conversions.agenda.gcalConnect")}
    </Button>
  );
}

/** "Sposta": a new day and time in the business's zone; a connected calendar checks for clashes. */
function RescheduleDialog({ appointment, onClose, onSave, t }: {
  appointment: AppointmentRecord | null;
  onClose: () => void;
  onSave: (id: number, window: { starts_at: string; ends_at: string; timezone?: string | null }) => Promise<void>;
  t: T;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [minutes, setMinutes] = useState(30);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!appointment) return;
    const when = appointmentDate(appointment) ?? new Date();
    const parts = zonedParts(when, getTimezone());
    setDate(parts.date);
    setTime(parts.time);
    setMinutes(appointmentMinutes(appointment) ?? 30);
  }, [appointment]);

  const save = async () => {
    if (!appointment) return;
    // The fields were filled in the tenant zone (zonedParts), so they are read back in it.
    const window = moveWindow(date, time, minutes, getTimezone());
    if (!window) return;
    setSaving(true);
    try {
      await onSave(appointment.id, window);
      toast.success(t("conversions.agenda.moved").replace("{when}", longWhen(new Date(window.starts_at))));
      onClose();
    } catch (cause) {
      toast.error(t(moveErrorKey(cause)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!appointment} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="a3-confirm max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("conversions.agenda.moveTitle")}</DialogTitle>
          <DialogDescription>{t("conversions.agenda.moveBody")}</DialogDescription>
        </DialogHeader>
        <div className="a3-move-fields">
          <div>
            <Label htmlFor="a3-move-date">{t("conversions.agenda.moveDate")}</Label>
            <Input id="a3-move-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="a3-move-time">{t("conversions.agenda.moveTime")}</Label>
            <Input id="a3-move-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="a3-move-minutes">{t("conversions.agenda.duration")}</Label>
            <Input id="a3-move-minutes" type="number" min={5} max={1440} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 30)} />
          </div>
        </div>
        <div className="a3-confirm-actions">
          <Button variant="secondary" onClick={onClose} disabled={saving}>{t("common.cancel")}</Button>
          <Button onClick={() => void save()} disabled={saving || !date || !time}>
            {saving && <RefreshCw className="animate-spin" aria-hidden="true" />}
            {t("conversions.agenda.moveSave")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
