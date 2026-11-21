/**
 * A tool's name as the owner reads it ("Prenota appuntamenti"), never its
 * key ("appointment_update", "knowledge_search"). The tools the owner turns
 * on keep the label the Carattere page shows (assistant.tools.<key>.label);
 * the internal tools and the variants of a tool are named under toolLabels.
 * Statistiche's "Strumenti usati" listed the raw keys.
 */
type T = (key: string) => string;

/** Variants that are the same tool to the owner: reading or changing a booking is the booking tool. */
const SAME_AS: Record<string, string> = {
  appointment_get: "appointment",
  appointment_update: "appointment",
  appointment_delete: "appointment",
  email_lead_get: "email_lead",
  email_lead_update: "email_lead",
  email_lead_delete: "email_lead",
};

function known(t: T, key: string): string | null {
  const label: unknown = t(key);
  return typeof label === "string" && label && label !== key ? label : null;
}

export function toolLabel(t: T, tool: string): string {
  const id = tool.trim().toLowerCase();
  const base = SAME_AS[id] ?? id;
  return known(t, `assistant.tools.${base}.label`) ?? known(t, `toolLabels.${base}`) ?? t("toolLabels.other");
}
