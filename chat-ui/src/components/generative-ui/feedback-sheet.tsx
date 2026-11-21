import * as React from "react";
import { CircleCheck, Star } from "lucide-react";
import { ChatSheet } from "@/components/chat/sheet";
import { cardCopy } from "@/lib/card-copy";
import { moveRadioFocus, radioTabIndex } from "./radio-keys";

const ASKED_KEY = "alpharecall_feedback_sent";

/** Feedback is asked once per browser session. */
export function feedbackAlreadySent() {
  try {
    return window.sessionStorage.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberFeedbackSent() {
  try {
    window.sessionStorage.setItem(ASKED_KEY, "1");
  } catch {
    // Private mode: asking twice is the lesser evil.
  }
}

export type VisitorFeedback = { rating: number | null; comment: string; idempotencyKey: string };
/**
 * Stores the feedback directly (app.tsx owns the visitor token and signature).
 * "missing" means the backend has no such route (404/405, an older install):
 * the sheet then falls back to the chat message.
 */
export type FeedbackSendResult = "ok" | "missing" | "error";
export type FeedbackSender = (feedback: VisitorFeedback) => Promise<FeedbackSendResult>;

let feedbackSender: FeedbackSender | null = null;

export function registerFeedbackSender(next: FeedbackSender | null) {
  feedbackSender = next;
  return () => {
    if (feedbackSender === next) feedbackSender = null;
  };
}

const newKey = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

function Stars({ value, onChange, label }: { value: number; onChange?: (n: number) => void; label: string }) {
  const copy = cardCopy();
  if (!onChange) {
    return (
      <span className="ar-stars ar-stars--static" role="img" aria-label={copy.feedbackRated(value)}>
        {[1, 2, 3, 4, 5].map((n) => <Star key={n} aria-hidden="true" data-on={n <= value ? "true" : undefined} />)}
      </span>
    );
  }
  return (
    <div className="ar-stars" role="radiogroup" aria-label={label}
      onKeyDown={(event) => moveRadioFocus(event, (el) => onChange(Number(el.dataset.value)))}>
      {[1, 2, 3, 4, 5].map((n, i) => (
        <button key={n} type="button" role="radio" className="ar-star" data-value={n} aria-checked={value === n}
          tabIndex={radioTabIndex(value === n, i, value > 0)} aria-label={copy.feedbackStar(n)}
          data-on={n <= value ? "true" : undefined} onClick={() => onChange(n)}>
          <Star aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/**
 * End of chat feedback (Messenger): stars plus a sentence. The sentence is
 * required, so the button waits for it and says why. With a registered sender
 * the feedback is stored directly; otherwise it goes out as a chat message
 * for the assistant's feedback tool.
 */
export function FeedbackSheet({ open, onClose, onSubmit }: {
  open: boolean;
  onClose: () => void;
  /** Fallback: receives the visitor's feedback as one chat message for the feedback tool. */
  onSubmit: (message: string, rating: number, comment: string) => void | Promise<unknown>;
}) {
  const copy = cardCopy();
  const [rating, setRating] = React.useState(0);
  const [comment, setComment] = React.useState("");
  const [state, setState] = React.useState<"idle" | "sending" | "saved" | "error">("idle");
  // One key per feedback: a retry after a lost response cannot store it twice.
  const key = React.useRef(newKey());
  const titleId = React.useId();
  const commentId = React.useId();
  const ready = comment.trim().length >= 3;

  React.useEffect(() => {
    if (!open) setState((s) => (s === "error" ? "idle" : s));
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || state === "sending") return;
    const text = comment.trim();
    setState("sending");
    const result: FeedbackSendResult = feedbackSender
      ? await feedbackSender({ rating: rating || null, comment: text, idempotencyKey: key.current }).catch((): FeedbackSendResult => "error")
      : "missing";
    if (result === "error") {
      setState("error");
      return;
    }
    if (result === "ok") {
      rememberFeedbackSent();
      setState("saved");
      return;
    }
    try {
      await onSubmit(copy.feedbackMessage(rating, text), rating, text);
      rememberFeedbackSent();
      setRating(0);
      setComment("");
      onClose();
    } finally {
      setState("idle");
    }
  };

  if (state === "saved") {
    return (
      <ChatSheet open={open} onClose={onClose} labelledBy={titleId} closeLabel={copy.close} className="ar-feedback-sheet">
        <div className="ar-sheet-head ar-sheet-head--center" role="status">
          <CircleCheck aria-hidden="true" className="ar-card-icon ar-card-icon--ok ar-feedback-done-icon" />
          <h2 id={titleId} className="ar-sheet-title">{copy.feedbackThanks}</h2>
          <p className="ar-sheet-text">{copy.feedbackSaved}</p>
          {rating > 0 ? <Stars value={rating} label={copy.feedbackStars} /> : null}
        </div>
        <button type="button" className="ar-btn ar-btn--secondary ar-btn--lg" onClick={onClose}>{copy.close}</button>
      </ChatSheet>
    );
  }

  return (
    <ChatSheet open={open} onClose={onClose} labelledBy={titleId} closeLabel={copy.close} className="ar-feedback-sheet">
      <div className="ar-sheet-head ar-sheet-head--center">
        <h2 id={titleId} className="ar-sheet-title">{copy.feedbackTitle}</h2>
        <p className="ar-sheet-text">{copy.feedbackSub}</p>
      </div>
      <form className="ar-sheet-form" onSubmit={submit}>
        <Stars value={rating} onChange={setRating} label={copy.feedbackStars} />
        <label className="ar-field ar-field--tall" htmlFor={commentId}>
          <span className="ar-field-label">{copy.feedbackComment}</span>
          <textarea id={commentId} rows={3} value={comment} placeholder={copy.feedbackPlaceholder}
            required aria-required="true" onChange={(e) => { setComment(e.target.value); if (state === "error") setState("idle"); }} />
        </label>
        {state === "error" ? <p className="ar-note ar-note--start" role="alert" data-error="true">{copy.feedbackError}</p> : null}
        <button type="submit" className="ar-btn ar-btn--primary ar-btn--lg" disabled={!ready || state === "sending"} data-waiting={!ready ? "true" : undefined}>
          {ready ? copy.feedbackSend : copy.feedbackNeedComment}
        </button>
      </form>
    </ChatSheet>
  );
}

/** Receipt in the thread after the feedback tool saved the visitor's feedback. */
export function FeedbackReceipt({ component }: {
  component: { title?: string; description?: string; lines?: Array<{ label?: string; value?: unknown }> };
}) {
  const copy = cardCopy();
  const ratingLine = component.lines?.find((l) => /^(rating|valutazione)$/i.test(String(l?.label || "")));
  const rating = Math.max(0, Math.min(5, Math.round(Number(ratingLine?.value) || 0)));
  return (
    <section className="ar-card ar-feedback-card" role="status">
      {rating > 0 ? <Stars value={rating} label={copy.feedbackStars} /> : null}
      <div className="ar-card-heading">
        <h3 className="ar-card-title">{copy.feedbackThanks}</h3>
        {component.description && !/grazie|thank/i.test(String(component.description))
          ? <p className="ar-card-sub">{String(component.description)}</p>
          : null}
      </div>
    </section>
  );
}
