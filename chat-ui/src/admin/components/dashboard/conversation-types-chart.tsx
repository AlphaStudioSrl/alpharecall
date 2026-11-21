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
import { formatNumber } from "@/admin/lib/format";
import type { ConversationItem } from "@/admin/hooks/use-dashboard";

interface ConversationTypesChartProps {
  /** Grouped by `workflow`; pass `{ workflow: thread.status }` to group threads by status. */
  conversations: Pick<ConversationItem, "workflow">[];
  /** Label for a group key; defaults to the key, capitalised. */
  labelOf?: (key: string) => string;
}

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

function groupByWorkflow(conversations: Pick<ConversationItem, "workflow">[], labelOf?: (key: string) => string) {
  const counts: Record<string, number> = {};
  for (const c of conversations) {
    const key = c.workflow || "chat";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value], i) => ({
      key,
      label: labelOf ? labelOf(key) : key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "),
      value,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
}

export function ConversationTypesChart({ conversations, labelOf }: ConversationTypesChartProps) {
  const { t } = useApp();

  const rows = useMemo(() => groupByWorkflow(conversations, labelOf), [conversations, labelOf]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);

  const chartConfig: ChartConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    for (const row of rows) {
      cfg[row.key] = { label: row.label, color: row.fill };
    }
    return cfg;
  }, [rows]);

  if (total === 0) {
    return (
      <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
        {t("messages.noData")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ChartContainer config={chartConfig} className="mx-auto aspect-square h-[220px]">
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent locale={getLocale()} hideLabel />}
          />
          <Pie
            data={rows}
            dataKey="value"
            nameKey="key"
            innerRadius={55}
            outerRadius={80}
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
                        {formatNumber(total)}
                      </tspan>
                      <tspan
                        x={viewBox.cx}
                        y={(viewBox.cy || 0) + 20}
                        className="fill-muted-foreground text-xs"
                      >
                        {t("badges.conversations").toLowerCase()}
                      </tspan>
                    </text>
                  );
                }
              }}
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {rows.map((row) => (
          <span key={row.key} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: row.fill }}
            />
            {row.label} ({Math.round((row.value / total) * 100)}%)
          </span>
        ))}
      </div>
    </div>
  );
}
