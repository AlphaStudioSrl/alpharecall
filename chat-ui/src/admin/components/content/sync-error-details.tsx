import { useApp } from "@/admin/app-context";
import { cn } from "@/admin/lib/utils";

export function SyncErrorDetails({ message, className }: { message: string; className?: string }) {
  const { t } = useApp();
  if (message.length <= 200) {
    return <p className={cn("text-xs text-destructive whitespace-pre-wrap [overflow-wrap:anywhere]", className)}>{message}</p>;
  }
  return (
    <details className={cn("group min-w-0 text-xs text-destructive", className)}>
      <summary className="cursor-pointer rounded-md [overflow-wrap:anywhere]">
        <span className="group-open:hidden">{message.slice(0, 200)}… </span>
        <span className="text-foreground underline underline-offset-2 group-open:hidden">{t("content.showFullError")}</span>
        <span className="hidden text-foreground underline underline-offset-2 group-open:inline">{t("content.hideFullError")}</span>
      </summary>
      <pre tabIndex={0} aria-label={t("content.syncErrorDetails")} className="mt-2 max-h-80 overflow-y-auto rounded-md bg-muted p-3 font-sans text-xs text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">{message}</pre>
    </details>
  );
}

/**
 * The API and the sync hook report failures in English, for support. Map the
 * known ones to a line the site owner can act on; anything else gets a
 * generic one. Ordered: the first match wins.
 */
const SYNC_ERRORS: [RegExp, string][] = [
  // First: the start request's own reason (a timeout, say) is not the sync's.
  [/couldn't start the sync/i, "assistant.syncErrors.start"],
  [/could not read any content/i, "assistant.syncErrors.unreachable"],
  [/unsafe (tenant domain|ingestion target|source url)/i, "assistant.syncErrors.unsafe"],
  [/timed? ?out|timeout/i, "assistant.syncErrors.timeout"],
  [/fetch failed for|failed after retries|unsafe xml in sitemap/i, "assistant.syncErrors.fetch"],
];

export function syncErrorKey(message: string): string {
  return SYNC_ERRORS.find(([pattern]) => pattern.test(message))?.[1] ?? "assistant.syncErrors.generic";
}

/** A failed sync as one readable line; the raw error stays one click away for support. */
export function SyncErrorNotice({ message, className }: { message: string; className?: string }) {
  const { t } = useApp();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <p className="text-xs text-tone-red [overflow-wrap:anywhere]" title={message}>{t(syncErrorKey(message))}</p>
      <details className="text-[11.5px] text-ink-3">
        <summary className="cursor-pointer self-start">{t("assistant.syncErrors.details")}</summary>
        <SyncErrorDetails message={message} className="mt-1 text-ink-3" />
      </details>
    </div>
  );
}
