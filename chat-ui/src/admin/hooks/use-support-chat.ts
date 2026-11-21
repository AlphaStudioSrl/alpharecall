import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { apiFetch } from "@/admin/lib/api";
import { usePoll } from "@/admin/lib/poll";
import { wpAttachmentClient, type ChatAttachment } from "@/lib/chat-attachments";

export interface SupportThread {
  id: number;
  status: string;
  title: string | null;
  last_message_at: string | null;
  created_at: string | null;
}

export interface SupportMessage {
  id: number;
  role: "user" | "assistant" | "human" | "system";
  content: string;
  format: string;
  created_at: string | null;
  attachments?: ChatAttachment[];
}

export function useSupportChat() {
  const attachmentClient = useMemo(() => wpAttachmentClient("support-chat/attachments"), []);
  const cfg = (window as any).AlphaRecallAdmin || {};
  const storageKey = `ar-support-active-thread:${cfg.settings?.tenant_id || cfg.restUrl || ""}:${cfg.currentUser?.id || ""}`;
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(() => {
    try {
      const id = Number(localStorage.getItem(storageKey));
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    } catch { return null; }
  });
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const [loading, setLoading] = useState(false);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [error, setError] = useState<"History" | "Messages" | "Send" | "Close" | "Unavailable" | null>(null);
  const [sending, setSending] = useState(false);
  const [threadStatus, setThreadStatus] = useState("open");
  const activeRef = useRef(activeThreadId);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const messageRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current++;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      if (activeThreadId) localStorage.setItem(storageKey, String(activeThreadId));
      else localStorage.removeItem(storageKey);
    } catch { /* Storage may be disabled. */ }
  }, [activeThreadId, storageKey]);

  const fetchThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const res = await apiFetch<{ items: SupportThread[] }>("/support-chat/threads", { cache: "reload" });
      if (mounted.current) {
        setThreads(res.items || []);
        setError(prev => prev === "History" ? null : prev);
      }
    } catch { if (mounted.current) setError(prev => prev || "History"); }
    finally { if (mounted.current) setThreadsLoading(false); }
  }, []);

  const fetchMessages = useCallback(async (threadId: number, initial = false) => {
    const generation = epoch.current;
    const request = ++messageRequest.current;
    const current = () => mounted.current && generation === epoch.current
      && activeRef.current === threadId && request === messageRequest.current && !abortRef.current;
    if (initial) setLoading(true);
    try {
      // Full reconciliation uses only persisted IDs/timestamps. Browser-clock
      // optimistic timestamps must never become an `after` cursor.
      const res = await apiFetch<{ messages: SupportMessage[]; status: string }>(
        `/support-chat/threads/${threadId}/messages`, { cache: "reload" }
      );
      if (current()) {
        setMessages(res.messages || []);
        setThreadStatus(res.status || "open");
        setStreamingText("");
        setError(prev => prev === "Messages" ? null : prev);
      }
    } catch (err) {
      if (current()) setError(prev => prev || "Messages");
      return err; // The poll backs off on it.
    }
    finally { if (current()) setLoading(false); }
  }, []);

  useEffect(() => { void fetchThreads(); }, [fetchThreads]);

  // Poll AI-owned and closed threads too: staff can take over or reopen them
  // at any time. One poller per open thread: it never overlaps slow requests,
  // pauses in a hidden tab and backs off on errors and 429s.
  const openedRef = useRef(false);
  useEffect(() => { openedRef.current = true; }, [activeThreadId]);
  usePoll(async () => {
    const threadId = activeRef.current;
    if (!threadId || abortRef.current) return;
    const initial = openedRef.current;
    openedRef.current = false;
    const failed = await fetchMessages(threadId, initial);
    if (failed) throw failed;
  }, { enabled: activeThreadId !== null, resetKey: activeThreadId, intervalMs: 5000, path: "/support-chat" });

  const cancelWork = useCallback(() => {
    epoch.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    setSending(false);
    setLoading(false);
    setStreamingText("");
    setError(null);
  }, []);

  const selectThread = useCallback((id: number | null) => {
    const reselecting = id !== null && activeRef.current === id;
    cancelWork();
    activeRef.current = id;
    setActiveThreadId(id);
    setMessages([]);
    setThreadStatus("open");
    setLoading(id !== null);
    if (reselecting) void fetchMessages(id, true);
  }, [cancelWork, fetchMessages]);

  const startNewThread = useCallback(() => selectThread(null), [selectThread]);

  const sendMessage = useCallback(async (content: string, attachments: ChatAttachment[] = []) => {
    const cfg = (window as any).AlphaRecallAdmin || {};
    if (!content.trim() || abortRef.current) return;
    if (!cfg.supportStreamUrl) { setError("Unavailable"); return; }
    setError(null);
    const generation = ++epoch.current;
    const controller = new AbortController();
    abortRef.current = controller;
    const current = () => mounted.current && epoch.current === generation && !controller.signal.aborted;
    let threadId = activeRef.current;
    setMessages(prev => [...prev, {
      id: -Date.now(), role: "user", content: content.trim(), format: "text", created_at: null,
      attachments,
    }]);
    setSending(true);
    setLoading(false);
    setStreamingText("");
    try {
      const res = await fetch(cfg.supportStreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-WP-Nonce": cfg.nonce || "" },
        body: JSON.stringify({ input: { query: content.trim() }, conversation_id: threadId, attachment_ids: attachments.map(file => file.id) }),
        signal: controller.signal,
      });
      if (!current()) return;
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let finished = false;
      try {
        while (current() && !finished) {
          const { done, value } = await reader.read();
          if (!current()) break;
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = done ? "" : lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") { finished = true; break; }
            let parsed;
            try { parsed = JSON.parse(data); } catch { continue; }
            if (parsed.event === "conversation_id" && Number.isSafeInteger(parsed.conversation_id) && parsed.conversation_id > 0) {
              threadId = parsed.conversation_id;
              activeRef.current = threadId;
              setActiveThreadId(threadId);
            } else if (parsed.event === "support_status") {
              setThreadStatus(parsed.status);
              // Takeover cancels this AI turn, including any partial text.
              // Do not wait for the proxy to close its response body.
              setStreamingText("");
              finished = true;
              break;
            } else if (parsed.delta) {
              accumulated += parsed.delta;
              setStreamingText(accumulated);
            } else if (parsed.error) {
              throw new Error(parsed.error);
            }
          }
          if (done) break;
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (err: any) {
      if (current() && err.name !== "AbortError") setError("Send");
    } finally {
      if (current()) {
        abortRef.current = null;
        setSending(false);
        // The API commits before DONE. Polling also reconciles interrupted
        // requests, without delayed callbacks that can resurrect old threads.
        if (threadId) await fetchMessages(threadId);
        await fetchThreads();
      }
    }
  }, [fetchMessages, fetchThreads]);

  const closeThread = useCallback(async (id: number) => {
    if (activeRef.current === id) cancelWork();
    const generation = epoch.current;
    try {
      await apiFetch(`/support-chat/threads/${id}/close`, { method: "POST" });
      if (mounted.current && generation === epoch.current && activeRef.current === id) {
        setThreadStatus("closed");
        await fetchMessages(id);
      }
      await fetchThreads();
    } catch {
      if (mounted.current && generation === epoch.current && activeRef.current === id) setError("Close");
    }
  }, [cancelWork, fetchMessages, fetchThreads]);

  // Refresh only reads persisted state. Never replay an interrupted POST, which
  // may already have been committed by the server (or queued for a human).
  const refresh = useCallback(async () => {
    setError(null);
    if (activeRef.current && !abortRef.current) await fetchMessages(activeRef.current, true);
    await fetchThreads();
  }, [fetchMessages, fetchThreads]);

  return { threads, activeThreadId, messages, streamingText, loading, sending, threadsLoading, error,
    threadStatus, sendMessage, startNewThread, selectThread, closeThread, fetchThreads, refresh, attachmentClient };
}
