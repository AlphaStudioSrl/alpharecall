import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";

export interface IndexedDocument {
  id: number;
  source_id: string;
  source_url: string;
  source_type: string;
  title: string;
  published_at?: string;
  updated_at?: string;
  content_hash?: string;
  chunk_count?: number;
  last_uploaded_at?: string;
}

export function useDocuments() {
  const { t } = useApp();
  const [documents, setDocuments] = useState<IndexedDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<unknown>("/documents?limit=200");
      const list = Array.isArray(res) ? res : (res as Record<string, unknown>)?.items ?? [];
      setDocuments(list as IndexedDocument[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(
    async (sourceId: string) => {
      try {
        await apiFetch(`/documents/${encodeURIComponent(sourceId)}`, {
          method: "DELETE",
        });
        setDocuments((prev) => prev.filter((d) => d.source_id !== sourceId));
        toast.success(t("toast.documentRemoved"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Couldn't delete the document.";
        setError(msg);
        toast.error(msg);
      }
    },
    []
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { documents, loading, error, remove, refresh: load };
}
