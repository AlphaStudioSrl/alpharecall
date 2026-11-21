/**
 * Oggi: what needs a decision today, ranked by urgency, each with the one
 * button that does the job; the week's results sit quietly to the side.
 *
 * Every row comes from real data (threads waiting for a person,
 * appointments still "scheduled", unread requests, questions the
 * assistant could not answer, plan and sync state, the Google Calendar
 * connection). Nothing waiting means a calm empty state,
 * never placeholder rows. The full report lives in Statistiche.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, AlertTriangle, Calendar, CheckCircle2, FileText, HelpCircle, Plug, Plus, RefreshCw, User, Users,
  type LucideIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/admin/lib/utils";
import { apiFetch } from "@/admin/lib/api";
import { useApp } from "@/admin/app-context";
import { getConfig } from "@/admin/lib/config";
import { interpolate, numberArticle, plural } from "@/admin/lib/i18n";
import { formatNumber, toNumber } from "@/admin/lib/format";
import { CHAT_INBOX_CHANGED } from "@/admin/lib/chat-inbox";
import { usePoll } from "@/admin/lib/poll";
import { NavLink, type NavTarget } from "@/admin/lib/nav-context";
import { ingestionFinished, ingestionPages, ingestionStarted, useDashboard, type DashboardData, type DashboardThread, type ConversionRow } from "@/admin/hooks/use-dashboard";
import { Bones } from "@/admin/components/shared/bones";
import { Empty, PageHead, ProgressBar, Segmented, Feed, type Tone } from "@/admin/components/shared/kit";
import type { GoogleCalendarConnection } from "@/admin/components/integrations/google-calendar-setup";
import { formatLongDate, formatShortDate, formatTime, getLocale, getTimezone, parseApiDate } from "@/admin/lib/datetime";
import {
  NEEDS_PERSON, contactSubmissions, contacts, knowledgeGapCount, rows, timeOf, visitorThreads, withoutYouShare,
  type PeriodReport,
} from "./metrics";
import { appointmentDate, columnFor, defaultStatus, newTotal, submissionKind, waitingKinds, type RequestKind } from "@/admin/components/conversions/request-model";
import { ALL_COLLECTIONS, useVisibleCollections } from "@/admin/components/conversions/collections";
import type { ConversionCollection } from "@/admin/hooks/use-conversions-data";
import type { AppointmentRecord } from "@/admin/hooks/use-conversions-data";
import { usePeriodReport } from "./use-period-report";
import { answerableGapQuestions, useKnowledgeGaps } from "./questions";
import { Sparkline } from "./sparkline";
import { countWord, duration, feedTime, firstName, rich } from "./text";
import "./today.css";
import { personName } from "@/admin/lib/record-fields";
import { anonymousVisitorLabel } from "@/admin/components/conversations/inbox-format";

type T = (key: string) => string;

/* ────────── provisioning state ────────── */

/**
 * Shown while the site has no tenant yet. This used to fall through to the
 * bare "dashboard not ready" card, which gave the admin no cause and no way
 * forward -- the single most confusing thing a new client could land on.
 */
