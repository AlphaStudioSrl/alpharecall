import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { apiFetch, errorText, peekGet } from "@/admin/lib/api";
import { DASHBOARD_ROWS } from "@/admin/hooks/use-dashboard";
import { RateLimitError } from "@/admin/lib/rate-limit";
import { CHAT_INBOX_CHANGED, markThreadRead, markThreadsRead, type InboxStateUpdate } from "@/admin/lib/chat-inbox";
import { usePoll } from "@/admin/lib/poll";
import { toast } from "sonner";
import { useNotificationPreferences, type NotificationType } from "@/admin/lib/notification-preferences";
import { personName } from "@/admin/lib/record-fields";
import { anonymousVisitorLabel, previewTitle } from "@/admin/components/conversations/inbox-format";
import { createT, getStoredLang, type TFunction } from "@/admin/lib/i18n";

const POLL_MS = 30000;
/** Unread chats are read 200 a page; the bell shows counts, so three pages (600) is plenty. */
const UNREAD_PAGE = 200;
const UNREAD_MAX_PAGES = 3;

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  conversationId?: number;
  unreadMessages?: number;
  lastVisitorMessageId?: number;
  /** Who a chat notification is from, as the inbox names them ("Visitatore 271"). */
  person?: string;
  meta?: Record<string, unknown>;
}

export function notificationStorageKey(): string {
  const config = window.AlphaRecallAdmin as (typeof window.AlphaRecallAdmin & { currentUser?: { id: number } });
  return `ar-notifications-read:${config?.siteUrl ?? ""}:${config?.settings?.tenant_id ?? ""}:${config?.currentUser?.id ?? ""}`;
}

function getReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(notificationStorageKey());
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<string>) {
  try {
    localStorage.setItem(notificationStorageKey(), JSON.stringify([...ids]));
  } catch {
    // Private browsing and storage quotas must not break notification actions.
  }
}

function collectionItems(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  const record = value as Record<string, unknown> | null;
  const items = record?.items;
  return Array.isArray(items) ? items as Record<string, unknown>[] : [];
}

/** Convert the chat thread summary into notification entries for the bell. */
export function buildChatNotifications(
  value: unknown,
  t: TFunction = createT(getStoredLang()),
): NotificationItem[] {
  const result: NotificationItem[] = [];

  for (const thread of collectionItems(value)) {
    if (!thread || typeof thread !== "object") continue;
    const threadId = Number(thread.id);
    if (!Number.isSafeInteger(threadId) || threadId <= 0 || thread.thread_type === "support") continue;
    const unread = Number(thread.unread_count);
    if (!Number.isSafeInteger(unread) || unread <= 0) continue;
    const message = thread.last_visitor_message && typeof thread.last_visitor_message === "object"
      ? thread.last_visitor_message as Record<string, unknown>
      : null;
    const messageId = Number(message?.id);
    if (message?.role !== "user" || !Number.isSafeInteger(messageId) || messageId <= 0) continue;
    if (message.thread_id != null && Number(message.thread_id) !== threadId) continue;
    const messageText = String(message.content || "").trim();
    const visitor = thread.visitor && typeof thread.visitor === "object"
      ? thread.visitor as Record<string, unknown>
      : null;
    // No name: "Visitatore <visitor id>", the label the inbox shows for this
    // person. Without a visitor id the title stands in, unless it is the
    // visitor's first message again ("Ciao vorrei... - Ciao vorrei..."). Then
    // the message alone.
    const title = String(thread.title || "").trim();
    const visitorId = Number(visitor?.id ?? thread.visitor_id);
    const visitorName = String(personName(thread.visitor_name) || personName(visitor?.display_name) || visitor?.email
      || (Number.isSafeInteger(visitorId) && visitorId > 0 ? anonymousVisitorLabel(visitorId, t) : "")
      || (previewTitle(title, "", messageText) ? title : ""));

    const isInitialChat = Number(thread.last_read_message_id || 0) === 0;
    result.push({
      id: `thread-${threadId}-${messageId}`,
      type: isInitialChat ? "chat" : "message",
      title: isInitialChat ? "notifications.chat" : "notifications.message",
      description: (visitorName ? `${visitorName} - ${messageText.slice(0, 120)}` : messageText.slice(0, 120)).trim(),
      timestamp: String(message.created_at || thread.created_at || ""),
      read: false,
      conversationId: threadId,
      unreadMessages: unread,
      lastVisitorMessageId: messageId,
      ...(visitorName ? { person: visitorName } : {}),
    });
  }

  return result;
}

