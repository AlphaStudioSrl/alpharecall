import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";

export interface Visitor {
  id: number;
  /** Null for anonymous visitors (the API hides its internal placeholder address). */
  email: string | null;
  /** An address the visitor typed without proving they own it. */
  unverified_email?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  wp_user_id?: number | null;
  is_banned: boolean;
  ban_reason?: string | null;
  notification_consent?: boolean;
  notes?: string | null;
  last_seen_at?: string | null;
  created_at: string;
  thread_count?: number;
}

const PAGE = 100;

function collection(res: unknown): Visitor[] {
  const items = Array.isArray(res)
    ? res
    : (res as Record<string, unknown>)?.items ?? (res as Record<string, unknown>)?.data ?? [];
  return Array.isArray(items) ? (items as Visitor[]) : [];
}

function totalOf(res: unknown): number | null {
  const total = Number((res as { total?: unknown } | null)?.total);
  return Number.isFinite(total) ? total : null;
}

/**
 * One page of Contatti (`/visitors` pages by offset, newest activity first).
 * Only people who wrote: the widget registers a visitor on load, and those
 * who never sent a message are not contacts ("Chat 0" rows and an inflated
 * "N persone hanno scritto"). An older backend ignores `has_chats`.
 */
export async function fetchVisitorPage(search: string | undefined, offset: number, limit = PAGE) {
  const params = new URLSearchParams({ limit: String(limit), has_chats: "true" });
  if (offset) params.set("offset", String(offset));
  if (search) params.set("search", search);
  const res = await apiFetch<unknown>(`/visitors?${params.toString()}`);
  return { items: collection(res), total: totalOf(res) };
}

export function useVisitors() {
  const { t } = useApp();
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The list itself shows an empty state on failure (the endpoint may be
  // missing on old backends); `failed` lets the page offer a retry instead.
  const [failed, setFailed] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const query = useRef<string | undefined>(undefined);
  const version = useRef(0);

  const load = useCallback(async (searchQuery?: string) => {
    const run = ++version.current;
    query.current = searchQuery;
    setLoading(true);
    setError(null);
    setFailed(false);
    try {
      const page = await fetchVisitorPage(searchQuery, 0);
      if (run !== version.current) return;
      setVisitors(page.items);
      setTotal(page.total);
    } catch {
      if (run !== version.current) return;
      // Silently show empty state — endpoint may not be available yet
      setVisitors([]);
      setTotal(null);
      setFailed(true);
    } finally {
      if (run === version.current) setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const run = version.current;
    setLoadingMore(true);
    try {
      const page = await fetchVisitorPage(query.current, visitors.length);
      if (run !== version.current) return;
      setVisitors((prev) => [...prev, ...page.items.filter((v) => !prev.some((p) => p.id === v.id))]);
      if (page.total !== null) setTotal(page.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("inboxPage.errors.morePeople"));
    } finally {
      setLoadingMore(false);
    }
  }, [visitors.length, t]);

  /** Replace one row in place (after a rectify, or a fresh GET /visitors/{id}). */
  const patchVisitor = useCallback((id: number, patch: Partial<Visitor>) => {
    setVisitors((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);

  const removeVisitor = useCallback((id: number) => {
    setVisitors((prev) => prev.filter((v) => v.id !== id));
    setTotal((n) => (n === null ? n : Math.max(0, n - 1)));
  }, []);

  const banVisitor = useCallback(
    async (id: number, reason?: string) => {
      try {
        await apiFetch(`/visitors/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_banned: true, ban_reason: reason || null }),
        });
        setVisitors((prev) =>
          prev.map((v) =>
            v.id === id ? { ...v, is_banned: true, ban_reason: reason } : v
          )
        );
        toast.warning(t("toast.visitorBanned") || "Visitor banned");
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("inboxPage.errors.ban"));
        return false;
      }
    },
    [t]
  );

  const unbanVisitor = useCallback(
    async (id: number) => {
      try {
        await apiFetch(`/visitors/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ is_banned: false, ban_reason: null }),
        });
        setVisitors((prev) =>
          prev.map((v) =>
            v.id === id
              ? { ...v, is_banned: false, ban_reason: undefined }
              : v
          )
        );
        toast.success(t("toast.visitorUnbanned") || "Visitor unbanned");
        return true;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("inboxPage.errors.unban")
        );
        return false;
      }
    },
    [t]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return {
    visitors, loading, loadingMore, error, failed, search, setSearch, load, loadMore,
    total, hasMore: total !== null && visitors.length < total,
    banVisitor, unbanVisitor, patchVisitor, removeVisitor,
  };
}

/** A single visitor (Ctrl K deep links, the inbox context panel). */
export async function fetchVisitor(id: number): Promise<Visitor | null> {
  const res = await apiFetch<Visitor>(`/visitors/${encodeURIComponent(String(id))}`);
  return res && typeof res === "object" && "id" in res ? res : null;
}
