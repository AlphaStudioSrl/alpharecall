import { useId, type ElementType, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, Settings2 } from "@/components/icons";
import { useApp } from "@/admin/app-context";
import { hrefForRoute } from "@/admin/lib/nav";

/** Local to Results: a quiet, borderless alternative to an empty table. */
export function ResultsState({ icon: Icon, title, description, action }: {
  icon: ElementType;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col items-center px-4 py-12 text-center sm:py-16">
      <div role="status" aria-live="polite" aria-atomic="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} className="flex max-w-md flex-col items-center">
        <div className="mb-4 flex items-center justify-center text-[color:var(--ar-ink-3)]" aria-hidden="true">
          <Icon className="size-7" />
        </div>
        <h3 id={`${id}-title`} className="text-base font-semibold text-foreground">{title}</h3>
        <p id={`${id}-description`} className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action && <div className="mt-6 flex w-full max-w-xs justify-center sm:w-auto">{action}</div>}
    </div>
  );
}

export function ConfigureResultsTools() {
  const { t, isAdmin } = useApp();
  if (!isAdmin) return null;
  // Carattere e strumenti restores these on mount: open the tools list. A real
  // link, so it also works from WordPress and from the standalone fixture.
  const prepareSettings = () => {
    try {
      localStorage.setItem("ar-settings-collapse:agent-persona", "0");
      localStorage.setItem("ar-settings-collapse:agent-tools", "1");
    } catch { /* The page is still reachable when storage is unavailable. */ }
  };
  return (
    <Button asChild variant="secondary" className="h-auto min-h-10 w-full whitespace-normal sm:w-auto">
      <a href={hrefForRoute({ section: "assistente", view: "carattere" })} onClick={prepareSettings}>
        <Settings2 className="size-4 shrink-0" aria-hidden="true" />
        {t("conversions.empty.configureTools")}
      </a>
    </Button>
  );
}

export function ResultsError({ title, description, retryLabel, onRetry, loading = false }: {
  title: string;
  description: string;
  retryLabel: string;
  onRetry: () => void;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-8 text-center">
      <div role="alert" className="max-w-md">
        <AlertCircle className="mx-auto mb-3 size-6 text-destructive" aria-hidden="true" />
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <Button variant="secondary" onClick={onRetry} disabled={loading}>{retryLabel}</Button>
    </div>
  );
}
