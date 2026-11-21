"use client";
import { cn } from "./_adapter";
import "../shared/tool-cards.css";
import type {
  StatsDisplayProps,
  StatItem,
  StatFormat,
  StatDiff,
} from "./schema";
import { Sparkline } from "./sparkline";
import { widgetCopy } from "@/lib/widget-copy";

interface FormattedValueProps {
  value: string | number;
  format?: StatFormat;
  locale?: string;
}

function FormattedValue({ value, format, locale }: FormattedValueProps) {
  if (typeof value === "string" || !format) {
    return <span className="ar-num">{String(value)}</span>;
  }

  switch (format.kind) {
    case "number": {
      const decimals = format.decimals ?? 0;
      if (format.compact) {
        const parts = new Intl.NumberFormat(locale, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
          notation: "compact",
        }).formatToParts(value);
        const fullNumber = new Intl.NumberFormat(locale).format(value);
        return (
          <span className="ar-num" aria-label={fullNumber}>
            {parts.map((part, i) =>
              part.type === "compact" ? (
                <span
                  key={i}
                  className="ar-stat-unit"
                  aria-hidden="true"
                >
                  {part.value}
                </span>
              ) : (
                <span key={i}>{part.value}</span>
              ),
            )}
          </span>
        );
      }
      const formatted = new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
      return <span className="ar-num">{formatted}</span>;
    }
    case "currency": {
      const currency = format.currency;
      const decimals = format.decimals ?? 2;
      const formatted = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
      const spokenValue = new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        currencyDisplay: "name",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
      return (
        <span className="ar-num" aria-label={spokenValue}>
          {formatted}
        </span>
      );
    }
    case "percent": {
      const decimals = format.decimals ?? 2;
      const basis = format.basis ?? "fraction";
      const numeric = basis === "fraction" ? value * 100 : value;
      const formatted = numeric.toFixed(decimals);
      return (
        <span
          className="ar-num"
          aria-label={widgetCopy().percent(formatted)}
        >
          {formatted}
          <span className="ar-stat-unit" aria-hidden="true">
            %
          </span>
        </span>
      );
    }
    case "text":
    default:
      return <span className="ar-num">{String(value)}</span>;
  }
}

interface DeltaValueProps {
  diff: StatDiff;
}

function DeltaValue({ diff }: DeltaValueProps) {
  const { value, decimals = 1, upIsPositive = true, label } = diff;

  const isPositive = value > 0;
  const isNegative = value < 0;
  const isGood = upIsPositive ? isPositive : isNegative;
  const isBad = upIsPositive ? isNegative : isPositive;

  const formatted = Math.abs(value).toFixed(decimals);
  const sign = isNegative ? "−" : "+";

  return (
    <span className="ar-stat-delta" data-tone={isGood ? "good" : isBad ? "bad" : "flat"}>
      {!upIsPositive && <span aria-hidden="true">{isGood ? "↓" : "↑"}</span>}
      {`${sign}${formatted}%`}
      {label && <span className="ar-stat-delta-label">{label}</span>}
    </span>
  );
}

interface StatCardProps {
  stat: StatItem;
  locale?: string;
}

function StatCard({ stat, locale }: StatCardProps) {
  const sparklineColor = stat.sparkline?.color ?? "var(--ar-brand)";

  return (
    <div className="ar-stat">
      {stat.sparkline && (
        <Sparkline
          data={stat.sparkline.data}
          color={sparklineColor}
          showFill
          fillOpacity={0.1}
          className="ar-stat-spark"
        />
      )}
      <span className="ar-stat-label">{stat.label}</span>
      <span className="ar-stat-value">
        <FormattedValue value={stat.value} format={stat.format} locale={locale} />
      </span>
      {stat.diff && <DeltaValue diff={stat.diff} />}
    </div>
  );
}

export function StatsDisplay({
  id,
  title,
  description,
  stats,
  className,
  locale: localeProp,
}: StatsDisplayProps) {
  const locale =
    localeProp ??
    (typeof navigator !== "undefined" ? navigator.language : undefined);
  const hasHeader = Boolean(title || description);

  return (
    <section
      data-slot="stats-display"
      data-tool-ui-id={id}
      className={cn("ar-card ar-stats-card", className)}
      aria-label={title || undefined}
    >
      {hasHeader && (
        <div className="ar-card-head">
          <div className="ar-card-heading">
            {title && <h3 className="ar-card-title">{title}</h3>}
            {description && <p className="ar-card-sub">{description}</p>}
          </div>
        </div>
      )}
      <div className="ar-stats-grid" data-single={stats.length === 1 ? "true" : undefined}>
        {stats.map((stat) => (
          <StatCard key={stat.key} stat={stat} locale={locale} />
        ))}
      </div>
    </section>
  );
}
