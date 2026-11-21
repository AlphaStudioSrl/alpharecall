import { getLocale } from "@/admin/lib/datetime";
import { useMemo } from "react";
import { Cell, Label, Pie, PieChart } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useApp } from "@/admin/app-context";
import { toNumber, formatNumber } from "@/admin/lib/format";
import type { QuotaData } from "@/admin/hooks/use-dashboard";

interface UsageDonutProps {
  quota: QuotaData;
}

// What is left reads as empty track, not as a second warning colour.
const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "var(--ar-panel)",
];

export function UsageDonut({ quota }: UsageDonutProps) {
  const { t } = useApp();

  const used = toNumber(quota.monthly_used ?? quota.messages_used);
  const limit = toNumber(quota.monthly_allowance ?? quota.messages_limit);
  const remaining = Math.max(0, limit - used);

  const rows = useMemo(
    () => [
      { key: "used", label: t("badges.messagesUsed"), value: used, fill: CHART_COLORS[0] },
      { key: "remaining", label: t("badges.remaining"), value: remaining, fill: CHART_COLORS[1] },
    ],
    [used, remaining, t]
  );

  const chartConfig: ChartConfig = {
    used: { label: t("badges.messagesUsed"), color: CHART_COLORS[0] },
    remaining: { label: t("badges.remaining"), color: CHART_COLORS[1] },
  };

  if (limit === 0 && used === 0) {
    return (
      <div className="h-[230px] flex items-center justify-center text-sm text-muted-foreground">
        {t("messages.noData")}
      </div>
    );
  }

  const usagePercent = limit > 0 ? Math.round((used / limit) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formatNumber(used)} / {formatNumber(limit)}</span>
        <span>{usagePercent > 100 ? t("stats.overLimit") : `${usagePercent}% ${t("badges.usageRate")}`}</span>
      </div>
      <ChartContainer config={chartConfig} className="mx-auto aspect-square h-[200px]">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent locale={getLocale()} hideLabel />}
          />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="key"
            innerRadius={60}
            outerRadius={85}
            strokeWidth={2}
            stroke="var(--ar-fill)"
          >
            {rows.map((row) => (
              <Cell key={row.key} fill={row.fill} />
            ))}
            <Label
              content={({ viewBox }) => {
                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                  return (
                    <text
                      x={viewBox.cx}
                      y={viewBox.cy}
                      textAnchor="middle"
                      dominantBaseline="middle"
                    >
                      <tspan
                        x={viewBox.cx}
                        y={viewBox.cy}
                        className="fill-foreground text-2xl font-bold"
                      >
                        {Math.min(usagePercent, 100)}%{usagePercent > 100 ? "+" : ""}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy || 0) + 20}
                        className="fill-muted-foreground text-xs"
                      >
                        {t("badges.usageRate")}
                      </tspan>
                    </text>
                  );
                }
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="text-center text-xs text-muted-foreground">
        {(quota.license_tier || quota.plan) && (() => {
          const plan = String(quota.license_tier || quota.plan);
          const key = `plans.${plan}`;
          return <span className="font-medium">{t("badges.currentPlan")}: {t(key) === key ? plan : t(key)}</span>;
        })()}
      </div>
    </div>
  );
}
