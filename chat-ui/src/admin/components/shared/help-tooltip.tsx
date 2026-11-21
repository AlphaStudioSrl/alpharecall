import { useState, useRef, useCallback, useId, useLayoutEffect } from "react";
import { SurfacePortal } from "@/components/ui/surface-portal";
import { HelpCircle } from "@/components/icons";

interface HelpTooltipProps {
  text: string;
}

/**
 * Portaled into an owned layer to retain its theme without being clipped by a
 * collapsible section. Supports hover, keyboard focus and touch dismissal.
 */
export function HelpTooltip({ text }: HelpTooltipProps) {
  const [show, setShow] = useState(false);
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleEnter = useCallback(() => {
    clearTimeout(hideTimer.current);
    setShow(true);
  }, []);
  const handleLeave = () => {
    hideTimer.current = setTimeout(() => {
      if (document.activeElement !== ref.current) setShow(false);
    }, 150);
  };
  useLayoutEffect(() => () => clearTimeout(hideTimer.current), []);

  const place = useCallback(() => {
    if (!ref.current || !tipRef.current) return;
    const rect = ref.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    setPosition({
      top: rect.top > tip.height + 12 ? rect.top - tip.height - 8 : rect.bottom + 8,
      left: Math.max(8, Math.min(rect.left + rect.width / 2 - tip.width / 2, window.innerWidth - tip.width - 8)),
    });
  }, []);
  const setTipRef = useCallback((node: HTMLDivElement | null) => {
    tipRef.current = node;
    if (node) place();
  }, [place]);

  useLayoutEffect(() => {
    if (!show) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setShow(false); };
    window.addEventListener("keydown", dismiss);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", dismiss);
    };
  }, [show, place]);

  return (
    <>
      <button ref={ref} type="button" aria-label={text} aria-describedby={show ? id : undefined}
        /* 24 x 24 to tap (WCAG 2.5.8), laid out as the 22 x 22 it was. */
        className="inline-flex shrink-0 items-center justify-center rounded p-[5px] -m-px text-muted-foreground hover:text-foreground cursor-help"
        onMouseEnter={handleEnter} onMouseLeave={handleLeave} onFocus={handleEnter}
        onBlur={() => setShow(false)} onClick={() => setShow(true)}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setShow(false); } }}>
        <HelpCircle aria-hidden="true" className="size-3.5" />
      </button>
      {show && <SurfacePortal>
        <div
          id={id} ref={setTipRef} role="tooltip"
          onMouseEnter={handleEnter} onMouseLeave={handleLeave}
          style={position}
          className="fixed z-[100001] w-[260px] max-w-[calc(100vw-16px)] px-3 py-2 rounded-md bg-card text-card-foreground border border-border text-xs leading-relaxed shadow-lg whitespace-normal"
        >
          {text}
        </div>
      </SurfacePortal>}
    </>
  );
}

/**
 * Label with inline help tooltip
 */
export function LabelWithHelp({
  children,
  help,
}: {
  children: React.ReactNode;
  help: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <HelpTooltip text={help} />
    </div>
  );
}
