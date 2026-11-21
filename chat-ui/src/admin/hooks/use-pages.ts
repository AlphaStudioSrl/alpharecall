import { useState, useCallback, useEffect } from "react";
import { ajaxFetchPages } from "../lib/api";

interface PageItem {
  id: number;
  title: string;
  type: string;
  url?: string;
}

interface PagesState {
  pages: PageItem[];
  page: number;
  totalPages: number;
  search: string;
  loading: boolean;
  error: string | null;
}

export function usePages() {
  const [state, setState] = useState<PagesState>({
    pages: [],
    page: 1,
    totalPages: 1,
    search: "",
    loading: false,
    error: null,
  });

  const load = useCallback(async (page = 1, search = "") => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await ajaxFetchPages({
        page,
        perPage: 20,
        search,
      });
      setState((prev) => ({
        ...prev,
        pages: result.pages as PageItem[],
        page,
        totalPages: result.totalPages,
        search,
        loading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "Couldn't load the pages",
      }));
    }
  }, []);

  const setSearch = useCallback(
    (search: string) => {
      load(1, search);
    },
    [load]
  );

  const setPage = useCallback(
    (page: number) => {
      load(page, state.search);
    },
    [load, state.search]
  );

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, setSearch, setPage, reload: () => load(state.page, state.search) };
}
