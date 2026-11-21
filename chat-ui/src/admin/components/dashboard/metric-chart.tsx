import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useApp } from "@/admin/app-context";
import { formatNumber } from "@/admin/lib/format";
import { formatDateKey, toZonedDateKey, getLocale } from "@/admin/lib/datetime";
import type { DashboardData } from "@/admin/hooks/use-dashboard";
import { Chips } from "@/admin/components/shared/kit";
import { cn } from "@/admin/lib/utils";
import { changeLabel, contactSubmissions, dayKeys, rows, visitorThreads, DAY_MS, type PeriodReport } from "./metrics";

type MetricKey = "conversations" | "leads" | "appointments" | "submissions" | "feedback";

/** Day by day over the period, and the count of the period before. */
function periodSeries(items: { created_at?: string }[], days: number, now: number) {
  const keys = dayKeys(days, now);
  const counts = new Map(keys.map((k) => [k, 0]));
  const prevStart = toZonedDateKey(new Date(now - 2 * days * DAY_MS));
  let previous = 0;
  for (const item of items) {
    const key = toZonedDateKey(item.created_at);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    else if (key && key > prevStart && key < keys[0]) previous += 1;
  }
  const series = keys.map((k) => ({ date: k, label: formatDateKey(k), value: counts.get(k) ?? 0 }));
  return { series, current: series.reduce((a, r) => a + r.value, 0), previous };
}

/**
 * The old dashboard's hero: one metric at a time (conversations, leads,
 * appointments, requests, feedback) day by day over the page's period, with
 * the change against the period before. Every number is the period's: the
 * chips used to carry all-time totals ("Conversazioni 47" in a week of 4).
 */
export function MetricChart({ data, days, report }: { data: DashboardData; days: number; report?: PeriodReport | null }) {
  const { t } = useApp();
  const gradientId = useId().replace(/:/g, "");
  const metrics = useMemo(() => {
    const now = Date.now();
    const threads = visitorThreads(data);
    const list: { key: MetricKey; label: string; ever: number; items: { created_at?: string }[] }[] = [
      {
        key: "conversations",
        label: t("badges.conversations"),
        ever: 1,
        // Chat threads are the real conversations; the legacy list is only a
        // fallback for older PHP without them.
        items: threads.length ? threads : (Array.isArray(data.conversations) ? data.conversations : []),
      },
      { key: "leads", label: t("badges.leads"), ever: data.conversions?.leads.total ?? 0, items: rows(data, "leads") },
      // Counted like the report's results: bookings not cancelled, requests
      // without the escalations useDashboard merges in.
      { key: "appointments", label: t("conversions.appointments"), ever: data.conversions?.appointments.total ?? 0, items: rows(data, "appointments").filter((r) => String(r.status ?? "") !== "cancelled") },
      { key: "submissions", label: t("conversions.submissions"), ever: data.conversions?.submissions.total ?? 0, items: contactSubmissions(data) },
      { key: "feedback", label: t("conversions.feedback"), ever: data.conversions?.feedback.total ?? 0, items: rows(data, "feedback") },
    ];
    return list.map((m) => {
      const period = periodSeries(m.items, days, now);
      // The conversation total is the report's (every thread active in the
      // period, server side), the number the tiles above show.
      if (m.key === "conversations" && report) {
        return { ...m, ...period, current: report.current.conversations, previous: report.truncated ? 0 : report.previous.conversations };
      }
      return { ...m, ...period };
    });
  }, [t, data, days, report]);
  // Conversations always; a conversion kind only once it has ever happened.
  const visible = metrics.filter((m) => m.key === "conversations" || m.ever > 0);
  const [active, setActive] = useState<MetricKey>("conversations");
  const meta = visible.find((m) => m.key === active) ?? visible[0];
  const { series, current, previous } = meta;

  const delta = changeLabel(current, previous);
  const config: ChartConfig = { value: { label: meta.label, color: "hsl(var(--chart-1))" } };

  return (
    <div className="ar-stats-metric">
      <Chips<MetricKey>
        aria-label={t("stats.trendTitle")}
        value={meta.key}
        onValueChange={setActive}
        options={visible.map((m) => ({ value: m.key, label: m.label, count: formatNumber(m.current) }))}
      />
      <div className="ar-stats-metric-big">
        <span>{formatNumber(current)}</span>
        {delta && <em className={cn(current > previous ? "ark-c-accent" : "ark-c-red")}>{delta}</em>}
      </div>
      {series.some((r) => r.value > 0) ? (
        <ChartContainer config={config} className="h-[220px] w-full">
          <AreaChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`metric-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" className="opacity-40" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={32} fontSize={11} tickMargin={8} />
            <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} fontSize={11} tickMargin={4} />
            <ChartTooltip cursor={{ strokeDasharray: "3 3" }} content={<ChartTooltipContent locale={getLocale()} indicator="line" />} />
            <Area dataKey="value" type="monotone" fill={`url(#metric-${gradientId})`} stroke="var(--color-value)" strokeWidth={2} />
          </AreaChart>
        </ChartContainer>
      ) : (
        <div className="ar-stats-chart-empty">{t("messages.noData")}</div>
      )}
    </div>
  );
}
