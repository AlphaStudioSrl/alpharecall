import { useSyncExternalStore } from "react";

/**
 * The Team di supporto comes with the Business plan only (internal tier
 * "enterprise"; the plan called "Performance" is "business"). The plugin
 * never locks managing the role or a member's dashboard (WordPress.org
 * guideline 5): the AlphaRecall API refuses a member's Messaggi and Richieste
 * calls below Business (app/security.py enforce_support_team_plan), and the
 * dashboard only says so. `supportTeamAvailable` is the admin's hint in Team
 * e accessi; what a member sees follows the API's answer (below).
 */
export function supportTeamAvailable(tier: string | null | undefined): boolean {
  return String(tier || "").toLowerCase() === "enterprise";
}

/** The API's code when it refuses a support member because of the plan. */
export const SUPPORT_TEAM_PLAN_REQUIRED = "support_team_plan_required";

let planRequired = false;
const listeners = new Set<() => void>();

/**
 * Called by lib/api when a request comes back 403 support_team_plan_required:
 * from then on a member's dashboard shows the plan notice instead of pages that
 * would only fail. Never set from the plugin's own idea of the plan.
 */
export function reportSupportTeamPlanRequired(): void {
  if (planRequired) return;
  planRequired = true;
  listeners.forEach((listener) => listener());
}

export function supportTeamPlanRequired(): boolean {
  return planRequired;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Whether the API has refused this user's calls because of the plan. */
export function useSupportTeamPlanRequired(): boolean {
  return useSyncExternalStore(subscribe, supportTeamPlanRequired, supportTeamPlanRequired);
}

/** Tests only. */
export function resetSupportTeamPlanRequired(): void {
  planRequired = false;
  listeners.forEach((listener) => listener());
}
