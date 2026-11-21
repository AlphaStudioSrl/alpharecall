import { Bot } from "@/components/icons";
import { ChatCustomizer } from "./chat-customizer";
import { AiPersonaSection } from "./ai-persona-section";
import { TeamSection } from "./team-section";
import { AdvancedSection } from "./advanced-section";
import { ToolSettingsSection } from "./tool-settings-section";
import { GdprSettingsSection } from "./gdpr-settings-section";
import { NotificationsSection } from "./notifications-section";
import { SettingsContactFooter } from "./contact-social-section";
import { CollapsibleSection } from "@/admin/components/shared/collapsible-section";
import { useApp } from "@/admin/app-context";
import "./impostazioni.css";

/**
 * The old Impostazioni tabs, one per leaf of the new IA (lib/nav.ts):
 *   widget        -> Widget
 *   agent         -> Assistente > Carattere e strumenti
 *   team          -> Impostazioni > Team e accessi
 *   notifications -> Impostazioni > Notifiche e avvisi
 *   privacy       -> Impostazioni > Privacy e dati
 *   advanced      -> Impostazioni > Avanzate
 */
export type SettingsViewKey = "widget" | "agent" | "team" | "notifications" | "privacy" | "advanced";

export function SettingsView({ view }: { view: SettingsViewKey }) {
  const { t } = useApp();

  switch (view) {
    case "widget":
      // Widget appearance: single editor with live preview.
      return <ChatCustomizer />;

    case "agent":
      // Persona + tools.
      return (
        <div className="space-y-3">
          <CollapsibleSection id="agent-persona" title={t("settings.tabPersona")} icon={Bot} defaultOpen>
            <AiPersonaSection />
          </CollapsibleSection>
          <CollapsibleSection id="agent-tools" title={t("settings.tabTools")} icon={Bot}>
            <ToolSettingsSection />
          </CollapsibleSection>
        </div>
      );

    case "team":
      // The Team di supporto (the one "Supporto AlphaRecall" role, Business
      // plan) and the operator profiles. Only WordPress administrators manage
      // AlphaRecall: there is no per-user full access to hand out.
      return (
        <div className="ars-page">
          <TeamSection />
        </div>
      );

    case "notifications":
      return <NotificationsSection />;

    case "privacy":
      return <GdprSettingsSection />;

    case "advanced":
      // Escalation, connections, guides and the danger zone, then
      // AlphaRecall's official channels as a quiet footer.
      return <AdvancedSection footer={<SettingsContactFooter />} />;
  }
}
