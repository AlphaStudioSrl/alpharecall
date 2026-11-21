import * as React from "react";
import { cardCopy } from "@/lib/card-copy";
import { CardCarousel, type CarouselCard } from "./card-carousel";

type Column = { key: string; label?: string; format?: { kind?: string; currency?: string; decimals?: number } };

interface TableCardProps {
  component: {
    id?: string;
    title?: string;
    description?: string;
    columns?: Column[];
    data?: Record<string, unknown>[];
  };
  onSendMessage?: (text: string) => void;
}

const VISIBLE_ROWS = 6;
const PRICE_LABEL = /prezz|cost|price|tariff|importo|quota|fee|€|eur\b/i;
const PRICE_VALUE = /(€|eur\b|\$|£|chf)\s?\d|\d[\d.,]*\s?(€|eur\b|euro|\$|£|chf)|^(gratis|gratuit[ao]|free)$/i;

function cellText(value: unknown, column?: Column): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((v) => cellText(v)).filter(Boolean).join(", ");
  if (typeof value === "boolean") return value ? "Sì" : "No";
  if (typeof value === "number") {
    const kind = column?.format?.kind;
    try {
      if (kind === "currency") {
        return new Intl.NumberFormat("it-IT", { style: "currency", currency: column?.format?.currency || "EUR", maximumFractionDigits: column?.format?.decimals ?? 2 }).format(value);
      }
      if (kind === "percent") return new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 }).format(Math.abs(value) > 1 ? value / 100 : value);
      return new Intl.NumberFormat("it-IT").format(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return cellText(record.label ?? record.value ?? record.text ?? "");
  }
  return String(value).trim();
}

/** The column that holds prices, when the table is a price list. */
function priceColumn(columns: Column[], rows: Record<string, unknown>[]): Column | null {
  const byLabel = columns.find((c) => PRICE_LABEL.test(`${c.label || ""} ${c.key}`) || c.format?.kind === "currency");
  if (byLabel) return byLabel;
  return columns.find((c) => {
    const values = rows.map((r) => cellText(r[c.key], c)).filter(Boolean);
    return values.length > 0 && values.filter((v) => PRICE_VALUE.test(v)).length >= Math.ceil(values.length / 2);
  }) || null;
}

/**
 * Tables Sofia shows with the display tool. A price list (a name and a price
 * per row) becomes swipeable service cards; anything else stays a compact
 * two-column list on the card fill, six rows at a time.
 */
export function TableCard({ component, onSendMessage }: TableCardProps) {
  const copy = cardCopy();
  const [expanded, setExpanded] = React.useState(false);
  const rows = Array.isArray(component.data) ? component.data.filter((r) => r && typeof r === "object") : [];
  const columns: Column[] = Array.isArray(component.columns) && component.columns.length
    ? component.columns.filter((c) => c && typeof c.key === "string")
    : Object.keys(rows[0] || {}).filter((k) => k !== "id").map((key) => ({ key, label: key }));
  if (!rows.length || !columns.length) return null;

  const price = priceColumn(columns, rows);
  const nameColumn = columns.find((c) => c !== price) || columns[0];
  const others = columns.filter((c) => c !== price && c !== nameColumn);

  if (price && price !== nameColumn && rows.length >= 2 && rows.length <= 12 && columns.length <= 4) {
    const items: CarouselCard[] = rows.map((row, i) => {
      const name = cellText(row[nameColumn.key], nameColumn) || `${i + 1}`;
      return {
        id: `${i}-${name}`,
        title: name,
        sub: others.map((c) => cellText(row[c.key], c)).filter(Boolean).join(" · ") || undefined,
        price: cellText(row[price.key], price) || undefined,
        action: onSendMessage
          ? { label: copy.pricesAsk, ariaLabel: copy.pricesAskLabel(name), onClick: () => onSendMessage(copy.pricesAskAbout(name)) }
          : undefined,
      };
    });
    return (
      <section className="ar-prices" data-slot="data-table" aria-label={component.title || copy.pricesLabel}>
        {component.title ? <h3 className="ar-prices-title">{component.title}</h3> : null}
        <CardCarousel items={items} label={component.title || copy.pricesLabel} />
      </section>
    );
  }

  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  // The name is not always the first column ([Prezzo, Servizio]).
  const valueColumns = columns.filter((c) => c !== nameColumn);
  const twoColumn = columns.length === 2;
  return (
    <section className="ar-card ar-table-card" data-slot="data-table" aria-label={component.title || undefined}>
      {component.title || component.description ? (
        <div className="ar-card-heading">
          {component.title ? <h3 className="ar-card-title">{component.title}</h3> : null}
          {component.description ? <p className="ar-card-sub">{component.description}</p> : null}
        </div>
      ) : null}
      <ul className="ar-rows">
        {shown.map((row, i) => {
          const label = cellText(row[nameColumn.key], nameColumn);
          if (twoColumn) {
            const valueColumn = valueColumns[0];
            return (
              <li key={i} className="ar-row">
                <span className="ar-row-label">{label}</span>
                <span className="ar-row-value">{cellText(row[valueColumn.key], valueColumn)}</span>
              </li>
            );
          }
          const details = valueColumns
            .map((c) => ({ label: c.label || c.key, value: cellText(row[c.key], c) }))
            .filter((d) => d.value);
          return (
            <li key={i} className="ar-row ar-row--stack">
              <span className="ar-row-label">{label}</span>
              {details.length ? (
                <dl className="ar-row-details">
                  {details.map((d) => (
                    <div key={d.label}><dt>{d.label}</dt><dd>{d.value}</dd></div>
                  ))}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
      {rows.length > VISIBLE_ROWS ? (
        <button type="button" className="ar-text-btn" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? copy.pricesShowLess : copy.pricesShowAll(rows.length)}
        </button>
      ) : null}
    </section>
  );
}
