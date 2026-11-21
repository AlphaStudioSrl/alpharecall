/**
 * tour-steps.ts
 * Per-section guided tour definitions (tour-engine.ts) for the AlphaRecall admin.
 *
 * Each admin section (= main tab) has its own short tour that auto-starts the
 * first time the tenant opens that section (see tutorial-manager.tsx). Steps
 * anchor to stable `data-tour` attributes inside the page; steps whose target
 * is not in the DOM are filtered at start time, so empty states and
 * plan-locked pages degrade gracefully.
 *
 * All text is resolved via i18n keys at runtime (in use-tour.ts):
 *   tutorial.sections.<section>.<stepKey>.title / .body
 */

export type TourSection =
  | "dashboard"
  | "conversations"
  | "conversions"
  | "content"
  | "helpdesk"
  | "tools"
  | "settings";

export interface TourStep {
  /** Unique step identifier; also the i18n leaf key */
  key: string;
  /** CSS selector for the target element (data-tour anchors) */
  selector: string;
  /** Tour dialog placement (optional, defaults to auto) */
  position?: "top" | "bottom" | "left" | "right" | "auto";
}

const step = (
  key: string,
  selector: string,
  position?: TourStep["position"]
): TourStep => ({ key, selector, position });

export const SECTION_TOURS: Record<TourSection, TourStep[]> = {
  dashboard: [
    step("intro", "[data-tour='dashboard-metric-tabs']", "bottom"),
    step("chart", "[data-tour='dashboard-chart']", "top"),
    step("usage", "[data-tour='dashboard-usage']", "top"),
    step("recent", "[data-tour='dashboard-recent']", "top"),
  ],
  conversations: [
    step("intro", "[data-tour='conversations-tabs']", "right"),
    step("list", "[data-tour='conversations-list']", "right"),
    step("detail", "[data-tour='conversations-detail']", "left"),
  ],
  conversions: [
    step("intro", "[data-tour='conversions-tabs']", "bottom"),
    step("table", "[data-tour='conversions-table']", "top"),
    step("export", "[data-tour='conversions-export']", "bottom"),
  ],
  content: [
    step("sync", "[data-tour='content-sync']", "bottom"),
    step("indexed", "[data-tour='content-indexed']", "top"),
    step("upload", "[data-tour='content-upload']", "top"),
  ],
  helpdesk: [
    step("actions", "[data-tour='helpdesk-actions']", "bottom"),
    step("categories", "[data-tour='helpdesk-categories']", "bottom"),
    step("list", "[data-tour='helpdesk-list']", "top"),
  ],
  tools: [
    step("intro", "[data-tour='tools-tabs']", "bottom"),
    step("table", "[data-tour='tools-table']", "top"),
  ],
  settings: [
    // Widget and Carattere left Impostazioni for their own top bar entries.
    step("widget", "[data-tour='nav-widget']", "bottom"),
    step("agent", "[data-tour='nav-assistente']", "bottom"),
    step("team", "[data-tour='settings-team-tab']", "right"),
    step("notifications", "[data-tour='settings-notifications-tab']", "right"),
    step("privacy", "[data-tour='settings-privacy-tab']", "right"),
    step("advanced", "[data-tour='settings-advanced-tab']", "right"),
  ],
  // The Upgrade page has no tour: a pricing table explains itself.
};

export const TOUR_SECTIONS = Object.keys(SECTION_TOURS) as TourSection[];

export function isTourSection(value: string): value is TourSection {
  return (TOUR_SECTIONS as string[]).includes(value);
}
