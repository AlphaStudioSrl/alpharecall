import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, RefreshCw, Sparkles } from "@/components/icons";
import { useBackgroundJobs } from "@/admin/hooks/use-background-jobs";
import { useApp } from "@/admin/app-context";

/**
 * Header indicator for long-running background jobs (content reindex, FAQ
 * generation). Visible on every section because the background-jobs state lives
 * at the app level, so the status persists when navigating between sections.
 * Renders nothing when no job is active (no idle clutter).
 */
export function BackgroundJobsIndicator() {
  const { t } = useApp();
  const { ingestionStatus, ingestionProgress, faqRunning } = useBackgroundJobs();

  const ingestionActive = ingestionStatus === "running" || ingestionStatus === "pending";
  const count = (ingestionActive ? 1 : 0) + (faqRunning ? 1 : 0);
  if (count === 0) return null;

  const total = ingestionProgress?.total ?? 0;
  const processed = ingestionProgress?.processed ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ark-ib w-auto gap-1.5 px-2.5 text-xs font-medium text-primary inline-flex"
          aria-label={t("jobs.title") || "Attività in corso"}
          title={t("jobs.title") || "Attività in corso"}
        >
          <Loader2 className="size-4 animate-spin" />
          <span className="tabular-nums">{count}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("jobs.title") || "Attività in corso"}
        </p>

        {ingestionActive && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <RefreshCw className="size-3.5 animate-spin text-primary" />
              <span className="font-medium">{t("jobs.reindexing") || "Reindicizzazione contenuti"}</span>
            </div>
            {pct !== null ? (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {processed}/{total} · {pct}%
                </p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">{t("messages.loading")}</p>
            )}
            {ingestionProgress?.current && (
              <p className="truncate text-[11px] text-muted-foreground">{ingestionProgress.current}</p>
            )}
          </div>
        )}

        {faqRunning && (
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Sparkles className="size-3.5 text-primary" />
            <span className="font-medium">{t("jobs.generatingFaq") || "Generazione FAQ"}</span>
            <Loader2 className="ml-auto size-3 animate-spin text-muted-foreground" />
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
