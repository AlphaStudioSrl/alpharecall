import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "../lib/api";
import { useApp } from "../app-context";

interface ToolItem {
  id: string;
  [key: string]: unknown;
}

type ToolType = "appointments" | "leads" | "escalations" | "products";

interface ToolsState {
  appointments: ToolItem[];
  leads: ToolItem[];
  escalations: ToolItem[];
  products: ToolItem[];
  loading: Record<ToolType, boolean>;
}

export function useTools() {
  const { settings } = useApp();
  const [state, setState] = useState<ToolsState>({
    appointments: [],
    leads: [],
    escalations: [],
    products: [],
    loading: {
      appointments: false,
      leads: false,
      escalations: false,
      products: false,
    },
  });

  const loadTool = useCallback(
    async (type: ToolType) => {
      if (!settings.tenant_id) return;
      setState((prev) => ({
        ...prev,
        loading: { ...prev.loading, [type]: true },
      }));
      try {
        const result = await apiFetch<ToolItem[] | { items: ToolItem[] }>(
          `/tools/${type}?limit=50`
        );
        const items = Array.isArray(result)
          ? result
          : Array.isArray((result as { items?: ToolItem[] })?.items)
            ? (result as { items: ToolItem[] }).items
            : [];
        setState((prev) => ({
          ...prev,
          [type]: items,
          loading: { ...prev.loading, [type]: false },
        }));
      } catch {
        setState((prev) => ({
          ...prev,
          [type]: [],
          loading: { ...prev.loading, [type]: false },
        }));
      }
    },
    [settings.tenant_id]
  );

  const loadAll = useCallback(async () => {
    await Promise.all([
      loadTool("appointments"),
      loadTool("leads"),
      loadTool("escalations"),
      loadTool("products"),
    ]);
  }, [loadTool]);

  const deleteItem = useCallback(
    async (type: ToolType, id: string) => {
      await apiFetch(`/tools/${type}/${id}`, { method: "DELETE" });
      setState((prev) => ({
        ...prev,
        [type]: prev[type].filter((item) => item.id !== id),
      }));
    },
    []
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  return { ...state, loadTool, loadAll, deleteItem };
}
