import { useMemo, useState, useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useApp } from "@/admin/app-context";
import { toNumber } from "@/admin/lib/format";
import type { AnalyticsEntry } from "@/admin/hooks/use-dashboard";
import { formatDateKey, toZonedDateKey, getLocale } from "@/admin/lib/datetime";

interface TrendChartProps {
  analytics: AnalyticsEntry[];
  /** Anything with a creation time: chat threads, or legacy conversation rows. */
  conversations: { created_at?: string }[];
  /** Period chosen by the page; without it the chart shows its own 7/30/90 switch. */
  days?: number;
  /**
   * The server's day series (Statistiche report): conversations and tool
   * calls per tenant day, the same numbers the Report tab counts. When given,
   * it replaces the counts built from the loaded threads.
   */
  series?: { date: string; conversations: number; tools?: number }[];
}

type RangeKey = "7" | "30" | "90";

function buildDailyBuckets(
  conversations: { created_at?: string }[],
  analytics: AnalyticsEntry[],
  days: number
) {
  const now = new Date();
  const buckets: Record<string, { conversations: number; tools: number }> = {};

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets[toZonedDateKey(d)] = { conversations: 0, tools: 0 };
  }

  // Keyed in the tenant's zone on both sides -- see daily-conversations-chart.
  for (const c of conversations) {
    const date = toZonedDateKey(c.created_at);
    if (buckets[date]) {
      buckets[date].conversations += 1;
    }
  }

  // Already a calendar day aggregated server-side, not an instant -- there is
  // no clock to convert, so this one is sliced rather than re-zoned.
  for (const a of analytics) {
    const date = (a.date || "").slice(0, 10);
    if (buckets[date]) {
      buckets[date].conversations += toNumber(a.conversations);
      buckets[date].tools += toNumber(a.tool_calls ?? a.count ?? 0);
    }
  }

  return Object.entries(buckets).map(([date, v]) => ({
    label: formatDateKey(date),
    conversations: v.conversations,
    tools: v.tools,
  }));
}

export function TrendChart({ analytics, conversations, days, series }: TrendChartProps) {
  const { t } = useApp();
  const [ownRange, setRange] = useState<RangeKey>("30");
  const range = days ? String(days) : ownRange;
  const gradientId = useId().replace(/:/g, "");

  const rows = useMemo(
    () =>
      series
        ? series.map((p) => ({ label: formatDateKey(p.date), conversations: p.conversations, tools: p.tools ?? 0 }))
        : buildDailyBuckets(conversations, analytics, Number(range)),
    [series, conversations, analytics, range]
  );

  const hasData = rows.some((r) => r.conversations > 0 || r.tools > 0);
  // The tool line only when there is a dated source for it: the analytics
  // envelope has per-tool totals with no day, and a legend entry for a line
  // that can never leave zero read as a broken chart.
  const hasTools = series ? series.some((p) => p.tools !== undefined) : rows.some((r) => r.tools > 0);

  const chartConfig: ChartConfig = {
    conversations: { label: t("badges.conversations"), color: "hsl(var(--chart-1))" },
    ...(hasTools ? { tools: { label: t("section.toolUsage"), color: "hsl(var(--chart-2))" } } : {}),
  };

  const ranges: { key: RangeKey; label: string }[] = [
    { key: "7", label: "7d" },
    { key: "30", label: "30d" },
    { key: "90", label: "90d" },
  ];

  if (!hasData) {
    return (
      <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">
        {t("messages.noData")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!days && (
        <div className="flex items-center gap-1">
          {ranges.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              onClick={() => setRange(r.key)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                range === r.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
      <ChartContainer config={chartConfig} className="h-[280px] w-full">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`conv-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-conversations)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="var(--color-conversations)" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id={`tools-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-tools)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--color-tools)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" className="opacity-40" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            fontSize={11}
            tickMargin={8}
          />
          <YAxis
            allowDecimals={false}
            width={30}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickMargin={4}
          />
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent locale={getLocale()} indicator="dot" />}
          />
          <ChartLegend content={<ChartLegendContent />} />
          {/* Two counts of different things: drawn side by side, not stacked. */}
          {hasTools && (
            <Area
              dataKey="tools"
              type="natural"
              fill={`url(#tools-${gradientId})`}
              stroke="var(--color-tools)"
              strokeWidth={2}
            />
          )}
          <Area
            dataKey="conversations"
            type="natural"
            fill={`url(#conv-${gradientId})`}
            stroke="var(--color-conversations)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
