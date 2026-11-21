import { useState, useEffect, useCallback, useRef } from "react";
import { apiFetch } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";
import { asCounts, mergeSubmissionCounts, type CollectionCounts } from "@/admin/hooks/use-conversions-data";
import { publishPlanUsage } from "@/admin/lib/plan-usage";

export interface QuotaData {
  messages_used?: number;
  messages_limit?: number;
  monthly_used?: number;
  monthly_allowance?: number;
  yearly_used?: number;
  yearly_allowance?: number;
  messages_remaining?: number;
  license_tier?: string;
  plan?: string;
  trial_expired?: boolean;
}

export interface ConversationItem {
  id?: number | string;
  session_id?: string;
  query?: string;
  first_message?: string;
  input?: unknown;
  output?: unknown;
  workflow?: string;
  message_count?: number;
  created_at?: string;
  updated_at?: string;
  visitor_ip?: string;
  status?: string;
}

export interface IngestionItem {
  id?: number | string;
  status?: string;
  /** Dev fixtures only; the API sends `stats` (app/schemas.py IngestionResponse). */
  documents_count?: number;
  created_at?: string;
  completed_at?: string;
  started_at?: string;
  finished_at?: string;
  stats?: { processed_items?: number; total_items?: number; documents_uploaded?: number } | null;
  error?: string;
}

/**
 * Pages a sync read. The API has no `documents_count`: reading only it showed
 * 0 for every real run. Not `documents_uploaded` either, which counts chunks.
 */
export function ingestionPages(run: IngestionItem): number {
  const value = run.documents_count ?? run.stats?.processed_items ?? run.stats?.total_items ?? 0;
  return Number(value) || 0;
}

/** When a sync started and ended, whichever field set the payload uses. */
export function ingestionStarted(run: IngestionItem): string | undefined {
  return run.created_at ?? run.started_at;
}
export function ingestionFinished(run: IngestionItem): string | undefined {
  return run.completed_at ?? run.finished_at ?? ingestionStarted(run);
}

export interface AnalyticsEntry {
  date?: string;
  conversations?: number;
  messages?: number;
  tool_calls?: number;
  tool_name?: string;
  count?: number;
}

export interface ContentCounts {
  pages?: number;
  posts?: number;
}

export interface TenantInfo {
  id?: number;
  domain?: string;
  plan?: string;
  status?: string;
  name?: string;
}

/**
 * One row of a /tools/* or submissions collection. The API sends the whole
 * record; only `created_at` is guaranteed, the rest depends on the kind
 * (lead: email/extra, appointment: user_info/timeslot/status, submission:
 * name/type/status, feedback: rating/name, escalation: issue/status).
 */
export interface ConversionRow {
  id?: number;
  created_at: string;
  [key: string]: unknown;
}

export interface ConversionCounts {
  leads: { total: number; items: ConversionRow[] };
  appointments: { total: number; items: ConversionRow[] };
  /** Contact submissions plus escalations, as Richieste lists them. */
  submissions: { total: number; items: ConversionRow[] };
  feedback: { total: number; items: ConversionRow[] };
  /** Escalations on their own (also counted in `submissions`). */
  escalations?: { total: number; items: ConversionRow[] };
  /**
   * Records per status over the whole collections (the API's with_counts),
   * shaped like Richieste's: Oggi counts "nuove" from these with the same
   * rule as the board's Nuove column. A collection is null from an older
   * API, which leaves only the 200 rows fetched to count.
   */
  counts?: CollectionCounts;
}

export interface DashboardThread {
  id: number;
  thread_type?: string;
  title?: string | null;
  status?: string;
  created_at: string;
  last_message_at?: string | null;
  message_count?: number;
  last_message?: { content?: string; text?: string; created_at?: string } | string | null;
  last_visitor_message?: { content?: string; created_at?: string } | null;
  visitor?: { id?: number | null; display_name?: string | null; name?: string | null; email?: string | null } | null;
  visitor_id?: number | null;
}

