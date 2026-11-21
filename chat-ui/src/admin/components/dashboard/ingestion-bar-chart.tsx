import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import { formatNumber } from "@/admin/lib/format";
import { ingestionPages, ingestionStarted, type IngestionItem } from "@/admin/hooks/use-dashboard";
import { formatShortDate, getLocale } from "@/admin/lib/datetime";

interface IngestionBarChartProps {
  ingestions: IngestionItem[];
}

export function IngestionBarChart({ ingestions }: IngestionBarChartProps) {
  const { t } = useApp();
  const [series, setSeries] = useState<"completed" | "failed">("completed");

  const rows = useMemo(() => {
    return ingestions
      .slice(0, 10)
      .reverse()
      .map((item, i) => {
        const label = formatShortDate(ingestionStarted(item)) || `#${i + 1}`;
        const docs = ingestionPages(item);
        const isCompleted = (item.status || "").toLowerCase() === "completed";
        return {
          label,
          completed: isCompleted ? docs : 0,
          failed: !isCompleted ? 1 : 0,
        };
      });
  }, [ingestions]);

  const totals = useMemo(
    () => ({
      completed: rows.reduce((s, r) => s + r.completed, 0),
      failed: rows.reduce((s, r) => s + r.failed, 0),
    }),
    [rows]
  );

  const chartConfig: ChartConfig = {
    completed: { label: t("badges.completed"), color: "hsl(var(--chart-2))" },
    failed: { label: t("badges.failed"), color: "hsl(var(--chart-1))" },
  };

  const hasData = rows.length > 0;

  if (!hasData) {
    return (
      <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
        {t("messages.noData")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1" role="tablist">
        {(["completed", "failed"] as const).map((key) => {
          const active = series === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-pressed={active}
              onClick={() => setSeries(key)}
              className={`flex flex-col items-start px-3 py-1.5 rounded-md text-xs transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              <span>{chartConfig[key].label}</span>
              <strong className="text-sm">{formatNumber(totals[key])}</strong>
            </button>
          );
        })}
      </div>
      <ChartContainer config={chartConfig} className="h-[220px] w-full">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            fontSize={11}
          />
          <YAxis
            allowDecimals={false}
            width={30}
            tickLine={false}
            axisLine={false}
            fontSize={11}
          />
          <Tooltip content={<ChartTooltipContent locale={getLocale()} />} />
          <Bar
            dataKey={series}
            name={chartConfig[series].label as string}
            fill={`var(--color-${series})`}
            radius={6}
          />
        </BarChart>
      </ChartContainer>
    </div>
  );
}
