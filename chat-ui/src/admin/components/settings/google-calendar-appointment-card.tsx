import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/admin/lib/api";
import {
  GoogleCalendarSetup,
  type GoogleCalendarConnection,
} from "@/admin/components/integrations/google-calendar-setup";
import {
  googleCalendarErrorCopy,
  useGoogleCalendarConnect,
} from "@/admin/components/integrations/use-google-calendar-connect";

/**
 * Google Calendar from the Appointments tool: connect in one click, see which
 * calendar bookings go to, and open the full settings without leaving the page.
 */
export function GoogleCalendarAppointmentCard({ locale }: { locale: "it" | "en" }) {
  const en = locale === "en";
  const [connection, setConnection] = useState<GoogleCalendarConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const { connect, connecting } = useGoogleCalendarConnect({ en, onConnected: setConnection });

  useEffect(() => {
    let alive = true;
    apiFetch<GoogleCalendarConnection>("/integrations/google-calendar")
      .then((current) => alive && setConnection(current))
      .catch(() => alive && setConnection(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return null;

  const live = connection?.connected && connection.status === "enabled" && !connection.error_code;
  const problem = connection?.connected && connection.error_code
    ? googleCalendarErrorCopy(connection.error_code, en)
    : null;

  let summary: string;
  if (live) {
    summary = en
      ? `Bookings go to "${connection!.calendar_name}" and visitors only see free times.`
      : `Le prenotazioni finiscono in "${connection!.calendar_name}" e i visitatori vedono solo gli orari liberi.`;
  } else if (problem) {
    summary = problem.text;
  } else if (connection?.connected) {
    summary = en
      ? "Google Calendar is connected but sync is turned off."
      : "Google Calendar è collegato ma la sincronizzazione è spenta.";
  } else {
    summary = en
      ? "Connect Google Calendar so visitors pick from your real free times and every booking lands in your calendar."
      : "Collega Google Calendar: i visitatori scelgono tra i tuoi orari davvero liberi e ogni prenotazione finisce nel calendario.";
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border/50 pt-3">
      <p className="text-sm font-medium">Google Calendar</p>
      <p className={problem ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{summary}</p>
      <div className="flex flex-wrap gap-2">
        {!connection?.connected || problem?.reconnect ? (
          <Button size="sm" className="min-h-9" onClick={connect} disabled={connecting}>
            {connecting
              ? (en ? "Waiting for Google..." : "In attesa di Google...")
              : problem?.reconnect
                ? (en ? "Reconnect Google Calendar" : "Ricollega Google Calendar")
                : (en ? "Connect Google Calendar" : "Collega Google Calendar")}
          </Button>
        ) : null}
        {connection?.connected ? (
          <Button size="sm" variant="outline" className="min-h-9" onClick={() => setOpen(true)}>
            {en ? "Manage" : "Gestisci"}
          </Button>
        ) : null}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Google Calendar</DialogTitle>
            <DialogDescription>
              {en ? "Calendar, bookable hours and sync for chat appointments." : "Calendario, orari prenotabili e sincronizzazione degli appuntamenti presi in chat."}
            </DialogDescription>
          </DialogHeader>
          <GoogleCalendarSetup
            locale={locale}
            connection={connection}
            loading={false}
            onChange={(next) => {
              setConnection(next);
              if (!next) setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
