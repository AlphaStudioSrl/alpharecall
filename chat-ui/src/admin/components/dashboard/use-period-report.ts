import { useEffect, useMemo, useState } from "react";
import { ApiRequestError, apiFetch } from "@/admin/lib/api";
import type { DashboardData } from "@/admin/hooks/use-dashboard";
import { deriveReport, reportFromApi, type PeriodDays, type PeriodReport } from "./metrics";

/**
 * Set once the proxy answered something that is not a report (an older
 * plugin without the route, the dev mock): the derived numbers are used for
 * the rest of the session instead of asking again on every period switch.
 */
let apiUnavailable = false;

/**
 * Current vs previous period for Oggi and Statistiche.
 *
 * Prefers the server's /performance-report (exact counts over every thread),
 * and falls back to numbers derived from the /dashboard payload, which only
 * carries the latest 100 threads and 200 rows per collection; the derived
 * report flags when that cap cuts into the period (`truncated`).
 */
export function usePeriodReport(data: DashboardData | null, days: PeriodDays): PeriodReport | null {
  const derived = useMemo(() => (data ? deriveReport(data, days) : null), [data, days]);
  const [fromApi, setFromApi] = useState<{ days: PeriodDays; report: PeriodReport } | null>(null);

  useEffect(() => {
    if (!data || apiUnavailable) return;
    let alive = true;
    // Plain GET: the 15s cache in lib/api makes switching back and forth free.
    apiFetch<unknown>(`/performance-report?days=${days}`)
      .then((payload) => {
        const report = reportFromApi(payload, days);
        if (!report) apiUnavailable = true;
        if (alive) setFromApi(report ? { days, report } : null);
      })
      .catch((err) => {
        // No such route on this proxy; any other failure may be transient.
        if (err instanceof ApiRequestError && (err.status === 404 || err.status === 405)) apiUnavailable = true;
        if (alive) setFromApi(null);
      });
    return () => {
      alive = false;
    };
  }, [data, days]);

  if (fromApi && fromApi.days === days) return fromApi.report;
  return derived;
}
