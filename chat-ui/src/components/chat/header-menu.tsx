import * as React from "react";
import { Check, MoreHorizontal } from "lucide-react";

export type HeaderMenuItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Reflects a toggle (sounds) as menuitemcheckbox. */
  checked?: boolean;
};

/** The "..." menu in the widget header: secondary actions stay one tap away. */
export function HeaderMenu({ label, items }: { label: string; items: HeaderMenuItem[] }) {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();

  const close = React.useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not([disabled])')?.focus({ preventScroll: true });
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') || []);
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { setOpen(false); return; }
    const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (move && entries.length) {
      event.preventDefault();
      entries[(index + move + entries.length) % entries.length]?.focus();
    } else if ((event.key === "Home" || event.key === "End") && entries.length) {
      event.preventDefault();
      entries[event.key === "Home" ? 0 : entries.length - 1]?.focus();
    }
  };

  return (
    <div className="ar-header-menu">
      <button ref={buttonRef} type="button" className="ar-chat-header-btn ar-chat-header-btn--more"
        aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); setOpen(true); } }}>
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} role="menu" aria-label={label} className="ar-menu" onKeyDown={onMenuKeyDown}>
          {items.map((item) => (
            <button key={item.id} type="button" className="ar-menu-item"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked === undefined ? undefined : item.checked}
              disabled={item.disabled}
              onClick={() => { close(); item.onSelect(); }}>
              {item.icon}<span>{item.label}</span>
              {item.checked ? <Check aria-hidden="true" className="ar-menu-check" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
