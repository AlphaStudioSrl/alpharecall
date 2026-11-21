import { useCallback } from "react";
import { useApp } from "@/admin/app-context";
import { formatNumber } from "@/admin/lib/format";
import { NavLink } from "@/admin/lib/nav-context";
import type { DashboardData } from "@/admin/hooks/use-dashboard";
import { analyticsRows, timeOf, visitorThreads, type PeriodDays, type PeriodReport } from "./metrics";
import { KpiCards } from "./kpi-cards";
import { MetricChart } from "./metric-chart";
import { DailyConversationsChart } from "./daily-conversations-chart";
import { TrendChart } from "./trend-chart";
import { ConversationTypesChart } from "./conversation-types-chart";
import { UsageDonut } from "./usage-donut";
import { ToolUsageWidget } from "./tool-usage-widget";
import { IndexedContentChart } from "./indexed-content-chart";
import { IngestionBarChart } from "./ingestion-bar-chart";
import { RecentConversations } from "./recent-conversations";

function Box({ title, hint, action, wide, children }: { title: string; hint?: string; action?: React.ReactNode; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={wide ? "ar-stats-box is-wide" : "ar-stats-box"}>
      <div className="ar-stats-box-head">
        <h3>{title}</h3>
        {action}
      </div>
      {hint && <p className="ar-stats-hint">{hint}</p>}
      {children}
    </section>
  );
}

/** "Dati": every raw chart of the old dashboard, for the period chosen above. */
export function StatsData({ data, days, report }: { data: DashboardData; days: PeriodDays; report?: PeriodReport | null }) {
  const { t } = useApp();
  const threads = visitorThreads(data);
  const legacy = Array.isArray(data.conversations) ? data.conversations : [];
  const conversations = threads.length ? threads : legacy;
  const analytics = analyticsRows(data);
  // One source with the Report tab: its server series for the day chart, and
  // its period for the status donut (which counted every loaded thread ever).
  const fromApi = report?.source === "api";
  const periodStart = report ? report.start.getTime() : null;
  // Active in the period, like the report's count: a thread opened earlier
  // that talked this week belongs to this week.
  const periodThreads =
    periodStart === null ? threads : threads.filter((th) => (timeOf(th.last_message_at ?? th.created_at) ?? 0) >= periodStart);
  const quota = data.quota ?? {};
  const statusLabel = useCallback((key: string) => {
    const k = `stats.status_${key}`;
    const label = t(k);
    return label === k ? key : label;
  }, [t]);

  // The period's results, the Report's numbers: these were all-time totals
  // ("Richieste 290" next to a week of 4 conversations).
  const m = report?.current;
  const results = (m
    ? [
        { key: "leads", label: t("badges.leads"), value: m.leads },
        { key: "appointments", label: t("conversions.appointments"), value: m.visits },
        { key: "submissions", label: t("conversions.submissions"), value: m.requests },
        { key: "feedback", label: t("conversions.feedback"), value: m.feedbackCount },
      ]
    : []
  ).filter((r) => r.value > 0);
  const maxResult = Math.max(1, ...results.map((r) => r.value));


  return (
    <div className="ar-stats-data">
      <KpiCards data={data} report={report} />
      <Box title={t("stats.trendTitle")} wide>
        <MetricChart data={data} days={days} report={report} />
      </Box>
      <div className="ar-stats-grid">
        <Box title={t("dashboard.dailyConversations")}>
          <DailyConversationsChart conversations={conversations} days={days} />
        </Box>
        <Box title={t("stats.conversationsAndTools")}>
          <TrendChart analytics={analytics} conversations={conversations} days={days} series={fromApi ? report!.series : undefined} />
        </Box>
        <Box title={t("stats.statusTitle")}>
          <ConversationTypesChart
            conversations={periodThreads.map((th) => ({ workflow: String(th.status || "open") }))}
            labelOf={statusLabel}
          />
        </Box>
        <Box title={t("dashboard.conversationTypes")} hint={t("dashboard.conversationTypesHint")}>
          {results.length ? (
            <ul className="ar-stats-breakdown">
              {results.map((r) => (
                <li key={r.key}>
                  <span>{r.label}</span>
                  <b>{formatNumber(r.value)}</b>
                  <i aria-hidden="true"><i style={{ width: `${(r.value / maxResult) * 100}%` }} /></i>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ar-stats-quiet">{t("messages.noData")}</p>
          )}
        </Box>
        <Box
          title={t("stats.usageTitle")}
          action={<NavLink to="impostazioni/piano" className="ar-stats-link">{t("badges.upgrade")}</NavLink>}
        >
          <UsageDonut quota={quota} />
        </Box>
        <Box title={t("stats.toolsTitle")} hint={t("stats.toolsHint")}>
          <ToolUsageWidget analytics={analytics} />
        </Box>
        <Box title={t("stats.contentTitle")}>
          <IndexedContentChart contentCounts={data.content_counts ?? {}} />
        </Box>
        <Box title={t("stats.ingestionTitle")}>
          <IngestionBarChart ingestions={Array.isArray(data.ingestions) ? data.ingestions : []} />
        </Box>
      </div>
      <Box title={t("stats.recentTitle")} wide>
        <RecentConversations conversations={legacy} threads={threads} total={data.chat_threads?.total} />
      </Box>
    </div>
  );
}
