import type React from "react";
import { cn } from "@/admin/lib/utils";
import type { LucideIcon } from "@/components/icons";
import type { IndexedDocument } from "@/admin/hooks/use-documents";
import "./assistant.css";

/**
 * The assistant's display name as the visitor sees it. "AlphaRecall" is the
 * unset default the API writes, so it reads as "l'assistente" instead.
 */
export function assistantName(settings: { tenant_settings?: Record<string, unknown> } | undefined, fallback: string): string {
  const name = String(settings?.tenant_settings?.chatbot_name ?? "").trim();
  return name && name !== "AlphaRecall" ? name : fallback;
}

export type SourceKind = "site" | "file" | "text";

/**
 * Where an indexed document came from. Site pages and posts carry their
 * public URL; uploads carry an `upload://` URL (`upload://pdf/...` for PDFs,
 * written by the API) or a `pdf-` source id.
 */
export function sourceKind(doc: Pick<IndexedDocument, "source_url" | "source_id">): SourceKind {
  const url = String(doc.source_url || "");
  if (/^https?:\/\//i.test(url)) return "site";
  if (/^upload:\/\/pdf\//i.test(url) || /^pdf-/i.test(String(doc.source_id || "")) || /\.pdf$/i.test(url)) return "file";
  return "text";
}

/** The WordPress post id behind a synced page, when the source id is one. */
export function wpPostId(doc: Pick<IndexedDocument, "source_id" | "source_url">): number | null {
  if (sourceKind(doc) !== "site") return null;
  const id = Number(doc.source_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function pathOf(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/i, "").replace(/\/$/, "");
  return path || "/";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A coverage ring (x-ring): the share as a conic fill around the number. */
export function Ring({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className="as-ring"
      role="img"
      aria-label={label}
      style={{ background: `conic-gradient(var(--ar-accent) 0 ${pct}%, var(--ar-fill-2) 0)` }}
    >
      <span aria-hidden="true">{pct}%</span>
    </div>
  );
}

/** A soft tile: bare icon, an optional status on the right, a title and one line. */
export function Tile({
  icon: Icon,
  iconClass,
  status,
  title,
  sub,
  onClick,
  pressed,
  className,
  children,
  ...rest
}: {
  icon: LucideIcon;
  iconClass?: string;
  status?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  onClick?: () => void;
  pressed?: boolean;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "title" | "onClick">) {
  const body = (
    <>
      <span className="as-tile-top">
        <Icon aria-hidden="true" className={iconClass} />
        <span className="as-spacer" />
        {status}
      </span>
      <span className="as-tile-title">{title}</span>
      {sub && <span className="as-tile-sub">{sub}</span>}
      {children}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cn("as-tile", className)} onClick={onClick} aria-pressed={pressed} {...rest}>
        {body}
      </button>
    );
  }
  return (
    <div className={cn("as-tile", className)} {...rest}>
      {body}
    </div>
  );
}
