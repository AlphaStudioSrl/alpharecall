import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { getConfig, localizedId, type AdminSettings, type LicenseTier } from "./lib/config";
import { apiFetch } from "./lib/api";
import { useTheme, type Theme } from "./hooks/use-theme";
import { useLang } from "./hooks/use-lang";
import { syncWpSidebarLang, type SupportedLang, type TFunction } from "./lib/i18n";

interface AppContextValue {
  // Settings
  settings: AdminSettings;
  updateSettings: (patch: Partial<AdminSettings>) => void;
  // Theme
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  // Language
  lang: SupportedLang;
  setLang: (l: SupportedLang) => void;
  toggleLang: () => void;
  t: TFunction;
  // Onboarding
  onboardingStep: number;
  setOnboardingStep: (step: number) => void;
  onboardingCompleted: boolean;
  setOnboardingCompleted: (v: boolean) => void;
  // Per-section tutorial (guided tours)
  tutorialSections: string[];
  markTutorialSectionSeen: (section: string) => void;
  resetTutorialSections: () => void;
  // License
  licenseTier: LicenseTier;
  refreshLicenseTier: () => Promise<LicenseTier>;
  // Upgrade URL
  upgradeUrl: string;
  pluginVersion: string;
  // Role-based access
  userRole: "admin" | "support";
  isAdmin: boolean;
  isWpAdmin: boolean;
  /** public_name: what a reply without a profile is signed with ("" = unsigned, shown as "Team"). */
  currentUser: { id: number; name: string; public_name?: string; email: string; avatar_url: string };
  linkedProfileId: number;
  setLinkedProfileId: (id: number) => void;
  // Granular RBAC
  role: "owner" | "admin" | "agent" | "viewer";
  permissions: string[];
  can: (permission: string) => boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

const LICENSE_CHECK_KEY = "ar-license-checked";
const LICENSE_CHECK_MS = 10 * 60_000;

const licenseCheckKey = () => `${LICENSE_CHECK_KEY}:${getConfig()?.settings?.tenant_id ?? ""}`;

/** True when this tab checked the plan successfully in the last few minutes. */
function licenseCheckedRecently(): boolean {
  try {
    return Date.now() - (Number(sessionStorage.getItem(licenseCheckKey())) || 0) < LICENSE_CHECK_MS;
  } catch {
    // No storage: check every time, as before.
    return false;
  }
}

function noteLicenseChecked(): void {
  try {
    sessionStorage.setItem(licenseCheckKey(), String(Date.now()));
  } catch {
    // No storage: the next load checks again.
  }
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  // getConfig gives the localized values their PHP types back ("3" → 3, "1" → true).
  const config = getConfig();
  const adminConfig = (config || {}) as any;
  const userRole = (adminConfig.userRole || "admin") as "admin" | "support";
  const isAdmin = userRole === "admin";
  const isWpAdmin = adminConfig.isWpAdmin === true;
  const currentUser = adminConfig.currentUser || { id: 0, name: "", email: "", avatar_url: "" };
  const [linkedProfileId, setLinkedProfileIdState] = useState<number>(() => localizedId(adminConfig.linkedProfileId));
  const setLinkedProfileId = useCallback((id: number) => setLinkedProfileIdState(localizedId(id)), []);

  // Granular RBAC — role and permissions come from PHP localized config (refreshed by /team/me).
  // Fall back to deriving from userRole so existing sessions remain fully functional.
  const role = (adminConfig.role ||
    (isAdmin ? "admin" : "viewer")) as "owner" | "admin" | "agent" | "viewer";
  const permissions: string[] = adminConfig.permissions || [];
  const can = (permission: string) => permissions.includes(permission);

  const [settings, setSettings] = useState<AdminSettings>(
    config.settings || ({} as AdminSettings)
  );
  const [onboardingStep, setOnboardingStep] = useState(
    config.settings?.onboarding_step ?? 0
  );
  const [onboardingCompleted, setOnboardingCompleted] = useState(
    config.settings?.onboarding_completed ?? false
  );
  const [tutorialSections, setTutorialSections] = useState<string[]>(
    Array.isArray(config.settings?.tutorial_sections)
      ? config.settings.tutorial_sections
      : []
  );
  // Ref mirrors state so mark/reset stay stable and never race each other.
  const tutorialSectionsRef = useRef<string[]>(tutorialSections);

  const persistTutorialSections = useCallback((sections: string[]) => {
    tutorialSectionsRef.current = sections;
    setTutorialSections(sections);
    // Best-effort persistence — the tour must not re-fire this session even
    // if the request fails. POST /settings is admin-only (tours are too).
    if (!isAdmin) return;
    apiFetch("/settings", {
      method: "POST",
      body: JSON.stringify({ tutorial_sections: sections }),
    }).catch(() => {});
  }, [isAdmin]);

  const markTutorialSectionSeen = useCallback(
    (section: string) => {
      if (tutorialSectionsRef.current.includes(section)) return;
      persistTutorialSections([...tutorialSectionsRef.current, section]);
    },
    [persistTutorialSections]
  );

  const resetTutorialSections = useCallback(() => {
    persistTutorialSections([]);
  }, [persistTutorialSections]);

  const { theme, setTheme, toggleTheme } = useTheme();
  const { lang, setLang, toggleLang, t } = useLang();
  const [licenseTier, setLicenseTier] = useState<LicenseTier>(
    config.licenseTier || "free"
  );

  const updateSettings = useCallback(
    (patch: Partial<AdminSettings>) => {
      setSettings((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  // /license/refresh is admin-only (require_admin): a support user's call
  // only ever came back 403. They keep the tier PHP localized.
  const refreshLicenseTier = useCallback(async (): Promise<LicenseTier> => {
    if (!isAdmin) return licenseTier;
    try {
      const res = await apiFetch<{ tier: LicenseTier }>("/license/refresh", {
        method: "POST",
      });
      if (res.tier) {
        setLicenseTier(res.tier);
        return res.tier;
      }
    } catch {
      // ignore
    }
    return licenseTier;
  }, [licenseTier, isAdmin]);

  // Sync WordPress sidebar labels whenever language changes
  useEffect(() => {
    syncWpSidebarLang(t);
  }, [lang, t]);

  // Auto-refresh tier on mount to catch stale transient cache. Once per tab
  // every few minutes: each full page load used to send it (a WordPress boot
  // plus a call to the API), and checkout and the plan page refresh it
  // themselves when the tier can actually have changed.
  const didRefreshTier = useRef(false);
  useEffect(() => {
    if (didRefreshTier.current) return;
    didRefreshTier.current = true;
    if (!isAdmin || licenseCheckedRecently()) return;
    void apiFetch<{ tier: LicenseTier }>("/license/refresh", { method: "POST" })
      .then((res) => {
        if (res?.tier) setLicenseTier(res.tier);
        noteLicenseChecked();
      })
      .catch(() => {
        // Not recorded: the next page load asks again.
      });
  }, [isAdmin]);

  return (
    <AppContext.Provider
      value={{
        settings,
        updateSettings,
        theme,
        setTheme,
        toggleTheme,
        lang,
        setLang,
        toggleLang,
        t,
        onboardingStep,
        setOnboardingStep,
        onboardingCompleted,
        setOnboardingCompleted,
        tutorialSections,
        markTutorialSectionSeen,
        resetTutorialSections,
        licenseTier,
        refreshLicenseTier,
        upgradeUrl: config.upgradeUrl || "https://alpharecall.com/pricing/",
        pluginVersion: config.pluginVersion,
        userRole,
        isAdmin,
        isWpAdmin,
        currentUser,
        linkedProfileId,
        setLinkedProfileId,
        role,
        permissions,
        can,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
