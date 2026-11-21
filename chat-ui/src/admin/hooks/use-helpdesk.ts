import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { apiFetch } from "../lib/api";
import { useApp } from "../app-context";
import { faqErrorText, FaqFileTooBig } from "../components/helpdesk/faq-errors";

export interface HelpdeskItem {
  id: number | string;
  question: string;
  answer: string;
  category?: string;
  category_id?: number | null;
  position?: number;
  enabled?: boolean;
  /** "generated" for answers the assistant drafted from the site, until someone reviews them. */
  source?: string | null;
  generated?: boolean;
}

export function useHelpdesk() {
  const { settings, t } = useApp();
  const [items, setItems] = useState<HelpdeskItem[]>([]);
  const confirmedItemsRef = useRef<HelpdeskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The callbacks keep their identity (load runs on mount); the error text reads the current language.
  const tRef = useRef(t);
  tRef.current = t;
  const tr = useCallback((key: string) => tRef.current(key), []);

  /** Set items and mark as server-confirmed state for rollback. */
  const setConfirmedItems = useCallback((next: HelpdeskItem[]) => {
    confirmedItemsRef.current = next;
    setItems(next);
  }, []);

  const load = useCallback(async () => {
    if (!settings.tenant_id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<HelpdeskItem[]>("/helpdesk");
      setConfirmedItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(faqErrorText(err, "load", tr));
      setConfirmedItems([]);
    } finally {
      setLoading(false);
    }
  }, [settings.tenant_id, setConfirmedItems]);

  const add = useCallback(
    async (question: string, answer: string, category?: string, category_id?: number | null) => {
      setError(null);
      try {
        const item = await apiFetch<HelpdeskItem>("/helpdesk", {
          method: "POST",
          body: JSON.stringify({
            question,
            answer,
            category: category || undefined,
            category_id: category_id ?? undefined,
            enabled: true,
          }),
        });
        if (item && item.id) {
          setItems((prev) => {
            const next = [item, ...prev];
            confirmedItemsRef.current = next;
            return next;
          });
          // The caller may link the new entry elsewhere (a resolved knowledge gap).
          return item;
        }
        await load();
        return null;
      } catch (err) {
        setError(faqErrorText(err, "add", tr));
        throw err;
      }
    },
    [load]
  );

  const update = useCallback(
    async (id: number | string, data: { question?: string; answer?: string; category?: string; category_id?: number | null; enabled?: boolean; source?: string }) => {
      setError(null);
      try {
        const item = await apiFetch<HelpdeskItem>(`/helpdesk/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        });
        if (item && item.id) {
          setItems((prev) => {
            const next = prev.map((entry) => (entry.id === id ? item : entry));
            confirmedItemsRef.current = next;
            return next;
          });
        }
      } catch (err) {
        setError(faqErrorText(err, "save", tr));
        throw err;
      }
    },
    [t]
  );

  const toggleEnabled = useCallback(
    async (id: number | string, enabled: boolean) => {
      // Optimistic update
      setItems((prev) => prev.map((item) => (item.id === id ? { ...item, enabled } : item)));
      try {
        await update(id, { enabled });
        toast.success(t("toast.faqUpdated"));
      } catch {
        // Revert on failure
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, enabled: !enabled } : item)));
      }
    },
    [update]
  );

  const remove = useCallback(
    async (id: number | string) => {
      setError(null);
      try {
        await apiFetch(`/helpdesk/${id}`, { method: "DELETE" });
        setItems((prev) => {
          const next = prev.filter((item) => item.id !== id);
          confirmedItemsRef.current = next;
          return next;
        });
        toast.success(t("toast.faqDeleted"));
      } catch (err) {
        setError(faqErrorText(err, "delete", tr));
        throw err;
      }
    },
    [t]
  );

  const reorder = useCallback(
    async (reorderedItems: HelpdeskItem[]) => {
      const previous = confirmedItemsRef.current;
      setItems(reorderedItems);
      setError(null);
      try {
        await apiFetch("/helpdesk/reorder", {
          method: "POST",
          body: JSON.stringify({
            items: reorderedItems.map((item, idx) => ({ id: item.id, position: idx })),
          }),
        });
        confirmedItemsRef.current = reorderedItems;
      } catch (err) {
        setError(faqErrorText(err, "reorder", tr));
        setItems(previous);
      }
    },
    []
  );

  const generate = useCallback(async (opts?: { max_pairs?: number; max_pages?: number; overwrite?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch<HelpdeskItem[]>("/helpdesk/generate", {
        method: "POST",
        // The proxy waits up to 180 s for the LLM; give up shortly after so
        // the button cannot stay in "Generazione…" forever.
        signal: AbortSignal.timeout(200_000),
        body: JSON.stringify({
          max_pairs: opts?.max_pairs ?? 12,
          max_pages: opts?.max_pages ?? 6,
          overwrite: opts?.overwrite ?? false,
        }),
      });
      // The response holds only the batch just created. Without overwrite the
      // API appends to what exists, so showing the response alone made the
      // earlier FAQs look deleted until the next page load.
      await load();
    } catch (err) {
      setError(faqErrorText(err, "generate", tr));
      try { await load(); } catch { /* already handled */ }
      throw err;
    } finally {
      setLoading(false);
    }
  }, [load]);

  const importFromFile = useCallback(
    async (file: File) => {
      if (file.size > 600000) {
        const tooBig = new FaqFileTooBig(600000);
        setError(faqErrorText(tooBig, "import", tr));
        throw tooBig;
      }
      setError(null);
      try {
        const text = await file.text();
        const result = await apiFetch<HelpdeskItem[]>("/helpdesk/import", {
          method: "POST",
          body: JSON.stringify({ text, source: file.name }),
        });
        setConfirmedItems(Array.isArray(result) ? result : []);
      } catch (err) {
        setError(faqErrorText(err, "import", tr));
        throw err;
      }
    },
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  return { items, setItems, loading, error, setError, add, update, toggleEnabled, remove, reorder, generate, importFromFile, reload: load };
}
