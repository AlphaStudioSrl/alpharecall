import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { SurfacePortal } from "@/components/ui/surface-portal";
import { ChevronDown, Check } from "@/components/icons";
import { cn } from "@/lib/utils";

interface SelectOption {
  value: string;
  label: string;
}

interface InlineSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  /** id of the visible label element; gives the trigger an accessible name */
  ariaLabelledby?: string;
  ariaLabel?: string;
}

const MENU_MAX_HEIGHT = 240;

/**
 * Custom select dropdown. The menu is portaled to document.body with fixed
 * positioning so it can never be clipped by overflow-hidden ancestors
 * (collapsible sections, cards, scroll containers).
 */
export function InlineSelect({
  value,
  onChange,
  options,
  placeholder = "Select...",
  className,
  ariaLabelledby,
  ariaLabel,
}: InlineSelectProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);

  const selectedOption = options.find((o) => o.value === value);

  const handleSelect = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
    },
    [onChange]
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimated = Math.min(MENU_MAX_HEIGHT, options.length * 36 + 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < estimated + 8 && rect.top > estimated + 8;
    setPos({
      top: above ? rect.top - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      above,
    });
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // Reposition while open on scroll (any scroller) and resize
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open, updatePosition]);

  // Close on outside click (trigger and portaled menu are separate subtrees)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-labelledby={ariaLabelledby}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className={cn(
          "ar-ui-select flex h-10 w-full items-center justify-between rounded-md border-0 bg-muted px-3 py-2 text-sm text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          !selectedOption && "text-muted-foreground",
          className
        )}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && pos &&
        <SurfacePortal>
          <div
            ref={menuRef}
            className="ar-ui-menu fixed rounded-md border-0 bg-card shadow-lg overflow-hidden animate-in fade-in-0 zoom-in-95"
            // Inside a modal dialog the body is pointer-events:none and the
            // dialog dismisses on any pointerdown outside its subtree; this
            // menu lives outside it (portal), so opt back in and keep the
            // pointerdown from reaching the dialog's document listener.
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              top: pos.above ? undefined : pos.top,
              bottom: pos.above ? window.innerHeight - pos.top : undefined,
              left: pos.left,
              width: pos.width,
              zIndex: 100000,
              pointerEvents: "auto",
            }}
          >
            <div className="max-h-60 overflow-y-auto py-1">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors",
                    "hover:bg-muted/50",
                    value === option.value && "bg-muted"
                  )}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      value === option.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </SurfacePortal>}
    </>
  );
}