/** What /tenants/{id}/analytics/tenant answers (the PHP payload passes it through). */
export interface AnalyticsPayload {
  analytics?: Record<string, unknown>[];
  summary?: {
    total?: number;
    by_kind?: Record<string, number>;
    tools?: Record<string, number>;
    conversions?: number;
    message_ratings?: { up?: number; down?: number } & Record<string, unknown>;
    /**
     * Open "could not answer" turns and the distinct questions behind them;
     * asks the safety filter refused are not in them but in `filtered`.
     */
    knowledge_gaps?: { open?: number; questions?: number; filtered?: number };
  };
}

export interface DashboardData {
  tenant?: TenantInfo;
  quota?: QuotaData;
  conversations?: ConversationItem[];
  chat_threads?: { items: DashboardThread[]; total: number };
  ingestions?: IngestionItem[];
  /** Daily rows in older payloads and the dev fixtures, the analytics envelope from the API. */
  analytics?: AnalyticsEntry[] | AnalyticsPayload;
  content_counts?: ContentCounts;
  commerce?: Record<string, unknown>;
  conversions?: ConversionCounts;
}

interface UseDashboardReturn {
  data: DashboardData | null;
  loading: boolean;
  /** Only when there is nothing to show; a failed background refresh sets `stale` instead. */
  error: string | null;
  /** The last refresh failed and `data` is the previous payload. */
  stale: boolean;
  /** When `data` was fetched (ms), null before the first load. */
  updatedAt: number | null;
  /** `refresh(true)` goes past the 15s caches to the server. */
  refresh: (force?: boolean) => void;
}

/**
 * Cache the last payload at module scope rather than in a ref.
 *
 * Switching tabs unmounts the whole page, so a useRef-based TTL was destroyed
 * every time and coming back to the dashboard refired /dashboard plus four
 * /tools/* requests -- each proxied through WordPress to the remote API. That
 * round trip is what made navigation feel slow. Module scope survives the
 * unmount, so returning to a tab within the TTL paints instantly from cache
 * and then revalidates.
 */
const CACHE_TTL_MS = 15000;

/**
 * The collections Oggi and Statistiche read, newest first. The bell asks for
 * the latest rows of the same collections: while these are in flight or
 * fresh it reads them instead of sending its own five requests (see
 * use-notifications.ts), so these URLs are its to share.
 */
export const DASHBOARD_ROWS = {
  leads: "/tools/leads?limit=200&with_total=1&with_counts=1",
  appointments: "/tools/appointments?limit=200&with_total=1&with_counts=1",
  submissions: "/contact-submissions?limit=200&with_total=1&with_counts=1",
  feedback: "/feedback?limit=200&with_total=1&with_counts=1",
  escalations: "/tools/escalations?limit=200&with_total=1&with_counts=1",
} as const;
let cachedData: DashboardData | null = null;
let cachedAt = 0;
let cachedTenant = "";

