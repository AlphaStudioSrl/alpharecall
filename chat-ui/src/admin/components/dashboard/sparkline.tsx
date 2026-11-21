import { useEffect, useRef, useState } from "react";
import { cn } from "@/admin/lib/utils";

/**
 * A quiet trend line: soft accent area, accent stroke, a dot on the latest
 * value. No axes; the numbers next to it carry the meaning, and `label`
 * gives screen readers the same sentence.
 *
 * Drawn at the measured width so the end dot stays round.
 */
export function Sparkline({ values, label, height = 70, className }: { values: number[]; label: string; height?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 5;
  const max = Math.max(1, ...values);
  const n = values.length;
  const points = values.map((v, i) => ({
    x: n > 1 ? pad + (i / (n - 1)) * (width - pad * 2) : width / 2,
    y: pad + (1 - v / max) * (height - pad * 2),
  }));

  // Catmull-Rom through the points, as cubic Béziers: smooth without overshooting much.
  let line = "";
  points.forEach((p, i) => {
    if (i === 0) {
      line = `M${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      return;
    }
    const p0 = points[i - 2] ?? points[i - 1];
    const p1 = points[i - 1];
    const p3 = points[i + 1] ?? p;
    const c1x = p1.x + (p.x - p0.x) / 6;
    const c1y = Math.min(height - pad, Math.max(pad, p1.y + (p.y - p0.y) / 6));
    const c2x = p.x - (p3.x - p1.x) / 6;
    const c2y = Math.min(height - pad, Math.max(pad, p.y - (p3.y - p1.y) / 6));
    line += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  });
  const last = points[points.length - 1];
  const area = points.length ? `${line} L${last.x.toFixed(1)} ${height} L${points[0].x.toFixed(1)} ${height}Z` : "";

  return (
    <div ref={ref} className={cn("ar-spark", className)} role="img" aria-label={label}>
      {points.length > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
          <path d={area} className="ar-spark-area" />
          <path d={line} className="ar-spark-line" />
          <circle cx={last.x} cy={last.y} r={4} className="ar-spark-dot" />
        </svg>
      )}
    </div>
  );
}
