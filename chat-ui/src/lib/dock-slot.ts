import * as React from "react";

/**
 * A page can give the widget a place to live: any element marked
 * `data-alpharecall-dock` (the marketing hero, a 404 page). There is still one
 * widget and one conversation. While it is closed the panel sits over the slot
 * instead of hiding, and the launcher only comes back once the slot has scrolled
 * out of view. The panel stays in the widget's own root, outside the host theme's
 * CSS: the slot only reserves the space and supplies size and corner radius.
 * The slot must scroll with the page: the panel is not moved on scroll, so a sticky
 * or fixed slot would stay on screen with the chat gone from it.
 */
export const DOCK_SELECTOR = "[data-alpharecall-dock]";

export type DockFrame = { top: number; left: number; width: number; height: number; radius: string };

export const findDockSlot = (): HTMLElement | null =>
  typeof document === "undefined" ? null : document.querySelector<HTMLElement>(DOCK_SELECTOR);

/** A slot hidden at this breakpoint counts as no slot at all. */
export const findVisibleDockSlot = (): HTMLElement | null => {
  const slot = findDockSlot();
  return slot && slot.getClientRects().length > 0 ? slot : null;
};

/** Where the slot is, in the coordinates of the panel's containing block. */
function measure(slot: HTMLElement, panel: HTMLElement | null): DockFrame {
  const rect = slot.getBoundingClientRect();
  const parent = panel?.offsetParent;
  const positioned = parent instanceof HTMLElement && parent !== document.body && parent !== document.documentElement;
  const origin = positioned ? parent.getBoundingClientRect() : { top: -window.scrollY, left: -window.scrollX };
  return {
    top: rect.top - origin.top,
    left: rect.left - origin.left,
    width: rect.width,
    height: rect.height,
    radius: getComputedStyle(slot).borderRadius,
  };
}

const sameFrame = (a: DockFrame | null, b: DockFrame) =>
  !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height && a.radius === b.radius;

/** Follows the slot. A slot hidden at this breakpoint has no box, so the widget acts as if there were none. */
export function useDockSlot(panelRef: React.RefObject<HTMLElement | null>, isOpen: boolean) {
  const [slot] = React.useState(findDockSlot);
  const [frame, setFrame] = React.useState<DockFrame | null>(null);
  const [inView, setInView] = React.useState(false);
  const updateRef = React.useRef<() => void>(() => {});

  React.useLayoutEffect(() => {
    if (!slot) return;
    const update = () => {
      const hidden = slot.getClientRects().length === 0;
      setFrame((current) => {
        if (hidden) return null;
        const next = measure(slot, panelRef.current);
        return sameFrame(current, next) ? current : next;
      });
    };
    updateRef.current = update;
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(slot);
    observer?.observe(document.documentElement);
    window.addEventListener("resize", update);
    window.addEventListener("load", update);
    void document.fonts?.ready.then(update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("load", update);
    };
  }, [slot, panelRef]);

  // Coming back from floating: the position was last read while the panel was fixed, which
  // has no offset parent. Re-read it before paint, now that the panel is absolute again.
  React.useLayoutEffect(() => {
    updateRef.current();
  }, [isOpen]);

  React.useEffect(() => {
    if (!slot || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(!!entry && entry.intersectionRatio >= 0.25);
        // Content above the slot may have moved it without resizing anything observed.
        updateRef.current();
      },
      { threshold: [0, 0.25, 0.5] },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);

  return { slot: frame ? slot : null, frame, inView: !!frame && inView };
}

/** Puts text in the composer as if typed. Nothing is sent: a visitor's click is what spends a message. */
export function prefillComposer(panel: HTMLElement | null, text: string) {
  const field = panel?.querySelector<HTMLTextAreaElement>(".ar-chat-composer textarea");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!field || !setValue || field.value) return false;
  setValue.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}