function ProvisioningCard() {
  const { t, settings, updateSettings } = useApp();
  const [retrying, setRetrying] = useState(false);
  const [lastError, setLastError] = useState<string>(settings.bootstrap_last_error || "");

  const retry = async () => {
    setRetrying(true);
    try {
      const res = await apiFetch<{ tenant_id?: string; error?: string }>("/bootstrap", {
        method: "POST",
      });
      if (res?.tenant_id) {
        updateSettings({
          tenant_id: res.tenant_id,
          pending_bootstrap: false,
          bootstrap_last_error: "",
        });
        window.location.reload();
        return;
      }
      setLastError(res?.error || t("messages.provisioningFailed"));
    } catch (e) {
      setLastError(e instanceof Error ? e.message : t("messages.provisioningFailed"));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Empty
      icon={Plug}
      title={t("messages.provisioningTitle")}
      description={
        <>
          {t("messages.provisioningHint")}
          {lastError && <span className="ar-today-error">{lastError}</span>}
        </>
      }
      action={
        <Button type="button" variant="secondary" onClick={retry} disabled={retrying}>
          {retrying ? t("messages.provisioningRetrying") : t("buttons.retryConnection")}
        </Button>
      }
    />
  );
}

/* ────────── decisions ────────── */

interface Decision {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  title: React.ReactNode;
  detail?: React.ReactNode;
  action: string;
  /** Where the button goes: every decision is solved on another page. */
  to: NavTarget;
  params?: Record<string, string>;
  intent?: string;
  /** Setup steps rank last and never take the highlight. */
  setup?: boolean;
  /** How many things the row stands for ("3 richieste" is three); default 1. */
  count?: number;
  /** Announced to screen readers when it appears (the chat being off). */
  alert?: boolean;
}

/** The things waiting for the owner behind the rows; optional setup steps are not among them. */
export function waitingCount(items: Decision[]): number {
  return items.reduce((sum, item) => sum + (item.setup ? 0 : item.count ?? 1), 0);
}

function visitorName(t: T, thread: { visitor?: { id?: number | null; display_name?: string | null; name?: string | null; email?: string | null } | null }): string {
  const v = thread.visitor;
  // The same "Visitatore <id>" the inbox shows for this person (inbox-format).
  return personName(v?.display_name) || personName(v?.name) || v?.email
    || (Number(v?.id) > 0 ? anonymousVisitorLabel(v?.id, t) : t("today.visitor"));
}

function rowName(row: ConversionRow): string {
  const info = (row.user_info ?? {}) as Record<string, unknown>;
  const extra = (row.extra ?? {}) as Record<string, unknown>;
  return personName(row.name) || personName(info.name) || personName(extra.name) || String(row.email || info.email || "").trim();
}

/** "gio 9:00": the day and time a booking is for, in the tenant's zone. */
function slotLabel(value: unknown): string {
  const d = parseApiDate(value);
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      timeZone: getTimezone(),
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return formatShortDate(d);
  }
}
export function buildDecisions({
  t, data, assistant, chatOff, calendar, now, threads, gapQuestions, collections = ALL_COLLECTIONS,
}: {
  t: T;
  data: DashboardData;
  /** The collections whose tools are on, as Richieste shows them. */
  collections?: ConversionCollection[];
  /** The inbox's own thread list when loaded (same request as the Inbox count). */
  threads?: DashboardThread[] | null;
  /** The most asked unanswered questions, when loaded; the row works without them. */
  gapQuestions?: string[] | null;
  assistant: string;
  chatOff: "trial" | "quota" | null;
  calendar: GoogleCalendarConnection | null | undefined;
  now: number;
}): Decision[] {
  const items: Decision[] = [];
  const plan = "impostazioni/piano";

  // 1. The chat is off on the site: nothing else matters until it is back.
  if (chatOff) {
    items.push({
      key: "chat-off",
      icon: AlertCircle,
      tone: "red",
      title: t("today.chatOffTitle"),
      detail: chatOff === "trial" ? t("today.chatOffTrial") : t("today.chatOffQuota"),
      action: t("dashboard.chatDisabledCta"),
      to: plan,
      alert: true,
    });
  }

  // 2. People waiting for a person, oldest first.
  const waiting = (threads ? threads.filter((th) => th.thread_type !== "support") : visitorThreads(data))
    .filter((th) => NEEDS_PERSON.has(String(th.status)))
    .map((th) => ({ th, since: timeOf(th.last_visitor_message?.created_at ?? th.last_message_at ?? th.created_at) ?? now }))
    .sort((a, b) => a.since - b.since);
  const shown = waiting.length > 3 ? waiting.slice(0, 2) : waiting;
  for (const { th, since } of shown) {
    const topic = th.title?.trim();
    const wait = interpolate(t("today.waiting"), { time: duration(t, now - since) });
    items.push({
      key: `thread-${th.id}`,
      icon: User,
      tone: "warn",
      title: interpolate(t("today.handoffTitle"), { name: visitorName(t, th) }),
      detail: topic ? `${topic} · ${wait}` : wait,
      action: t("today.openChat"),
      to: "inbox/conversazioni",
      params: { thread: String(th.id) },
    });
  }
  if (waiting.length > shown.length) {
    const rest = waiting.slice(shown.length);
    items.push({
      key: "threads-more",
      icon: Users,
      tone: "warn",
      title: plural(t, "today.handoffMoreTitleOne", "today.handoffMoreTitle", rest.length),
      count: rest.length,
      detail: rest.slice(0, 3).map(({ th }) => visitorName(t, th)).join(" · "),
      action: t("today.openInbox"),
      to: "inbox/conversazioni",
    });
  }

  // 3. Bookings still waiting for the practice's confirmation: Agenda's
  // "Da confermare" rule (status scheduled, a known time still ahead).
  const toConfirm = rows(data, "appointments")
    .map((r) => ({ r, when: appointmentDate(r as unknown as AppointmentRecord) }))
    .filter(({ r, when }) => String(r.status || "scheduled") === "scheduled" && when !== null && when.getTime() >= now)
    .sort((a, b) => a.when!.getTime() - b.when!.getTime());
  if (toConfirm.length) {
    const one = toConfirm.length === 1;
    items.push({
      key: "appointments",
      icon: Calendar,
      tone: "info",
      title: one ? t("today.apptOne") : interpolate(t("today.apptMany"), { count: toConfirm.length }),
      count: toConfirm.length,
      detail: toConfirm
        .slice(0, 3)
        .map(({ r, when }) => [rowName(r), slotLabel(when)].filter(Boolean).join(" "))
        .join(" · "),
      action: t("today.confirm"),
      to: "richieste/agenda",
      params: one && toConfirm[0].r.id !== undefined ? { item: String(toConfirm[0].r.id) } : undefined,
    });
  }

  // 4. New requests: Richieste's Nuove column (waitingKinds, newTotal) without
  // the bookings, which have the row above. Contact, quote and call-back
  // requests nobody opened, escalations not resolved, feedback not read.
  const kinds: RequestKind[] = waitingKinds(collections).filter((k) => k !== "appointment");
  const fresh = [
    ...contactSubmissions(data).map((r) => ({ r, kind: submissionKind(String(r.type ?? "")) })),
    ...rows(data, "escalations").map((r) => ({ r, kind: "escalation" as RequestKind })),
    ...rows(data, "feedback").map((r) => ({ r, kind: "feedback" as RequestKind })),
  ]
    .filter(({ r, kind }) => kinds.includes(kind) && columnFor(kind, String(r.status || defaultStatus(kind))) === "new")
    .sort((a, b) => (timeOf(b.r.created_at) ?? 0) - (timeOf(a.r.created_at) ?? 0));
  // How many wait over the whole collections; the rows fetched name a few of them.
  const counted = data.conversions?.counts ? newTotal(data.conversions.counts, kinds) : null;
  const unreadTotal = Math.max(counted ?? fresh.length, fresh.length);
  const tabOf = (kind: RequestKind) => (kind === "feedback" ? "feedback" : "submissions");
  if (unreadTotal === 1 && fresh.length === 1) {
    const { r, kind } = fresh[0];
    const titleKey = kind === "feedback" || kind === "escalation" ? `today.request_${kind}` : `today.request_${String(r.type ?? r.inquiry_type ?? "inquiry")}`;
    const title = t(titleKey) === titleKey ? t("today.request_inquiry") : t(titleKey);
    const about = String(r.service_description || r.subject || r.message || r.comment || r.issue || "").trim();
    items.push({
      key: `request-${r.id}`,
      icon: FileText,
      tone: "accent",
      title,
      detail: [kind === "escalation" ? "" : rowName(r), about].filter(Boolean).join(" · "),
      action: t("today.reply"),
      to: "richieste/elenco",
      // An escalation's id can equal a submission's: Richieste then opens the submission, so no item.
      params: { tab: tabOf(kind), ...(r.id !== undefined && kind !== "escalation" ? { item: String(r.id) } : {}) },
    });
  } else if (unreadTotal > 0) {
    items.push({
      key: "requests",
      icon: FileText,
      tone: "accent",
      // One request older than the rows fetched: named generically.
      title: unreadTotal === 1 ? t("today.requestsOne") : interpolate(t("today.requestsMany"), { count: unreadTotal }),
      count: unreadTotal,
      detail: fresh.slice(0, 3).map(({ r }) => rowName(r)).filter(Boolean).join(" · "),
      action: t("today.open"),
      to: "richieste/elenco",
    });
  }

  // 4b. Questions the assistant could not answer: an FAQ fixes them for good.
  const gaps = knowledgeGapCount(data);
  if (gaps && gaps.open > 0) {
    const asked = (gapQuestions ?? []).slice(0, 2).map((q) => `\u201C${q}\u201D`);
    items.push({
      key: "gaps",
      icon: HelpCircle,
      tone: "violet",
      title: gaps.open === 1
        ? interpolate(t("today.gapsTitleOne"), { name: assistant })
        : interpolate(t("today.gapsTitleMany"), { name: assistant, count: gaps.open }),
      detail: asked.length
        ? asked.join(" · ")
        : gaps.questions > 1
          ? interpolate(t("today.gapsDetailMany"), { count: gaps.questions })
          : t("today.gapsDetailOne"),
      action: t("today.gapsAction"),
      to: "assistente/faq",
      count: Math.max(1, gaps.questions),
    });
  }

  // 5. The plan is about to run out (only when the chat is still on).
  const quota = data.quota ?? {};
  const used = toNumber(quota.monthly_used ?? quota.messages_used);
  const limit = toNumber(quota.monthly_allowance ?? quota.messages_limit);
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  if (!chatOff && limit > 0 && pct >= 80) {
    items.push({
      key: "quota",
      icon: AlertTriangle,
      tone: "warn",
      title: interpolate(t("today.quotaTitle"), { pct: Math.min(pct, 100), il: numberArticle(Math.min(pct, 100)) }),
      detail: interpolate(t("today.quotaDetail"), { used: plain(used), limit: plain(limit) }),
      action: t("today.seePlan"),
      to: plan,
    });
  }

  // 6. Site content: never synced, or the last sync failed.
  const runs = Array.isArray(data.ingestions) ? data.ingestions : [];
  const latest = [...runs].sort((a, b) => (timeOf(ingestionStarted(b)) ?? 0) - (timeOf(ingestionStarted(a)) ?? 0))[0];
  const sync = { to: "assistente/contenuti", intent: "sync" } as const;
  if (latest && /fail|error/i.test(String(latest.status ?? ""))) {
    items.push({
      key: "sync-failed",
      icon: RefreshCw,
      tone: "red",
      title: t("today.syncFailedTitle"),
      detail: interpolate(t("today.syncFailedDetail"), { name: assistant }),
      action: t("today.retry"),
      ...sync,
    });
  } else if (!runs.length) {
    items.push({
      key: "sync-first",
      icon: Plus,
      tone: "mute",
      title: t("today.syncFirstTitle"),
      detail: interpolate(t("today.syncFirstDetail"), { name: assistant }),
      action: t("today.sync"),
      ...sync,
      setup: true,
    });
  }

  // 7. Google Calendar, only where the booking tool is on.
  if (calendar !== undefined) {
    const openCalendar = { to: "assistente/carattere", intent: "google-calendar" } as const;
    // Not where AlphaRecall cannot connect a calendar yet (no Google OAuth
    // client): the button would only say it is not available.
    if (!calendar?.connected && calendar?.oauth_ready !== false) {
      items.push({
        key: "calendar",
        icon: Plus,
        tone: "mute",
        title: t("today.calendarTitle"),
        detail: t("today.calendarDetail"),
        action: t("today.connect"),
        ...openCalendar,
        setup: true,
      });
    } else if (calendar?.connected && calendar.error_code) {
      items.push({
        key: "calendar-problem",
        icon: Calendar,
        tone: "red",
        title: t("today.calendarProblemTitle"),
        detail: t("today.calendarProblemDetail"),
        action: t("today.reconnect"),
        ...openCalendar,
      });
    }
  }

  return [...items.filter((i) => !i.setup), ...items.filter((i) => i.setup)];
}

