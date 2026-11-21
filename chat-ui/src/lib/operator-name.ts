/**
 * The team member who signed a reply (profile_name from the API), shown on
 * the widget's team replies instead of "Risposta dal team".
 */
export function operatorOf(row: { profile_name?: unknown } | null | undefined): { operatorName?: string } {
  const name = typeof row?.profile_name === "string" ? row.profile_name.trim() : "";
  return name ? { operatorName: name } : {};
}
