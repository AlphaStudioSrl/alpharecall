import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiRequestError, apiFetch } from "@/admin/lib/api";
import { startWatch, type Poller } from "@/admin/lib/poll";
import type { GoogleCalendarConnection } from "./google-calendar-setup";

export type GoogleCalendarErrorCode =
  | "reauth_required"
  | "calendar_not_found"
  | "missing_scopes"
  | "rate_limited"
  | "google_unavailable"
  | "unknown";

/** Owner-facing explanation of a Google problem, and whether a reconnect fixes it. */
export function googleCalendarErrorCopy(code: string | null | undefined, en: boolean) {
  switch (code) {
    case "reauth_required":
      return {
        reconnect: true,
        text: en
          ? "Google no longer lets AlphaRecall use your calendar (access was revoked or expired). Visitors can still book in your bookable hours, but appointments won't reach Google until you reconnect."
          : "Google non consente più ad AlphaRecall di usare il calendario (accesso revocato o scaduto). I visitatori possono ancora prenotare negli orari prenotabili, ma gli appuntamenti arriveranno su Google solo dopo che lo ricolleghi.",
      };
    case "missing_scopes":
      return {
        reconnect: true,
        text: en
          ? "On Google's screen not every permission was allowed. Reconnect and leave all the boxes ticked: AlphaRecall needs them to read your free times and add appointments."
          : "Nella schermata di Google non sono stati concessi tutti i permessi. Ricollega e lascia selezionate tutte le caselle: servono ad AlphaRecall per leggere gli orari liberi e aggiungere gli appuntamenti.",
      };
    case "calendar_not_found":
      return {
        reconnect: true,
        text: en
          ? "The calendar in use was deleted or is no longer shared with this account. Reconnect to pick a calendar you can edit."
          : "Il calendario in uso è stato eliminato o non è più condiviso con questo account. Ricollega Google Calendar per sceglierne uno che puoi modificare.",
      };
    case "rate_limited":
      return {
        reconnect: false,
        text: en
          ? "Google is temporarily limiting requests. Nothing to do: AlphaRecall retries on its own."
          : "Google sta limitando le richieste per qualche minuto. Non devi fare nulla: AlphaRecall riprova da solo.",
      };
    case "google_unavailable":
      return {
        reconnect: false,
        text: en
          ? "Google Calendar could not be reached. AlphaRecall retries on its own."
          : "Non è stato possibile raggiungere Google Calendar. AlphaRecall riprova da solo.",
      };
    default:
      return {
        reconnect: false,
        text: en
          ? "The last Google Calendar request failed. Try the connection test."
          : "L'ultima richiesta a Google Calendar non è andata a buon fine. Prova il test di connessione.",
      };
  }
}

/** Why a connect attempt ended without a working calendar (the callback's reason). */
function attemptFailedCopy(reason: string | null | undefined, en: boolean) {
  if (reason === "access_denied") {
    return en
      ? "You cancelled the authorization on Google: nothing changed. You can try again whenever you like."
      : "Hai annullato l'autorizzazione su Google: non è cambiato nulla. Puoi riprovare quando vuoi.";
  }
  if (reason === "expired") {
    return en
      ? "The connection request expired. Try again."
      : "La richiesta di collegamento è scaduta. Riprova.";
  }
  if (reason === "missing_scopes" || reason === "calendar_not_found" || reason === "reauth_required") {
    return googleCalendarErrorCopy(reason, en).text;
  }
  return en
    ? "Google Calendar was not connected. You can try again whenever you like."
    : "Google Calendar non è stato collegato. Puoi riprovare quando vuoi.";
}

function announce(current: GoogleCalendarConnection, en: boolean, reason?: string | null) {
  if (current.connected && current.status === "enabled" && !current.error_code && !reason) {
    toast.success(
      en
        ? `Google Calendar connected. Appointments now go to "${current.calendar_name}".`
        : `Google Calendar collegato. Gli appuntamenti ora finiscono in "${current.calendar_name}".`
    );
  } else if (reason || current.authorizing || !current.connected) {
    toast.error(attemptFailedCopy(reason || current.error_code, en));
  } else {
    toast.error(googleCalendarErrorCopy(current.error_code, en).text);
  }
}

const POLL_MS = 1200;
const MAX_WAIT_MS = 10 * 60 * 1000;
const MESSAGE_SOURCE = "alpharecall-google-calendar";

/**
 * One-click connect (and reconnect): opens Google's consent screen in a popup
 * and waits for the API to finish the setup. The callback page reports back
 * with a message and closes; the popup closing (or the watch) is the fallback
 * cue. Where popups are blocked, the admin tab itself goes to Google and the
 * callback brings it back to Richieste > Agenda (see useGoogleCalendarReturn).
 */
