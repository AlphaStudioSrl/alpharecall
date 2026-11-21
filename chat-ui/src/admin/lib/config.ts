import type { NotificationPreferences } from "./notification-preferences";

export type AdminTab =
  | "dashboard"
  | "conversations"
  | "conversions"
  | "content"
  | "helpdesk"
  | "tools"
  | "settings"
  | "upgrade";

export type ToolsTab = "appointments" | "leads" | "escalations" | "products";

export interface AdminSettings {
  tenant_domain: string;
  tenant_id: string;
  tenant_status: string;
  pending_bootstrap?: boolean;
  bootstrap_last_error?: string;
  onboarding_step: number;
  onboarding_completed: boolean;
  tutorial_completed: boolean;
  tutorial_sections: string[];
  exclude_page_ids: string[];
  business_profile: Record<string, unknown>;
  tool_preferences: Record<string, unknown>;
  tenant_settings: Record<string, unknown>;
  chat_config: Record<string, unknown>;
  integrations: Record<string, boolean>;
}

export type LicenseTier = "free" | "pro" | "business" | "enterprise";

export interface AlphaRecallAdminConfig {
  restUrl: string;
  wpRestUrl: string;
  ajaxUrl: string;
  ajaxNonce: string;
  siteUrl: string;
  /** The WordPress site title, shown as the workspace name in the top bar. */
  siteName?: string;
  /** Base URL for bundled plugin assets, e.g. avatar placeholders. */
  assetsUrl?: string;
  nonce: string;
  upgradeUrl: string;
  pluginVersion: string;
  licenseTier: LicenseTier;
  navMode: string;
  /** Section the page opened on (lib/nav.ts routeFromName); the URL wins when it names one. */
  initialTab: string;
  initialToolsTab: string | null;
  /** Sections kept out of the product for now (mirrors AlphaRecall_Admin_UI::HIDDEN_SECTIONS). */
  hiddenTabs?: string[];
  /** Whether the public widget is currently served (mirrors the plan cache PHP uses). */
  chatAvailable?: boolean;
  chatUnavailableReason?: string;
  settings: AdminSettings;
  currentUser?: { id: number };
  /** WordPress manage_options (the access list in Impostazioni). */
  isWpAdmin?: boolean;
  /** admin-post download of the site's whole AlphaRecall archive (ZIP); empty for non-admins. */
  dataExportUrl?: string;
  /** The support profile this user's replies are signed with (0: none), as reply_attribution reads it. */
  linkedProfileId?: number;
  notificationPreferences?: Partial<NotificationPreferences>;
}

declare global {
  interface Window {
    AlphaRecallAdmin?: AlphaRecallAdminConfig;
  }
}

/**
 * wp_localize_script casts every top-level scalar to a string: the linked
 * profile id 3 arrives as "3", true as "1" and false as "". Nested arrays keep
 * their JSON types. These are the top-level fields the app compares strictly.
 */
export function localizedId(value: unknown): number {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** "1"/true/1 → true, ""/"0"/false/0 → false; undefined when PHP sent no key. */
export function localizedFlag(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  return value === true || value === 1 || value === "1" || value === "true";
}

const normalized = new WeakSet<object>();

/** Gives the localized config back its PHP types, once per config object. */
export function normalizeAdminConfig<T extends Partial<AlphaRecallAdminConfig>>(config: T): T {
  if (!config || typeof config !== "object" || normalized.has(config)) return config;
  const raw = config as Record<string, unknown>;
  if ("linkedProfileId" in raw) raw.linkedProfileId = localizedId(raw.linkedProfileId);
  for (const key of ["isWpAdmin", "chatAvailable"]) {
    if (key in raw) raw[key] = localizedFlag(raw[key]);
  }
  normalized.add(config);
  return config;
}

export function getConfig(): AlphaRecallAdminConfig {
  return normalizeAdminConfig(window.AlphaRecallAdmin!);
}

/** Fallback when PHP sends no hiddenTabs key: nothing is hidden. */
const DEFAULT_HIDDEN_TABS: AdminTab[] = [];

let hiddenTabSet: ReadonlySet<AdminTab> | null = null;

/** PHP sets hiddenTabs once at page load, so the set is built once and reused. */
export function hiddenTabs(): ReadonlySet<AdminTab> {
  if (!hiddenTabSet) {
    const fromConfig = (window as any).AlphaRecallAdmin?.hiddenTabs;
    hiddenTabSet = new Set(Array.isArray(fromConfig) ? (fromConfig as AdminTab[]) : DEFAULT_HIDDEN_TABS);
  }
  return hiddenTabSet;
}

export function isTabHidden(tab: string): boolean {
  return hiddenTabs().has(tab as AdminTab);
}

const TOOL_TAB_KEYS: ToolsTab[] = ["appointments", "leads", "escalations", "products"];

const LEGACY_TOOL_TAB_BY_MAIN_TAB: Record<string, ToolsTab> = {
  appointments: "appointments",
  leads: "leads",
  escalations: "escalations",
};

export function getInitialToolsTab(): ToolsTab {
  const raw = getConfig().initialToolsTab;
  const mainTab = getConfig().initialTab || "dashboard";
  const fromMain = LEGACY_TOOL_TAB_BY_MAIN_TAB[mainTab];
  const candidate = raw || fromMain || "appointments";
  return TOOL_TAB_KEYS.includes(candidate as ToolsTab)
    ? (candidate as ToolsTab)
    : "appointments";
}
