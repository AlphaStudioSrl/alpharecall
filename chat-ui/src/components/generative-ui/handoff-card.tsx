import * as React from "react";
import { CircleCheck, Users } from "lucide-react";
import { cardCopy } from "@/lib/card-copy";
import { canLeaveHandoffContact, sendHandoffContact, startNewChatFromHandoff, type HandoffContactStage } from "@/lib/handoff-contact";

interface HandoffCardProps {
  component: {
    status?: string;
    lines?: Array<{ label?: string; value?: unknown }>;
    channel?: string;
  };
  onSendMessage?: (text: string) => void;
  /** Only the newest hand-off follows the chat; older ones are a static record. */
  live?: boolean;
}

/**
 * True once a person from the team wrote after this card: a team message
 * (.ar-turn--human) that follows it, so an operator from an earlier hand-off
 * never marks a new one. The status alone is no proof: "escalated" is still
 * waiting and "handoff" is also set when the visitor writes into a closed
 * thread. A closed chat never counts. Reading the DOM keeps the card free of
 * the chat runtime, so it also renders in tests and in the dashboard preview.
 */
function usePersonJoined(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [joined, setJoined] = React.useState(false);
  React.useEffect(() => {
    const card = ref.current;
    const panel = card?.closest(".ar-chat-panel");
    if (!enabled || !card || !panel) {
      setJoined(false);
      return;
    }
    const read = () => {
      if (panel.getAttribute("data-chat-status") === "closed") {
        setJoined(false);
        return;
      }
      // data-human-joined (app.tsx) is a cheap "nobody yet" check, never proof on its own.
      if (panel.getAttribute("data-human-joined") === "false") {
        setJoined(false);
        return;
      }
      const after = Array.from(panel.querySelectorAll(".ar-turn--human"))
        .some((el) => card.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      setJoined(after);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(panel, { attributes: true, attributeFilter: ["data-chat-status", "data-human-joined"], childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref, enabled]);
  return joined;
}

/** How far the visitor got, as the server knows it: it survives a reload of the page. */
function usePanelContactStage(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  const [stage, setStage] = React.useState<HandoffContactStage | null>(null);
  React.useEffect(() => {
    const panel = ref.current?.closest(".ar-chat-panel");
    if (!enabled || !panel) return;
    const read = () => {
      const value = panel.getAttribute("data-handoff-contact");
      setStage(value === "details" || value === "sent" ? value : null);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(panel, { attributes: true, attributeFilter: ["data-handoff-contact"] });
    return () => observer.disconnect();
  }, [ref, enabled]);
  return stage;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The visitor does not want to wait: an e-mail first, so the request is stored
 * even if they leave right after, then optional details.
 */
function HandoffContactForm({ step, takeFocus, onStage }: { step: "email" | "details"; takeFocus: boolean; onStage: (stage: HandoffContactStage) => void }) {
  const copy = cardCopy();
  const id = React.useId();
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const fieldRef = React.useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // After the visitor's click the keyboard follows, without moving the chat. A step
  // restored from the server (reload, another tab) leaves the focus where it is.
  React.useEffect(() => { if (takeFocus) fieldRef.current?.focus({ preventScroll: true }); }, [step, takeFocus]);
  const isEmail = step === "email";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const text = value.trim();
    if (isEmail && !EMAIL_PATTERN.test(text)) {
      setError(copy.handoffEmailInvalid);
      return;
    }
    setBusy(true);
    setError("");
    const result = await sendHandoffContact(isEmail ? { email: text } : text ? { details: text } : { finish: true });
    setBusy(false);
    if ("stage" in result) {
      setValue("");
      onStage(result.stage);
    } else {
      setError(result.status === 422 ? copy.handoffEmailInvalid : copy.handoffError);
    }
  };

  return (
    <form className="ar-handoff-form" onSubmit={submit} noValidate>
      <label className="ar-field" htmlFor={id}>
        <span className="ar-field-label">{isEmail ? copy.handoffEmailLabel : copy.handoffDetailsLabel}</span>
        {isEmail ? (
          <input ref={fieldRef} id={id} type="email" autoComplete="email" inputMode="email" maxLength={254} value={value}
            aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => { setValue(e.target.value); setError(""); }} />
        ) : (
          <textarea ref={fieldRef} id={id} rows={2} maxLength={2000} value={value}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => { setValue(e.target.value); setError(""); }} />
        )}
      </label>
      {error ? <p id={`${id}-error`} className="ar-handoff-error" role="alert">{error}</p> : null}
      {isEmail ? <p className="ar-note">{copy.handoffEmailHelp}</p> : null}
      <button type="submit" className="ar-btn ar-btn--primary ar-btn--sm" disabled={busy} aria-busy={busy || undefined}>{copy.handoffSend}</button>
      {isEmail ? <p className="ar-note">{copy.draftConsent}</p> : null}
    </form>
  );
}

/**
 * Messenger hand-off: Sofia passed the chat to the team. The card says where
 * the answer arrives, flips when a person joins, and lets a visitor who does
 * not want to wait leave an e-mail and go.
 */
export function HandoffCard({ component, onSendMessage, live = false }: HandoffCardProps) {
  const copy = cardCopy();
  const rootRef = React.useRef<HTMLElement>(null);
  const human = usePersonJoined(rootRef, live);
  const serverStage = usePanelContactStage(rootRef, live);
  const [asked, setAsked] = React.useState(false);
  const [localStage, setLocalStage] = React.useState<HandoffContactStage | null>(null);
  const channelLine = component.lines?.find((line) => /^(channel|canale)$/i.test(String(line?.label || "")));
  const channel = String(component.channel || channelLine?.value || "").toLowerCase();
  const byEmail = channel === "email";
  const stage = localStage === "sent" || serverStage === "sent" ? "sent" : localStage || serverStage;
  const sent = live && !human && stage === "sent";
  const canContact = live && !human && !sent && !!onSendMessage && canLeaveHandoffContact();
  const step = stage === "details" ? "details" : asked ? "email" : null;

  return (
    <>
      <section ref={rootRef} className="ar-card ar-handoff-card" data-state={!live ? "past" : human ? "joined" : sent ? "sent" : "waiting"} aria-live={live ? "polite" : undefined}>
        <div className="ar-card-head">
          {human ? <span className="ar-live-dot" aria-hidden="true" /> : sent ? <CircleCheck aria-hidden="true" className="ar-card-icon ar-card-icon--ok" /> : <Users aria-hidden="true" className="ar-card-icon" />}
          <div className="ar-card-heading">
            <h3 className="ar-card-title">{human ? copy.handoffJoined : sent ? copy.handoffSentTitle : copy.handoffTitle}</h3>
            <p className="ar-card-sub">{human ? copy.handoffJoinedSub : sent ? copy.handoffSentSub : byEmail ? copy.handoffEmail : copy.handoffWaiting}</p>
          </div>
        </div>
        {live && !human && !sent ? <div className="ar-wait-bar" aria-hidden="true"><i /></div> : null}
        {canContact && !step ? (
          <div className="ar-handoff-alt">
            <span>{copy.handoffNoWait}</span>
            <button type="button" className="ar-text-btn ar-text-btn--brand" onClick={() => setAsked(true)}>
              {copy.handoffCallback}
            </button>
          </div>
        ) : null}
        {canContact && step ? <HandoffContactForm key={step} step={step} takeFocus={asked} onStage={setLocalStage} /> : null}
        {sent ? (
          <button type="button" className="ar-text-btn ar-text-btn--brand ar-handoff-new" onClick={startNewChatFromHandoff}>{copy.handoffNewChat}</button>
        ) : null}
      </section>
      {live && byEmail && !human && !sent && !step ? <p className="ar-note">{copy.handoffEmailNote}</p> : null}
    </>
  );
}
