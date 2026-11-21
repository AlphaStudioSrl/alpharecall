import { getLocale } from "@/admin/lib/datetime";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useApp } from "@/admin/app-context";
import { toNumber, formatNumber } from "@/admin/lib/format";
import type { ContentCounts } from "@/admin/hooks/use-dashboard";

interface IndexedContentChartProps {
  contentCounts: ContentCounts;
}

export function IndexedContentChart({ contentCounts }: IndexedContentChartProps) {
  const { t } = useApp();

  const rows = useMemo(
    () => [
      { key: "pages", label: t("badges.pages"), value: Math.max(0, toNumber(contentCounts.pages)) },
      { key: "posts", label: t("badges.posts"), value: Math.max(0, toNumber(contentCounts.posts)) },
    ],
    [contentCounts, t]
  );

  const chartConfig: ChartConfig = {
    pages: { label: t("badges.pages"), color: "hsl(var(--chart-2))" },
    posts: { label: t("badges.posts"), color: "hsl(var(--chart-1))" },
  };

  const total = rows.reduce((s, r) => s + r.value, 0);
  const hasData = total > 0;

  if (!hasData) {
    return (
      <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
        {t("messages.noData")}
      </div>
    );
  }

  const pagesShare = Math.round((rows[0].value / Math.max(1, total)) * 100);

  return (
    <div className="space-y-3">
      <ChartContainer config={chartConfig} className="h-[180px] w-full">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            width={60}
            fontSize={11}
          />
          <Tooltip content={<ChartTooltipContent locale={getLocale()} />} />
          <Bar dataKey="value" radius={[0, 8, 8, 0]}>
            {rows.map((row) => (
              <Cell key={row.key} fill={`var(--color-${row.key})`} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{formatNumber(total)} {t("badges.indexedContent").toLowerCase()}</span>
        <span>{t("badges.pages")} {pagesShare}%</span>
      </div>
    </div>
  );
}
