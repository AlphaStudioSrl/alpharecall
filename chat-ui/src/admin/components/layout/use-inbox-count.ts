import { useState } from "react";
import { apiFetch } from "@/admin/lib/api";
import { isMissingRoute } from "@/admin/lib/rate-limit";
import { usePoll } from "@/admin/lib/poll";

/** Thread statuses that mean "Sofia handed this chat to a person". */
const NEEDS_PERSON = new Set(["handoff", "escalated"]);
const POLL_MS = 45000;

function collection(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  const items = (value as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

/**
 * Set once /chat-threads/counts turns out missing (an older backend): from
 * then on the count comes from the list for the rest of the session.
 */
let countsMissing = false;

/** Tests only: forget that the counts route was missing. */
export function resetInboxCountRoute() {
  countsMissing = false;
}

/**
 * How many conversations are waiting for a person: visitor threads the
 * assistant handed off (status handoff/escalated). Shown next to "Inbox" in
 * the top bar. Read from GET /chat-threads/counts (`waiting`), one COUNT on the
 * server over every thread. An older backend without it falls back to
 * counting the first 200 threads of the list, the URL the inbox also polls.
 * Null until the first answer (or when it fails).
 */
export function useInboxCount(enabled = true): number | null {
  const [count, setCount] = useState<number | null>(null);

  // The poller pauses in a hidden tab and backs off on errors and 429s. A
  // failed count just keeps the last number; the inbox itself reports errors.
  // No CHAT_INBOX_CHANGED listener: that event carries read and favorite
  // state, which never moves a chat in or out of handoff, and recounting on
  // it cost a list read per notification click.
  usePoll(async ({ init }) => {
    if (!countsMissing) {
      try {
        const counts = await apiFetch<{ waiting?: unknown }>("/chat-threads/counts", init);
        const waiting = Number(counts?.waiting);
        if (Number.isFinite(waiting) && waiting >= 0) {
          setCount(waiting);
          return;
        }
        countsMissing = true; // Some other answer: not this route.
      } catch (error) {
        if (!isMissingRoute(error, "/chat-threads/counts")) throw error;
        countsMissing = true;
      }
    }
    const res = await apiFetch<unknown>("/chat-threads?limit=200", init);
    setCount(
      collection(res).filter(
        (thread) => thread.thread_type !== "support" && NEEDS_PERSON.has(String(thread.status))
      ).length
    );
  }, { enabled, intervalMs: POLL_MS, path: "/chat-threads" });

  return count;
}
