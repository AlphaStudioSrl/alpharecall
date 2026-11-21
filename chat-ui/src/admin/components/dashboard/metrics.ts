/**
 * Numbers for Oggi and Statistiche, derived from what the admin already
 * loads: the /dashboard payload (chat threads, ingestions, analytics, quota)
 * with the conversion collections useDashboard attaches, and, when the
 * proxy offers it, the API's /performance-report.
 *
 * Pure functions, no React: the pages and the tests share them.
 */
import { parseApiDate, toZonedDateKey, getTimezone } from "@/admin/lib/datetime";
import { toNumber } from "@/admin/lib/format";
import type {
  AnalyticsEntry,
  AnalyticsPayload,
  ConversionRow,
  DashboardData,
  DashboardThread,
} from "@/admin/hooks/use-dashboard";

export const DAY_MS = 86_400_000;

/** Thread statuses that mean the assistant handed the chat to a person. */
export const NEEDS_PERSON = new Set(["handoff", "escalated"]);

export type PeriodDays = 7 | 30 | 90;

export interface PeriodMetrics {
  /** Visitor conversations in the period. */
  conversations: number;
  /** Conversations passed to the team. */
  handedOff: number;
  /** E-mail leads. */
  leads: number;
  /** Contact, callback and quote requests. */
  requests: number;
  /** Appointments booked (cancelled ones excluded). */
  visits: number;
  feedbackCount: number;
  feedbackAverage: number | null;
}

export interface SeriesPoint {
  /** "YYYY-MM-DD" in the tenant's zone. */
  date: string;
  conversations: number;
  conversions: number;
  /** Tool calls that day; only the server report has them. */
  tools?: number;
}

