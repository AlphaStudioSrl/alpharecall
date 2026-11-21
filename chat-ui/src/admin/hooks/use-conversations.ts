import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { apiFetch, errorText } from "@/admin/lib/api";
import { RateLimitError } from "@/admin/lib/rate-limit";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { CHAT_INBOX_CHANGED, markThreadRead, updateInboxState, type InboxStateUpdate } from "@/admin/lib/chat-inbox";
import { usePoll } from "@/admin/lib/poll";
import type { ChatAttachment } from "@/lib/chat-attachments";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ThreadVisitor {
  id: number;
  email: string;
  /** An address typed on a session without a proven one. */
  unverified_email?: string | null;
  display_name?: string;
  avatar_url?: string;
  wp_user_id?: number;
  is_banned?: boolean;
}

export interface ChatThread {
  id: number;
  tenant_id: number;
  visitor_id?: string;
  visitor_name?: string;
  visitor_email?: string;
  visitor?: ThreadVisitor;
  title?: string;
  status: "active" | "resolved" | "pending" | "open" | "closed" | "escalated" | "handoff";
  last_message?: string | Record<string, unknown>;
  last_message_at?: string;
  message_count?: number;
  unread_count?: number;
  is_favorite?: boolean;
  last_read_message_id?: number;
  /** The newest visitor message (inbox state): what "waiting for N min" is measured from. */
  last_visitor_message?: { id: number; role: string; content: string; created_at: string } | null;
  thread_type?: "visitor" | "support";
  created_at: string;
  updated_at?: string;
  /** The visitor closed this waiting chat, or started a new one. Only on chats waiting for a person. */
  visitor_left?: { at: string; reason: "left" | "new_chat"; email?: string | null } | null;
}

