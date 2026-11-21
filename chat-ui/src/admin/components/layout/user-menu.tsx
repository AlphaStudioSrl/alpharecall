import { Languages, LifeBuoy, Moon, Sun } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/admin/app-context";
import { initials } from "@/admin/components/shared/kit";
import { OPEN_SUPPORT_EVENT } from "./frame-events";

/**
 * The signed-in user's initials, opening the account menu: theme, interface
 * language and the AlphaRecall support chat (what the old header showed as
 * separate buttons).
 */
export function UserMenu() {
  const { t, theme, toggleTheme, lang, toggleLang, currentUser } = useApp();
  const name = currentUser?.name || currentUser?.email || "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ar-me" aria-label={t("nav.shell.account")} title={name || t("nav.shell.account")}>
          {initials(name || "?")}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="ar-menu w-60">
        {name && (
          <>
            <DropdownMenuLabel className="ar-menu-who">
              <b>{currentUser.name || currentUser.email}</b>
              {currentUser.name && currentUser.email && <small>{currentUser.email}</small>}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={toggleTheme}>
          {theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
          {theme === "dark" ? t("nav.shell.themeLight") : t("nav.shell.themeDark")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggleLang}>
          <Languages aria-hidden="true" />
          <span className="flex-1">{t("nav.shell.language")}</span>
          <span className="ar-menu-hint">{lang === "it" ? t("nav.shell.languageIt") : t("nav.shell.languageEn")}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event(OPEN_SUPPORT_EVENT))}>
          <LifeBuoy aria-hidden="true" />
          {t("nav.shell.support")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
