import { useSyncExternalStore } from "react";
import { apiFetch } from "./api";
import { getConfig } from "./config";

/**
 * The plan's message usage for the top bar (GET /quota, or the `quota` the
 * /dashboard payload already carries). Oggi and the Piano page publish what
 * they load, so the header shows it without a request of its own there; on
 * another page it asks once, after the page's own requests, and the answer
 * is kept for a few minutes across page loads of this tab.
 */
export interface PlanUsage {
  used: number;
  allowance: number;
  /** The free trial counts for life, a paid plan per calendar month. */
  lifetime: boolean;
  /** The plan the API counts against (`license_tier`), when the payload names it. */
  tier?: string;
}

const CHANGED = "ar:plan-usage-changed";
const KEEP_MS = 5 * 60_000;
const storageKey = () => `ar-plan-usage:${getConfig()?.settings?.tenant_id ?? ""}`;

let current: PlanUsage | null = null;
let currentAt = 0;
let loaded = false;
let inFlight: Promise<void> | null = null;

function readStored(): void {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(sessionStorage.getItem(storageKey()) || "null") as { at?: number; usage?: PlanUsage } | null;
    if (raw?.usage && typeof raw.at === "number" && Date.now() - raw.at < KEEP_MS) {
      current = raw.usage;
      currentAt = raw.at;
    }
  } catch {
    // No storage: the header asks once per page load.
  }
}

/** The usage in a /quota (or /dashboard `quota`) payload, or null when it has none. */
export function planUsageOf(quota: unknown): PlanUsage | null {
  const q = (quota ?? {}) as Record<string, unknown>;
  const allowance = Number(q.monthly_allowance ?? q.messages_limit);
  const used = Number(q.monthly_used ?? q.messages_used ?? 0);
  if (!Number.isFinite(allowance) || allowance <= 0 || !Number.isFinite(used)) return null;
  const period = (q.quota as { message_period?: unknown } | undefined)?.message_period;
  const tier = typeof q.license_tier === "string" && q.license_tier ? q.license_tier : undefined;
  return { used: Math.max(0, used), allowance, lifetime: period === "lifetime" || tier === "free", tier };
}

/** Called by whoever loaded a quota payload (Oggi, Piano). */
export function publishPlanUsage(quota: unknown): void {
  const usage = planUsageOf(quota);
  if (!usage) return;
  current = usage;
  currentAt = Date.now();
  loaded = true;
  try {
    sessionStorage.setItem(storageKey(), JSON.stringify({ at: currentAt, usage }));
  } catch {
    // Kept for this page load only.
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** Asks GET /quota unless a fresh value is known or a request is out. */
export function loadPlanUsage(): Promise<void> {
  readStored();
  if (current && Date.now() - currentAt < KEEP_MS) return Promise.resolve();
  inFlight ??= apiFetch<unknown>("/quota")
    .then(publishPlanUsage)
    .catch(() => {
      // The header shows the plan name alone.
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}

function snapshot(): PlanUsage | null {
  readStored();
  return current;
}

export function usePlanUsage(): PlanUsage | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** Tests: forget everything. */
export function resetPlanUsage(): void {
  current = null;
  currentAt = 0;
  loaded = false;
  inFlight = null;
}
