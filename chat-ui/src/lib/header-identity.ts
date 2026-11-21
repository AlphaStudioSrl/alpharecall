/**
 * Who the header names and what the status line under it says.
 *
 * With an assistant name the header reads "Sofia" / "Studio Rossi · risponde
 * subito". Without one the business name is the title, so the status line must
 * not repeat it: "Studio Rossi" / "Online ora, rispondiamo subito".
 */
export type HeaderIdentityInput = {
  chatbotName?: string | null;
  headerTitle?: string | null;
  headerSubtitle?: string | null;
  fallbackName: string;
  /** Status when the business speaks for itself ("Online ora, rispondiamo subito"). */
  onlineStatus: string;
  /** Status under an assistant's name, "{business} · risponde subito". */
  personaStatus: string;
};

const clean = (value: string | null | undefined) => String(value || "").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => !!a && !!b && a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function headerIdentity(input: HeaderIdentityInput): { name: string; status: string } {
  const persona = clean(input.chatbotName);
  const business = clean(input.headerTitle);
  const name = persona || business || input.fallbackName;

  const subtitle = clean(input.headerSubtitle);
  if (subtitle) {
    // A tenant subtitle that starts with the title ("Studio Rossi · risponde
    // subito" under "Studio Rossi") keeps only what follows the name.
    if (same(subtitle, name)) return { name, status: input.onlineStatus };
    const rest = subtitle.replace(new RegExp(`^${escape(name)}\\s*[·•|,:–-]\\s*`, "i"), "").trim();
    return { name, status: rest || input.onlineStatus };
  }
  if (persona && business && !same(persona, business)) {
    return { name, status: input.personaStatus.replace("{business}", business) };
  }
  return { name, status: input.onlineStatus };
}
