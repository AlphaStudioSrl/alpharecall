import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "../lib/api";
import { useApp } from "../app-context";
import { faqErrorText } from "../components/helpdesk/faq-errors";

export interface HelpdeskCategory {
  id: number;
  name: string;
  description?: string;
  position: number;
}

export function useHelpdeskCategories() {
  const { settings, t } = useApp();
  const [categories, setCategories] = useState<HelpdeskCategory[]>([]);
  const confirmedRef = useRef<HelpdeskCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Card gxo6eh1izsvo: Italian text, the raw message to the console (faq-errors.ts).
  const tRef = useRef(t);
  tRef.current = t;
  const tr = useCallback((key: string) => tRef.current(key), []);

  const setConfirmed = useCallback((next: HelpdeskCategory[]) => {
    confirmedRef.current = next;
    setCategories(next);
  }, []);

  const load = useCallback(async () => {
    if (!settings.tenant_id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<HelpdeskCategory[]>("/helpdesk/categories");
      setConfirmed(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(faqErrorText(err, "categoryLoad", tr));
      setConfirmed([]);
    } finally {
      setLoading(false);
    }
  }, [settings.tenant_id, setConfirmed]);

  const add = useCallback(
    async (name: string, description?: string) => {
      setError(null);
      try {
        const cat = await apiFetch<HelpdeskCategory>("/helpdesk/categories", {
          method: "POST",
          body: JSON.stringify({ name, description: description || undefined }),
        });
        if (cat && cat.id) {
          setCategories((prev) => {
            const next = [...prev, cat];
            confirmedRef.current = next;
            return next;
          });
        } else {
          await load();
        }
        return cat;
      } catch (err) {
        setError(faqErrorText(err, "categoryAdd", tr));
        throw err;
      }
    },
    [load]
  );

  const update = useCallback(
    async (id: number, data: { name?: string; description?: string }) => {
      setError(null);
      try {
        const cat = await apiFetch<HelpdeskCategory>(`/helpdesk/categories/${id}`, {
          method: "PUT",
          body: JSON.stringify(data),
        });
        if (cat && cat.id) {
          setCategories((prev) => {
            const next = prev.map((c) => (c.id === id ? cat : c));
            confirmedRef.current = next;
            return next;
          });
        }
        return cat;
      } catch (err) {
        setError(faqErrorText(err, "categorySave", tr));
        throw err;
      }
    },
    []
  );

  const remove = useCallback(
    async (id: number) => {
      setError(null);
      try {
        await apiFetch(`/helpdesk/categories/${id}`, { method: "DELETE" });
        setCategories((prev) => {
          const next = prev.filter((c) => c.id !== id);
          confirmedRef.current = next;
          return next;
        });
      } catch (err) {
        setError(faqErrorText(err, "categoryDelete", tr));
        throw err;
      }
    },
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  return { categories, loading, error, setError, load, add, update, remove };
}