/** Safely extract text from last_message which may be a string or message object */
export function getLastMessageText(msg: unknown): string {
  if (!msg) return "";
  if (typeof msg === "string") return msg;
  if (typeof msg === "object" && msg !== null) {
    const obj = msg as Record<string, unknown>;
    if (typeof obj.content === "string") return obj.content;
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

export interface ChatMessage {
  id: number;
  thread_id: number;
  role: "user" | "assistant" | "admin" | "human" | "tool" | "system";
  content: string;
  created_at: string;
  profile_id?: number;
  profile_name?: string;
  profile_avatar?: string;
  attachments?: ChatAttachment[];
  /** Tool the assistant ran for this turn and its visitor-safe result. */
  tool?: string | null;
  tool_output?: Record<string, unknown> | null;
  /** Knowledge answers: what the answer was built from ({ title, url? }). */
  sources?: Array<{ title?: string; url?: string }> | null;
  /** The visitor's thumbs on an assistant answer. */
  rating?: "up" | "down" | null;
  /** An answer the visitor stopped (Stop / Ricomincia): only what they saw. */
  stopped?: boolean;
}

/**
 * "attention" (Da gestire): the assistant handed the chat to the team
 * (handoff/escalated), the same rule as the Inbox count in the top bar.
 * "ai" (Gestite, the id is kept for old links): everything else, the chats
 * the assistant handles on its own and the closed ones, whoever closed them,
 * so Da gestire + Gestite = Tutte. "unread" and "favorites" are filtered by
 * the API.
 */
export type ConversationFilter = "attention" | "ai" | "all" | "unread" | "favorites" | "resolved";

export type ThreadUpdate = { title?: string; status?: string; action?: "takeover" | "resume_ai" };

/** Which control an update came from, so that one shows the pending state. */
export function threadUpdateKey(updates: ThreadUpdate): string {
  if (updates.action) return `action:${updates.action}`;
  if (updates.status !== undefined) return `status:${updates.status}`;
  return "title";
}

/**
 * Fold a PATCH response (the thread detail) into the thread on screen instead
 * of replacing it: the transcript is not list state, list-only fields
 * (message_count, last_message) are not in it, and a response without the
 * visitor must not turn the chat into "Visitatore <thread id>".
 */
export function mergeThreadUpdate(current: ChatThread, updated: Partial<ChatThread> & { messages?: unknown } | null | undefined): ChatThread {
  if (!updated || typeof updated !== "object") return current;
  const { messages: _transcript, visitor, ...fields } = updated;
  const merged: ChatThread = { ...current, ...fields, id: current.id };
  if (visitor) merged.visitor = visitor;
  return merged;
}

const NEEDS_PERSON = new Set<ChatThread["status"]>(["handoff", "escalated"]);
const AI_OWNED = new Set<ChatThread["status"]>(["open", "active", "pending"]);
const CLOSED = new Set<ChatThread["status"]>(["resolved", "closed"]);

export const needsPerson = (thread: ChatThread) => NEEDS_PERSON.has(thread.status);
export const isAiOwned = (thread: ChatThread) => AI_OWNED.has(thread.status);
export const isClosed = (thread: ChatThread) => CLOSED.has(thread.status);
/** The "Gestite" tab: nobody on the team has to do anything (the assistant owns it, or it is closed). */
export const isHandled = (thread: ChatThread) => AI_OWNED.has(thread.status) || CLOSED.has(thread.status);

const PAGE = 200;
/** Search results come in smaller pages: they are read on every pause in typing. */
export const SEARCH_PAGE = 50;
/** The pause in typing after which the search goes to the server. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The API statuses behind each tab, so a search stays inside the tab it was typed in. */
const FILTER_STATUSES: Partial<Record<ConversationFilter, string>> = {
  attention: "handoff,escalated",
  ai: "open,closed",
  resolved: "closed",
};

function serverQuery(filter: ConversationFilter, offset = 0) {
  return `/chat-threads?limit=${PAGE}${offset ? `&offset=${offset}` : ""}${filter === "favorites" ? "&favorites_only=true" : ""}${filter === "unread" ? "&unread_only=true" : ""}`;
}

/**
 * The server-side search (app/chat_threads.py): visitor label and number, name,
 * contacts, title, operator name and every message. `operatorId` (a support
 * profile, "Altri filtri" > Operatore) keeps the chats that team member replied
 * in, with or without a term (card gbztrbczsxzr).
 */
export function searchQuery(filter: ConversationFilter, term: string, visitorId: number | null, offset = 0, operatorId: number | null = null): string {
  const params = new URLSearchParams({ limit: String(SEARCH_PAGE) });
  if (term) params.set("search", term);
  if (offset) params.set("offset", String(offset));
  const statuses = FILTER_STATUSES[filter];
  if (statuses) params.set("status", statuses);
  if (filter === "favorites") params.set("favorites_only", "true");
  if (filter === "unread") params.set("unread_only", "true");
  if (visitorId !== null) params.set("visitor_id", String(visitorId));
  if (operatorId !== null) params.set("operator_id", String(operatorId));
  return `/chat-threads?${params}`;
}

/** What the box searches for: trimmed, inner runs of spaces as one; "" (no search) for spaces alone. */
export const searchTerm = (value: string) => value.trim().replace(/\s+/g, " ");

/** Tab counts from the server's matches per status. */
export function countsByStatus(byStatus: Record<string, number>): { attention: number; ai: number; all: number } {
  const n = (status: string) => Number(byStatus[status]) || 0;
  return {
    attention: n("handoff") + n("escalated"),
    ai: n("open") + n("closed"),
    all: Object.values(byStatus).reduce((sum, value) => sum + (Number(value) || 0), 0),
  };
}

export type SearchStatus = "idle" | "pending" | "done" | "error";

interface SearchResult {
  key: string;
  items: ChatThread[];
  total: number;
  byStatus: Record<string, number> | null;
}

/**
 * Normalize a collection response that may be wrapped in various shapes:
 * array, { items }, { threads }, { conversations }, { data }, { data.items }, etc.
 */
function normalizeCollection<T>(response: unknown): T[] {
  const r = response as Record<string, unknown> | undefined;
  const candidates = [
    response,
    r?.items,
    r?.threads,
    r?.conversations,
    r?.data,
    (r?.data as Record<string, unknown> | undefined)?.items,
    (r?.data as Record<string, unknown> | undefined)?.threads,
    (r?.data as Record<string, unknown> | undefined)?.conversations,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as T[];
    }
  }
  return [];
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseConversationsOptions {
  initialFilter?: ConversationFilter;
  /** Only this visitor's chats (Contatti "Vedi le conversazioni"). */
  visitorId?: number | null;
  /** Only the chats this team member (support profile id) replied in: filtered by the API. */
  operatorId?: number | null;
}

export function useConversations(isViewing = true, options: UseConversationsOptions = {}) {
  const { t } = useApp();
  const { visitorId = null, operatorId = null } = options;
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [filter, setFilterState] = useState<ConversationFilter>(options.initialFilter ?? "all");
  const [total, setTotal] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Threads that came from "load more": a poll of the first page keeps them.
  const olderIds = useRef(new Set<number>());
  // Ids of the server's first page. With olderIds this is what the API has
  // paged out so far: the next offset, which a deep-linked thread pulled in
  // on its own must not shift.
  const firstPageIds = useRef(new Set<number>());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The list's own failure, shown above the list (the thread pane is hidden on phones).
  const [listError, setListError] = useState<string | null>(null);

  const selectedIdRef = useRef<number | null>(null);
  const listVersion = useRef(0);
  const messageVersion = useRef(0);
  const readingRef = useRef(new Set<string>());
  /** Reads that failed, keyed by thread, visitor message and newest message: not retried by every poll. */
  const failedReadsRef = useRef(new Set<string>());
  const favoritePending = useRef(new Set<number>());
  const inboxRevision = useRef(0);
  const latestInboxState = useRef(new Map<number, InboxStateUpdate>());
  /** Status/title changes in flight, by thread: one at a time, shown on the control that sent it. */
  const [updating, setUpdating] = useState<Record<number, string>>({});
  const updatePending = useRef(new Set<number>());
  // A list or transcript read that started before a change settled carries
  // the old status: it must not put it back on that thread.
  const threadRevision = useRef(0);
  const settledRevision = useRef(new Map<number, number>());
  const changedSince = (threadId: number, revision: number) => (settledRevision.current.get(threadId) ?? 0) > revision;

  /* ---------- load threads list ---------- */

  /** Resolves with the error when the list could not be read (the poll backs off on it). */
  const loadThreads = useCallback(async (quiet = false): Promise<unknown> => {
    const version = ++listVersion.current;
    const revision = threadRevision.current;
    if (!quiet) setLoading(true);

    try {
      const res = await apiFetch<unknown>(serverQuery(filter), { cache: "reload" });
      const raw = normalizeCollection<ChatThread>(res);
      const data = raw.filter((thread) => thread.thread_type !== "support");
      if (version !== listVersion.current) return;
      firstPageIds.current = new Set(raw.map((thread) => thread.id));
      setListError(null);
      const count = Number((res as { total?: unknown } | null)?.total);
      setTotal(Number.isFinite(count) ? count : null);
      setThreads((prev) => {
        const kept = prev.filter((thread) => !data.some((d) => d.id === thread.id)
          && (thread.id === selectedIdRef.current || olderIds.current.has(thread.id)));
        const fresh = data.map((thread) => changedSince(thread.id, revision)
          ? prev.find((p) => p.id === thread.id) ?? thread : thread);
        return kept.length ? [...fresh, ...kept] : fresh;
      });
    } catch (err) {
      if (version !== listVersion.current) return err;
      setListError(errorText(err, t("inboxPage.errors.list")));
      return err;
    } finally {
      if (version === listVersion.current) setLoading(false);
    }
  }, [filter, t]);

  const pagedCount = () => new Set([...firstPageIds.current, ...olderIds.current]).size;

  /** Next page of the list (the API pages by offset; the list keeps what it has). */
  /**
   * Resolves false when the page could not be read or was empty (callers
   * paging on their own stop there). A page dropped because a newer list read
   * landed meanwhile resolves true: nothing failed, the same offset can be
   * asked again.
   */
  const loadMore = useCallback(async (): Promise<boolean> => {
    const version = listVersion.current;
    setLoadingMore(true);
    try {
      const res = await apiFetch<unknown>(serverQuery(filter, pagedCount()), { cache: "reload" });
      if (version !== listVersion.current) return true;
      const raw = normalizeCollection<ChatThread>(res);
      const count = Number((res as { total?: unknown } | null)?.total);
      if (Number.isFinite(count)) setTotal(count);
      raw.forEach((thread) => olderIds.current.add(thread.id));
      const data = raw.filter((thread) => thread.thread_type !== "support");
      setThreads((prev) => [...prev, ...data.filter((thread) => !prev.some((p) => p.id === thread.id))]);
      return raw.length > 0;
    } catch (err) {
      toast.error(errorText(err, t("inboxPage.errors.more")));
      return false;
    } finally {
      setLoadingMore(false);
    }
  }, [filter, t]);

  const setFilter = useCallback((next: ConversationFilter) => {
    olderIds.current.clear();
    setFilterState(next);
  }, []);

  /* ---------- server-side search ---------- */

  // The box only searches the loaded pages no more: the API looks through
  // every chat of the site (visitor label and number, name, e-mail, phone,
  // thread id, title, every message), inside the tab and the person filter.
  const term = searchTerm(search);
  // The operator filter has no field in the loaded threads: the API answers it, like a search.
  const searchKey = term || operatorId !== null ? JSON.stringify([term, filter, visitorId, operatorId]) : "";
  const [found, setFound] = useState<SearchResult | null>(null);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRun = useRef<{ key: string; controller: AbortController | null }>({ key: "", controller: null });

  useEffect(() => {
    searchRun.current.controller?.abort();
    searchRun.current = { key: searchKey, controller: null };
    if (!searchKey) {
      setFound(null);
      setSearchStatus("idle");
      setSearchError(null);
      return;
    }
    setSearchStatus("pending");
    const run = searchRun.current;
    const timer = window.setTimeout(() => {
      const controller = new AbortController();
      run.controller = controller;
      apiFetch<unknown>(searchQuery(filter, term, visitorId, 0, operatorId), { cache: "reload", signal: controller.signal })
        .then((res) => {
          if (searchRun.current !== run) return;
          const count = Number((res as { total?: unknown } | null)?.total);
          const byStatus = (res as { by_status?: unknown } | null)?.by_status;
          const items = normalizeCollection<ChatThread>(res).filter((thread) => thread.thread_type !== "support");
          setFound({
            key: run.key,
            items,
            total: Number.isFinite(count) ? count : items.length,
            byStatus: byStatus && typeof byStatus === "object" ? byStatus as Record<string, number> : null,
          });
          setSearchError(null);
          setSearchStatus("done");
        })
        .catch((err) => {
          // A newer search (or clearing the box) aborted this one: nothing to say.
          if (searchRun.current !== run || controller.signal.aborted) return;
          setSearchError(errorText(err, t("inboxPage.errors.search")));
          setSearchStatus("error");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      run.controller?.abort();
    };
    // `searchKey` carries term, filter, visitorId and operatorId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  /** The next page of search results. */
  const loadMoreResults = useCallback(async (): Promise<boolean> => {
    const run = searchRun.current;
    if (!found || found.key !== run.key) return false;
    setLoadingMore(true);
    try {
      const res = await apiFetch<unknown>(searchQuery(filter, term, visitorId, found.items.length, operatorId), { cache: "reload" });
      if (searchRun.current !== run) return true;
      const raw = normalizeCollection<ChatThread>(res).filter((thread) => thread.thread_type !== "support");
      const count = Number((res as { total?: unknown } | null)?.total);
      setFound((prev) => prev && prev.key === run.key ? {
        ...prev,
        items: [...prev.items, ...raw.filter((thread) => !prev.items.some((p) => p.id === thread.id))],
        total: Number.isFinite(count) ? count : prev.total,
      } : prev);
      return raw.length > 0;
    } catch (err) {
      toast.error(errorText(err, t("inboxPage.errors.more")));
      return false;
    } finally {
      setLoadingMore(false);
    }
  }, [found, filter, term, visitorId, operatorId, t]);

  /* ---------- load messages for a thread ---------- */

  const loadMessages = useCallback(async (threadId: number, quiet = false) => {
    const version = ++messageVersion.current;
    const revision = inboxRevision.current;
    const statusRevision = threadRevision.current;
    if (!quiet) {
      setLoadingMessages(true);
      setMessages([]);
    }

    try {
      // /chat-threads/{id} returns the thread detail with .messages. There is
      // no legacy /conversations/{id} route: the old fallback only produced a
      // second 404 and an admin-ajax retry on every failure.
      const detail = await apiFetch<ChatThread & { messages: ChatMessage[] }>(
        `/chat-threads/${encodeURIComponent(threadId)}`, { cache: "reload" }
      );
      if (selectedIdRef.current !== threadId || version !== messageVersion.current) return;
      const msgs = normalizeCollection<ChatMessage>(detail?.messages ?? detail).map((m, i) => ({
        ...m,
        id: m.id || i,
        content: typeof m.content === "string" ? m.content : String(m.content ?? ""),
        role: m.role || "user",
        created_at: m.created_at || "",
      }));
      setMessages(msgs);
      const currentDetail = revision === inboxRevision.current ? detail : { ...detail, ...latestInboxState.current.get(threadId) };
      setThreads((prev) => prev.some((thread) => thread.id === threadId)
        ? changedSince(threadId, statusRevision) ? prev
          : prev.map((thread) => thread.id === threadId ? mergeThreadUpdate(thread, currentDetail) : thread)
        : [currentDetail, ...prev]);
    } catch (err) {
      if (selectedIdRef.current !== threadId || version !== messageVersion.current) return;
      // A rate-limited background refresh keeps the open chat: the next poll
      // (after the cool-down) brings it up to date.
      if (quiet && err instanceof RateLimitError) throw err;
      setError(errorText(err, t("inboxPage.errors.messages")));
      // A thread the API cannot return (deleted, or a stale link carrying the
      // wrong id) must not pass for "nothing selected".
      toast.error(t("conversations.loadFailed") || "Impossibile caricare questa conversazione.");
      setSelectedThreadId(null);
      selectedIdRef.current = null;
    } finally {
      if (version === messageVersion.current) setLoadingMessages(false);
    }
  }, [t]);

  /* ---------- select a thread ---------- */

  const selectThread = useCallback(
    (threadId: number | null) => {
      setSelectedThreadId(threadId);
      selectedIdRef.current = threadId;
      setError(null); // an error belongs to the thread it happened on
      if (threadId !== null) {
        void loadMessages(threadId);
      } else {
        setMessages([]);
      }
    },
    [loadMessages]
  );

  useEffect(() => {
    const changed = (event: Event) => {
      const { threadId, state } = (event as CustomEvent<{ threadId: number; state: InboxStateUpdate }>).detail;
      ++listVersion.current; // An older poll must not restore the old badge/star.
      setLoading(false);
      ++inboxRevision.current;
      latestInboxState.current.set(threadId, state);
      setThreads((prev) => prev.map((thread) => thread.id === threadId ? { ...thread, ...state } : thread));
    };
    window.addEventListener(CHAT_INBOX_CHANGED, changed);
    return () => window.removeEventListener(CHAT_INBOX_CHANGED, changed);
  }, []);

  const readCursor = threads.find((thread) => thread.id === selectedThreadId)?.last_read_message_id ?? 0;
  useEffect(() => {
    if (!isViewing || selectedThreadId === null || loadingMessages || document.visibilityState !== "visible") return;
    const lastVisitorId = Math.max(0, ...messages.filter((message) => message.role === "user").map((message) => message.id));
    const key = `${selectedThreadId}:${lastVisitorId}`;
    // A failed read waits for the transcript to change (a new message), not
    // for the next poll, which hands back a new but identical messages array.
    const attempt = `${key}:${Math.max(0, ...messages.map((message) => message.id))}`;
    if (lastVisitorId <= readCursor || readingRef.current.has(key) || failedReadsRef.current.has(attempt)) return;
    readingRef.current.add(key);
    void markThreadRead(selectedThreadId, lastVisitorId).catch((err) => {
      // A rate limit is retried by the poll after the cool-down it waits out.
      if (!(err instanceof RateLimitError)) failedReadsRef.current.add(attempt);
      // Marking read happens by itself on open: the owner did not ask for it
      // and can do nothing about it, so a failure is logged, never shown.
      console.warn("AlphaRecall: could not mark the chat as read", err);
    }).finally(() => readingRef.current.delete(key));
  }, [isViewing, selectedThreadId, messages, loadingMessages, readCursor]);

  const toggleFavorite = useCallback(async (threadId: number, favorite: boolean) => {
    if (favoritePending.current.has(threadId)) return;
    favoritePending.current.add(threadId);
    try {
      await updateInboxState(threadId, "favorite", "PUT", { is_favorite: favorite });
    } catch (err) {
      toast.error(errorText(err, t("inboxPage.errors.favorite")));
    } finally {
      favoritePending.current.delete(threadId);
    }
  }, [t]);

  /* ---------- send reply ---------- */

  const sendReply = useCallback(
    async (content: string, profileInfo?: { profile_id?: number; profile_name?: string; profile_avatar?: string }, attachmentIds: string[] = []) => {
      if (!selectedThreadId || !content.trim()) return;

      setSending(true);
      setError(null);
      try {
        const body: Record<string, unknown> = { content: content.trim(), format: "markdown" };
        if (attachmentIds.length) body.attachment_ids = attachmentIds;
        if (profileInfo?.profile_id) body.profile_id = profileInfo.profile_id;
        if (profileInfo?.profile_name) body.profile_name = profileInfo.profile_name;
        if (profileInfo?.profile_avatar) body.profile_avatar = profileInfo.profile_avatar;

        const res = await apiFetch<ChatMessage>(
          `/chat-threads/${encodeURIComponent(selectedThreadId)}/messages`,
          {
            method: "POST",
            body: JSON.stringify(body),
          }
        );

        // Optimistic: append the message or reload
        if (res && res.id && selectedIdRef.current === selectedThreadId) {
          ++messageVersion.current; // Fence any transcript poll started before this reply.
          setLoadingMessages(false);
          setMessages((prev) => prev.some((message) => message.id === res.id) ? prev : [...prev, res]);
        } else if (selectedIdRef.current === selectedThreadId) {
          await loadMessages(selectedThreadId);
        }

        // Refresh threads so preview updates. No toast either way: the reply
        // shows in the transcript, a failure in the alert above the composer,
        // and on phones a toast would sit on the send button.
        void loadThreads();
      } catch (err) {
        setError(errorText(err, t("inboxPage.errors.reply")));
        throw err; // The composer retains its draft only when the send rejects.
      } finally {
        setSending(false);
      }
    },
    [selectedThreadId, loadMessages, loadThreads]
  );

  /* ---------- update thread (title, status) ---------- */

  const updateThread = useCallback(
    async (threadId: number, updates: ThreadUpdate): Promise<boolean> => {
      // A second click while the first PATCH is in flight sent it twice.
      // false tells the caller nothing was saved (ignored or failed).
      if (updatePending.current.has(threadId)) return false;
      updatePending.current.add(threadId);
      setUpdating((prev) => ({ ...prev, [threadId]: threadUpdateKey(updates) }));
      const revision = inboxRevision.current;
      try {
        const updated = await apiFetch<ChatThread>(`/chat-threads/${encodeURIComponent(threadId)}`, {
          method: "PATCH",
          body: JSON.stringify(updates),
        });
        // A read/favorite write that landed meanwhile is newer than this response's inbox state.
        const inbox = revision === inboxRevision.current ? null : latestInboxState.current.get(threadId);
        setThreads((prev) => prev.map((thread) => thread.id === threadId
          ? mergeThreadUpdate(thread, inbox ? { ...updated, ...inbox } : updated)
          : thread));
        // Reopening hands the chat to the team, never back to the assistant
        // (app/main.py update_chat_thread): say so, the header alone read like
        // the state before closing had been lost.
        toast.success(t(updates.status === "open" ? "toast.conversationReopened" : "toast.conversationUpdated"));
        return true;
      } catch (err) {
        // A toast, not also the banner: the banner stayed after the toast had gone.
        toast.error(errorText(err, t("inboxPage.errors.update")));
        return false;
      } finally {
        settledRevision.current.set(threadId, ++threadRevision.current);
        updatePending.current.delete(threadId);
        setUpdating((prev) => {
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
      }
    },
    [t]
  );

  /* ---------- delete thread ---------- */

  const deleteThread = useCallback(
    async (threadId: number) => {
      try {
        await apiFetch(`/chat-threads/${encodeURIComponent(threadId)}`, {
          method: "DELETE",
        });
        setThreads((prev) => prev.filter((t) => t.id !== threadId));
        // The server's pages close up over the deleted row.
        firstPageIds.current.delete(threadId);
        olderIds.current.delete(threadId);
        if (selectedThreadId === threadId) {
          setSelectedThreadId(null);
          selectedIdRef.current = null;
          ++messageVersion.current;
          setMessages([]);
        }
        toast.success(t("toast.conversationDeleted"));
      } catch (err) {
        toast.error(errorText(err, t("inboxPage.errors.delete")));
      }
    },
    [selectedThreadId, t]
  );

  /* ---------- generate title via LLM ---------- */

  const generateTitle = useCallback(
    async (threadId: number) => {
      try {
        const res = await apiFetch<{ title?: string }>(
          `/chat-threads/${encodeURIComponent(threadId)}/generate-title`,
          { method: "POST" }
        );
        const title = res?.title;
        if (title) {
          setThreads((prev) =>
            prev.map((t) => (t.id === threadId ? { ...t, title } : t))
          );
          toast.success(t("toast.titleGenerated"));
        }
      } catch (err) {
        toast.error(errorText(err, t("inboxPage.errors.title")));
      }
    },
    [t]
  );

  /* ---------- filtered + searched threads ---------- */

  const inTab = useCallback((th: ChatThread) => {
    if (filter === "favorites" && !th.is_favorite) return false;
    if (filter === "unread" && !(th.unread_count ?? 0) && th.id !== selectedThreadId) return false;
    if (filter === "resolved" && !isClosed(th)) return false;
    if (filter === "attention" && !needsPerson(th)) return false;
    if (filter === "ai" && !isHandled(th)) return false;
    if (visitorId !== null && th.visitor?.id !== visitorId) return false;
    return true;
  }, [filter, visitorId, selectedThreadId]);

  // While the server search runs (and if it fails), the loaded threads that
  // match show at once; the server's answer then replaces them.
  const filteredThreads = useMemo(() => threads.filter((th) => {
    if (!inTab(th)) return false;
    // Spaces alone are not a search ("   " used to empty every tab).
    const q = term.toLowerCase();
    if (q) {
      const visitor = th.visitor?.id ?? th.visitor_id;
      const haystack = [
        th.visitor_name,
        th.visitor_email,
        th.visitor?.display_name,
        th.visitor?.email,
        visitor ? `${interpolate(t("inboxPage.visitor"), { id: String(visitor) })} ${visitor}` : null,
        th.title,
        getLastMessageText(th.last_message),
        getLastMessageText(th.last_visitor_message),
        String(th.id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  }), [threads, inTab, term, t]);

  const currentResult = searchKey && found?.key === searchKey ? found : null;
  // The server's matches, each with the newest state the inbox holds for it
  // (a takeover, a read, a star), and dropped once it leaves the tab.
  const searchedThreads = useMemo(() => {
    if (!currentResult) return null;
    const latest = new Map(threads.map((th) => [th.id, th]));
    return currentResult.items.map((th) => latest.get(th.id) ?? th).filter(inTab);
  }, [currentResult, threads, inTab]);

  /** Tab counts over everything loaded (not meaningful while the API filters the list). */
  const counts = useMemo(() => {
    const scoped = visitorId === null ? threads : threads.filter((th) => th.visitor?.id === visitorId);
    return {
      attention: scoped.filter(needsPerson).length,
      ai: scoped.filter(isHandled).length,
      all: visitorId === null && total !== null ? Math.max(total, scoped.length) : scoped.length,
    };
  }, [threads, total, visitorId]);
  const serverFiltered = filter === "favorites" || filter === "unread";
  const listHasMore = total !== null && pagedCount() < total;
  const hasMore = searchKey ? !!currentResult && currentResult.items.length < currentResult.total : listHasMore;
  // While searching, the tabs count the matches (the last answer's, until the next one lands).
  const searchCounts = searchKey && found?.byStatus ? countsByStatus(found.byStatus) : null;
  // Until the API answers an operator filter, none of the loaded chats is known to match.
  const waitingForOperator = operatorId !== null && !currentResult;

  /* ---------- auto-load on mount ---------- */

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Live refresh of the list and the open transcript: paused in a hidden tab,
  // one debounced refresh on return, backing off on errors and 429s.
  usePoll(async () => {
    const listFailed = await loadThreads(true);
    if (isViewing && selectedIdRef.current !== null) await loadMessages(selectedIdRef.current, true);
    if (listFailed) throw listFailed;
  }, { intervalMs: 10000, immediate: false, path: "/chat-threads" });

  useEffect(() => () => {
    ++messageVersion.current;
    ++listVersion.current;
  }, []);

  return {
    threads: searchedThreads ?? (waitingForOperator ? [] : filteredThreads),
    allThreads: threads,
    // No counts before the first page lands: "Aperte 0" would read as an answer.
    counts: serverFiltered ? null
      : searchKey ? searchCounts
        : ((loading || listError) && threads.length === 0) ? null : counts,
    total,
    hasMore,
    loadMore: searchKey ? loadMoreResults : loadMore,
    /** The inbox's own pages, whatever the search box holds (the visitor filter pages these). */
    listHasMore,
    loadMoreList: loadMore,
    loadingMore,
    /** The server search: "pending" while it runs, "done" with `searchTotal` matches in this tab. */
    searchStatus,
    searchTotal: currentResult?.total ?? null,
    searchError,
    messages,
    selectedThreadId,
    // A search result that is not among the loaded pages is shown from the
    // result until its transcript (which carries the thread) arrives.
    selectedThread: threads.find((t) => t.id === selectedThreadId)
      ?? found?.items.find((t) => t.id === selectedThreadId) ?? null,
    /** The pending update of each thread (see threadUpdateKey); absent when none is in flight. */
    updating,
    filter,
    setFilter,
    search,
    setSearch,
    loading,
    loadingMessages,
    sending,
    error,
    listError,
    selectThread,
    sendReply,
    updateThread,
    deleteThread,
    generateTitle,
    toggleFavorite,
    refresh: loadThreads,
  };
}
