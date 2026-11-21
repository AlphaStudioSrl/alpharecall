import * as React from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { cardCopy } from "@/lib/card-copy";

export type MessageRatingValue = "up" | "down" | null;

/**
 * Posts a rating for one assistant answer. The shell registers it (app.tsx),
 * because it owns the visitor token and the public request signature; until
 * it does, the thumbs stay hidden.
 */
export type MessageRatingSender = (messageId: number, rating: MessageRatingValue) => Promise<boolean>;

let sender: MessageRatingSender | null = null;
const listeners = new Set<() => void>();
const ratings = new Map<number, MessageRatingValue>();

export function registerMessageRatingSender(next: MessageRatingSender | null) {
  sender = next;
  listeners.forEach((listener) => listener());
  return () => {
    if (sender === next) {
      sender = null;
      listeners.forEach((listener) => listener());
    }
  };
}

function useSender() {
  return React.useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => sender,
    () => null,
  );
}

/**
 * The stored id of an answer, or null when it cannot be rated. A streamed
 * answer has an id only when the backend announced it (`message` event). A
 * history row always has one, so it also needs the "rating" key, which only a
 * backend with the rating route sends; `chatMessageId` ("stored-…" for history
 * rows) tells the two apart.
 */
export function ratedMessageId(metadata: Record<string, unknown> | undefined, chatMessageId?: string): number | null {
  if (!metadata) return null;
  if (chatMessageId?.startsWith("stored-") && !("rating" in metadata)) return null;
  const id = Number(metadata.message_id ?? metadata.messageId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Thumbs up / down next to copy and retry on an assistant answer (bare icons, w-answer A). */
export function MessageRating({ messageId, initial = null }: { messageId: number | null; initial?: MessageRatingValue }) {
  const copy = cardCopy();
  const send = useSender();
  const [value, setValue] = React.useState<MessageRatingValue>(() => (messageId ? ratings.get(messageId) ?? initial : initial));
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  if (!send || !messageId) return null;

  const rate = async (next: Exclude<MessageRatingValue, null>) => {
    if (state === "saving") return;
    const target: MessageRatingValue = value === next ? null : next;
    const previous = value;
    setValue(target);
    setState("saving");
    // The answer row is written just after the stream ends: a very quick tap can
    // land before it exists, so one failure is retried shortly after.
    const attempt = () => send(messageId, target).catch(() => false);
    const ok = (await attempt()) || (await new Promise((r) => setTimeout(r, 600)).then(attempt));
    if (ok) {
      ratings.set(messageId, target);
      setState(target ? "saved" : "idle");
    } else {
      setValue(previous);
      setState("error");
    }
  };

  return (
    <>
      <button type="button" className="ar-chat-action-icon ar-rate" data-rate="up" aria-pressed={value === "up"}
        aria-label={copy.rateUp} title={copy.rateUp} onClick={() => { void rate("up"); }}>
        <ThumbsUp aria-hidden="true" />
      </button>
      <button type="button" className="ar-chat-action-icon ar-rate" data-rate="down" aria-pressed={value === "down"}
        aria-label={copy.rateDown} title={copy.rateDown} onClick={() => { void rate("down"); }}>
        <ThumbsDown aria-hidden="true" />
      </button>
      <span className="ar-rate-note" role="status" data-error={state === "error" ? "true" : undefined}>
        {state === "saved" ? copy.rateThanks : state === "error" ? copy.rateError : ""}
      </span>
    </>
  );
}
