import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/admin/lib/api";
import { googleCalendarErrorCopy, useGoogleCalendarConnect } from "./use-google-calendar-connect";

export type GoogleCalendarConnection = {
  /** Null while nothing was ever connected (the API then answers status "disconnected"). */
  id: number | null;
  public_id: string | null;
  slug: "google-calendar";
  status: string;
  connected: boolean;
  calendar_id: string | null;
  calendar_name: string | null;
  calendar_timezone: string | null;
  default_duration_minutes: number;
  event_title: string;
  conflict_checks: boolean;
  inbound_enabled: boolean;
  invite_attendee: boolean;
  create_google_meet: boolean;
  send_updates: "all" | "externalOnly" | "none";
  /** Bookable weekdays, 0 = Monday. */
  business_days: number[];
  business_start: string;
  business_end: string;
  min_notice_minutes: number;
  error_code: string | null;
  /** A Google consent window is still open. */
  authorizing: boolean;
  /** How the last consent ended: "connected" or a reason (access_denied, missing_scopes, ...). */
  last_connect_result?: string | null;
  webhook_connected: boolean;
  webhook_expires_at: string | null;
  oauth_ready: boolean;
  last_tested_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
};

type CalendarOption = {
  id: string;
  name: string;
  timezone: string;
  primary: boolean;
  access_role: "writer" | "owner";
};

type Props = {
  locale: "it" | "en";
  connection: GoogleCalendarConnection | null;
  loading: boolean;
  onChange: (connection: GoogleCalendarConnection | null) => void;
};

const DAYS = {
  it: ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};
const NOTICE_OPTIONS = [0, 30, 60, 120, 240, 1440, 2880];

const draftFrom = (connection: GoogleCalendarConnection | null) => ({
  enabled: connection?.status === "enabled",
  calendar_id: connection?.calendar_id || "",
  default_duration_minutes: connection?.default_duration_minutes || 30,
  event_title: connection?.event_title || "Appuntamento",
  conflict_checks: connection?.conflict_checks ?? true,
  inbound_enabled: connection?.inbound_enabled ?? true,
  invite_attendee: connection?.invite_attendee ?? false,
  create_google_meet: connection?.create_google_meet ?? false,
  send_updates: connection?.send_updates || "none",
  business_days: connection?.business_days || [0, 1, 2, 3, 4],
  business_start: connection?.business_start || "09:00",
  business_end: connection?.business_end || "18:00",
  min_notice_minutes: connection?.min_notice_minutes ?? 60,
});

function noticeLabel(minutes: number, en: boolean) {
  if (minutes === 0) return en ? "None" : "Nessuno";
  if (minutes < 60) return en ? `${minutes} min` : `${minutes} minuti`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return en ? `${hours} h` : `${hours} ${hours === 1 ? "ora" : "ore"}`;
  }
  const days = minutes / 1440;
  return en ? `${days} day${days === 1 ? "" : "s"}` : `${days} ${days === 1 ? "giorno" : "giorni"}`;
}

