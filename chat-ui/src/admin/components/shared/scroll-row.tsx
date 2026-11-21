import { useCallback, useEffect, useState, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/utils";

interface ScrollRowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export interface ScrollEdges {
  start: boolean;
  end: boolean;
}

/**
 * Which ends of a horizontal scroller still hide content. Spread
 * `fadeAttrs(edges)` on the element and give it a mask on `[data-fade-*]`
 * (`.ark-scroll-row` in kit.css, the frame's nav rows in frame.css).
 * `ref` is a callback ref, so an element that mounts later is picked up.
 */
export function useScrollEdges<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });

  useEffect(() => {
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const start = el.scrollLeft > 1;
      const end = max - el.scrollLeft > 1;
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    measure();
    // The row resizing (a narrower page) changes what fits...
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // ...and so do chips arriving or their counts changing, which leave the
    // row's own box the same size: only the overflow grows.
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(measure) : null;
    mo?.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro?.disconnect();
      mo?.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [el]);

  return { ref: setEl, el, edges };
}

export function fadeAttrs(edges: ScrollEdges) {
  return { "data-fade-start": edges.start || undefined, "data-fade-end": edges.end || undefined };
}

/**
 * Scroll a sideways row so `item` sits in its middle. Moves the row only:
 * scrollIntoView could also scroll the WordPress page.
 */
export function centerInRow(row: HTMLElement, item: HTMLElement): void {
  if (row.scrollWidth <= row.clientWidth) return;
  const r = row.getBoundingClientRect();
  const a = item.getBoundingClientRect();
  row.scrollLeft += a.left - r.left - (r.width - a.width) / 2;
}

/**
 * Keep a nav row's current entry (`[aria-current="page"]`) centred: on open,
 * when `key` changes, and when the entries change size (web fonts landing, a
 * count appearing), which moves the entry after the first pass. Once the
 * user swipes or scrolls the row it is theirs until the next `key`.
 */
export function useCenterCurrent(row: HTMLElement | null, key: unknown): void {
  useEffect(() => {
    if (!row) return;
    let touched = false;
    const center = () => {
      if (touched) return;
      const current = row.querySelector<HTMLElement>('[aria-current="page"]');
      if (current) centerInRow(row, current);
    };
    const hands = () => { touched = true; };
    center();
    const events = ["pointerdown", "wheel", "touchstart", "keydown"] as const;
    events.forEach((name) => row.addEventListener(name, hands, { passive: true }));
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(center) : null;
    ro?.observe(row);
    Array.from(row.children).forEach((child) => ro?.observe(child));
    return () => {
      ro?.disconnect();
      events.forEach((name) => row.removeEventListener(name, hands));
    };
  }, [row, key]);
}

/**
 * Horizontal scroller that shows which edge still has content.
 *
 * Tab strips and chip rows hide their scrollbar for looks, so on a phone the
 * row just looked cut off and nobody swiped (Domande frequenti hid 3 to 7
 * categories). The edges fade out while there is more to scroll to and come
 * back sharp once reached. The fade is a mask (`.ark-scroll-row` in kit.css),
 * so it works on any surface without matching its colour. Whether the row
 * scrolls or wraps is the caller's CSS: a wrapping row never overflows, so it
 * never fades.
 */
export function ScrollRow({ children, className, ref: outerRef, ...props }: ScrollRowProps) {
  const { ref, edges } = useScrollEdges<HTMLDivElement>();

  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      ref(el);
      if (typeof outerRef === "function") outerRef(el);
      else if (outerRef) (outerRef as { current: HTMLDivElement | null }).current = el;
    },
    [ref, outerRef]
  );

  return (
    <div ref={setRef} className={cn("ark-scroll-row", className)} {...fadeAttrs(edges)} {...props}>
      {children}
    </div>
  );
}