/**
 * Every unread chat, filtered before pagination: old unread chats must not be
 * displaced by recent read ones, and no 24-hour cutoff hides an unseen visitor.
 * Capped at UNREAD_MAX_PAGES pages; `truncated` says there are more.
 */
async function loadUnreadThreads(init: RequestInit) {
  const items: Record<string, unknown>[] = [];
  let total = 0;
  for (let page = 0; page < UNREAD_MAX_PAGES && !init.signal?.aborted; page += 1) {
    const res = await apiFetch<{ items: Record<string, unknown>[]; total: number }>(
      `/chat-threads?limit=${UNREAD_PAGE}&unread_only=true&offset=${items.length}`, init,
    );
    if (!res.items.length) break;
    items.push(...res.items);
    total = Number(res.total) || items.length;
    if (items.length >= total) break;
  }
  return { items, truncated: items.length < total };
}

/** How old Oggi's copy of a collection may be for the bell to read it instead of asking. */
const SHARED_MAX_AGE_MS = 5000;

/**
 * The latest rows of a collection: Oggi's and Statistiche's own request for
 * it when that one is in flight or a few seconds old (it carries the same
 * newest rows and more), else the bell's small request. On those two pages
 * the bell used to send five requests for records the page was fetching
 * anyway.
 */
async function latestRows(kind: keyof typeof DASHBOARD_ROWS, path: string, init: RequestInit): Promise<unknown> {
  // The bell's first run starts in its mount effect, which React runs before
  // the page's effects of the same commit: one microtask lets the page send
  // its requests first.
  await Promise.resolve();
  // Oggi's request failing is no reason to lose this collection from the bell.
  return peekGet<unknown>(DASHBOARD_ROWS[kind], SHARED_MAX_AGE_MS)?.catch(() => apiFetch<unknown>(path, init)) ?? apiFetch<unknown>(path, init);
}

