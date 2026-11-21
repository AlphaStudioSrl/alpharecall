"use client";

import * as React from "react";
import { Check, Pencil, CircleCheck } from "lucide-react";
import { cardCopy } from "@/lib/card-copy";

export type DraftField = {
  id: string;
  label: string;
  value: string;
  multiline?: boolean;
  /** Read-only rows (recipient) show no pencil. */
  readOnly?: boolean;
  inputType?: "text" | "email" | "tel";
};

type DraftState = "review" | "sending" | "submitting" | "sent" | "cancelled";

/**
 * What a send produced. Nothing (or a sent time) is a success; an error keeps
 * the card open with the message and a retry, unless it is final (the draft
 * can no longer be sent, e.g. a newer one replaced it).
 */
export type DraftSendOutcome =
  | void
  | { error: string; final?: boolean }
  | { sentAt?: string | null; repeated?: boolean };

export interface RequestDraftProps {
  id: string;
  fields: DraftField[];
  sendLabel: string;
  consentLine?: string;
  outcome?: "sent" | "cancelled";
  /** When the request was actually sent (ISO); a reloaded card shows this, never the reload time. */
  sentAt?: string | null;
  /** Heading of the sent state ("Richiesta inviata" by default). */
  sentTitle?: string;
  /** The time line under it; false when the send happened earlier (a repeated request). */
  showSentTime?: boolean;
  undoGracePeriod?: number;
  /** Called after the undo window with the fields the visitor changed (empty when none). */
  onSend?: (changes: Record<string, string>, values: Record<string, string>) => DraftSendOutcome | Promise<DraftSendOutcome>;
  onUndo?: () => void;
  onCancel?: () => void;
  className?: string;
}

const DEFAULT_GRACE_PERIOD = 5000;
const COLLAPSED_CHARS = 220;

const stateFromOutcome = (outcome: RequestDraftProps["outcome"]): DraftState =>
  outcome === "sent" ? "sent" : outcome === "cancelled" ? "cancelled" : "review";

function parseTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTime(date: Date) {
  const language = String((window as any).AlphaRecallChat?.language || document.documentElement.lang || "it");
  try {
    return date.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" });
  } catch {
    return date.toLocaleTimeString("it-IT", { hour: "numeric", minute: "2-digit" });
  }
}

function FieldValue({ field, value }: { field: DraftField; value: string }) {
  const copy = cardCopy();
  const [expanded, setExpanded] = React.useState(false);
  const long = !!field.multiline && value.length > COLLAPSED_CHARS;
  return (
    <>
      <span className="ar-draft-value" data-clamped={long && !expanded ? "true" : undefined}>{value}</span>
      {long ? (
        <button type="button" className="ar-text-btn" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? copy.draftShowLess : copy.draftReadAll}
        </button>
      ) : null}
    </>
  );
}

/**
 * The request Sofia prepared, shown before it goes to the business: every
 * field can be corrected in place and nothing is sent without the explicit tap.
 */
