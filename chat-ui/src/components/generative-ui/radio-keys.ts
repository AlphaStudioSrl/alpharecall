import type * as React from "react";

/**
 * Arrow keys for a row or grid of role="radio" buttons: move focus to the
 * next enabled radio and select it, as the ARIA radio group pattern expects.
 */
export function moveRadioFocus(event: React.KeyboardEvent<HTMLElement>, onPick?: (el: HTMLElement) => void) {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
        : 0;
  if (!step) return;
  const group = event.currentTarget;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'));
  if (!radios.length) return;
  event.preventDefault();
  const index = radios.indexOf(document.activeElement as HTMLElement);
  const next = radios[(index + step + radios.length) % radios.length];
  next.focus();
  onPick?.(next);
}

/** Only the checked radio (or the first one) is in the Tab order. */
export function radioTabIndex(checked: boolean, index: number, anyChecked: boolean) {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