/**
 * The inbox's thread list, for the to-do rows. The /dashboard payload already
 * carries the newest threads: asking /chat-threads too on every visit was a
 * second request (a whole WordPress boot) for the same rows. It is asked only
 * when /dashboard has no `chat_threads` (an older proxy), and on a live
 * refresh (a chat changed, the tab came back), where the proxy's 15s copy of
 * /dashboard could still list a chat someone just took over.
 */
function useInboxThreads(nonce: number, needed: boolean): DashboardThread[] | null {
  const [threads, setThreads] = useState<DashboardThread[] | null>(null);
  useEffect(() => {
    if (!nonce && !needed) return;
    let alive = true;
    apiFetch<unknown>("/chat-threads?limit=200", nonce ? { cache: "reload" } : {})
      .then((res) => {
        const items = Array.isArray(res) ? res : (res as { items?: unknown } | null)?.items;
        if (alive && Array.isArray(items)) setThreads(items as DashboardThread[]);
      })
      .catch(() => { /* keep the dashboard payload's threads */ });
    return () => {
      alive = false;
    };
  }, [nonce, needed]);
  return threads;
}

/** Google Calendar state, or undefined when the booking tool is off (no row then). */
function useCalendarConnection(enabled: boolean): GoogleCalendarConnection | null | undefined {
  const [connection, setConnection] = useState<GoogleCalendarConnection | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      setConnection(undefined);
      return;
    }
    let alive = true;
    apiFetch<GoogleCalendarConnection>("/integrations/google-calendar")
      .then((c) => alive && setConnection(c && typeof c === "object" ? c : null))
      // Unknown state: say nothing rather than nag about a connection that may exist.
      .catch(() => alive && setConnection(undefined));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return connection;
}

