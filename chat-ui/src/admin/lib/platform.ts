/** Mac, iPhone and iPad keyboards use ⌘ where everything else uses Ctrl. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * The send shortcut of a multi-line composer: ⌘+Enter on Apple keyboards,
 * Ctrl+Enter elsewhere (either works anywhere, the label names the native
 * one). IME composition never sends.
 */
export function isSendShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; nativeEvent?: { isComposing?: boolean } }): boolean {
  if (e.key !== "Enter" || e.nativeEvent?.isComposing) return false;
  return e.metaKey || e.ctrlKey;
}

/** "⌘+Invio" or "Ctrl+Invio": pass the localized name of the Enter key. */
export function sendShortcutLabel(enterKey: string): string {
  return `${isApplePlatform() ? "⌘" : "Ctrl"}+${enterKey}`;
}
