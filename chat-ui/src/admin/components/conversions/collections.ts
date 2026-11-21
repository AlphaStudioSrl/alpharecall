/** Which record collections Richieste shows, and the deep-link helpers both pages use. */
import { useMemo } from "react";
import { useApp } from "@/admin/app-context";
import type { ConversionCollection } from "@/admin/hooks/use-conversions-data";

// "business" is intentionally absent: business info is configuration and
// lives in Assistente > Dati attività, not with the records chat generated.
const TAB_TOOL_MAP: Record<ConversionCollection, string[]> = {
  leads: ["email_lead", "newsletter_subscribe"],
  appointments: ["appointment"],
  submissions: ["contact_form", "callback_request", "quote_request"],
  feedback: ["feedback"],
};

export const ALL_COLLECTIONS: ConversionCollection[] = ["leads", "appointments", "submissions", "feedback"];

/** Collections whose tools are not all switched off. */
export function useVisibleCollections(): ConversionCollection[] {
  const { settings } = useApp();
  const enabledTools = (((settings.tenant_settings || {}) as Record<string, unknown>).enabled_tools ?? {}) as Record<string, boolean>;
  const key = JSON.stringify(enabledTools);
  return useMemo(
    () => ALL_COLLECTIONS.filter((c) => TAB_TOOL_MAP[c].some((tool) => enabledTools[tool] !== false)),
    // The object is rebuilt on every settings read; its content is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
}

export function urlParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}
