/**
 * Which part of the widget a chat_config edit is about. The live preview
 * collapses to the launcher for button edits, shows the invite next to it for
 * invite edits, opens the welcome for welcome edits and opens the panel for
 * the rest, so the changed element is on screen (card mjz3uzsl34i0).
 */
export type PreviewFocus = { id: number; target: "launcher" | "invite" | "welcome" | "panel" };

const LAUNCHER_KEYS = new Set([
  "launcherStyle",
  "launcherLabel",
  "launcherIconUrl",
  "launcherImageMode",
  "buttonColor",
  "buttonRadius",
  "position",
  "marginX",
  "marginY",
]);

const INVITE_KEYS = new Set([
  "auto_open_greeting",
  "auto_open_delay",
]);

const WELCOME_KEYS = new Set([
  "widgetTitle",
  "welcomeMessage",
  "starterQuestions",
  "starterLayout",
]);

const PANEL_KEYS = new Set([
  "headerStyle",
  "logoUrl",
  "logoUrlDark",
  "primaryColor",
  "accentColor",
  "titleColor",
  "activeTabBackgroundColor",
  "theme",
  "headerTitle",
  "headerSubtitle",
  "inputPlaceholder",
  "widgetStyle",
  "radius",
  "panelWidth",
  "panelHeight",
  "fontScale",
]);

/** Returns the preview part a patch belongs to, or null when the preview should stay as it is. */
export function previewTargetFor(patch: Record<string, unknown>): PreviewFocus["target"] | null {
  const keys = Object.keys(patch);
  // A brand color carries the button color along, but it is the open panel
  // (header, bubbles, Send) that shows it: collapsing to a launcher with an
  // avatar on it showed no color at all (card akq1m7oqwc05).
  if (keys.includes("primaryColor")) return "panel";
  if (keys.some((key) => LAUNCHER_KEYS.has(key))) return "launcher";
  if (keys.some((key) => INVITE_KEYS.has(key))) return "invite";
  if (keys.some((key) => WELCOME_KEYS.has(key))) return "welcome";
  if (keys.some((key) => PANEL_KEYS.has(key))) return "panel";
  return null;
}
