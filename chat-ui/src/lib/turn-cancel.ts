/**
 * Stopping a question the assistant is still answering (the widget's Stop,
 * Prova's "Ricomincia").
 *
 * Aborting the fetch alone is not enough: the WordPress proxy keeps waiting
 * on the API, which would finish the answer, save it and count it toward the
 * plan. So every question carries a random `turn_id`, and stopping it also
 * sends that id to POST /chat/cancel (app.turn_cancel on the API).
 */

const TURN_ID = /^[A-Za-z0-9_-]{16,64}$/;

export function isTurnId(value: unknown): value is string {
  return typeof value === "string" && TURN_ID.test(value);
}

/** A fresh id for one question: 32 hex characters. */
export function newTurnId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface TurnCancel {
  /** The plugin's REST base (".../wp-json/alpharecall/v1"). */
  restBase: string;
  /** The same signature, nonce and visitor headers the question was sent with. */
  headers: Record<string, string>;
  turnId: string;
  /** Characters of the answer on screen when it was stopped; only those are kept. */
  shownChars?: number;
}

/**
 * Tell the API to stop the turn. Fire and forget: the visitor has moved on,
 * a failure changes nothing on screen. `keepalive` lets it leave even when
 * the page is being closed.
 */
export function cancelTurn({ restBase, headers, turnId, shownChars }: TurnCancel): Promise<boolean> {
  if (!restBase || !isTurnId(turnId) || typeof fetch !== "function") return Promise.resolve(false);
  const body: Record<string, unknown> = { turn_id: turnId };
  if (typeof shownChars === "number" && Number.isFinite(shownChars) && shownChars >= 0) {
    body.shown_chars = Math.floor(shownChars);
  }
  return fetch(`${restBase.replace(/\/$/, "")}/chat/cancel`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify(body),
  })
    .then((res) => res.ok)
    .catch(() => false);
}