export interface PeriodReport {
  days: PeriodDays;
  start: Date;
  end: Date;
  current: PeriodMetrics;
  previous: PeriodMetrics;
  series: SeriesPoint[];
  /**
   * The conversation count is a lower bound: the dashboard payload carries
   * the latest 100 threads and the oldest of them is inside the period.
   */
  truncated: boolean;
  /** "api": the server's performance report; "derived": computed here. */
  source: "api" | "derived";
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

export function timeOf(value: unknown): number | null {
  const d = parseApiDate(value);
  return d ? d.getTime() : null;
}

function within(value: unknown, start: number, end: number): boolean {
  const t = timeOf(value);
  return t !== null && t >= start && t < end;
}

/** Visitor threads only: support threads are the owner talking to AlphaRecall. */
export function visitorThreads(data: DashboardData | null): DashboardThread[] {
  const items = data?.chat_threads?.items ?? [];
  return items.filter((t) => t && t.thread_type !== "support");
}

export function rows(data: DashboardData | null, kind: "leads" | "appointments" | "submissions" | "feedback" | "escalations"): ConversionRow[] {
  const conv = data?.conversions;
  if (!conv) return [];
  const bucket = conv[kind];
  return Array.isArray(bucket?.items) ? bucket.items : [];
}

/** Contact submissions without the escalations useDashboard merges into them. */
export function contactSubmissions(data: DashboardData | null): ConversionRow[] {
  // Same objects in both lists (useDashboard spreads them), so identity is exact.
  const escalations = new Set(rows(data, "escalations"));
  return rows(data, "submissions").filter((s) => !escalations.has(s));
}

export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Below this many in the period before, a percentage is noise: 1 contact
 * then 4 now read "+300%". The change is then given as a count (+3).
 */
export const MIN_PERCENT_BASE = 10;

/** "+12%", or "+3" when the period before had too few to be a base; null when there is nothing to compare. */
export function changeLabel(current: number, previous: number): string | null {
  if (previous <= 0 || current === previous) return null;
  const sign = current > previous ? "+" : "\u2212";
  if (previous < MIN_PERCENT_BASE) return `${sign}${Math.abs(current - previous)}`;
  const pct = percentChange(current, previous)!;
  return pct === 0 ? null : `${sign}${Math.abs(pct)}%`;
}

/** Share of conversations that never needed the team, 0..100, or null without conversations. */
export function withoutYouShare(m: PeriodMetrics): number | null {
  if (m.conversations <= 0) return null;
  const handed = Math.min(m.handedOff, m.conversations);
  return Math.round(((m.conversations - handed) / m.conversations) * 100);
}

export function contacts(m: PeriodMetrics): number {
  return m.leads + m.requests;
}

/** Analytics in either shape, as the daily rows and tool counts the charts read. */
export function analyticsRows(data: DashboardData | null): AnalyticsEntry[] {
  const raw = data?.analytics;
  if (Array.isArray(raw)) return raw;
  const tools = (raw as AnalyticsPayload | undefined)?.summary?.tools;
  if (!tools) return [];
  return Object.entries(tools).map(([tool_name, count]) => ({ tool_name, count: toNumber(count) }));
}

export function messageRatings(data: DashboardData | null): { up: number; down: number } | null {
  const raw = data?.analytics;
  if (!raw || Array.isArray(raw)) return null;
  const r = (raw as AnalyticsPayload).summary?.message_ratings;
  if (!r) return null;
  return { up: toNumber(r.up), down: toNumber(r.down) };
}

/** Open knowledge gaps from the /dashboard summary; null on proxies without it. */
export function knowledgeGapCount(data: DashboardData | null): { open: number; questions: number } | null {
  const raw = data?.analytics;
  if (!raw || Array.isArray(raw)) return null;
  const g = (raw as AnalyticsPayload).summary?.knowledge_gaps;
  if (!g) return null;
  return { open: toNumber(g.open), questions: toNumber(g.questions) };
}

/* ------------------------------------------------------------------ */
/*  Period report                                                      */
/* ------------------------------------------------------------------ */

function emptyMetrics(): PeriodMetrics {
  return { conversations: 0, handedOff: 0, leads: 0, requests: 0, visits: 0, feedbackCount: 0, feedbackAverage: null };
}

function metricsBetween(data: DashboardData | null, start: number, end: number): PeriodMetrics {
  const m = emptyMetrics();
  const threads = visitorThreads(data).filter((t) => within(t.created_at, start, end));
  m.conversations = threads.length;
  const handedThreads = threads.filter((t) => NEEDS_PERSON.has(String(t.status))).length;
  const escalations = rows(data, "escalations").filter((e) => within(e.created_at, start, end)).length;
  m.handedOff = Math.max(handedThreads, escalations);
  m.leads = rows(data, "leads").filter((r) => within(r.created_at, start, end)).length;
  m.requests = contactSubmissions(data).filter((r) => within(r.created_at, start, end)).length;
  m.visits = rows(data, "appointments").filter(
    (r) => within(r.created_at, start, end) && String(r.status ?? "") !== "cancelled"
  ).length;
  const fb = rows(data, "feedback").filter((r) => within(r.created_at, start, end));
  m.feedbackCount = fb.length;
  const rated = fb.map((r) => Number(r.rating)).filter((n) => Number.isFinite(n) && n > 0);
  m.feedbackAverage = rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null;
  return m;
}

/** Calendar days of the period in the tenant's zone, oldest first. */
export function dayKeys(days: number, now = Date.now()): string[] {
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(toZonedDateKey(new Date(now - i * DAY_MS)));
  return keys;
}

function derivedSeries(data: DashboardData | null, days: number, now: number): SeriesPoint[] {
  const keys = dayKeys(days, now);
  const byDay = new Map(keys.map((k) => [k, { date: k, conversations: 0, conversions: 0 }]));
  for (const t of visitorThreads(data)) {
    const p = byDay.get(toZonedDateKey(t.created_at));
    if (p) p.conversations += 1;
  }
  const conversions = [
    ...rows(data, "leads"),
    ...contactSubmissions(data),
    ...rows(data, "appointments").filter((r) => String(r.status ?? "") !== "cancelled"),
  ];
  for (const r of conversions) {
    const p = byDay.get(toZonedDateKey(r.created_at));
    if (p) p.conversions += 1;
  }
  return keys.map((k) => byDay.get(k)!);
}

export function deriveReport(data: DashboardData | null, days: PeriodDays, now = Date.now()): PeriodReport {
  const end = now;
  const start = end - days * DAY_MS;
  const prevStart = start - days * DAY_MS;
  const threads = visitorThreads(data);
  const total = data?.chat_threads?.total ?? threads.length;
  const oldest = threads.reduce<number | null>((min, t) => {
    const at = timeOf(t.created_at);
    return at === null ? min : min === null ? at : Math.min(min, at);
  }, null);
  return {
    days,
    start: new Date(start),
    end: new Date(end),
    current: metricsBetween(data, start, end),
    previous: metricsBetween(data, prevStart, start),
    series: derivedSeries(data, days, now),
    truncated: total > threads.length && oldest !== null && oldest > prevStart,
    source: "derived",
  };
}

/** Shape of GET /performance-report (app/weekly_reports.py::collect_performance_report). */
export interface PerformanceReportPayload {
  period_start?: string;
  period_end?: string;
  period_days?: number;
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
  series?: { date?: string; conversations?: number; conversions?: number; tools?: number }[];
}

function metricsFromApi(raw: Record<string, unknown> | undefined): PeriodMetrics {
  const r = raw ?? {};
  const avg = r.feedback_average;
  return {
    conversations: toNumber(r.conversations),
    // Chats that reached a person (takeover, operator reply or escalation);
    // older APIs only had the escalation rows, which miss every takeover.
    handedOff: toNumber(r.handed_off ?? r.escalations),
    leads: toNumber(r.email_leads),
    requests: toNumber(r.contact_requests),
    visits: toNumber(r.appointments),
    feedbackCount: toNumber(r.feedback_count),
    feedbackAverage: typeof avg === "number" ? avg : null,
  };
}

/** The server report, or null when the payload is not one (older proxy, dev mock). */
export function reportFromApi(payload: unknown, days: PeriodDays, now = Date.now()): PeriodReport | null {
  const p = payload as PerformanceReportPayload | null;
  if (!p || typeof p !== "object" || !p.current || typeof p.current !== "object") return null;
  const start = timeOf(p.period_start) ?? now - days * DAY_MS;
  const end = timeOf(p.period_end) ?? now;
  // The API buckets by the tenant's calendar day, the zone the Dati charts
  // use too. A rolling 7x24h window touches 8 calendar days: keep the last
  // `days`, the same days the range label names, and drop the partial first one.
  const series = (Array.isArray(p.series) ? p.series : [])
    .filter((s) => typeof s?.date === "string")
    .map((s) => ({
      date: String(s.date),
      conversations: toNumber(s.conversations),
      conversions: toNumber(s.conversions),
      ...(s.tools !== undefined ? { tools: toNumber(s.tools) } : {}),
    }))
    .slice(-days);
  return {
    days,
    start: new Date(start),
    end: new Date(end),
    current: metricsFromApi(p.current),
    previous: metricsFromApi(p.previous),
    series,
    truncated: false,
    source: "api",
  };
}

/* ------------------------------------------------------------------ */
/*  Bookings outside opening hours                                     */
/* ------------------------------------------------------------------ */

/** Hour (0-23) and weekday (0 = Sunday) of an instant in the tenant's zone. */
export function zonedHourAndDay(value: unknown): { hour: number; weekday: number } | null {
  const d = parseApiDate(value);
  if (!d) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: getTimezone(),
      hour: "numeric",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(d);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    return Number.isFinite(hour) && weekday >= 0 ? { hour, weekday } : null;
  } catch {
    return null;
  }
}

