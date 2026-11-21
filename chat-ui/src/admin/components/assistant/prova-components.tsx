import { isValidElement, type CSSProperties, type ComponentProps, type ReactNode } from "react";
import { useApp } from "@/admin/app-context";
import { markdownComponents } from "@/components/tambo/markdown-components";
import { ToolSlotBoundary } from "@/components/chat/tool-slot";
import { TableCard } from "@/components/generative-ui/table-card";
import { Chart } from "@/components/tool-ui/chart";
import { StatsDisplay } from "@/components/tool-ui/stats-display";
import { contrastColor } from "@/lib/brand-color";
import widgetCardsCss from "@/widget-cards.css?raw";
import widgetDesignCss from "@/widget-design.css?raw";

// The widget's card kit, scoped under the admin root like the Widget preview's.
// The card rules come first, as in the widget (see widget-cards.css), and
// load only while an answer with a card is on screen.
const scopedCss = [widgetCardsCss, widgetDesignCss].join("\n").split(".lp-root").join("#alpharecall-admin-app .lp-root");

const TABLES = new Set(["data_table", "table"]);
const CHARTS = new Set(["chart", "bar_chart", "line_chart", "area_chart"]);
const STATS = new Set(["stats", "stats_display"]);
/** Cards the widget draws that Prova only names: bookings, forms, maps, choices. */
const INTERACTIVE = new Set([
  "consent_required", "appointment_slots", "event_list", "geo_map", "map", "locations",
  "message_draft", "draft", "order_summary", "cart", "product_list", "product_carousel",
  "product_suggestions", "products", "fast_checkout", "checkout_form",
]);

/** The type as the widget's renderer reads it (tool-generative-renderer.tsx). */
function widgetType(component: Record<string, unknown>): string {
  return String(component.type ?? "").trim().toLowerCase();
}

const hasItems = (value: unknown) => Array.isArray(value) && value.length > 0;

/**
 * The one card the widget shows under this answer, in the order its renderer
 * picks it: a consent request, then a request to confirm, then the first
 * component it knows how to draw. `drawable` when it only displays data (a
 * table, a chart, numbers), which Prova draws with the widget's components;
 * an interactive card is only named. Null when the widget shows no card.
 */
export function widgetCard(components: Record<string, unknown>[]): { component: Record<string, unknown>; drawable: boolean } | null {
  const rank = (c: Record<string, unknown>) => (widgetType(c) === "consent_required" ? 0 : c.draft_id ? 1 : 2);
  const ordered = components.map((component, index) => ({ component, index }))
    .sort((a, b) => rank(a.component) - rank(b.component) || a.index - b.index)
    .map(({ component }) => component);
  for (const component of ordered) {
    const type = widgetType(component);
    if (rank(component) < 2) return { component, drawable: false };
    // An empty table, or choices without options, is skipped by the widget too.
    if (TABLES.has(type)) {
      if (hasItems(component.data)) return { component, drawable: true };
      continue;
    }
    if (type === "clarify" || type === "question_flow") {
      if (hasItems(component.items) || hasItems(component.options)) return { component, drawable: false };
      continue;
    }
    if (CHARTS.has(type) || STATS.has(type)) return { component, drawable: true };
    if (INTERACTIVE.has(type)) return { component, drawable: false };
    if (type === "tool_status" && String(component.status ?? "").toLowerCase() !== "error") return { component, drawable: false };
  }
  return null;
}

/** A read-only copy of the card the visitor sees under the answer. */
export function ProvaComponentPreview({ component }: { component: Record<string, unknown> }) {
  const { theme, settings } = useApp();
  const chat = (settings.chat_config || {}) as Record<string, unknown>;
  const brand = /^#[0-9a-f]{6}$/i.test(String(chat.primaryColor || "")) ? String(chat.primaryColor) : "";
  const id = widgetType(component);
  const style = brand ? ({ "--ar-tenant": brand, "--ar-on-tenant": contrastColor(brand) } as CSSProperties) : undefined;

  let card: ReactNode = null;
  if (TABLES.has(id)) {
    card = <TableCard component={component as any} />;
  } else if (CHARTS.has(id)) {
    const chartType = (component.chart_type || (id === "line_chart" ? "line" : "bar")) as "bar" | "line";
    card = <Chart {...(component as any)} type={chartType} />;
  } else if (STATS.has(id)) {
    card = <StatsDisplay locale="it-IT" {...(component as any)} />;
  }
  if (!card) return null;
  return (
    <div className="lp-root as-prova-card" data-theme={theme} style={style}>
      <style>{scopedCss}</style>
      <ToolSlotBoundary tool={id}>{card}</ToolSlotBoundary>
    </div>
  );
}

/** The plain text inside a table cell. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/**
 * A short figure that must stay on one line: "2/7", "€ 1.200,50", "15%",
 * "9:00-13:00". Next to a column of long text the table would otherwise
 * squeeze it until "2/7" breaks over two lines (card 85rkorpufcuq).
 */
export function isFigure(text: string): boolean {
  const value = text.trim();
  return value.length > 0 && value.length <= 24 && /\d/.test(value) && /^[\d\s.,:/%+\-–×x€$£()]+$/i.test(value);
}

/** The answer's markdown as the chat draws it, with figures kept whole in tables. */
export const provaMarkdownComponents = {
  ...markdownComponents,
  th: ({ children, style }: ComponentProps<"th">) => (
    <th className="border border-border bg-muted px-4 py-2 font-semibold" style={style} data-figure={isFigure(textOf(children)) ? "" : undefined}>
      {children}
    </th>
  ),
  td: ({ children, style }: ComponentProps<"td">) => (
    <td className="border border-border px-4 py-2" style={style} data-figure={isFigure(textOf(children)) ? "" : undefined}>
      {children}
    </td>
  ),
};
