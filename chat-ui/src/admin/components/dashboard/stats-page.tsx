/**
 * Statistiche: the week (or 30 / 90 days) as a short written report: what
 * happened, what it was worth, what to fix, each insight ending with the
 * action that fixes it. "Dati" keeps every raw chart of the old dashboard
 * for whoever wants the numbers.
 *
 * Numbers come from the server's performance report when the proxy has it,
 * otherwise from the /dashboard payload (see use-period-report.ts). The
 * questions (asked most, left unanswered) come from questions.ts.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle, Bell, Check, ChevronRight, Clock, HelpCircle, Mail, Star, TrendingDown, TrendingUp,
  type LucideIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useApp } from "@/admin/app-context";
import { apiFetch } from "@/admin/lib/api";
import { interpolate, numberArticle } from "@/admin/lib/i18n";
import { formatNumber, toNumber } from "@/admin/lib/format";
import { formatDateKey, formatShortDate, getLocale, toZonedDateKey } from "@/admin/lib/datetime";
import { NavLink, useNavigate, type NavTarget } from "@/admin/lib/nav-context";
import { saveNotificationPreferences, useNotificationPreferences } from "@/admin/lib/notification-preferences";
import { useDashboard, type DashboardData } from "@/admin/hooks/use-dashboard";
import { Bones } from "@/admin/components/shared/bones";
import { Empty, PageHead, Segmented, Tag, Toggle, type Tone } from "@/admin/components/shared/kit";
import { cn } from "@/admin/lib/utils";
import {
  DAY_MS, MIN_PERCENT_BASE, NEEDS_PERSON, afterHoursBookings, changeLabel, chartBuckets, contacts, percentChange, timeOf, visitorThreads, withoutYouShare,
  type ChartBucket, type PeriodDays, type PeriodReport,
} from "./metrics";
import { usePeriodReport } from "./use-period-report";
import { gapFilteredOnly, useKnowledgeGaps, useTopQuestions, type GapList, type TopQuestions } from "./questions";
import { duration, rich } from "./text";
import { ShareReportCard } from "./share-report-card";
import { StatsData } from "./stats-data";
import "./stats.css";

type T = (key: string) => string;
type View = "report" | "data";

/* ────────── headline ────────── */

function plural(t: T, one: string, many: string, count: number): string {
  return count === 1 ? t(one) : interpolate(t(many), { count: formatNumber(count) });
}

/**
 * The report's opening sentence: what the assistant brought in (or handled),
 * then the same number for the period before.
 *
 * "Luca ha gestito 32 conversazioni, rispetto alle 6 gestite nella settimana
 * precedente." Conversations always compare by count (the tile beside it
 * carries the percentage); results switch to a percentage once the period
 * before is a meaningful base. No comparison when the period before has
 * nothing to compare with: zero there reads the same as a site that was not
 * live yet, and a truncated derived report never reaches it.
 */
export function Headline({ t, report, assistant }: { t: T; report: PeriodReport; assistant: string }) {
  const m = report.current;
  const p = report.previous;
  const visits = plural(t, "stats.visitsOne", "stats.visitsMany", m.visits);
  const people = plural(t, "stats.contactsOne", "stats.contactsMany", contacts(m));
  // A truncated count is a lower bound (the tile shows "100+").
  const talks = report.truncated
    ? interpolate(t("stats.conversationsAtLeast"), { count: formatNumber(m.conversations) })
    : plural(t, "stats.conversationsOne", "stats.conversationsMany", m.conversations);
  const results = m.visits + contacts(m);
  const inPrev = t(`stats.prevSame${report.days}`);

  let body: React.ReactNode;
  if (m.visits > 0 && contacts(m) > 0) body = rich(t("stats.headBrought"), { name: assistant, visits, contacts: people }, ["visits"]);
  else if (m.visits > 0) body = rich(t("stats.headBroughtVisits"), { name: assistant, visits }, ["visits"]);
  else if (contacts(m) > 0) body = rich(t("stats.headBroughtContacts"), { name: assistant, contacts: people }, ["contacts"]);
  else if (m.conversations > 0) body = rich(t("stats.headAnswered"), { name: assistant, conversations: talks }, ["conversations"]);
  else return <h2 className="ar-stats-headline">{t("stats.headNothing")}</h2>;

  let tail = ".";
  if (results === 0) {
    // Conversations: always the count ("rispetto alle 6 gestite ...").
    const before = p.conversations;
    if (report.truncated || before <= 0) tail = ".";
    else if (before === m.conversations) tail = interpolate(t("stats.deltaSame"), { prevSame: inPrev });
    else if (before === 1) tail = interpolate(t("stats.vsHandledOne"), { prevSame: inPrev });
    else tail = interpolate(t("stats.vsHandledMany"), { count: formatNumber(before), prevSame: inPrev });
  } else {
    const before = p.visits + contacts(p);
    const pct = percentChange(results, before);
    if (pct !== null && pct !== 0 && before < MIN_PERCENT_BASE) {
      // "il 300% in più" out of 1 then 4: the count says it plainly.
      tail = interpolate(t("stats.deltaVs"), { count: formatNumber(before), prevSame: inPrev });
    } else if (pct !== null) {
      const abs = Math.abs(pct);
      const prev = t(`stats.prev${report.days}`);
      if (pct > 0) tail = interpolate(t("stats.deltaUp"), { pct: abs, il: numberArticle(abs), prev });
      else if (pct < 0) tail = interpolate(t("stats.deltaDown"), { pct: abs, il: numberArticle(abs), prev });
      else tail = interpolate(t("stats.deltaSame"), { prevSame: inPrev });
    }
  }
  return (
    <h2 className="ar-stats-headline">
      {body}
      {tail}
    </h2>
  );
}

