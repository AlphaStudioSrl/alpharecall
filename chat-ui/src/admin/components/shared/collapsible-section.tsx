import { useCallback, useState, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

const STORE_PREFIX = "ar-settings-collapse:";

function readStored(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(STORE_PREFIX + id);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* ignore */
  }
  return fallback;
}

interface CollapsibleSectionProps {
  /** Stable id used to persist the open/closed state across reloads. */
  id: string;
  title: string;
  /** Animated/lucide icon component shown in the header. */
  icon?: LucideIcon;
  /** Open state used only on first visit (no stored preference yet). */
  defaultOpen?: boolean;
  /** Optional trailing element in the header (e.g. a count badge). */
  badge?: ReactNode;
  children: ReactNode;
}

/**
 * An accordion-style settings panel: a clickable header (icon + title +
 * chevron) over collapsible content. Built on Radix Collapsible so the content
 * is correctly removed from the a11y/tab order when closed (no focus leak) and
 * animates smoothly via the collapsible-down/up keyframes. The open/closed
 * state is persisted in localStorage so it survives reloads and navigation.
 * Borderless by design — separated by the card background + spacing.
 */
export function CollapsibleSection({
  id,
  title,
  icon: Icon,
  defaultOpen = false,
  badge,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(() => readStored(id, defaultOpen));

  const onOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      try {
        localStorage.setItem(STORE_PREFIX + id, next ? "1" : "0");
      } catch {
        /* ignore */
      }
    },
    [id]
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="rounded-xl bg-card shadow-sm"
    >
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors cursor-pointer",
          "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        )}
      >
        {Icon && (
          <Icon className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
        )}
        <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
        {badge}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="px-4 pb-4 pt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