export function RequestDraft({
  id,
  fields,
  sendLabel,
  consentLine,
  outcome,
  sentAt: sentAtProp,
  sentTitle,
  showSentTime = true,
  undoGracePeriod = DEFAULT_GRACE_PERIOD,
  onSend,
  onUndo,
  onCancel,
  className,
}: RequestDraftProps) {
  const copy = cardCopy();
  const initial = React.useMemo(() => Object.fromEntries(fields.map((f) => [f.id, f.value])), [fields]);
  const [values, setValues] = React.useState<Record<string, string>>(initial);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [state, setState] = React.useState<DraftState>(() => stateFromOutcome(outcome));
  const [countdown, setCountdown] = React.useState(Math.ceil(undoGracePeriod / 1000));
  // A card that arrives already sent (a reload) knows its time only from the
  // stored confirm; without one it shows no time rather than the reload time.
  const [sentAt, setSentAt] = React.useState<Date | null>(() => (outcome === "sent" ? parseTime(sentAtProp) : null));
  const [repeated, setRepeated] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; final: boolean } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const undoRef = React.useRef<HTMLButtonElement>(null);
  const previousOutcome = React.useRef(outcome);
  const titleId = `${id}-title`;

  // The send waiting out the undo window: closing the chat (which unmounts the
  // card) must not silently drop a request the visitor already tapped.
  const pendingSend = React.useRef<(() => void) | null>(null);
  const clearTimers = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (ticker.current) clearInterval(ticker.current);
    timer.current = null;
    ticker.current = null;
    pendingSend.current = null;
  }, []);
  React.useEffect(() => () => {
    const send = pendingSend.current;
    clearTimers();
    send?.();
  }, [clearTimers]);

  React.useEffect(() => {
    if (previousOutcome.current === outcome) return;
    previousOutcome.current = outcome;
    clearTimers();
    const next = stateFromOutcome(outcome);
    setState(next);
    setSentAt(next === "sent" ? parseTime(sentAtProp) ?? new Date() : null);
  }, [outcome, sentAtProp, clearTimers]);

  const changes = React.useMemo(() => {
    const diff: Record<string, string> = {};
    for (const field of fields) {
      const value = (values[field.id] ?? "").trim();
      if (value !== field.value.trim()) diff[field.id] = value;
    }
    return diff;
  }, [fields, values]);

  const submit = async () => {
    setEditing(null);
    setError(null);
    setState("submitting");
    let result: DraftSendOutcome;
    try {
      result = await onSend?.(changes, values);
    } catch {
      result = { error: copy.draftSendError };
    }
    if (result && "error" in result) {
      setError({ message: result.error, final: !!result.final });
      setState("review");
      return;
    }
    const success = (result || {}) as { sentAt?: string | null; repeated?: boolean };
    setSentAt(parseTime(success.sentAt) ?? new Date());
    setRepeated(!!success.repeated);
    setState("sent");
  };

  const startSend = () => {
    setEditing(null);
    setError(null);
    setState("sending");
    setCountdown(Math.ceil(undoGracePeriod / 1000));
    window.requestAnimationFrame(() => undoRef.current?.focus({ preventScroll: true }));
    ticker.current = setInterval(() => setCountdown((s) => Math.max(0, s - 1)), 1000);
    timer.current = setTimeout(() => {
      clearTimers();
      void submit();
    }, undoGracePeriod);
    pendingSend.current = () => void onSend?.(changes, values);
  };

  const undo = () => {
    clearTimers();
    setState("review");
    onUndo?.();
  };

  const cancel = () => {
    clearTimers();
    setState("cancelled");
    onCancel?.();
  };

  if (state === "cancelled") return null;

  const done = state === "sent";
  const closed = !!error?.final;
  const editable = state === "review" && !closed;
  const visible = fields.filter((f) => (values[f.id] ?? "").trim() || editing === f.id);

  return (
    <article
      className={`ar-card ar-draft-card${className ? ` ${className}` : ""}`}
      data-slot="message-draft"
      data-tool-ui-id={id}
      data-state={state}
      aria-labelledby={titleId}
    >
      {done ? (
        <div className="ar-card-head" role="status">
          <CircleCheck aria-hidden="true" className="ar-card-icon ar-card-icon--ok" />
          <div className="ar-card-heading">
            <h3 id={titleId} className="ar-card-title">{repeated ? copy.draftAlreadySent : sentTitle || copy.draftSent}</h3>
            {showSentTime && !repeated && sentAt ? <p className="ar-card-sub">{copy.draftSentAt(formatTime(sentAt))}</p> : null}
          </div>
        </div>
      ) : (
        <h3 id={titleId} className="ar-sr-only">{copy.draftLabel}</h3>
      )}

      {visible.length ? <dl className="ar-draft-rows">
        {visible.map((field) => {
          const value = values[field.id] ?? "";
          const isEditing = editing === field.id && editable;
          const inputId = `${id}-${field.id}`;
          if (isEditing) {
            const close = () => setEditing(null);
            return (
              <div key={field.id} className="ar-draft-row" data-editing="true">
                <label className="ar-field ar-draft-edit" htmlFor={inputId}>
                  <span className="ar-field-label">{field.label}</span>
                  {field.multiline ? (
                    <textarea id={inputId} rows={3} value={value} autoFocus
                      onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }} />
                  ) : (
                    <input id={inputId} type={field.inputType || "text"} value={value} autoFocus
                      autoComplete={field.inputType === "email" ? "email" : field.inputType === "tel" ? "tel" : field.id === "name" ? "name" : "off"}
                      onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); close(); }
                        if (e.key === "Escape") { e.stopPropagation(); close(); }
                      }} />
                  )}
                </label>
                <button type="button" className="ar-icon-btn" aria-label={copy.draftDone} onClick={close}>
                  <Check aria-hidden="true" />
                </button>
              </div>
            );
          }
          return (
            <div key={field.id} className="ar-draft-row">
              <div className="ar-draft-text">
                <dt className="ar-field-label">{field.label}</dt>
                <dd><FieldValue field={field} value={value} /></dd>
              </div>
              {!field.readOnly && editable ? (
                <button type="button" className="ar-icon-btn" aria-label={copy.draftEdit(field.label)}
                  onClick={() => setEditing(field.id)}>
                  <Pencil aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
      </dl> : null}

      {state === "review" && error ? (
        <p className="ar-note ar-note--start ar-draft-error" role="alert" data-error="true">{error.message}</p>
      ) : null}

      {editable ? (
        <div className="ar-draft-actions">
          <div className="ar-btn-row ar-btn-row--main">
            <button type="button" className="ar-btn ar-btn--secondary" onClick={cancel}>{copy.draftCancel}</button>
            {/* A retry sends right away: the visitor already waited out the undo window once. */}
            <button type="button" className="ar-btn ar-btn--primary" onClick={error ? () => void submit() : startSend}>
              {error ? copy.draftRetry : sendLabel}
            </button>
          </div>
          {consentLine ? <p className="ar-note">{consentLine}</p> : null}
        </div>
      ) : null}

      {state === "submitting" ? (
        <div className="ar-draft-sending" aria-live="polite">
          <span>{copy.draftSubmitting}</span>
        </div>
      ) : null}

      {state === "sending" ? (
        <div className="ar-draft-sending" aria-live="polite">
          <span>{copy.draftSendingIn(countdown)}</span>
          <button ref={undoRef} type="button" className="ar-btn ar-btn--secondary" onClick={undo}>{copy.draftUndo}</button>
        </div>
      ) : null}
    </article>
  );
}