export function useDashboard(): UseDashboardReturn {
  const { settings, updateSettings } = useApp();
  // Seed from cache so the first paint after a tab switch has content.
  const seed = cachedTenant === settings.tenant_id ? cachedData : null;
  const [data, setData] = useState<DashboardData | null>(seed);
  const [loading, setLoading] = useState(!seed);
  const [error, setError] = useState<string | null>(null);
  // A background refresh that fails keeps the last payload on screen and
  // only flags it; the error state is for when there is nothing to show.
  const [stale, setStale] = useState(false);
  const fetchedAtRef = useRef(seed ? cachedAt : 0);
  const dataRef = useRef<DashboardData | null>(seed);

  const load = useCallback(async (force = false) => {
    if (!settings.tenant_id) {
      setData(null);
      dataRef.current = null;
      setLoading(false);
      return;
    }
    const now = Date.now();
    if (!force && fetchedAtRef.current && now - fetchedAtRef.current < CACHE_TTL_MS) {
      return;
    }
    // Only show the skeleton when there is nothing to show; a cached payload
    // stays on screen while it revalidates instead of flashing empty.
    if (!cachedData || cachedTenant !== settings.tenant_id) setLoading(true);
    setError(null);
    // An explicit refresh must reach the server, not the shared GET cache in
    // lib/api -- the button exists precisely to bypass staleness.
    const live: RequestInit = force ? { cache: "reload" } : {};
    // All six at once: the collections used to wait for /dashboard, a
    // second round trip, and the bell (which shares them) waited with them.
    const collections = Promise.allSettled([
      apiFetch<unknown>(DASHBOARD_ROWS.leads, live),
      apiFetch<unknown>(DASHBOARD_ROWS.appointments, live),
      apiFetch<unknown>(DASHBOARD_ROWS.submissions, live),
      apiFetch<unknown>(DASHBOARD_ROWS.feedback, live),
      apiFetch<unknown>(DASHBOARD_ROWS.escalations, live),
    ]);
    try {
      const result = await apiFetch<DashboardData>("/dashboard", live);

      // Conversion counts (best-effort). with_total=1 makes the API answer
      // {items, total}: the badge must show the collection size, not the
      // length of the page fetched for the chart buckets.
      type Rows = ConversionRow[];
      const extract = (res: PromiseSettledResult<unknown>): { items: Rows; total: number } => {
        if (res.status !== "fulfilled") return { items: [], total: 0 };
        const v = res.value as unknown;
        if (Array.isArray(v)) return { items: v as Rows, total: v.length };
        const obj = (v ?? {}) as { items?: unknown; total?: unknown };
        const items = Array.isArray(obj.items) ? (obj.items as Rows) : [];
        return { items, total: typeof obj.total === "number" ? obj.total : items.length };
      };
      const [leadsRes, apptRes, subRes, fbRes, escRes] = await collections;
      const leads = extract(leadsRes);
      const appts = extract(apptRes);
      const subs = extract(subRes);
      const fb = extract(fbRes);
      // Risultati lists escalations under "Richieste"; count them the same
      // way here or the two pages disagree on the same label.
      const escs = extract(escRes);
      // "200 richieste da leggere" was the pending rows among the 200 fetched.
      const countsOf = (res: PromiseSettledResult<unknown>) =>
        res.status === "fulfilled" ? asCounts((res.value as { counts?: unknown } | null)?.counts) : null;
      result.conversions = {
        counts: {
          leads: countsOf(leadsRes),
          appointments: countsOf(apptRes),
          submissions: mergeSubmissionCounts(countsOf(subRes), countsOf(escRes)),
          feedback: countsOf(fbRes),
        },
        leads: { total: leads.total, items: leads.items },
        appointments: { total: appts.total, items: appts.items },
        submissions: { total: subs.total + escs.total, items: [...subs.items, ...escs.items] },
        feedback: { total: fb.total, items: fb.items },
        escalations: escs,
      };

      setData(result);
      dataRef.current = result;
      // The top bar's plan chip reads it from here instead of asking /quota.
      publishPlanUsage(result.quota);
      setStale(false);
      fetchedAtRef.current = now;
      cachedData = result;
      cachedAt = now;
      cachedTenant = settings.tenant_id;
      // Also fetch tenant-settings to keep them in sync (matches old admin)
      try {
        const tenantSettings = await apiFetch<Record<string, unknown>>("/tenant-settings");
        updateSettings({ tenant_settings: tenantSettings });
      } catch {
        // ignore tenant settings load failures
      }
    } catch (err) {
      if (dataRef.current) {
        setStale(true);
      } else {
        setData(null);
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  }, [settings.tenant_id, updateSettings]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, stale, updatedAt: fetchedAtRef.current || null, refresh: load };
}
