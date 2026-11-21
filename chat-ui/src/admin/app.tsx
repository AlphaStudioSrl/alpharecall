import { Component, lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { AppProvider, useApp } from "./app-context";
import { AdminShell } from "./components/layout/admin-shell";
import { DashboardPage } from "./components/dashboard/dashboard-page";
import { OnboardingModal } from "./components/onboarding/onboarding-modal";
import { TutorialManager } from "./components/tutorial/tutorial-manager";
import { Bones } from "./components/shared/bones";
import { PageSkeleton } from "./components/shared/loading-skeleton";
import { Button } from "@/components/ui/button";
import { BackgroundJobsProvider } from "./hooks/use-background-jobs";
import { NavProvider, useNav } from "./lib/nav-context";
import { pageIdOf } from "./lib/nav";
import { useSupportTeamPlanRequired } from "./lib/support-team";

/**
 * Oggi (the landing page) ships in admin.js with the shell; every other page
 * is its own chunk, fetched the first time its section opens (card
 * jc8185x03q9p: the one 3.5 MB file parsed every page's code on every load).
 * vite.admin.config.ts builds them as ES modules and writes admin.js, the
 * classic script WordPress enqueues, as a loader for the app chunk.
 */
function page<P>(load: () => Promise<Record<string, unknown>>, name: string) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType<P> }));
}
const StatsPage = page(() => import("./components/dashboard/stats-page"), "StatsPage");
const ConversationsPage = page<{ view?: "conversations" | "visitors" }>(() => import("./components/conversations/conversations-page"), "ConversationsPage");
const ContentPage = page<{ view?: "knowledge" | "business" }>(() => import("./components/content/content-page"), "ContentPage");
const HelpdeskPage = page(() => import("./components/helpdesk/helpdesk-page"), "HelpdeskPage");
const ToolsPage = page(() => import("./components/tools/tools-page"), "ToolsPage");
const ConversionsPage = page<{ initialTab?: string }>(() => import("./components/conversions/conversions-page"), "ConversionsPage");
const SettingsView = page<{ view: "widget" | "agent" | "team" | "notifications" | "privacy" | "advanced" }>(
  () => import("./components/settings/settings-page"), "SettingsView",
);
const CharacterPage = page(() => import("./components/assistant/character-page"), "CharacterPage");
const ProvaPage = page(() => import("./components/assistant/prova-page"), "ProvaPage");
const UpgradePage = page(() => import("./components/upgrade/upgrade-page"), "UpgradePage");

/**
 * One leaf of lib/nav.ts -> the page that renders it. Access is checked by
 * the router (a leaf the user cannot open is never routed to), so there is
 * no isAdmin gate here.
 */
function LeafPage({ id, params }: { id: string; params: Record<string, string> }) {
  switch (id) {
    case "oggi/oggi":
      return <DashboardPage />;
    case "inbox/conversazioni":
      return <ConversationsPage view="conversations" />;
    case "inbox/contatti":
      return <ConversationsPage view="visitors" />;
    case "richieste/elenco":
      // `tab` also arrives as a router param (Ctrl K results), which the dev
      // server cannot put on its URL where `tab` is the section.
      return <ConversionsPage initialTab={params.tab} />;
    case "richieste/agenda":
      return <ConversionsPage initialTab="appointments" />;
    case "richieste/registro":
      return <ToolsPage />;
    case "assistente/contenuti":
      return <ContentPage view="knowledge" />;
    case "assistente/dati":
      return <ContentPage view="business" />;
    case "assistente/faq":
      return <HelpdeskPage />;
    case "assistente/carattere":
      return <CharacterPage />;
    case "assistente/prova":
      return <ProvaPage />;
    case "widget/widget":
      return <SettingsView view="widget" />;
    case "statistiche/statistiche":
      return <StatsPage />;
    case "impostazioni/team":
      return <SettingsView view="team" />;
    case "impostazioni/notifiche":
      return <SettingsView view="notifications" />;
    case "impostazioni/privacy":
      return <SettingsView view="privacy" />;
    case "impostazioni/avanzate":
      return <SettingsView view="advanced" />;
    case "impostazioni/piano":
      return <UpgradePage />;
    default:
      return null;
  }
}

/** The captured skeleton of the page whose chunk is on its way, where there is one. */
const LEAF_BONES: Record<string, string> = {
  "statistiche/statistiche": "stats",
  "richieste/elenco": "conversions-list",
  "richieste/agenda": "conversions-agenda",
  "assistente/contenuti": "content-documents",
  "assistente/faq": "helpdesk-list",
};

function PageLoading({ id }: { id: string }) {
  const bones = LEAF_BONES[id];
  return bones ? <Bones name={bones} loading>{null}</Bones> : <PageSkeleton />;
}

function ChunkFailed() {
  const { t } = useApp();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-6">
      <p className="text-sm">{t("nav.shell.pageLoadFailed")}</p>
      <Button variant="secondary" onClick={() => window.location.reload()}>{t("nav.shell.reload")}</Button>
    </div>
  );
}

/**
 * A page chunk that does not arrive: offline, or a tab opened before a plugin
 * update asks for chunk files the update replaced. A reload fetches the new
 * admin.js and its chunks. Keyed by page, so the next section tries again.
 */
class PageChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <ChunkFailed /> : this.props.children;
  }
}

/**
 * A Team di supporto member on a plan without it: the AlphaRecall API refuses
 * their Messaggi and Richieste calls with 403 support_team_plan_required (the
 * plugin keeps the role and the dashboard open on every plan), so after that
 * answer say why instead of a page of errors. The plugin's own copy of the
 * plan never decides it.
 */
export function SupportTeamPaused() {
  const { t } = useApp();
  return (
    <div role="status" className="flex max-w-xl flex-col items-start gap-2 py-6" data-testid="support-team-paused">
      <p className="text-base font-semibold">{t("supportTeam.pausedTitle")}</p>
      <p className="text-sm">{t("supportTeam.pausedBody")}</p>
    </div>
  );
}

function AdminContent() {
  const { leaf, pageKey, params } = useNav();
  const { isAdmin } = useApp();
  const planRefused = useSupportTeamPlanRequired();
  // Contenuti and Dati aziendali are the two tabs of one page that keeps
  // unsaved drafts of both: one key, so switching between them keeps them.
  const key = pageKey.replace(leaf.id, pageIdOf(leaf));
  return (
    <>
      <AdminShell>
        {!isAdmin && planRefused ? (
          <SupportTeamPaused />
        ) : (
          <PageChunkBoundary key={key}>
            <Suspense fallback={<PageLoading id={leaf.id} />}>
              <LeafPage key={key} id={leaf.id} params={params} />
            </Suspense>
          </PageChunkBoundary>
        )}
      </AdminShell>
      <TutorialManager tour={leaf.tour} />
    </>
  );
}

function AdminAppInner() {
  const { isAdmin } = useApp();
  return (
    <BackgroundJobsProvider enabled={isAdmin}>
      <NavProvider>
        <AdminContent />
      </NavProvider>
      {isAdmin && <OnboardingModal />}
    </BackgroundJobsProvider>
  );
}

export function AdminApp() {
  return (
    <AppProvider>
      <AdminAppInner />
    </AppProvider>
  );
}
