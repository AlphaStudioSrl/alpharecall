import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/admin/lib/api";
import { usePoll } from "@/admin/lib/poll";
import type { IngestionRun, IngestionStatus } from "@/admin/hooks/use-ingestion";

export interface IngestionProgress {
  processed?: number;
  total?: number;
  current?: string;
}

interface BackgroundJobsValue {
  /** Latest content-ingestion (reindex) status, polled server-side so it
   *  survives navigation AND full page reloads. */
  ingestionStatus: IngestionStatus;
  ingestionProgress: IngestionProgress | null;
  /** The latest run as polled, for useIngestion (which reads it instead of polling itself). */
  ingestionRun: IngestionRun | null;
  /** Whether this provider is polling /ingestion (false: no provider, or the poll is off). */
  ingestionLive: boolean;
  /** Whether a FAQ-generation request is currently in flight. */
  faqRunning: boolean;
  /** Run a FAQ-generation call through the app-level context so the in-flight
   *  request (and its status) survives navigating between sections. */
  runFaqJob: <T>(fn: () => Promise<T>) => Promise<T>;
  /** Force an immediate ingestion status refresh (e.g. right after starting a sync). */
  bumpIngestion: () => void;
}

const BackgroundJobsContext = createContext<BackgroundJobsValue | null>(null);

/**
 * Returns the app-level background-jobs state. Falls back to an inert value when
 * used outside the provider (e.g. the support-only role, which has no provider).
 */
export function useBackgroundJobs(): BackgroundJobsValue {
  const ctx = useContext(BackgroundJobsContext);
  if (!ctx) {
    return {
      ingestionStatus: "idle",
      ingestionProgress: null,
      ingestionRun: null,
      ingestionLive: false,
      faqRunning: false,
      runFaqJob: (fn) => fn(),
      bumpIngestion: () => {},
    };
  }
  return ctx;
}

const ACTIVE_MS = 2500;
// Idle, the poll only notices a sync started elsewhere (another tab, the
// scheduler); starting one here bumps it at once.
const IDLE_MS = 30000;

function isActiveStatus(s: IngestionStatus): boolean {
  return s === "running" || s === "pending";
}

export function BackgroundJobsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [ingestionStatus, setIngestionStatus] = useState<IngestionStatus>("idle");
  const [ingestionProgress, setIngestionProgress] = useState<IngestionProgress | null>(null);
  const [ingestionRun, setIngestionRun] = useState<IngestionRun | null>(null);
  const [faqRunning, setFaqRunning] = useState(false);

  const statusRef = useRef<IngestionStatus>("idle");

  // Adaptive poll: fast while a run is active, slow when idle, paused in a
  // hidden tab, backing off on errors and 429s. Runs as long as the provider
  // is mounted (the whole admin session), so the status is correct after
  // navigating between sections or reloading the page.
  const poll = usePoll(async ({ init }) => {
    // A live poll: the shared GET cache would hold a 15s-old run status and
    // freeze the progress readout mid-sync.
    const res = await apiFetch<IngestionRun[] | Record<string, unknown>>("/ingestion?limit=1", init);
    const list = Array.isArray(res)
      ? res
      : ((res as Record<string, unknown>)?.items as IngestionRun[]) ?? [];
    const run = list[0];
    if (!run) {
      statusRef.current = "idle";
      setIngestionStatus("idle");
      setIngestionProgress(null);
      setIngestionRun(null);
      return;
    }
    const s = (run.status?.toLowerCase() || "idle") as IngestionStatus;
    statusRef.current = s;
    setIngestionStatus(s);
    setIngestionRun(run);
    if (isActiveStatus(s)) {
      setIngestionProgress({
        processed: run.stats?.processed_items,
        total: run.stats?.total_items,
        current: run.stats?.current_item,
      });
    } else {
      setIngestionProgress(null);
    }
  }, {
    enabled,
    intervalMs: () => (isActiveStatus(statusRef.current) ? ACTIVE_MS : IDLE_MS),
    path: "/ingestion",
    // Starting a sync bumps from both useIngestion and the page: one request.
    debounceMs: 300,
  });

  const bumpIngestion = useCallback(() => {
    poll.refresh();
  }, [poll]);

  const runFaqJob = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setFaqRunning(true);
    try {
      return await fn();
    } finally {
      setFaqRunning(false);
    }
  }, []);

  return (
    <BackgroundJobsContext.Provider
      value={{ ingestionStatus, ingestionProgress, ingestionRun, ingestionLive: enabled, faqRunning, runFaqJob, bumpIngestion }}
    >
      {children}
    </BackgroundJobsContext.Provider>
  );
}
