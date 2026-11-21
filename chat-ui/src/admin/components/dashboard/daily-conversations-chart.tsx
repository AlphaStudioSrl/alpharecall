import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useApp } from "@/admin/app-context";
import { formatDateKey, toZonedDateKey, getLocale } from "@/admin/lib/datetime";

interface DailyConversationsChartProps {
  /** Anything with a creation time: chat threads, or legacy conversation rows. */
  conversations: { created_at?: string }[];
  days?: number;
}

function buildDailyBuckets(conversations: { created_at?: string }[], days: number) {
  const now = new Date();
  const buckets: Record<string, number> = {};

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets[toZonedDateKey(d)] = 0;
  }

  // Both sides must key the same way. Slicing the raw string took the UTC
  // date, so a conversation at 01:30 Rome counted toward the previous day.
  for (const c of conversations) {
    const date = toZonedDateKey(c.created_at);
    if (buckets[date] !== undefined) {
      buckets[date] += 1;
    }
  }

  return Object.entries(buckets).map(([date, count]) => ({
    date,
    label: formatDateKey(date),
    count,
  }));
}

export function DailyConversationsChart({ conversations, days = 30 }: DailyConversationsChartProps) {
  const { t } = useApp();

  const rows = useMemo(() => buildDailyBuckets(conversations, days), [conversations, days]);

  const hasData = rows.some((r) => r.count > 0);

  const chartConfig: ChartConfig = {
    count: { label: t("badges.conversations"), color: "hsl(var(--chart-1))" },
  };

  if (!hasData) {
    return (
      <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
        {t("messages.noData")}
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-[260px] w-full">
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}
