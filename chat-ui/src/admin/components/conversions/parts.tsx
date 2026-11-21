/** Small pieces shared by the Richieste board, list, sheet and Agenda. */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tag, type Tone } from "@/admin/components/shared/kit";
import { cn } from "@/admin/lib/utils";
import { statusLabel } from "@/admin/lib/record-fields";
import { fetchAllRecords } from "@/admin/hooks/use-conversions-data";
import { errorText } from "@/admin/lib/api";
import { formatNumber } from "@/admin/lib/format";
import { RefreshCw } from "@/components/icons";
import { columnFor, kindInfo, statusTone, type Column, type RequestItem, type RequestKind, statusOptions } from "./request-model";

type T = (key: string) => string;

/** The type of a request: a soft pill with its bare icon (x-tag). */
export function KindTag({ kind, t, className }: { kind: RequestKind; t: T; className?: string }) {
  const info = kindInfo(kind, t);
  const Icon = info.icon;
  return (
    <Tag tone={info.tone} className={cn("a3-kind", className)}>
      <Icon aria-hidden="true" />
      {info.label}
    </Tag>
  );
}

export function columnLabel(column: Column, t: T): string {
  return t(`conversions.board.columns.${column}`);
}

/**
 * A record's status as Richieste names it: the stage of its column (Nuova,
 * In corso, Fatta), the one vocabulary of the board, the list and the sheet.
 * Each collection stores its own word (pending/read/replied, scheduled/
 * confirmed/completed...), and showing those next to the column names read
 * as two workflows. A lead has no column: its email opt-in state. A cancelled
 * booking is done without having happened, and an escalation that could not
 * be delivered needs someone: both keep their own word.
 */
export function stageLabel(kind: RequestKind, status: string, t: T): string {
  const column = columnFor(kind, status);
  if (!column || ownWord(kind, status)) return statusLabel(t, status);
  return t(`conversions.board.stage.${column}`);
}

function ownWord(kind: RequestKind, status: string): boolean {
  return (kind === "appointment" && status === "cancelled") || (kind === "escalation" && status === "failed");
}

const STAGE_TONE: Record<Column, Tone> = { new: "warn", doing: "info", done: "accent" };

/** The colour that goes with stageLabel: one per stage, red for the own words. */
export function stageTone(kind: RequestKind, status: string): Tone {
  const column = columnFor(kind, status);
  if (!column) return statusTone(status);
  return ownWord(kind, status) ? "red" : STAGE_TONE[column];
}

/**
 * The keyboard (and touch) way to move a card: a menu of the statuses the
 * record can take, each named with the column it lands in.
 */
export function StatusMenu({ item, t, onSet, trigger, align = "end" }: {
  item: RequestItem;
  t: T;
  onSet: (item: RequestItem, status: string) => void;
  trigger: ReactNode;
  align?: "start" | "end";
}) {
  const options = statusOptions(item);
  if (!options.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="a3-menu min-w-[210px]">
        <DropdownMenuLabel className="a3-menu-label">{t("conversions.board.moveTo")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={item.status} onValueChange={(status) => status !== item.status && onSet(item, status)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.status} value={o.status} className="a3-menu-item">
              <span>{columnLabel(o.column, t)}</span>
              {/* Only where two statuses share a column (a booking done or cancelled). */}
              {options.some((other) => other !== o && other.column === o.column) && <small>{statusLabel(t, o.status)}</small>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  run: () => Promise<unknown> | void;
  /** What did not happen, when `run` fails; "Non siamo riusciti a eliminare." by default. */
  failed?: string;
}

/** "Eliminare questa richiesta?" before anything is deleted. */
export function ConfirmDialog({ request, onClose, t }: { request: ConfirmRequest | null; onClose: () => void; t: T }) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await request.run();
      onClose();
    } catch (error) {
      toast.error(errorText(error, request.failed || t("conversions.board.deleteFailed")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="a3-confirm max-w-sm">
        {request && (
          <>
            <DialogHeader>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription>{request.description}</DialogDescription>
            </DialogHeader>
            <div className="a3-confirm-actions">
              <Button variant="secondary" onClick={onClose} disabled={busy}>{t("common.cancel") || "Annulla"}</Button>
              <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
                {busy && <RefreshCw className="animate-spin" aria-hidden="true" />}
                {request.confirmLabel}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Mostrati X di Y" plus "Carica altri"; hidden once everything is loaded. */
export function LoadMoreBar({ shown, total, loading, onLoadMore, t, label }: {
  shown: number;
  total: number;
  loading: boolean;
  onLoadMore: () => void;
  t: T;
  label?: string;
}) {
  if (total <= shown) return null;
  const text = (t("conversions.shownOf") || "Mostrati {shown} di {total}")
    .replace("{shown}", String(shown))
    .replace("{total}", String(total));
  return (
    <div className="a3-more">
      {label && <b>{label}</b>}
      <span>{text}</span>
      <Button variant="secondary" size="sm" onClick={onLoadMore} disabled={loading}>
        {loading && <RefreshCw className="animate-spin" aria-hidden="true" />}
        {t("conversions.loadMore") || "Carica altri"}
      </Button>
    </div>
  );
}

/** Fetch every record of a collection before exporting; toasts while running. */
export async function exportAll<R>(path: string, t: T, write: (rows: R[]) => void) {
  const id = toast.loading(t("conversions.exportPreparing") || "Preparo l'esportazione…");
  try {
    const result = await fetchAllRecords<R>(path);
    // Half a file would pass for the whole one: a failed page exports nothing.
    if (result.failed) throw new Error("export");
    write(result.rows);
    if (result.capped) {
      toast.warning(
        (t("conversions.exportCapped") || "Esportate le prime {count} righe su {total}.")
          .replace("{count}", formatNumber(result.rows.length))
          .replace("{total}", formatNumber(result.total ?? result.rows.length)),
        { id },
      );
    } else {
      toast.success(t("conversions.exportReady") || "Esportazione pronta", { id });
    }
  } catch (error) {
    toast.error(errorText(error, t("inboxPage.errors.export")), { id });
  }
}

/**
 * Run a status change: a toast names the new stage, or says that the change
 * did not happen and why (it used to say "Non siamo riusciti a salvare le
 * impostazioni", the settings page's message).
 */
export async function applyStatus(
  t: T,
  run: () => Promise<void>,
  status: string,
  kind?: RequestKind,
) {
  try {
    await run();
    toast.success(`${t("conversions.statusUpdated")}: ${kind ? stageLabel(kind, status, t) : statusLabel(t, status)}`);
  } catch (error) {
    toast.error(errorText(error, t("conversions.board.statusFailed")));
    throw new Error("status");
  }
}

/** "★★★★☆", or a dash for a comment without a score. */
export function stars(rating: number | null | undefined): string {
  if (rating == null) return "–";
  const filled = Math.round(Math.min(Math.max(rating, 0), 5));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}