function DecisionList({ items, t, assistant }: { items: Decision[]; t: T; assistant: string }) {
  if (!items.length) {
    return (
      <div className="ar-today-list" data-tour="dashboard-metric-tabs">
        <Empty
          className="ar-today-empty"
          icon={CheckCircle2}
          title={t("today.emptyTitle")}
          description={interpolate(t("today.emptyDesc"), { name: assistant })}
        />
      </div>
    );
  }
  const highlight = items[0] && !items[0].setup ? items[0].key : null;
  return (
    <ul className="ar-today-list" aria-label={t("today.listLabel")} data-tour="dashboard-metric-tabs">
      {items.map((item) => {
        const on = item.key === highlight;
        const Icon = item.icon;
        return (
          <li key={item.key} className={cn("ar-today-item", on && "is-on ark-on-fill", item.setup && "is-setup")}>
            <Icon className={cn("ar-today-icon", `ark-c-${item.tone}`)} aria-hidden="true" />
            <div className="ar-today-text" role={item.alert ? "alert" : undefined}>
              <b>{item.title}</b>
              {item.detail && <small>{item.detail}</small>}
            </div>
            <Button asChild size="sm" variant={on ? "default" : item.setup ? "ghost" : "secondary"} className="ar-today-act">
              <NavLink to={item.to} params={item.params} intent={item.intent}>
                {item.action}
              </NavLink>
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/* ────────── the week box ────────── */

function WeekBox({ t, report, range, setRange }: {
  t: T;
  report: PeriodReport | null;
  range: "7" | "30";
  setRange: (r: "7" | "30") => void;
}) {
  const m = report?.current;
  const share = m ? withoutYouShare(m) : null;
  const lower = report?.truncated ? "+" : "";
  const values = (report?.series ?? []).map((p) => p.conversations);
  // The spoken total is the KPI's, not the sum of daily buckets.
  const total = m?.conversations ?? 0;
  return (
    <section className="ar-today-week ark-on-fill" data-tour="dashboard-chart" aria-labelledby="ar-today-week-title">
      <div className="ar-today-week-head">
        <h2 id="ar-today-week-title">{range === "7" ? t("today.week") : t("today.month")}</h2>
        <Segmented
          size="sm"
          className="ar-today-mini"
          aria-label={t("today.rangeLabel")}
          value={range}
          onValueChange={setRange}
          options={[
            { value: "7", label: t("today.range7") },
            { value: "30", label: t("today.range30") },
          ]}
        />
      </div>
      <dl className="ar-today-kpis">
        <div title={report?.truncated ? interpolate(t("today.lowerBound"), { count: formatNumber(m?.conversations ?? 0) }) : undefined}>
          <dt>{t("today.kpiConversations")}</dt>
          <dd>{formatNumber(m?.conversations ?? 0)}{lower}</dd>
        </div>
        <div>
          <dt>{t("today.kpiWithoutYou")}</dt>
          <dd>{share === null ? "–" : `${share}%`}</dd>
        </div>
        <div>
          <dt>{t("today.kpiContacts")}</dt>
          <dd>{formatNumber(m ? contacts(m) : 0)}</dd>
        </div>
        <div>
          <dt>{t("today.kpiVisits")}</dt>
          <dd>{formatNumber(m?.visits ?? 0)}</dd>
        </div>
      </dl>
      <Sparkline
        values={values}
        label={interpolate(t("today.sparkLabel"), { days: range, total })}
        className="ar-today-spark"
      />
    </section>
  );
}

/* ────────── plan usage ────────── */

/** "1.284", not "1.3K": a quota is read as an exact count. */
function plain(n: number): string {
  return formatNumber(n);
}

function UsageLine({ t, data }: { t: T; data: DashboardData }) {
  const quota = data.quota ?? {};
  const used = toNumber(quota.monthly_used ?? quota.messages_used);
  const limit = toNumber(quota.monthly_allowance ?? quota.messages_limit);
  if (limit <= 0) return null;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const plan = String(quota.license_tier || quota.plan || "");
  const planKey = `plans.${plan}`;
  const planLabel = plan ? (t(planKey) === planKey ? plan : t(planKey)) : "";
  return (
    <div className="ar-today-usage" data-tour="dashboard-usage">
      <div className="ar-today-usage-row">
        <span>{interpolate(t("today.usage"), { used: plain(used), limit: plain(limit) })}</span>
        <NavLink to="impostazioni/piano" className="ar-today-usage-link">
          {planLabel ? interpolate(t("today.usagePlan"), { plan: planLabel }) : t("today.seePlan")}
        </NavLink>
      </div>
      <ProgressBar value={pct} tone={pct >= 80 ? "ink" : "accent"} label={t("dashboard.messageUsage")} />
    </div>
  );
}

/* ────────── recent activity ────────── */

function useFeed(t: T, data: DashboardData, assistant: string, now: number) {
  return useMemo(() => {
    const events: { key: string; at: number; content: React.ReactNode }[] = [];
    const push = (key: string, at: number | null, content: React.ReactNode) => {
      if (at !== null && at <= now + 60_000) events.push({ key, at, content });
    };
    for (const r of rows(data, "appointments")) {
      if (String(r.status ?? "") === "cancelled") continue;
      push(`a-${r.id}`, timeOf(r.created_at), rich(t("today.feedBooked"), { assistant, name: rowName(r) || t("today.someone") }, ["name"]));
    }
    for (const r of rows(data, "leads")) {
      push(`l-${r.id}`, timeOf(r.created_at), rich(t("today.feedLead"), { name: rowName(r) || t("today.someone") }, ["name"]));
    }
    for (const r of contactSubmissions(data)) {
      push(`s-${r.id}`, timeOf(r.created_at), rich(t("today.feedRequest"), { name: rowName(r) || t("today.someone") }, ["name"]));
    }
    for (const r of rows(data, "feedback")) {
      const rating = Number(r.rating);
      const key = !Number.isFinite(rating) || rating <= 0 ? "today.feedFeedback" : rating >= 4 ? "today.feedFeedbackGood" : rating <= 2 ? "today.feedFeedbackBad" : "today.feedFeedback";
      push(`f-${r.id}`, timeOf(r.created_at), rich(t(key), { name: rowName(r) || t("today.someone") }, ["name"]));
    }
    for (const th of visitorThreads(data)) {
      if (!NEEDS_PERSON.has(String(th.status))) continue;
      push(`h-${th.id}`, timeOf(th.last_visitor_message?.created_at ?? th.last_message_at), rich(t("today.feedHandoff"), { name: visitorName(t, th) }, ["name"]));
    }
    for (const run of Array.isArray(data.ingestions) ? data.ingestions : []) {
      const status = String(run.status ?? "");
      if (/complete|success|done/i.test(status)) {
        push(`i-${run.id}`, timeOf(ingestionFinished(run)), plural(t, "today.feedSyncedOne", "today.feedSynced", ingestionPages(run), { count: formatNumber(ingestionPages(run)) }));
      } else if (/fail|error/i.test(status)) {
        push(`i-${run.id}`, timeOf(ingestionFinished(run)), t("today.feedSyncFailed"));
      }
    }
    return events
      .sort((a, b) => b.at - a.at)
      .slice(0, 6)
      .map((e) => ({ key: e.key, time: feedTime(t, e.at, now), content: e.content }));
  }, [t, data, assistant, now]);
}

function RecentActivity({ t, data, assistant, now }: { t: T; data: DashboardData; assistant: string; now: number }) {
  const items = useFeed(t, data, assistant, now);
  return (
    <section className="ar-today-recent" data-tour="dashboard-recent" aria-labelledby="ar-today-recent-title">
      <h2 id="ar-today-recent-title" className="ark-lbl">{t("today.recent")}</h2>
      {items.length ? <Feed items={items} /> : <p className="ar-today-quiet">{t("today.recentEmpty")}</p>}
    </section>
  );
}

/* ────────── page ────────── */

function greetingWord(t: T, now: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: getTimezone() }).format(now)
  );
  if (hour >= 5 && hour < 13) return t("today.morning");
  if (hour >= 13 && hour < 18) return t("today.afternoon");
  return t("today.evening");
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;
}

function chatDisabledReason(data: DashboardData | null): "trial" | "quota" | null {
  // PHP decides whether the widget is served from the cached plan; read that
  // same verdict so this row never contradicts the site. Older PHP without
  // the key falls back to what the quota numbers imply.
  const gate = getConfig();
  const quota = data?.quota ?? {};
  const remaining = quota.messages_remaining;
  if (typeof gate.chatAvailable === "boolean") {
    if (gate.chatAvailable) return null;
    return gate.chatUnavailableReason === "quota_exhausted" ? "quota" : "trial";
  }
  if (quota.trial_expired) return "trial";
  if (typeof remaining === "number" && remaining <= 0) return "quota";
  return null;
}

export function DashboardPage() {
  const { t, settings, currentUser } = useApp();
  const { data: payload, loading, error, stale, updatedAt, refresh } = useDashboard();
  const [liveNonce, setLiveNonce] = useState(0);
  const inboxThreads = useInboxThreads(liveNonce, Boolean(payload) && !payload?.chat_threads);
  // Older proxies send /dashboard without chat_threads: the inbox list stands in.
  const data = useMemo(
    () =>
      payload && inboxThreads && !payload.chat_threads?.items?.length
        ? { ...payload, chat_threads: { total: inboxThreads.length, items: inboxThreads } }
        : payload,
    [payload, inboxThreads]
  );
  const [range, setRange] = useState<"7" | "30">("7");
  const report = usePeriodReport(data, range === "7" ? 7 : 30);
  const weekReport = usePeriodReport(data, 7);
  const tenant = (settings.tenant_settings ?? {}) as Record<string, unknown>;
  const assistant = String(tenant.chatbot_name || "").trim() || t("today.assistantFallback");
  const tools = (tenant.enabled_tools ?? {}) as Record<string, boolean>;
  const calendar = useCalendarConnection(Boolean(settings.tenant_id) && tools.appointment !== false);
  const collections = useVisibleCollections();
  const [now, setNow] = useState(() => Date.now());

  // The list is a to-do: bring it up to date when someone comes back to the
  // tab or a chat changes elsewhere, past the 15s cache (`refresh(true)`).
  // No timer of its own: the poller only debounces those triggers (several
  // chats read in a row are one refresh) and skips a return within 15s.
  const live = usePoll(() => {
    setNow(Date.now());
    setLiveNonce((n) => n + 1);
    refresh(true);
  }, { intervalMs: Infinity, immediate: false, staleMs: 15000, debounceMs: 1000 });
  useEffect(() => {
    const changed = () => live.refresh();
    window.addEventListener(CHAT_INBOX_CHANGED, changed);
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.removeEventListener(CHAT_INBOX_CHANGED, changed);
      window.clearInterval(tick);
    };
  }, [live]);

  // The summary counts every open gap; the sample covers the longest window the API serves.
  // Questions the safety filter refused every time are not FAQ work (the
  // summary counts them apart too): a few extra rows keep two quotable ones.
  const gapList = useKnowledgeGaps((knowledgeGapCount(data)?.open ?? 0) > 0 ? 365 : null, 6, liveNonce);
  const gapQuestions = useMemo(() => answerableGapQuestions(gapList), [gapList]);

  const decisions = useMemo(
    () => (data ? buildDecisions({ t, data, threads: inboxThreads, gapQuestions, assistant, chatOff: chatDisabledReason(data), calendar, now, collections }) : []),
    [t, data, inboxThreads, gapQuestions, assistant, calendar, now, collections]
  );

  const today = new Date(now);
  const name = firstName(currentUser?.name);
  const word = greetingWord(t, today);
  const greeting = name ? `${word}, ${name}.` : `${word}.`;
  const eyebrow = capitalize(formatLongDate(today).replace(/\s\d{4}$/, ""));

  // Sentence under the greeting: what waits, and what the assistant handled.
  const week = weekReport?.current;
  const handled = week ? Math.max(0, week.conversations - Math.min(week.handedOff, week.conversations)) : 0;
  const waiting = waitingCount(decisions);
  const waitingText =
    waiting === 0
      ? t("today.summaryNone")
      : waiting === 1
        ? t("today.summaryOne")
        : interpolate(t("today.summaryMany"), { count: countWord(t, waiting) });
  // What the assistant did this week, on its own: "Le altre 2 conversazioni
  // della settimana" next to a to-do of chats and requests from weeks ago
  // read as if those were the week's other conversations.
  let handledText = "";
  if (handled > 0) {
    handledText = capitalize(handled === 1
      ? interpolate(t("today.handledAllOne"), { name: assistant })
      : interpolate(t("today.handledAll"), { name: assistant, count: formatNumber(handled) }));
  }
  const subtitle = data ? [waitingText, handledText].filter(Boolean).join(" ") : undefined;

  const head = <PageHead eyebrow={eyebrow} title={greeting} subtitle={subtitle} size="lg" className="ar-today-hello" />;

  // Replays the bones captured from the loaded tree below (same names).
  if (loading) {
    return (
      <div className="ar-today ar-today-grid">
        <div className="ar-today-main">
          {head}
          <Bones name="dashboard" loading>{null}</Bones>
        </div>
        <Bones name="dashboard-side" loading>{null}</Bones>
      </div>
    );
  }

  // No tenant yet: explain it and offer a retry rather than an empty card.
  if (!settings.tenant_id) return <ProvisioningCard />;

  if (error || !data) {
    return (
      <div className="ar-today">
        {head}
        <Empty
          icon={AlertCircle}
          title={error ? t("toast.genericError") : t("messages.dashboardNotReady")}
          description={error || undefined}
          action={
            error ? (
              <Button type="button" variant="secondary" onClick={() => refresh(true)}>
                {t("buttons.retryConnection")}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  // This is the tree `npm run bones` measures. The greeting sits outside it
  // so it is on screen, not boned, while the data loads.
  return (
    <div className="ar-today ar-today-grid">
      <div className="ar-today-main">
        {head}
        {stale && (
          <p className="ar-today-stale" role="status">
            {interpolate(t("today.staleNote"), { time: updatedAt ? formatTime(new Date(updatedAt)) : "" })}{" "}
            <button type="button" onClick={() => refresh(true)}>{t("today.staleRetry")}</button>
          </p>
        )}
        <Bones name="dashboard" loading={false}>
          <DecisionList items={decisions} t={t} assistant={assistant} />
        </Bones>
      </div>
      <Bones name="dashboard-side" loading={false}>
        <aside className="ar-today-side">
          <WeekBox t={t} report={report} range={range} setRange={setRange} />
          <UsageLine t={t} data={data} />
          <RecentActivity t={t} data={data} assistant={assistant} now={now} />
        </aside>
      </Bones>
    </div>
  );
}

