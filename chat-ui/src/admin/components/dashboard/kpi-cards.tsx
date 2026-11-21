import { useApp } from "@/admin/app-context";
import { formatNumber, toNumber } from "@/admin/lib/format";
import { interpolate } from "@/admin/lib/i18n";
import type { DashboardData } from "@/admin/hooks/use-dashboard";
import { analyticsRows, type PeriodReport } from "./metrics";

/**
 * The four totals of the Dati tab: conversations, messages used against the
 * plan, indexed content and tool uses. Soft tiles, no icons (x-tile).
 */
export function KpiCards({ data, report }: { data: DashboardData; report?: PeriodReport | null }) {
  const { t } = useApp();

  const quota = data.quota ?? {};
  const contentCounts = data.content_counts ?? {};
  const conversations = Array.isArray(data.conversations) ? data.conversations : [];

  const messagesUsed = toNumber(quota.monthly_used ?? quota.messages_used);
  const messagesLimit = toNumber(quota.monthly_allowance ?? quota.messages_limit);
  // The period's count, the number the Report tab shows; the all-time thread
  // total only without a report (it read 42 next to the Report's 44).
  const conversationCount = report ? report.current.conversations : data.chat_threads?.total ?? conversations.length;
  const conversationHint = report
    ? interpolate(t("stats.kpiPeriodHint"), { days: report.days })
    : t("badges.activeConversations");
  const pagesIndexed = toNumber(contentCounts.pages) + toNumber(contentCounts.posts);
  // The period's tool calls from the server report's daily series; without
  // it, the latest events the dashboard carries, and the hint says so.
  const periodTools = report?.series.some((s) => s.tools !== undefined)
    ? report.series.reduce((sum, s) => sum + (s.tools ?? 0), 0)
    : null;
  const toolCalls = periodTools ?? analyticsRows(data).reduce(
    (sum, entry) => sum + toNumber(entry.tool_calls ?? entry.count ?? 0),
    0
  );
  const plan = String(quota.license_tier || data.tenant?.plan || quota.plan || "");
  const planKey = `plans.${plan}`;
  const planLabel = plan ? (t(planKey) === planKey ? plan : t(planKey)) : "";
  const usagePercent = messagesLimit > 0 ? Math.round((messagesUsed / messagesLimit) * 100) : 0;
  // Past the allowance (a plan lowered mid-month) "300%" reads as a bug: say "oltre il 100%".
  const usageText = usagePercent > 100 ? t("stats.overLimit") : `${usagePercent}%`;

  const tiles = [
    { key: "conversations", value: `${formatNumber(conversationCount)}${report?.truncated ? "+" : ""}`, label: t("badges.conversations"), hint: conversationHint },
    {
      key: "messages",
      value: `${formatNumber(messagesUsed)}/${formatNumber(messagesLimit)}`,
      label: t("badges.messagesUsed"),
      hint: `${usageText}${planLabel ? ` · ${interpolate(t("dashboard.planLabel"), { plan: planLabel })}` : ""}`,
      warn: usagePercent >= 80,
    },
    {
      key: "content",
      value: formatNumber(pagesIndexed),
      label: t("badges.indexedContent"),
      hint: `${formatNumber(toNumber(contentCounts.pages))} ${t("badges.pages").toLowerCase()}`,
    },
    {
      key: "tools",
      value: formatNumber(toolCalls),
      label: t("stats.toolsTitle"),
      hint: periodTools !== null && report ? interpolate(t("stats.kpiPeriodHint"), { days: report.days }) : t("stats.toolsRecentHint"),
    },
  ];

  return (
    <dl className="ar-stats-tiles ar-stats-kpis">
      {tiles.map((tile) => (
        <div key={tile.key} className="ar-stats-tile">
          <dt>{tile.label}</dt>
          <dd>{tile.value}</dd>
          <dd className={tile.warn ? "ar-stats-tile-hint ark-c-red" : "ar-stats-tile-hint"}>{tile.hint}</dd>
        </div>
      ))}
    </dl>
  );
}
