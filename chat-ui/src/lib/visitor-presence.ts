import * as React from "react";

/**
 * Tells the operator whether a visitor is still in a chat that waits for them.
 * Without it the dashboard cannot know: closing the panel or starting a new chat
 * happens only in the browser. Decoration for the operator, so a failure is
 * ignored; `keepalive` lets the call leave while the page closes.
 */
export type VisitorPresenceState = "left" | "new_chat" | "back";

export const isWaitingStatus = (status: unknown) => status === "handoff" || status === "escalated";

/**
 * Also true right after the assistant passed the chat on: the status only arrives
 * with the next poll, seconds later, and the visitor may already be closing the chat.
 */
export function awaitsPerson(status: unknown, lastAssistantTool: unknown) {
  if (isWaitingStatus(status)) return true;
  return status !== "closed" && lastAssistantTool === "escalate";
}

export function sendVisitorPresence({ restBase, headers, conversationId, state }: {
  restBase: string;
  headers: Record<string, string>;
  conversationId: number;
  state: VisitorPresenceState;
}): Promise<boolean> {
  if (!restBase || !conversationId || typeof fetch !== "function") return Promise.resolve(false);
  return fetch(`${restBase.replace(/\/$/, "")}/visitor-presence`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify({ thread_id: conversationId, state }),
  })
    .then((res) => res.ok)
    .catch(() => false);
}

const flagKey = (conversationId: number) => `alpharecall_left:${window.location.host}:${conversationId}`;
const readFlag = (conversationId: number) => {
  try { return localStorage.getItem(flagKey(conversationId)) === "1"; } catch { return false; }
};
const writeFlag = (conversationId: number, on: boolean) => {
  try {
    if (on) localStorage.setItem(flagKey(conversationId), "1");
    else localStorage.removeItem(flagKey(conversationId));
  } catch { /* Optional: without it the marker clears on the visitor's next message. */ }
};

/**
 * `present`: the chat is on screen. Leaving means closing the panel or the page
 * while the chat waits for a person; coming back undoes it. The flag makes "back"
 * cost a call only after a "left", also when the page was reloaded in between, and
 * stays until the call succeeds. A marker that still slips through (a reordered call
 * while changing page) clears with the visitor's next message.
 */
export function useVisitorPresence({ conversationId, awaitingPerson, present, send }: {
  conversationId: number | null;
  awaitingPerson: boolean;
  present: boolean;
  send: (conversationId: number, state: VisitorPresenceState) => Promise<boolean>;
}) {
  const sendRef = React.useRef(send);
  sendRef.current = send;
  const waiting = !!conversationId && awaitingPerson;
  // A page opened with the panel closed has not left anything.
  const seenOnScreen = React.useRef(false);
  if (present) seenOnScreen.current = true;

  const comeBack = React.useCallback((id: number) => {
    void sendRef.current(id, "back").then((ok) => { if (ok) writeFlag(id, false); });
  }, []);

  React.useEffect(() => {
    if (!waiting || !conversationId) return;
    const flagged = readFlag(conversationId);
    if (present && flagged) {
      comeBack(conversationId);
    } else if (!present && !flagged && seenOnScreen.current) {
      // Also when the hand-off landed after the panel was closed.
      writeFlag(conversationId, true);
      void sendRef.current(conversationId, "left");
    }
  }, [comeBack, conversationId, present, waiting]);

  React.useEffect(() => {
    if (!waiting || !present || !conversationId) return;
    const leave = () => {
      writeFlag(conversationId, true);
      void sendRef.current(conversationId, "left");
    };
    const returned = (event: PageTransitionEvent) => {
      if (event.persisted && readFlag(conversationId)) comeBack(conversationId);
    };
    // The same chat open in another tab: that tab closing does not mean the visitor left.
    const otherTab = (event: StorageEvent) => {
      if (event.key === flagKey(conversationId) && event.newValue === "1") comeBack(conversationId);
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", returned);
    window.addEventListener("storage", otherTab);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", returned);
      window.removeEventListener("storage", otherTab);
    };
  }, [comeBack, conversationId, present, waiting]);
}