export function useNotifications() {
  const preferences = useNotificationPreferences();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const readIdsRef = useRef(getReadIds());
  const loadVersion = useRef(0);

  // Driven by the poller below: a failure is thrown so it backs off.
  const load = useCallback(async (init: RequestInit) => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        latestRows("escalations", "/tools/escalations?limit=50", init),
        latestRows("appointments", "/tools/appointments?limit=20", init),
        latestRows("submissions", "/contact-submissions?limit=20", init),
        latestRows("feedback", "/feedback?limit=20", init),
        latestRows("leads", "/tools/leads?limit=20", init),
        loadUnreadThreads(init),
      ] as const);
      const [escalations, appointments, submissionsRes, feedbackRes, leadsRes, chatThreadsRes] = results;

      const readIds = readIdsRef.current;
      const notifications: NotificationItem[] = [];

      if (chatThreadsRes.status === "fulfilled") {
        notifications.push(...buildChatNotifications(chatThreadsRes.value));
      }

      // Escalations → notifications
      if (escalations.status === "fulfilled") {
        // The 50 newest, whichever request answered (Oggi's has 200).
        for (const e of collectionItems(escalations.value).slice(0, 50)) {
          const id = `esc-${e.id}`;
          notifications.push({
            id,
            type: "escalation",
            title: "notifications.escalation",
            description: String(e.issue || ""),
            timestamp: String(e.created_at || ""),
            read: readIds.has(id),
            conversationId: e.conversation_id as number | undefined,
            meta: e,
          });
        }
      }

      // Recent appointments → notifications (last 24h, status=scheduled)
      if (appointments.status === "fulfilled") {
        const raw = appointments.value;
        const list = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.items || [];
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        for (const a of list as Record<string, unknown>[]) {
          const created = String(a.created_at || "");
          if (created < cutoff) continue;
          const id = `appt-${a.id}`;
          notifications.push({
            id,
            type: "appointment",
            title: "notifications.appointment",
            description: `${a.user_info && (a.user_info as Record<string, unknown>).name || "Visitor"} · ${a.timeslot || ""}`,
            timestamp: created,
            read: readIds.has(id),
          });
        }
      }

      // Contact submissions → notifications (last 24h)
      if (submissionsRes.status === "fulfilled") {
        const raw = submissionsRes.value;
        const list = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.items || [];
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        for (const s of list as Record<string, unknown>[]) {
          const created = String(s.created_at || "");
          if (created < cutoff) continue;
          const id = `sub-${s.id}`;
          notifications.push({
            id,
            type: "submission",
            title: "notifications.submission",
            description: `${s.name || "Visitor"} · ${s.subject || s.type || ""}`,
            timestamp: created,
            read: readIds.has(id),
            meta: s,
          });
        }
      }

      // Feedback → notifications (last 24h)
      if (feedbackRes.status === "fulfilled") {
        const raw = feedbackRes.value;
        const list = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.items || [];
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        for (const f of list as Record<string, unknown>[]) {
          const created = String(f.created_at || "");
          if (created < cutoff) continue;
          const id = `fb-${f.id}`;
          notifications.push({
            id,
            type: "feedback",
            title: "notifications.feedback",
            description: `${"★".repeat(Number(f.rating) || 0)} ${String(f.comment || "").slice(0, 60)}`,
            timestamp: created,
            read: readIds.has(id),
            meta: f,
          });
        }
      }

      // Leads → notifications (last 24h)
      if (leadsRes.status === "fulfilled") {
        const raw = leadsRes.value;
        const list = Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.items || [];
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        for (const l of list as Record<string, unknown>[]) {
          const created = String(l.created_at || "");
          if (created < cutoff) continue;
          const id = `lead-${l.id}`;
          notifications.push({
            id,
            type: "lead",
            title: "notifications.lead",
            description: String(l.email || ""),
            timestamp: created,
            read: readIds.has(id),
            meta: l,
          });
        }
      }

      // Sort by timestamp descending
      notifications.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      if (version === loadVersion.current && !init.signal?.aborted) {
        setItems((prev) => chatThreadsRes.status === "fulfilled" ? notifications : [
          ...notifications, ...prev.filter((item) => item.type === "chat" || item.type === "message"),
        ]);
        if (chatThreadsRes.status === "fulfilled") setTruncated(chatThreadsRes.value.truncated);
      }

      // What reached the screen stays; a rate limit or a total failure is
      // still the poller's to back off from.
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      const limited = failures.find((reason) => reason instanceof RateLimitError);
      if (limited) throw limited;
      if (failures.length === results.length) throw failures[0];
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  // One trigger path: the poll itself, plus one debounced refresh when the
  // tab comes back (no separate focus listener: returning to the tab fired
  // both and loaded every endpoint twice).
  const poll = usePoll(({ init }) => load(init), { intervalMs: POLL_MS });

  useEffect(() => {
    const changed = (event: Event) => {
      const { threadId, state } = (event as CustomEvent<{ threadId: number; state: InboxStateUpdate }>).detail;
      ++loadVersion.current;
      setItems((prev) => prev.map((item) => {
        if (item.conversationId !== threadId || !item.lastVisitorMessageId) return item;
        const incoming = state.last_visitor_message;
        // A visitor can post between GET and acknowledgement. Keep that new
        // message unread instead of clearing the bell for the old snapshot.
        if ((state.unread_count ?? 0) > 0 && incoming && incoming.id > state.last_read_message_id) {
          return { ...item, id: `thread-${threadId}-${incoming.id}`, type: "message", read: false,
            lastVisitorMessageId: incoming.id, unreadMessages: state.unread_count,
            description: (item.person ? `${item.person} - ${incoming.content.slice(0, 120)}` : incoming.content.slice(0, 120)).trim(),
            timestamp: incoming.created_at };
        }
        return { ...item, read: item.lastVisitorMessageId <= state.last_read_message_id,
          unreadMessages: state.unread_count ?? item.unreadMessages };
      }));
    };
    window.addEventListener(CHAT_INBOX_CHANGED, changed);
    return () => window.removeEventListener(CHAT_INBOX_CHANGED, changed);
  }, []);

  const visibleItems = useMemo(() => items.filter((item) => preferences[item.type]), [items, preferences]);
  const unreadCount = visibleItems.filter((n) => !n.read).length;

  /** Read state of chats lives on the server; the rest only in this browser. */
  const markLocal = useCallback((ids: string[]) => {
    if (!ids.length) return;
    for (const id of ids) readIdsRef.current.add(id);
    saveReadIds(readIdsRef.current);
    const marked = new Set(ids);
    setItems((prev) => prev.map((n) => (marked.has(n.id) ? { ...n, read: true } : n)));
  }, []);

  const markAsRead = useCallback(async (id: string) => {
    const item = items.find((item) => item.id === id);
    if (item?.conversationId && item.lastVisitorMessageId) {
      try {
        // The bell updates from the CHAT_INBOX_CHANGED this publishes.
        await markThreadRead(item.conversationId, item.lastVisitorMessageId);
      } catch (err) {
        toast.error(errorText(err, "Impossibile segnare la notifica come letta."));
      }
      return;
    }
    markLocal([id]);
  }, [items, markLocal]);

  // One request for every chat (POST /chat-threads/read). On an older backend
  // without it: one chat at a time, so "mark all" is a steady trickle of
  // small writes rather than a burst, and a rate limit stops it.
  const markAllAsRead = useCallback(async () => {
    const unread = visibleItems.filter((item) => !item.read);
    const chats = unread.filter((item) => item.conversationId && item.lastVisitorMessageId);
    markLocal(unread.filter((item) => !chats.includes(item)).map((item) => item.id));
    if (!chats.length) return;
    try {
      const moved = await markThreadsRead(chats.map((item) => ({ threadId: item.conversationId!, messageId: item.lastVisitorMessageId! })));
      if (moved) {
        // Moved cursors arrive as CHAT_INBOX_CHANGED; a chat the server left
        // out was already read there.
        const already = new Set(chats.map((item) => item.conversationId!).filter((id) => !moved.includes(id)));
        if (already.size) setItems((prev) => prev.map((n) => (n.conversationId && already.has(n.conversationId) && n.lastVisitorMessageId ? { ...n, read: true } : n)));
        return;
      }
    } catch (err) {
      // The server's own text can be a validation array or English.
      toast.error(err instanceof RateLimitError ? err.message : "Impossibile segnare le notifiche come lette.");
      return;
    }
    for (const item of chats) {
      try {
        await markThreadRead(item.conversationId!, item.lastVisitorMessageId!);
      } catch (err) {
        toast.error(errorText(err, "Impossibile segnare la notifica come letta."));
        if (err instanceof RateLimitError) break;
      }
    }
  }, [visibleItems, markLocal]);

  const clearAll = useCallback(async () => {
    await markAllAsRead();
    setItems((prev) => prev.filter((item) => !item.read));
  }, [markAllAsRead]);

  // `truncated`: more unread chats than were read (UNREAD_MAX_PAGES), so the count is a floor.
  return { items: visibleItems, unreadCount, truncated, loading, markAsRead, markAllAsRead, clearAll, reload: poll.runNow };
}
