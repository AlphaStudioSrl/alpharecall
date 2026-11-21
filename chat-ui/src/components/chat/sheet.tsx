import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Bottom sheets that slide up over the conversation (consent, booking,
 * guided questions). The panel body owns one host element; cards rendered deep
 * inside the scrolling thread portal into it so the sheet covers the panel
 * instead of scrolling away with the messages.
 */
const SheetHostContext = React.createContext<HTMLElement | null>(null);

export function ChatSheetHost({ children }: { children: React.ReactNode }) {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  return (
    <SheetHostContext.Provider value={host}>
      {children}
      <div ref={setHost} className="ar-sheet-host" />
    </SheetHostContext.Provider>
  );
}

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside `container`; Escape calls `onEscape` without closing the panel. */
export function trapSheetKeys(event: React.KeyboardEvent, container: HTMLElement | null, onEscape?: () => void) {
  if (event.key === "Escape") {
    event.stopPropagation();
    if (onEscape) { event.preventDefault(); onEscape(); }
    return;
  }
  if (event.key !== "Tab" || !container) return;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

export type ChatSheetProps = {
  open: boolean;
  /** Called by the scrim, the close button and Escape. Omit to make the sheet modal-only. */
  onClose?: () => void;
  /** Accessible name; pass `labelledBy` instead when the sheet renders its own heading. */
  label?: string;
  labelledBy?: string;
  closeLabel?: string;
  children: React.ReactNode;
  className?: string;
};

/** One sheet over the conversation. Renders inline when no host is mounted (tests, previews). */
export function ChatSheet({ open, onClose, label, labelledBy, closeLabel = "Chiudi", children, className }: ChatSheetProps) {
  const host = React.useContext(SheetHostContext);
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const first = sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first || sheetRef.current)?.focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  const layer = (
    <div className="ar-sheet-layer">
      <div className="ar-sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy} tabIndex={-1}
        className={`ar-sheet${className ? ` ${className}` : ""}`}
        onKeyDown={(event) => trapSheetKeys(event, sheetRef.current, onClose)}>
        <span className="ar-sheet-handle" aria-hidden="true" />
        {onClose ? (
          <button type="button" className="ar-sheet-close" aria-label={closeLabel} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
  return host ? createPortal(layer, host) : layer;
}