/* ────────── tiles ────────── */

function Delta({ t, now, before }: { t: T; now: number; before: number }) {
  const text = changeLabel(now, before);
  if (text === null) return null;
  return (
    <span className={cn("ar-stats-delta", now > before ? "ark-c-accent" : "ark-c-red")} title={interpolate(t("stats.vsPrevious"), { delta: text })}>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{interpolate(t("stats.vsPrevious"), { delta: text })}</span>
    </span>
  );
}

function Tiles({ t, report, bookings }: { t: T; report: PeriodReport; bookings: boolean }) {
  const m = report.current;
  const p = report.previous;
  const share = withoutYouShare(m);
  const tiles: { key: string; value: string; label: string; delta?: [number, number] }[] = [
    { key: "conversations", value: `${formatNumber(m.conversations)}${report.truncated ? "+" : ""}`, label: t("stats.tileConversations"), delta: report.truncated ? undefined : [m.conversations, p.conversations] },
    { key: "share", value: share === null ? "–" : `${share}%`, label: t("stats.tileWithoutYou") },
    { key: "contacts", value: formatNumber(contacts(m)), label: t("stats.tileContacts"), delta: [contacts(m), contacts(p)] },
    // Bookings made in chat, not site visits: "Visite 0" on a site without
    // the booking tool read as broken visit tracking.
    ...(bookings || m.visits > 0 || p.visits > 0
      ? [{ key: "visits", value: formatNumber(m.visits), label: t("stats.tileVisits"), delta: [m.visits, p.visits] as [number, number] }]
      : []),
  ];
  return (
    <dl className={cn("ar-stats-tiles", tiles.length === 3 && "is-three")}>
      {tiles.map((tile) => (
        <div key={tile.key} className="ar-stats-tile">
          <dt>{tile.label}</dt>
          <dd>
            {tile.value}
            {tile.delta && <Delta t={t} now={tile.delta[0]} before={tile.delta[1]} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ────────── insights ────────── */

interface Insight {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  text: string;
  action?: { label: string; to?: NavTarget; params?: Record<string, string>; intent?: string; onClick?: () => void };
}

const quoted = (text: string) => `\u201C${text}\u201D`;

function useInsights(t: T, data: DashboardData, report: PeriodReport, assistant: string, gaps: GapList | null | undefined): Insight[] {
  const prefs = useNotificationPreferences();
  return useMemo(() => {
    const list: Insight[] = [];
    const m = report.current;
    const p = report.previous;
    const now = report.end.getTime();

    // People waiting right now: the most actionable thing on the page.
    const waiting = visitorThreads(data)
      .filter((th) => NEEDS_PERSON.has(String(th.status)))
      .map((th) => timeOf(th.last_visitor_message?.created_at ?? th.last_message_at ?? th.created_at) ?? Date.now());
    if (waiting.length) {
      const oldest = Math.min(...waiting);
      list.push({
        key: "waiting",
        icon: Clock,
        tone: "warn",
        title: waiting.length === 1 ? t("stats.waitingTitleOne") : interpolate(t("stats.waitingTitleMany"), { count: waiting.length }),
        // A chat waiting since before the period is not in its numbers: say
        // so, or "100% senza di te" next to "aspetta da 63 giorni" reads as a contradiction.
        text: interpolate(t(oldest < report.start.getTime() ? "stats.waitingTextOld" : "stats.waitingText"), { time: duration(t, Date.now() - oldest) }),
        action: { label: t("stats.openInbox"), to: "inbox/conversazioni" },
      });
    }

    // Handoffs happen but nobody gets told.
    if (prefs.escalation === false && (waiting.length > 0 || m.handedOff > 0)) {
      list.push({
        key: "notify",
        icon: Bell,
        tone: "warn",
        title: t("stats.notifyOffTitle"),
        text: interpolate(t("stats.notifyOffText"), { name: assistant }),
        action: {
          label: t("stats.notifyOn"),
          onClick: () => {
            saveNotificationPreferences({ escalation: true })
              .then(() => toast.success(t("stats.notifyDone")))
              .catch(() => toast.error(t("stats.notifyFailed")));
          },
        },
      });
    }

    // Bookings made while the practice is closed: what the assistant is worth.
    const late = afterHoursBookings(data, now - report.days * DAY_MS, now);
    if (late.total >= 3 && late.count / late.total >= 0.4) {
      list.push({
        key: "after-hours",
        icon: Check,
        tone: "accent",
        title: t("stats.afterHoursTitle"),
        text: interpolate(t("stats.afterHoursText"), { count: late.count, total: late.total }),
      });
    }

    // A question that keeps coming back without an answer: one FAQ fixes it.
    const top = gaps?.groups[0];
    if (top && top.count >= 2) {
      list.push({
        key: "gap",
        icon: HelpCircle,
        tone: "violet",
        title: t("stats.gapInsightTitle"),
        text: interpolate(t("stats.gapInsightText"), { q: quoted(top.question), count: formatNumber(top.count) }),
        action: { label: t("stats.writeAnswer"), to: "assistente/faq", intent: "add-faq", params: { q: top.question, gap: top.key } },
      });
    } else if (gaps && gaps.questions >= 3) {
      list.push({
        key: "gap",
        icon: HelpCircle,
        tone: "violet",
        title: interpolate(t("stats.gapsManyTitle"), { count: formatNumber(gaps.questions) }),
        text: interpolate(t("stats.gapsManyText"), { name: assistant }),
        action: { label: t("stats.openFaq"), to: "assistente/faq" },
      });
    }

    // How much of the work never reached the team.
    const share = withoutYouShare(m);
    if (share !== null && m.conversations >= 5 && !report.truncated) {
      if (share >= 80) {
        list.push({
          key: "share",
          icon: Check,
          tone: "accent",
          title: interpolate(t("stats.withoutYouTitle"), { pct: share }),
          text: interpolate(t("stats.withoutYouText"), { handled: formatNumber(m.conversations - Math.min(m.handedOff, m.conversations)), total: formatNumber(m.conversations) }),
        });
      } else if (share < 70) {
        list.push({
          key: "share",
          icon: HelpCircle,
          tone: "violet",
          title: interpolate(t("stats.handoffTitle"), { pct: 100 - share }),
          text: interpolate(t("stats.handoffText"), { count: formatNumber(Math.min(m.handedOff, m.conversations)), total: formatNumber(m.conversations) }),
          action: { label: t("stats.openFaq"), to: "assistente/faq" },
        });
      }
    }

    // Contacts moving a lot either way.
    const nowContacts = contacts(m);
    const prevContacts = contacts(p);
    const change = percentChange(nowContacts, prevContacts);
    if (change !== null && prevContacts >= MIN_PERCENT_BASE && Math.abs(change) >= 20) {
      list.push({
        key: "contacts",
        icon: change > 0 ? TrendingUp : TrendingDown,
        tone: change > 0 ? "accent" : "red",
        title: interpolate(t(change > 0 ? "stats.contactsUpTitle" : "stats.contactsDownTitle"), { pct: Math.abs(change), del: numberArticle(Math.abs(change), "del") }),
        text: interpolate(t("stats.contactsText"), { now: formatNumber(nowContacts), prev: formatNumber(prevContacts) }),
        action: change < 0 ? { label: t("stats.reviewTools"), to: "assistente/carattere" } : undefined,
      });
    }

    // What visitors say about it.
    if (m.feedbackAverage !== null && m.feedbackCount >= 3) {
      const avg = m.feedbackAverage.toLocaleString(getLocale(), { maximumFractionDigits: 1 });
      const good = m.feedbackAverage >= 4;
      if (good || m.feedbackAverage < 3.5) {
        list.push({
          key: "feedback",
          icon: good ? Star : AlertCircle,
          tone: good ? "accent" : "red",
          title: interpolate(t(good ? "stats.feedbackGoodTitle" : "stats.feedbackBadTitle"), { avg }),
          text: interpolate(t("stats.feedbackText"), { count: formatNumber(m.feedbackCount) }),
          action: good ? undefined : { label: t("stats.readFeedback"), to: "richieste/elenco", params: { tab: "feedback" } },
        });
      }
    }
    return list;
  }, [t, data, report, assistant, gaps, prefs.escalation]);
}

function Insights({ t, items }: { t: T; items: Insight[] }) {
  if (!items.length) return <p className="ar-stats-quiet">{t("stats.noInsights")}</p>;
  return (
    <ul className="ar-stats-insights" aria-label={t("stats.insightsLabel")}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <li key={item.key}>
            <Icon className={cn("ar-stats-insight-icon", `ark-c-${item.tone}`)} aria-hidden="true" />
            <div className="ar-stats-insight-body">
              <p>
                <b>{item.title}</b> <span>{item.text}</span>
              </p>
              {item.action &&
                (item.action.to ? (
                  <Button asChild size="sm" variant="secondary" className="ar-stats-act">
                    <NavLink to={item.action.to} params={item.action.params} intent={item.action.intent}>{item.action.label}</NavLink>
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="secondary" className="ar-stats-act" onClick={item.action.onClick}>
                    {item.action.label}
                  </Button>
                ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ────────── supporting numbers ────────── */

/** Conversations and results per day (per week over 90 days), as small paired bars. */
export function DayBars({ t, report }: { t: T; report: PeriodReport }) {
  const series = report.series;
  // The legend repeats the tiles: the bars give the shape of the period, the
  // totals are the report's own (a conversation spanning two days is one).
  const total = report.current.conversations;
  const results = contacts(report.current) + report.current.visits;
  // Long periods: one bar per week reads better than 90 hairlines. Weeks
  // end on the period's last day, and each bar names the days it covers.
  const { step, buckets } = chartBuckets(series);
  const span = (b: ChartBucket) =>
    b.start === b.end ? formatDateKey(b.start) : `${formatDateKey(b.start)} – ${formatDateKey(b.end)}`;
  const top = Math.max(1, ...buckets.map((b) => Math.max(b.conversations, b.conversions)));
  // The heading and the chart's accessible name say the same unit.
  const title = t(step === 7 ? "stats.chartTitleWeekly" : "stats.chartTitle");
  return (
    <section className="ar-stats-box" aria-labelledby="ar-stats-days">
      <div className="ar-stats-box-head">
        <h3 id="ar-stats-days">{title}</h3>
        <span className="ar-stats-legend">
          <span className="is-conv">{t("stats.chartConversations")} {formatNumber(total)}</span>
          <span className="is-res">{t("stats.chartConversions")} {formatNumber(results)}</span>
        </span>
      </div>
      <div className="ar-stats-bars" role="img" aria-label={`${title}: ${formatNumber(total)} / ${formatNumber(results)}`}>
        {buckets.map((b) => (
          <div key={b.start} className="ar-stats-bar" title={`${span(b)}: ${b.conversations} · ${b.conversions}`}>
            <i className="is-conv" style={{ height: `${(b.conversations / top) * 100}%` }} />
            <i className="is-res" style={{ height: `${(b.conversions / top) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="ar-stats-axis" aria-hidden="true">
        <span>{buckets[0] ? formatDateKey(buckets[0].start) : ""}</span>
        <span>{buckets.length ? formatDateKey(buckets[buckets.length - 1].end) : ""}</span>
      </div>
    </section>
  );
}

function Results({ t, report, bookings }: { t: T; report: PeriodReport; bookings: boolean }) {
  const m = report.current;
  const rows = [
    ...(bookings || m.visits > 0 || report.previous.visits > 0 ? [{ key: "visits", label: t("stats.resultsVisits"), value: m.visits }] : []),
    { key: "leads", label: t("stats.resultsLeads"), value: m.leads },
    { key: "requests", label: t("stats.resultsRequests"), value: m.requests },
    { key: "feedback", label: t("stats.resultsFeedback"), value: m.feedbackCount },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  const any = rows.some((r) => r.value > 0);
  return (
    <section className="ar-stats-box" aria-labelledby="ar-stats-results">
      <div className="ar-stats-box-head">
        <h3 id="ar-stats-results">{t("stats.resultsTitle")}</h3>
        <NavLink to="richieste/elenco" className="ar-stats-link">
          {t("nav.sections.richieste")}
          <ChevronRight aria-hidden="true" />
        </NavLink>
      </div>
      {any ? (
        <ul className="ar-stats-breakdown">
          {rows.map((r) => (
            <li key={r.key}>
              <span>{r.label}</span>
              <b>{formatNumber(r.value)}</b>
              <i aria-hidden="true"><i style={{ width: `${(r.value / max) * 100}%` }} /></i>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ar-stats-quiet">{t("stats.resultsEmpty")}</p>
      )}
    </section>
  );
}

/**
 * What people talked about: the period's conversation titles, the same
 * topic counted once with how many conversations it had, busiest first.
 */
function Topics({ t, data, report }: { t: T; data: DashboardData; report: PeriodReport }) {
  const start = report.start.getTime();
  const end = report.end.getTime();
  const groups = new Map<string, { title: string; threadId: number; count: number; messages: number; latest: number }>();
  for (const th of visitorThreads(data)) {
    const at = timeOf(th.created_at);
    const title = (th.title || "").trim();
    if (at === null || at < start || at >= end || !title) continue;
    const key = title.toLocaleLowerCase();
    const g = groups.get(key);
    if (!g) groups.set(key, { title, threadId: th.id, count: 1, messages: toNumber(th.message_count), latest: at });
    else {
      g.count += 1;
      g.messages += toNumber(th.message_count);
      // Link the most recent conversation of the topic.
      if (at > g.latest) Object.assign(g, { latest: at, threadId: th.id });
    }
  }
  const topics = [...groups.values()].sort((a, b) => b.count - a.count || b.messages - a.messages).slice(0, 5);
  if (!topics.length) return null;
  return (
    <section className="ar-stats-box" aria-labelledby="ar-stats-topics">
      <div className="ar-stats-box-head">
        <h3 id="ar-stats-topics">{t("stats.topicsTitle")}</h3>
      </div>
      <p className="ar-stats-hint">{t("stats.topicsHint")}</p>
      <ul className="ar-stats-topics">
        {topics.map((g) => (
          <li key={g.threadId}>
            <NavLink to="inbox/conversazioni" params={{ thread: String(g.threadId) }}>
              <span>{g.title}</span>
              <small>
                {g.count > 1
                  ? plural(t, "stats.conversationsOne", "stats.conversationsMany", g.count)
                  : plural(t, "stats.messagesCountOne", "stats.messagesCount", g.messages)}
              </small>
            </NavLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The questions visitors asked most (semantic-cache clusters). Sites without
 * the answer cache have none: the conversation topics stand in there.
 */
function TopQuestionsBox({ t, top, days, data, report }: { t: T; top: TopQuestions | null | undefined; days: number; data: DashboardData; report: PeriodReport }) {
  if (!top?.enabled) return <Topics t={t} data={data} report={report} />;
  const items = top.items.slice(0, 5);
  return (
    <section className="ar-stats-box" aria-labelledby="ar-stats-top">
      <div className="ar-stats-box-head">
        <h3 id="ar-stats-top">{t("stats.topQuestionsTitle")}</h3>
      </div>
      <p className="ar-stats-hint">
        {(top.days ?? days) < days ? interpolate(t("stats.topQuestionsHintLimited"), { days: String(top.days) }) : t("stats.topQuestionsHint")}
      </p>
      {items.length ? (
        <ul className="ar-stats-topics">
          {items.map((q) => (
            <li key={q.question}>
              <div className="ar-stats-topic">
                <span>{q.question}</span>
                <small>{plural(t, "stats.timesCountOne", "stats.timesCount", q.count)}</small>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ar-stats-quiet">{t("stats.topQuestionsEmpty")}</p>
      )}
    </section>
  );
}

const GAPS_SHOWN = 5;

/** What the assistant could not answer, most asked first, each one FAQ away from fixed. */
function Gaps({ t, gaps, assistant }: { t: T; gaps: GapList | null | undefined; assistant: string }) {
  // Older proxies have no gap list; while it loads the box would only flash.
  if (!gaps) return null;
  return (
    <section className="ar-stats-box ark-on-fill" aria-labelledby="ar-stats-gaps">
      <div className="ar-stats-box-head">
        <h3 id="ar-stats-gaps">{t("stats.gapsTitle")}</h3>
        {gaps.questions > GAPS_SHOWN && (
          <NavLink to="assistente/faq" className="ar-stats-link">
            {interpolate(t("stats.gapsAll"), { count: formatNumber(gaps.questions) })}
            <ChevronRight aria-hidden="true" />
          </NavLink>
        )}
      </div>
      {gaps.groups.length ? (
        <>
          <p className="ar-stats-hint">{interpolate(t("stats.gapsHint"), { name: assistant })}</p>
          <ul className="ar-stats-gaps">
            {gaps.groups.slice(0, GAPS_SHOWN).map((g) => {
              const thread = g.conversation_ids[0];
              return (
                <li key={g.key}>
                  <div className="ar-stats-gap-text">
                    <span>{quoted(g.question)}</span>
                    <small>
                      {g.count === 1 ? t("stats.askedOnce") : interpolate(t("stats.askedTimes"), { count: formatNumber(g.count) })}
                      {g.last_seen && ` · ${formatShortDate(g.last_seen)}`}
                      {(g.filtered ?? 0) > 0 && ` · ${t("assistant.gaps.filteredHint")}`}
                      {thread !== undefined && (
                        <>
                          {" · "}
                          <NavLink to="inbox/conversazioni" params={{ thread: String(thread) }}>{t("stats.openChat")}</NavLink>
                        </>
                      )}
                    </small>
                  </div>
                  {gapFilteredOnly(g) ? (
                    <Tag tone="warn" className="ar-stats-act">{t("assistant.gaps.filtered")}</Tag>
                  ) : (
                    <Button asChild size="sm" variant="secondary" className="ar-stats-act">
                      <NavLink to="assistente/faq" intent="add-faq" params={{ q: g.question, gap: g.key }}>{t("stats.writeAnswer")}</NavLink>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="ar-stats-quiet">{interpolate(t("stats.gapsEmpty"), { name: assistant })}</p>
      )}
    </section>
  );
}

/* ────────── weekly e-mail ────────── */

function WeeklyEmail({ t }: { t: T }) {
  const { settings, updateSettings } = useApp();
  const navigate = useNavigate();
  const tenant = (settings.tenant_settings ?? {}) as Record<string, unknown>;
  const [saving, setSaving] = useState(false);
  const enabled = Boolean(tenant.weekly_report_enabled);
  const recipients = String(tenant.weekly_report_recipients ?? "").trim();

  const change = async (on: boolean) => {
    // The API refuses to send without a recipient: collect one where the
    // rest of the report settings live instead of failing here.
    if (on && !recipients) {
      toast(t("stats.emailNeedsRecipient"));
      navigate("impostazioni/notifiche");
      return;
    }
    setSaving(true);
    try {
      const saved = await apiFetch<Record<string, unknown>>("/tenant-settings", {
        method: "POST",
        body: JSON.stringify({ weekly_report_enabled: on }),
      });
      updateSettings({ tenant_settings: saved && typeof saved === "object" ? { ...tenant, ...saved } : { ...tenant, weekly_report_enabled: on } });
      toast.success(t(on ? "stats.emailOn" : "stats.emailOff"));
    } catch {
      toast.error(t("stats.emailFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ar-stats-email">
      <Mail aria-hidden="true" />
      <label htmlFor="ar-stats-weekly">{t("stats.emailToggle")}</label>
      <Toggle id="ar-stats-weekly" checked={enabled} disabled={saving} onCheckedChange={change} />
      <NavLink to="impostazioni/notifiche" className="ar-stats-link">{t("stats.emailManage")}</NavLink>
    </div>
  );
}

/* ────────── page ────────── */

function rangeLabel(report: PeriodReport | null): string {
  if (!report) return "";
  // The calendar days the charts show; a rolling 7x24h window would read as eight.
  const keys = report.series.map((p) => p.date);
  const first = keys[0] ?? toZonedDateKey(report.start.getTime() + DAY_MS);
  const last = keys[keys.length - 1] ?? toZonedDateKey(report.end.getTime() - 60_000);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const from = formatDateKey(first, sameMonth ? { day: "numeric" } : { day: "numeric", month: "long" });
  const to = formatDateKey(last, { day: "numeric", month: "long" });
  return `${from} – ${to}`;
}

export function StatsPage() {
  const { t, settings, isAdmin } = useApp();
  const { data, loading, error, refresh } = useDashboard();
  const [view, setView] = useState<View>("report");
  const [days, setDays] = useState<PeriodDays>(7);
  const report = usePeriodReport(data, days);
  const tenant = (settings.tenant_settings ?? {}) as Record<string, unknown>;
  const assistant = String(tenant.chatbot_name || "").trim() || t("today.assistantFallback");
  const gaps = useKnowledgeGaps(days, 20);
  const top = useTopQuestions(days);
  const insights = useInsights(t, data ?? {}, report ?? emptyReport(days), assistant, gaps);
  // The booking tool is on (or was, and left bookings): only then is "visite" a number to show.
  const bookings = ((tenant.enabled_tools ?? {}) as Record<string, boolean>).appointment !== false;

  const toolbar = (
    <div className="ar-stats-bar-top">
      <Segmented<View>
        aria-label={t("stats.viewLabel")}
        value={view}
        onValueChange={setView}
        options={[
          { value: "report", label: t("stats.report") },
          { value: "data", label: t("stats.data") },
        ]}
      />
      <span className="ar-stats-sp" />
      <span className="ar-stats-range">{rangeLabel(report)}</span>
      <Segmented
        size="sm"
        aria-label={t("stats.periodLabel")}
        value={String(days) as "7" | "30" | "90"}
        onValueChange={(v) => setDays(Number(v) as PeriodDays)}
        options={[
          { value: "7", label: t("stats.period7") },
          { value: "30", label: t("stats.period30") },
          { value: "90", label: t("stats.period90") },
        ]}
      />
      {isAdmin && <ShareReportCard period={days} />}
    </div>
  );

  // The frame's default title would repeat "Statistiche": the report owns its head.
  const head = <PageHead title={t("nav.sections.statistiche")} className="sr-only" />;

  if (loading) {
    return (
      <div className="ar-stats">
        {head}
        {toolbar}
        <Bones name="stats" loading>{null}</Bones>
      </div>
    );
  }

  if (error || !data || !report) {
    return (
      <div className="ar-stats">
        {head}
        {toolbar}
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

  return (
    <div className={cn("ar-stats", view === "data" && "is-data")}>
      {head}
      {toolbar}
      <Bones name="stats" loading={false}>
        {view === "report" ? (
          <article className="ar-stats-report" aria-labelledby="ar-stats-eyebrow">
            <div className="ar-stats-intro">
              <p id="ar-stats-eyebrow" className="ark-lbl">{t(`stats.eyebrow${days}`)}</p>
              <Headline t={t} report={report} assistant={assistant} />
            </div>
            <Tiles t={t} report={report} bookings={bookings} />
            <Insights t={t} items={insights} />
            <DayBars t={t} report={report} />
            <div className="ar-stats-pair">
              <Results t={t} report={report} bookings={bookings} />
              <TopQuestionsBox t={t} top={top} days={days} data={data} report={report} />
            </div>
            <Gaps t={t} gaps={gaps} assistant={assistant} />
            {report.truncated && (
              <p className="ar-stats-note">
                {interpolate(t("stats.lowerBoundNote"), { count: visitorThreads(data).length })}
              </p>
            )}
            {isAdmin && <WeeklyEmail t={t} />}
          </article>
        ) : (
          <StatsData data={data} days={days} report={report} />
        )}
      </Bones>
    </div>
  );
}

function emptyReport(days: PeriodDays): PeriodReport {
  const zero = { conversations: 0, handedOff: 0, leads: 0, requests: 0, visits: 0, feedbackCount: 0, feedbackAverage: null };
  const now = Date.now();
  return { days, start: new Date(now - days * DAY_MS), end: new Date(now), current: zero, previous: zero, series: [], truncated: false, source: "derived" };
}
