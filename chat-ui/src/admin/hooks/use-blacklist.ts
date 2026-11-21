import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";

export interface BlacklistedVisitor {
  id: number;
  tenant_id: number;
  visitor_id: string;
  visitor_ip?: string;
  reason?: string;
  thread_id?: number;
  created_at: string;
}

export function useBlacklist() {
  const { t } = useApp();
  const [visitors, setVisitors] = useState<BlacklistedVisitor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<unknown>("/blacklisted-visitors");
      const list = Array.isArray(res) ? res : (res as Record<string, unknown>)?.items ?? [];
      setVisitors(list as BlacklistedVisitor[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the block list.");
    } finally {
      setLoading(false);
    }
  }, []);

  const blacklist = useCallback(
    async (data: { visitor_id: string; visitor_ip?: string; reason?: string; thread_id?: number }) => {
      setError(null);
      try {
        const res = await apiFetch<BlacklistedVisitor>("/blacklisted-visitors", {
          method: "POST",
          body: JSON.stringify(data),
        });
        if (res?.id) {
          setVisitors((prev) => [res, ...prev]);
        }
        toast.warning(t("toast.visitorBlocked"));
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't block this visitor.";
        setError(msg);
        toast.error(msg);
        throw err;
      }
    },
    []
  );

  const unblacklist = useCallback(
    async (id: number) => {
      setError(null);
      try {
        await apiFetch(`/blacklisted-visitors/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        setVisitors((prev) => prev.filter((v) => v.id !== id));
        toast.info(t("toast.visitorUnblocked"));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't unblock this visitor.");
      }
    },
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { visitors, loading, error, blacklist, unblacklist, refresh: load };
}
