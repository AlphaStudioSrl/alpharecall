import { useState } from "react";
import { useOwnPageHead } from "@/admin/components/layout/frame-context";
import { useNavigate, useNavIntent } from "@/admin/lib/nav-context";
import { AiPersonaSection } from "@/admin/components/settings/ai-persona-section";
import { ToolSettingsSection } from "@/admin/components/settings/tool-settings-section";

/**
 * Assistente > Carattere e strumenti: the assistant as one persona card
 * (identity, how it talks), what it can do for visitors, then its special
 * instructions and starter questions. The persona head is the page title.
 */
export function CharacterPage() {
  useOwnPageHead();
  const navigate = useNavigate();
  // Bumped by the "google-calendar" intent; the tools section scrolls to the connection.
  const [calendarRequest, setCalendarRequest] = useState(0);
  useNavIntent("google-calendar", () => setCalendarRequest((n) => n + 1));
  return (
    <AiPersonaSection
      toolsSlot={<ToolSettingsSection calendarRequest={calendarRequest} />}
      onTry={() => navigate("assistente/prova")}
    />
  );
}
