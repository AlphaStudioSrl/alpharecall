import { useMemo } from "react";
import { useApp } from "@/admin/app-context";
import { toNumber, formatNumber } from "@/admin/lib/format";
import type { AnalyticsEntry } from "@/admin/hooks/use-dashboard";
import { toolLabel } from "@/admin/lib/tool-labels";

interface ToolUsageWidgetProps {
  analytics: AnalyticsEntry[];
}

interface ToolStat {
  name: string;
  count: number;
}

export function ToolUsageWidget({ analytics }: ToolUsageWidgetProps) {
  const { t } = useApp();

  const tools = useMemo(() => {
    // By the owner's name for the tool: reading and changing a booking are the booking tool.
    const map = new Map<string, number>();
    for (const entry of analytics) {
      if (entry.tool_name) {
        const name = toolLabel(t, entry.tool_name);
        map.set(name, (map.get(name) || 0) + toNumber(entry.count ?? entry.tool_calls ?? 1));
      }
    }
    const sorted: ToolStat[] = [];
    for (const [name, count] of map) {
      sorted.push({ name, count });
    }
    sorted.sort((a, b) => b.count - a.count);
    return sorted.slice(0, 8);
  }, [analytics, t]);

  const total = tools.reduce((s, t) => s + t.count, 0);

  if (!tools.length) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        {t("messages.noToolUsage")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t("badges.toolUses")}</span>
        <span>{formatNumber(total)}</span>
      </div>
      <ul className="space-y-2">
        {tools.map((tool) => {
          const pct = total > 0 ? Math.round((tool.count / total) * 100) : 0;
          return (
            <li key={tool.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-foreground">{tool.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {formatNumber(tool.count)} ({pct}%)
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
