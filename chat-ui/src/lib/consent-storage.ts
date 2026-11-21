/**
 * GDPR/ePrivacy-gated localStorage helper for the chat widget.
 *
 * ePrivacy Art. 5(3) requires consent before storing or reading data on
 * the user's terminal equipment, EXCEPT when storage is strictly necessary
 * for a service the user explicitly requested.
 *
 * Policy:
 *   - `strictlyNecessary: true`  → bypass gate (always allowed)
 *   - `strictlyNecessary: false` → require consent (or tenant has no
 *                                   privacy_notice_url configured, in
 *                                   which case fall back to legacy
 *                                   behavior to preserve zero-impact)
 *
 * The consent decision itself is stored under a strictly-necessary key
 * (`alpharecall_consent:{host}`) so the helper can bootstrap without
 * infinite recursion.
 */

const CONSENT_KEY = () => `alpharecall_consent:${window.location.host}`;

export type ConsentState = "granted" | "declined" | null;

export function readConsent(): ConsentState {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY());
    if (raw === "granted" || raw === "declined") return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeConsent(state: Exclude<ConsentState, null>): void {
  try {
    window.localStorage.setItem(CONSENT_KEY(), state);
  } catch { /* storage disabled / full */ }
}

export function clearConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_KEY());
  } catch { /* ignored */ }
}

interface Options {
  strictlyNecessary?: boolean;
  /** When no privacyNoticeUrl is configured, fall back to unconditional access
   *  (legacy / zero-impact). Default true. */
  fallbackWhenUnconfigured?: boolean;
  /** Whether the tenant has a privacy notice configured. If false, we're in
   *  legacy mode and convenience items pass through. */
  privacyNoticeConfigured?: boolean;
}

function isAllowed(opts: Options): boolean {
  if (opts.strictlyNecessary) return true;
  if (opts.fallbackWhenUnconfigured !== false && !opts.privacyNoticeConfigured) {
    return true;
  }
  return readConsent() === "granted";
}

export function getGatedItem(key: string, opts: Options = {}): string | null {
  if (!isAllowed(opts)) return null;
  try { return window.localStorage.getItem(key); }
  catch { return null; }
}

export function setGatedItem(key: string, value: string, opts: Options = {}): boolean {
  if (!isAllowed(opts)) return false;
  try { window.localStorage.setItem(key, value); return true; }
  catch { return false; }
}

export function removeGatedItem(key: string): void {
  // Deletions are always allowed — they never write new data and are often
  // required for "forget me" flows that predate any consent state.
  try { window.localStorage.removeItem(key); } catch { /* ignored */ }
}