export function useGoogleCalendarConnect({
  en,
  onConnected,
}: {
  en: boolean;
  onConnected: (connection: GoogleCalendarConnection) => void;
}) {
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<Poller | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const stop = () => {
    pollRef.current?.stop();
    pollRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
  };

  useEffect(() => stop, []);

  const start = () =>
    apiFetch<{ authorization_url: string; return_url_accepted?: boolean }>("/integrations/google-calendar/oauth/start", { method: "POST" });

  const startFailed = (cause: unknown) => {
    setConnecting(false);
    if (cause instanceof ApiRequestError && cause.status === 503) {
      // The AlphaRecall server has no Google OAuth client yet: nothing the owner can fix here.
      toast.error(
        en
          ? "Google Calendar isn't available on AlphaRecall yet. We'll let you know as soon as you can connect it."
          : "Google Calendar non è ancora disponibile su AlphaRecall. Ti avvisiamo appena potrai collegarlo."
      );
      return;
    }
    toast.error(cause instanceof Error ? cause.message : (en ? "Could not start the connection." : "Non siamo riusciti ad avviare il collegamento."));
  };

  const connect = async () => {
    // Open the window inside the click so popup blockers allow it.
    const popup = window.open("", "alpharecall-google-calendar-oauth", "popup,width=720,height=780");
    if (!popup) {
      // Popups blocked: go to Google in this tab; the callback returns to Agenda.
      setConnecting(true);
      try {
        const result = await start();
        if (result.return_url_accepted === false) {
          // Google could not send the owner back here (older plugin, or a site
          // address the API does not recognise): only the popup works.
          setConnecting(false);
          toast.error(en ? "Allow popups for this site to connect Google Calendar." : "Consenti i popup per questo sito per collegare Google Calendar.");
          return;
        }
        window.location.assign(result.authorization_url);
      } catch (cause) {
        startFailed(cause);
      }
      return;
    }
    setConnecting(true);
    try {
      const result = await start();
      popup.location.href = result.authorization_url;
    } catch (cause) {
      popup.close();
      startFailed(cause);
      return;
    }

    let reported: string | null = null;
    const check = async (final: boolean) => {
      let failure: unknown = null;
      const current = await apiFetch<GoogleCalendarConnection>("/integrations/google-calendar", { cache: "reload" })
        .catch((error) => { failure = error; return null; });
      // A failed read backs the watch off; it is retried on the next poll.
      if (!final && !current) throw failure;
      if (!final && current!.authorizing) return;
      stop();
      setConnecting(false);
      if (!popup.closed) popup.close();
      if (!current) return;
      onConnectedRef.current(current);
      // The server records how the consent ended; a failed reconnect of a
      // working calendar otherwise looks exactly like a success.
      const result = current.last_connect_result;
      announce(current, en, reported ?? (result && result !== "connected" ? result : null));
    };
    // The callback page posts {source, status, reason} to this window. Only a
    // message from the popup we opened counts; it just triggers the final read.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== popup) return;
      const data = event.data as { source?: string; status?: string; reason?: string | null } | null;
      if (!data || data.source !== MESSAGE_SOURCE) return;
      reported = data.status === "connected" ? null : String(data.reason || "unknown");
      void check(true);
    };
    window.addEventListener("message", onMessage);
    cleanupRef.current = () => window.removeEventListener("message", onMessage);
    // One check at a time (the watch never overlaps runs), paused in a hidden tab.
    // The time limit is the watch's own timer, so it also ends a watch the tab
    // never resumed: a last check frees the button and closes the popup.
    pollRef.current = startWatch(() => check(popup.closed), POLL_MS, {
      stopAfterMs: MAX_WAIT_MS,
      onExpire: () => void check(true),
    });
  };

  return { connect, connecting };
}

const RETURN_PARAM = "google_calendar";
const RETURN_REASON_PARAM = "google_calendar_reason";

/**
 * Back from Google in this tab (popups blocked, phones): the callback appended
 * `google_calendar=connected|error` to the Agenda URL. Read it once, drop it
 * from the address bar so a reload does not repeat the message, and refresh.
 */
export function useGoogleCalendarReturn({
  en,
  onConnected,
}: {
  en: boolean;
  onConnected: (connection: GoogleCalendarConnection) => void;
}) {
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  useEffect(() => {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    const outcome = params.get(RETURN_PARAM);
    if (outcome !== "connected" && outcome !== "error") return;
    const reason = outcome === "error" ? params.get(RETURN_REASON_PARAM) || "unknown" : null;
    params.delete(RETURN_PARAM);
    params.delete(RETURN_REASON_PARAM);
    try {
      const query = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    } catch { /* the message still shows */ }
    let alive = true;
    void apiFetch<GoogleCalendarConnection>("/integrations/google-calendar", { cache: "reload" })
      .then((current) => {
        if (!alive || !current) return;
        onConnectedRef.current(current);
        announce(current, en, reason);
      })
      .catch(() => {
        if (alive && reason) toast.error(attemptFailedCopy(reason, en));
      });
    return () => {
      alive = false;
    };
    // Runs once per mount: the parameter is consumed on the first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