const selectClass =
  "flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export function GoogleCalendarSetup({ locale, connection, loading, onChange }: Props) {
  const en = locale === "en";
  const [busy, setBusy] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [metadataError, setMetadataError] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(connection));
  const { connect, connecting } = useGoogleCalendarConnect({ en, onConnected: onChange });

  useEffect(() => {
    setDraft(draftFrom(connection));
  }, [connection]);

  useEffect(() => {
    if (!connection?.connected) return;
    setMetadataError(false);
    void apiFetch<{ calendars: CalendarOption[] }>("/integrations/google-calendar/metadata")
      .then((result) => setCalendars(result.calendars))
      .catch(() => setMetadataError(true));
  }, [connection?.connected, connection?.public_id]);

  const selected = useMemo(
    () => calendars.find((calendar) => calendar.id === draft.calendar_id),
    [calendars, draft.calendar_id]
  );

  const save = async () => {
    setBusy("save");
    try {
      const updated = await apiFetch<GoogleCalendarConnection>("/integrations/google-calendar", {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      onChange(updated);
      toast.success(en ? "Google Calendar settings saved." : "Impostazioni Google Calendar salvate.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : (en ? "Could not save settings." : "Impossibile salvare le impostazioni."));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      await apiFetch("/integrations/google-calendar/test", { method: "POST" });
      onChange(await apiFetch<GoogleCalendarConnection>("/integrations/google-calendar"));
      toast.success(en ? "Everything works: AlphaRecall can read free times and add events." : "Tutto funziona: AlphaRecall legge gli orari liberi e aggiunge gli eventi.");
    } catch {
      const current = await apiFetch<GoogleCalendarConnection>("/integrations/google-calendar", { cache: "reload" }).catch(() => null);
      if (current) onChange(current);
      toast.error(googleCalendarErrorCopy(current?.error_code, en).text);
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    try {
      await apiFetch("/integrations/google-calendar/sync", { method: "POST" });
      toast.success(en ? "Calendar reconciliation queued." : "Riconciliazione calendario accodata.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : (en ? "Could not queue sync." : "Impossibile accodare la sincronizzazione."));
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(en ? "Disconnect Google Calendar? Existing Google events will be kept." : "Scollegare Google Calendar? Gli eventi Google esistenti verranno mantenuti.")) return;
    setBusy("disconnect");
    try {
      await apiFetch("/integrations/google-calendar", { method: "DELETE" });
      onChange(null);
      setCalendars([]);
      toast.success(en ? "Google Calendar disconnected." : "Google Calendar scollegato.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : (en ? "Disconnect failed." : "Disconnessione non riuscita."));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="text-sm text-muted-foreground" role="status">{en ? "Loading Google Calendar..." : "Caricamento Google Calendar..."}</p>;

  if (!connection?.connected) {
    return (
      <section className="space-y-4 rounded-xl border p-4" aria-labelledby="google-calendar-connect-title">
        <div>
          <h4 id="google-calendar-connect-title" className="text-sm font-semibold">{en ? "Connect Google Calendar securely" : "Collega Google Calendar in modo sicuro"}</h4>
          <p className="text-xs text-muted-foreground">{en ? "OAuth grants only calendar events, writable-calendar discovery, and free/busy access. AlphaRecall never receives your Google password." : "OAuth concede solo eventi, elenco dei calendari scrivibili e disponibilità. AlphaRecall non riceve mai la password Google."}</p>
        </div>
        <p className="text-xs text-muted-foreground">{en ? "After you allow access, your main calendar is used right away, with bookable hours Monday to Friday 9:00 to 18:00. You can change everything later." : "Dopo che autorizzi l'accesso, AlphaRecall usa subito il tuo calendario principale con orari prenotabili dal lunedì al venerdì, 9:00-18:00. Puoi cambiare tutto dopo."}</p>
        <Button className="min-h-11 w-full sm:w-auto" onClick={connect} disabled={busy !== null || connecting}>
          {connecting ? (en ? "Waiting for Google..." : "In attesa di Google...") : (en ? "Connect Google Calendar" : "Collega Google Calendar")}
        </Button>
      </section>
    );
  }

  const problem = connection.error_code ? googleCalendarErrorCopy(connection.error_code, en) : null;
  const days = DAYS[en ? "en" : "it"];
  const toggleDay = (day: number) =>
    setDraft((current) => ({
      ...current,
      business_days: current.business_days.includes(day)
        ? current.business_days.filter((item) => item !== day)
        : [...current.business_days, day].sort((a, b) => a - b),
    }));
  const hoursInvalid = draft.business_days.length === 0 || draft.business_end <= draft.business_start;

  return (
    <div className="space-y-4">
      {problem ? (
        <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
          <p className="text-sm">{problem.text}</p>
          {problem.reconnect ? (
            <Button className="min-h-11" onClick={connect} disabled={connecting}>
              {connecting ? (en ? "Waiting for Google..." : "In attesa di Google...") : (en ? "Reconnect Google Calendar" : "Ricollega Google Calendar")}
            </Button>
          ) : null}
        </div>
      ) : connection.status === "enabled" ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm" role="status">
          {en
            ? `Connected. Appointments booked in chat go to "${connection.calendar_name}" (${connection.calendar_timezone}) and visitors only see times that are free.`
            : `Collegato. Gli appuntamenti presi in chat finiscono in "${connection.calendar_name}" (${connection.calendar_timezone}) e i visitatori vedono solo gli orari liberi.`}
        </p>
      ) : null}

      <section className="space-y-3 rounded-xl border p-4" aria-labelledby="google-calendar-calendar-title">
        <div>
          <h4 id="google-calendar-calendar-title" className="text-sm font-semibold">{en ? "Calendar and event defaults" : "Calendario e valori predefiniti"}</h4>
          <p className="text-xs text-muted-foreground">{en ? "Only calendars where this account can create events are listed." : "Sono elencati solo i calendari in cui l'account può creare eventi."}</p>
        </div>
        {metadataError ? <p className="text-xs text-destructive" role="alert">{en ? "Could not load writable calendars. Reconnect and retry." : "Impossibile caricare i calendari scrivibili. Ricollega e riprova."}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="google-calendar-id">{en ? "Writable calendar" : "Calendario scrivibile"}</Label>
            <select id="google-calendar-id" className={selectClass} value={draft.calendar_id} onChange={(event) => setDraft({ ...draft, calendar_id: event.target.value })}>
              <option value="">{en ? "Select a calendar" : "Seleziona un calendario"}</option>
              {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}{calendar.primary ? (en ? " (primary)" : " (principale)") : ""}</option>)}
            </select>
            {selected ? <p className="text-xs text-muted-foreground">{selected.timezone}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="google-calendar-duration">{en ? "Default duration (minutes)" : "Durata predefinita (minuti)"}</Label>
            <Input id="google-calendar-duration" type="number" min={5} max={1440} step={5} value={draft.default_duration_minutes} onChange={(event) => setDraft({ ...draft, default_duration_minutes: Number(event.target.value) })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="google-calendar-title">{en ? "Event title" : "Titolo evento"}</Label>
          <Input id="google-calendar-title" maxLength={255} aria-describedby="google-calendar-title-hint" value={draft.event_title} onChange={(event) => setDraft({ ...draft, event_title: event.target.value })} />
          <p id="google-calendar-title-hint" className="text-xs text-muted-foreground">
            {en
              ? `The visitor's name follows, e.g. "${draft.event_title.trim() || "Appuntamento"}: Mario Rossi". Contact details and notes go in the event description.`
              : `Segue il nome del visitatore, ad esempio "${draft.event_title.trim() || "Appuntamento"}: Mario Rossi". Contatti e note vanno nella descrizione dell'evento.`}
          </p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border p-4" aria-labelledby="google-calendar-hours-title">
        <div>
          <h4 id="google-calendar-hours-title" className="text-sm font-semibold">{en ? "When visitors can book" : "Quando si può prenotare"}</h4>
          <p className="text-xs text-muted-foreground">{en ? "Visitors are offered free slots inside these hours, as long as the appointment length set above. Times are in the calendar's timezone." : "Ai visitatori proponiamo gli orari liberi in questa fascia, lunghi quanto la durata impostata sopra. Gli orari seguono il fuso del calendario."}</p>
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{en ? "Bookable days" : "Giorni prenotabili"}</legend>
          {days.map((label, day) => (
            <label key={label} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm has-[:checked]:bg-primary/5">
              <input type="checkbox" className="size-4 accent-current" checked={draft.business_days.includes(day)} onChange={() => toggleDay(day)} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="google-calendar-start">{en ? "From" : "Dalle"}</Label>
            <Input id="google-calendar-start" type="time" step={300} value={draft.business_start} onChange={(event) => setDraft({ ...draft, business_start: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="google-calendar-end">{en ? "To" : "Alle"}</Label>
            <Input id="google-calendar-end" type="time" step={300} value={draft.business_end} onChange={(event) => setDraft({ ...draft, business_end: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="google-calendar-notice">{en ? "Minimum notice" : "Preavviso minimo"}</Label>
            <select id="google-calendar-notice" className={selectClass} value={draft.min_notice_minutes} onChange={(event) => setDraft({ ...draft, min_notice_minutes: Number(event.target.value) })}>
              {NOTICE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {noticeLabel(minutes, en)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {hoursInvalid ? <p className="text-xs text-destructive">{en ? "Pick at least one day and an end time after the start time." : "Scegli almeno un giorno e un orario di fine successivo a quello di inizio."}</p> : null}
      </section>

      <section className="space-y-2 rounded-xl border p-4" aria-labelledby="google-calendar-sync-title">
        <div><h4 id="google-calendar-sync-title" className="text-sm font-semibold">{en ? "Availability and synchronization" : "Disponibilità e sincronizzazione"}</h4><p className="text-xs text-muted-foreground">{en ? "Remote changes apply only to events created and linked by this connector." : "Le modifiche remote si applicano solo agli eventi creati e collegati da questo connettore."}</p></div>
        {([
          ["conflict_checks", en ? "Reject busy times" : "Rifiuta orari occupati"],
          ["inbound_enabled", en ? "Reconcile Google changes" : "Riconcilia modifiche Google"],
          ["invite_attendee", en ? "Invite the visitor email" : "Invita l'email del visitatore"],
          ["create_google_meet", en ? "Create a unique Google Meet" : "Crea un Google Meet univoco"],
          ["enabled", en ? "Calendar sync enabled" : "Sincronizzazione calendario attiva"],
        ] as const).map(([key, label]) => (
          <div key={key} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <Label htmlFor={`google-calendar-${key}`}>{label}</Label>
            <Switch id={`google-calendar-${key}`} checked={draft[key]} onCheckedChange={(checked) => setDraft({ ...draft, [key]: checked })} />
          </div>
        ))}
        <div className="space-y-1.5 pt-1">
          <Label htmlFor="google-calendar-updates">{en ? "Google attendee notifications" : "Notifiche Google agli invitati"}</Label>
          <select id="google-calendar-updates" className={selectClass} value={draft.send_updates} onChange={(event) => setDraft({ ...draft, send_updates: event.target.value as GoogleCalendarConnection["send_updates"] })}>
            <option value="none">{en ? "Do not email attendees" : "Non inviare email agli invitati"}</option>
            <option value="externalOnly">{en ? "Email external attendees only" : "Email solo agli invitati esterni"}</option>
            <option value="all">{en ? "Email all attendees" : "Email a tutti gli invitati"}</option>
          </select>
        </div>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button className="min-h-11" onClick={save} disabled={busy !== null || !draft.calendar_id || !draft.event_title.trim() || hoursInvalid}>{busy === "save" ? (en ? "Saving..." : "Salvataggio...") : (en ? "Save settings" : "Salva impostazioni")}</Button>
        <Button className="min-h-11" variant="outline" onClick={test} disabled={busy !== null || connection.status !== "enabled"}>{busy === "test" ? (en ? "Testing..." : "Test...") : (en ? "Test connection" : "Test connessione")}</Button>
        <Button className="min-h-11" variant="outline" onClick={sync} disabled={busy !== null || connection.status !== "enabled"}>{busy === "sync" ? (en ? "Queuing..." : "Accodamento...") : (en ? "Sync now" : "Sincronizza ora")}</Button>
        <Button className="min-h-11" variant="destructive" onClick={disconnect} disabled={busy !== null}>{busy === "disconnect" ? (en ? "Disconnecting..." : "Disconnessione...") : (en ? "Disconnect" : "Scollega")}</Button>
      </div>
    </div>
  );
}
