/**
 * Contatti's Lead and Appuntamento badges. The directory has no status of
 * its own: leads and appointments are matched to people by address. The API
 * cannot filter either list by address, so the newest ones are read, which is
 * who the first pages of the directory (newest activity first) are.
 *
 * One read serves every visit for SIGNAL_TTL_MS, and visits during a read
 * share it: Contatti used to page both lists in full, in parallel, on every
 * visit, which with thousands of rows was enough to hit the rate limit.
 */
import { apiFetch } from "@/admin/lib/api";
import { getConfig } from "@/admin/lib/config";
import { asPage, readPages, type PagedRows } from "@/admin/lib/paging";

export type Signal = "lead" | "appointment";

export interface ContactSignals {
  signals: Map<string, Signal>;
  /** Both lists were read to the end. */
  complete: boolean;
  /** A page failed, so badges may be missing for a reason other than volume. */
  failed: boolean;
}

export const SIGNAL_PAGE = 500; // the API's largest page
export const SIGNAL_MAX_ROWS = 4 * SIGNAL_PAGE; // of each list
export const SIGNAL_TTL_MS = 60_000;
const SIGNAL_PAUSE_MS = 100;

interface CacheEntry {
  scope: string;
  at: number;
  value?: ContactSignals;
  pending?: Promise<ContactSignals>;
}

let cache: CacheEntry | null = null;

function scopeKey(): string {
  const config = getConfig();
  return JSON.stringify([config?.restUrl, config?.settings?.tenant_id, config?.currentUser?.id]);
}

function readList(path: string): Promise<PagedRows<Record<string, unknown>>> {
  return readPages(
    async (offset, limit) => asPage<Record<string, unknown>>(
      await apiFetch<unknown>(`${path}?limit=${limit}&offset=${offset}&with_total=1`, { cache: "reload" }),
    ),
    { pageSize: SIGNAL_PAGE, maxRows: SIGNAL_MAX_ROWS, pauseMs: SIGNAL_PAUSE_MS },
  );
}

async function readSignals(): Promise<ContactSignals> {
  const signals = new Map<string, Signal>();
  // One list after the other, and a failure ends the read: the second list
  // would only meet the same limit.
  const leads = await readList("/tools/leads");
  for (const lead of leads.rows) {
    const email = String(lead.email || "").toLowerCase();
    if (email) signals.set(email, "lead");
  }
  if (leads.failed) return { signals, complete: false, failed: true };
  const appointments = await readList("/tools/appointments");
  for (const appointment of appointments.rows) {
    const info = (appointment.user_info || {}) as Record<string, unknown>;
    const email = String(info.email || "").toLowerCase();
    if (email) signals.set(email, "appointment");
  }
  return { signals, complete: leads.complete && appointments.complete, failed: appointments.failed };
}

/** The last read for this site and user while it is fresh, for a first paint without a wait. */
export function cachedContactSignals(now = Date.now()): ContactSignals | null {
  if (!cache?.value || cache.scope !== scopeKey() || now - cache.at >= SIGNAL_TTL_MS) return null;
  return cache.value;
}

/** The badges, from the cache, the read in flight, or a new read. Never rejects. */
export function loadContactSignals(now = Date.now()): Promise<ContactSignals> {
  const scope = scopeKey();
  if (cache?.scope === scope) {
    if (cache.pending) return cache.pending;
    if (cache.value && now - cache.at < SIGNAL_TTL_MS) return Promise.resolve(cache.value);
  }
  const pending = readSignals().catch((): ContactSignals => ({ signals: new Map(), complete: false, failed: true }));
  const entry: CacheEntry = { scope, at: now, pending };
  cache = entry;
  void pending.then((value) => {
    // A failed read is kept too, for the same time: retrying on every visit is the storm this avoids.
    if (cache === entry) cache = { scope, at: Date.now(), value };
  });
  return pending;
}

/** Forget the cached badges (tests, and after a change that should show at once). */
export function resetContactSignals(): void {
  cache = null;
}
