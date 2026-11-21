import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";
import { useBackgroundJobs } from "@/admin/hooks/use-background-jobs";
import { usePoll } from "@/admin/lib/poll";

export type IngestionStatus = "idle" | "pending" | "running" | "completed" | "failed";

export interface IngestionRun {
  id: number;
  status: string;
  started_at: string;
  finished_at?: string;
  error_msg?: string;
  stats?: {
    sources?: number;
    total_items?: number;
    processed_items?: number;
    current_item?: string;
    documents_uploaded?: number;
    pages?: number;
    posts?: number;
    started_processing_at?: string;
    [key: string]: unknown;
  };
}

interface SyncOptions {
  include_posts: boolean;
  include_pages: boolean;
  replace_all: boolean;
}

/**
 * The content sync: start one, list recent runs, follow the active run.
 *
 * Following reads the run BackgroundJobsProvider already polls for the header
 * indicator; polling /ingestion here as well doubled the requests during a
 * sync. Only without a live provider (support roles) does it poll itself.
 */
export function useIngestion() {
  const { t } = useApp();
  const jobs = useBackgroundJobs();
  const { bumpIngestion } = jobs;
  const [status, setStatus] = useState<IngestionStatus>("idle");
  const [currentRun, setCurrentRun] = useState<IngestionRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<IngestionRun[]>([]);
  /** Following a run (one we started, or one found active on load). */
  const [tracking, setTracking] = useState(false);
  const runIdRef = useRef<number | null>(null);
  /** The run that was latest before a start whose response carried no id: not ours. */
  const staleRunIdRef = useRef<number | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyRun = useCallback((latest: IngestionRun) => {
    // Only the run we started (or the active one found on load): until the
    // poll catches up, the shared state can still hold the previous run.
    if (runIdRef.current ? latest.id !== runIdRef.current : latest.id === staleRunIdRef.current) return;
    setCurrentRun(latest);
    const runStatus = latest.status?.toLowerCase() || "pending";
    if (runStatus === "completed") {
      setStatus("completed");
      setTracking(false);
      toast.success(t("toast.syncComplete"));
      // Auto-reset to idle after 5 seconds
      resetTimer.current = setTimeout(() => setStatus("idle"), 5000);
    } else if (runStatus === "failed") {
      setStatus("failed");
      setTracking(false);
      setError(latest.error_msg || "La sincronizzazione non è terminata.");
      toast.error(t("toast.syncFailed"));
    } else if (runStatus === "running") {
      setStatus("running");
    } else {
      setStatus("pending");
    }
  }, [t]);

  // Follow the provider's poll.
  const sharedRun = jobs.ingestionLive ? jobs.ingestionRun : null;
  useEffect(() => {
    if (tracking && sharedRun) applyRun(sharedRun);
  }, [tracking, sharedRun, applyRun]);

  // No live provider: poll while following a run, as before.
  usePoll(async ({ init }) => {
    const runs = await apiFetch<IngestionRun[] | Record<string, unknown>>("/ingestion?limit=1", init);
    const list = Array.isArray(runs) ? runs : (runs as Record<string, unknown>)?.items as IngestionRun[] ?? [];
    if (list.length) applyRun(list[0]);
  }, { enabled: tracking && !jobs.ingestionLive, intervalMs: 2000, path: "/ingestion" });

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const startSync = useCallback(
    async (options: SyncOptions) => {
      setStatus("pending");
      setError(null);
      setCurrentRun(null);
      runIdRef.current = null;
      staleRunIdRef.current = null;
      if (resetTimer.current) clearTimeout(resetTimer.current);

      try {
        const result = await apiFetch<IngestionRun | Record<string, unknown>>("/ingestion", {
          method: "POST",
          body: JSON.stringify({
            include_posts: options.include_posts,
            include_pages: options.include_pages,
            replace_all: options.replace_all,
            mode: "wp_api",
            site_url: window.AlphaRecallAdmin?.siteUrl || "",
          }),
        });

        // Extract run ID from response
        const run = result as IngestionRun;
        if (run?.id) {
          runIdRef.current = run.id;
          setCurrentRun(run);
        } else {
          staleRunIdRef.current = jobs.ingestionRun?.id ?? null;
        }

        setTracking(true);
        // Poll now rather than at the next (idle, slow) tick.
        bumpIngestion();
      } catch (err) {
        setStatus("failed");
        // Tagged so the panel says the sync never started (syncErrorKey), not
        // that a started one failed; the raw reason stays in the details.
        setError(`Couldn't start the sync: ${err instanceof Error ? err.message : String(err)}`);
        toast.error(t("toast.syncStartFailed"));
      }
    },
    [bumpIngestion, jobs.ingestionRun, t]
  );

  const loadRecentRuns = useCallback(async () => {
    try {
      const runs = await apiFetch<IngestionRun[] | Record<string, unknown>>("/ingestion?limit=5");
      const list = Array.isArray(runs) ? runs : (runs as Record<string, unknown>)?.items as IngestionRun[] ?? [];
      setRecentRuns(list);

      // If there's an active run, follow it
      if (list.length > 0) {
        const latest = list[0];
        const runStatus = latest.status?.toLowerCase() || "";
        if (runStatus === "pending" || runStatus === "running") {
          setCurrentRun(latest);
          runIdRef.current = latest.id;
          setStatus(runStatus as IngestionStatus);
          setTracking(true);
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn("Failed to load recent ingestion runs:", err);
    }
  }, []);

  // Load recent runs on mount
  useEffect(() => {
    void loadRecentRuns();
  }, [loadRecentRuns]);

  const isActive = status === "pending" || status === "running";

  return {
    status,
    currentRun,
    error,
    recentRuns,
    isActive,
    startSync,
    loadRecentRuns,
  };
}
