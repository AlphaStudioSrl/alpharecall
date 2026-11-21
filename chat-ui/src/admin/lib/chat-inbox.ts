import { apiFetch } from "./api";
import { isMissingRoute } from "./rate-limit";
import { getConfig } from "./config";

export const CHAT_INBOX_CHANGED = "ar-chat-inbox-changed";

export interface InboxState {
  is_favorite: boolean;
  unread_count: number;
  last_read_message_id: number;
  last_visitor_message?: { id: number; thread_id: number; role: string; content: string; created_at: string } | null;
}

/**
 * What CHAT_INBOX_CHANGED carries: a full snapshot from the single routes, or
 * just the moved read cursor from the bulk route (no star, and no unread count
 * when it is not known). Listeners merge it, so absent keys keep their value.
 */
export type InboxStateUpdate = Omit<InboxState, "is_favorite" | "unread_count"> & {
  is_favorite?: boolean;
  unread_count?: number;
};

// Read and favorite both return a full state snapshot. Serialize their writes
// per thread so an earlier response cannot undo a later cursor/star update.
const writes = new Map<string, Promise<InboxState>>();
function scope() {
  const config = getConfig();
  return JSON.stringify([config?.restUrl, config?.settings?.tenant_id, config?.currentUser?.id, config?.nonce]);
}
export function updateInboxState(threadId: number, suffix: string, method: string, body: unknown) {
  const identity = scope();
  const key = `${identity}:${threadId}`;
  const update = async () => {
    if (scope() !== identity) throw new Error("The website connection changed. Reload the page.");
    const state = await apiFetch<InboxState>(`/chat-threads/${threadId}/${suffix}`, { method, body: JSON.stringify(body) });
    if (scope() === identity) publishInboxState(threadId, state);
    return state;
  };
  const pending = writes.get(key);
  const run = pending ? pending.then(update, update) : update();
  writes.set(key, run);
  const settled = () => { if (writes.get(key) === run) writes.delete(key); };
  void run.then(settled, settled);
  return run;
}

export function publishInboxState(threadId: number, state: InboxStateUpdate) {
  window.dispatchEvent(new CustomEvent(CHAT_INBOX_CHANGED, { detail: { threadId, state } }));
}

export async function markThreadRead(threadId: number, messageId: number) {
  return updateInboxState(threadId, "read", "POST", { last_read_message_id: messageId });
}

/** The bulk read route takes at most this many threads per request. */
const BULK_READ_MAX = 500;
const BULK_READ_PATH = "/chat-threads/read";

/**
 * Mark several chats read in one request per BULK_READ_MAX threads
 * (POST /chat-threads/read). Each chat carries its own cursor, the newest
 * visitor message shown for it (`messageId`), so a message that arrived after
 * the list was drawn stays unread, as with the single route. Chats with no
 * shown message are left out: there is nothing to mark.
 *
 * Resolves with the ids whose cursor moved (each also published as
 * CHAT_INBOX_CHANGED); a requested id not among them was already read. Null
 * when the server has no bulk route (an older backend: see isMissingRoute),
 * and the caller falls back to one request per chat.
 */
export async function markThreadsRead(items: Array<{ threadId: number; messageId: number }>): Promise<number[] | null> {
  const identity = scope();
  const shown = new Map<number, number>();
  for (const item of items) {
    if (item.threadId > 0 && item.messageId > 0) shown.set(item.threadId, Math.max(item.messageId, shown.get(item.threadId) ?? 0));
  }
  const threads = [...shown].map(([id, upTo]) => ({ id, up_to_message_id: upTo }));
  const moved: number[] = [];
  for (let start = 0; start < threads.length; start += BULK_READ_MAX) {
    let res: { threads?: Array<{ id: number; last_read_message_id: number }> };
    try {
      res = await apiFetch(BULK_READ_PATH, {
        method: "POST",
        body: JSON.stringify({ threads: threads.slice(start, start + BULK_READ_MAX) }),
      });
    } catch (error) {
      if (start === 0 && isMissingRoute(error, BULK_READ_PATH)) return null;
      throw error;
    }
    // Not this route's answer (a proxy that does not know it): same as missing.
    if (!Array.isArray(res?.threads)) {
      if (start === 0) return null;
      continue;
    }
    if (scope() !== identity) throw new Error("The website connection changed. Reload the page.");
    // Only threads whose cursor moved are listed. A chat counts as read only
    // when its cursor reached the message shown for it.
    for (const thread of res.threads) {
      const cursor = Number(thread.last_read_message_id) || 0;
      const last = shown.get(thread.id);
      moved.push(thread.id);
      publishInboxState(thread.id, {
        last_read_message_id: cursor,
        ...(last !== undefined && cursor >= last ? { unread_count: 0 } : {}),
      });
    }
  }
  return moved;
}