/** Bookings made in the evening (20:00-08:00) or at the weekend, out of all bookings in the range. */
export function afterHoursBookings(data: DashboardData | null, start: number, end: number): { count: number; total: number } {
  const booked = rows(data, "appointments").filter(
    (r) => within(r.created_at, start, end) && String(r.status ?? "") !== "cancelled"
  );
  let count = 0;
  for (const r of booked) {
    const at = zonedHourAndDay(r.created_at);
    if (at && (at.hour >= 20 || at.hour < 8 || at.weekday === 0 || at.weekday === 6)) count += 1;
  }
  return { count, total: booked.length };
}

export interface ChartBucket {
  /** First and last day ("YYYY-MM-DD") the bar covers; equal for a daily bar. */
  start: string;
  end: string;
  conversations: number;
  conversions: number;
}

/**
 * The bars of the Statistiche chart: one per day up to a month, one per
 * week beyond. Weeks are counted back from the last day, so the last bar
 * always ends today and a short remainder, if any, is the first bar.
 */
export function chartBuckets(series: SeriesPoint[]): { step: 1 | 7; buckets: ChartBucket[] } {
  const step: 1 | 7 = series.length > 31 ? 7 : 1;
  const buckets: ChartBucket[] = [];
  for (let end = series.length; end > 0; end -= step) {
    const slice = series.slice(Math.max(0, end - step), end);
    buckets.unshift({
      start: slice[0].date,
      end: slice[slice.length - 1].date,
      conversations: slice.reduce((a, s) => a + s.conversations, 0),
      conversions: slice.reduce((a, s) => a + s.conversions, 0),
    });
  }
  return { step, buckets };
}
