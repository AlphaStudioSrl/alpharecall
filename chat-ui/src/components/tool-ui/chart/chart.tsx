"use client";

import { useMemo, useCallback, memo } from "react";
import {
  BarChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

import {
  cn,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "./_adapter";
import "../shared/tool-cards.css";
import type { ChartProps } from "./schema";

// The tenant color first, then lighter mixes of it and two neutrals.
const DEFAULT_COLORS = [
  "var(--ar-brand, var(--chart-1))",
  "color-mix(in srgb, var(--ar-brand, var(--chart-1)) 60%, var(--ar-panel, #fff))",
  "color-mix(in srgb, var(--ar-brand, var(--chart-1)) 35%, var(--ar-panel, #fff))",
  "var(--ar-ink-3, var(--chart-4))",
  "var(--ar-ink-2, var(--chart-5))",
];

export const Chart = memo(function Chart({
  id,
  type,
  title,
  description,
  data,
  xKey,
  series,
  colors,
  showLegend = false,
  showGrid = true,
  className,
  onDataPointClick,
}: ChartProps) {
  const palette = colors?.length ? colors : DEFAULT_COLORS;

  const seriesColors = useMemo(
    () =>
      series.map(
        (seriesItem, index) =>
          seriesItem.color ?? palette[index % palette.length],
      ),
    [series, palette],
  );

  const chartConfig: ChartConfig = useMemo(
    () =>
      Object.fromEntries(
        series.map((seriesItem, index) => [
          seriesItem.key,
          {
            label: seriesItem.label,
            color: seriesColors[index],
          },
        ]),
      ),
    [series, seriesColors],
  );

  const handleDataPointClick = useCallback(
    (
      seriesKey: string,
      seriesLabel: string,
      payload: Record<string, unknown>,
      index: number,
    ) => {
      onDataPointClick?.({
        seriesKey,
        seriesLabel,
        xValue: payload[xKey],
        yValue: payload[seriesKey],
        index,
        payload,
      });
    },
    [onDataPointClick, xKey],
  );

  const ChartComponent = type === "bar" ? BarChart : LineChart;

  const chartContent = (
    <ChartContainer
      config={chartConfig}
      className="ar-chart min-h-[200px] w-full"
      data-tool-ui-id={id}
    >
      <ChartComponent data={data} accessibilityLayer>
        {showGrid && <CartesianGrid vertical={false} stroke="var(--ar-fill-2)" />}
        <XAxis
          dataKey={xKey}
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--ar-ink-3)" }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          width={36}
          tick={{ fontSize: 11, fill: "var(--ar-ink-3)" }}
        />
        <ChartTooltip content={<ChartTooltipContent className="ar-chart-tip" />} />
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}

        {type === "bar" &&
          series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              fill={seriesColors[i]}
              radius={6}
              onClick={(data) =>
                handleDataPointClick(s.key, s.label, data.payload, data.index)
              }
              cursor={onDataPointClick ? "pointer" : undefined}
            />
          ))}

        {type === "line" &&
          series.map((s, i) => (
            <Line
              key={s.key}
              dataKey={s.key}
              type="monotone"
              stroke={seriesColors[i]}
              strokeWidth={2}
              dot={{ r: 4, cursor: onDataPointClick ? "pointer" : undefined }}
              activeDot={{
                r: 6,
                cursor: onDataPointClick ? "pointer" : undefined,
                // Recharts types are incorrect - onClick receives (event, dotData) at runtime
                onClick: ((
                  _: unknown,
                  dotData: { payload: Record<string, unknown>; index: number },
                ) => {
                  handleDataPointClick(
                    s.key,
                    s.label,
                    dotData.payload,
                    dotData.index,
                  );
                }) as unknown as React.MouseEventHandler,
              }}
            />
          ))}
      </ChartComponent>
    </ChartContainer>
  );

  return (
    <section
      className={cn("ar-card ar-chart-card", className)}
      data-tool-ui-id={id}
      data-slot="chart"
      aria-label={title || undefined}
    >
      {(title || description) && (
        <div className="ar-card-head">
          <div className="ar-card-heading">
            {title && <h3 className="ar-card-title">{title}</h3>}
            {description && <p className="ar-card-sub">{description}</p>}
          </div>
        </div>
      )}
      <div className="ar-chart-plot">{chartContent}</div>
    </section>
  );
});
