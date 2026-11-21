import { createContext } from "react";

export type LauncherImageMode = "custom" | "logo" | "icon";
export type WidgetTheme = "light" | "dark";

type AvatarImages = {
  logoUrl?: string;
  /** Optional avatar for the dark widget (card h8dosik1g6ic); empty means the same avatar for both. */
  logoUrlDark?: string;
  defaultAvatarUrl?: string;
};

const HTTP_URL = /^https?:\/\//i;

/** The theme the widget is showing ("Scuro", or "Automatico" resolved on the host page). */
export const WidgetThemeContext = createContext<WidgetTheme>("light");

/** The assistant's avatar for the theme on screen: the dark one only when it is set. */
export function avatarImageUrl(config: AvatarImages, theme?: string): string {
  if (theme === "dark" && config.logoUrlDark && HTTP_URL.test(config.logoUrlDark)) return config.logoUrlDark;
  return config.logoUrl || config.defaultAvatarUrl || "";
}

/** Keep the public widget and editor preview on the same image-selection rules. */
export function launcherImageUrl(config: AvatarImages & {
  launcherImageMode?: string;
  launcherIconUrl?: string;
}, theme?: string): string {
  if (config.launcherImageMode === "icon") return "";
  // "Come l'avatar": the same image the header shows, dark one included.
  if (config.launcherImageMode === "logo") return avatarImageUrl(config, theme);
  // Legacy settings retain their independent image / assigned portrait.
  return config.launcherIconUrl || config.defaultAvatarUrl || "";
}
