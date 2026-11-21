/**
 * Window events the frame listens for, so anything (the account menu, a
 * Ctrl K action, a page) can open frame-level overlays without prop drilling.
 *
 *   window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));
 */

/** Opens the Ctrl K command palette (detail: `{ opener }`, see openCommandPalette). */
export const OPEN_PALETTE_EVENT = "ar-open-palette";
/** Opens the AlphaRecall support chat popup. */
export const OPEN_SUPPORT_EVENT = "ar-open-support";

/**
 * Opens the Ctrl K command palette. `opener` gets focus back when it closes
 * (Safari does not focus a clicked button, so the palette cannot read it from
 * document.activeElement).
 */
export function openCommandPalette(opener?: HTMLElement): void {
  window.dispatchEvent(new CustomEvent<{ opener?: HTMLElement }>(OPEN_PALETTE_EVENT, { detail: { opener } }));
}

/** "⌘ K" on Apple keyboards, "Ctrl K" elsewhere. */
export function paletteShortcutLabel(): string {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  return /mac|iphone|ipad/i.test(platform) ? "⌘ K" : "Ctrl K";
}
