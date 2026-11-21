/**
 * Turn WordPress menu clicks and in-app links into in-page navigation.
 *
 * Every section of this dashboard is registered as its own wp-admin page
 * (see class-ar-admin-ui.php: admin.php?page=alpharecall-content and friends),
 * so clicking one in the sidebar was a full browser navigation. That cost, per
 * click: WordPress rendering the whole admin page, the browser re-parsing a
 * 3.7 MB bundle, React remounting from nothing, and every hook refetching --
 * roughly two to three seconds to reach a screen the app could already draw.
 *
 * The SPA holds every section and switches between them with local state; so
 * intercept those clicks (the WordPress submenu and any `<a href>` inside the
 * app pointing at one of our pages), switch the route, and push the same URL
 * WordPress would have loaded. A refresh, a bookmark, or a hard navigation
 * still lands on the right screen, because the URL never stops being the real
 * one. Routes and URLs are defined in lib/nav.ts.
 *
 * Anything we are not certain about -- a modified click, an unknown page, a
 * role that may not open the target -- falls through to the browser untouched.
 */
import { getSection, routeFromUrl, pageParamsFromUrl, type NavRoute, type SectionId } from "./nav";

/**
 * Switch the app to a route. `params` are the page parameters the URL carried
 * (thread=42, tab=leads ...). Return false to decline (the support-only role
 * may open just the inbox) and let the browser navigate instead, or "stay"
 * when the user kept a page with unsaved changes: nothing happens then (a
 * refused Back/Forward is walked back here). Must not touch history: the
 * caller does (a click) or did (`source` "history", back/forward).
 */
export type NavigateFn = (
  route: NavRoute,
  params: Record<string, string>,
  source: "click" | "history"
) => boolean | "stay";

/*
 * Every entry the app pushes carries its position (`arIdx` in history.state),
 * so a Back or Forward the user refuses (unsaved changes) can return to the
 * entry still on screen with history.go(), leaving the rest of the history as
 * it was. `shownIdx` / `shownHref` describe that entry.
 */
let shownIdx = 0;
let shownHref = "";
/** The popstate our own history.go() causes, which must not navigate again. */
let ignorePop = false;
// From the first line, so a replaceRoute before install keeps a reloaded entry's position.
adoptCurrentEntry();

/** The current entry's position, or null for an entry we did not write. */
function entryIdx(): number | null {
  const idx = (window.history.state as { arIdx?: unknown } | null)?.arIdx;
  return typeof idx === "number" ? idx : null;
}

/** Start counting from the entry the app opened on (a reload keeps its position). */
function adoptCurrentEntry(): void {
  shownIdx = entryIdx() ?? 0;
  shownHref = window.location.href;
  try {
    window.history.replaceState({ ...(window.history.state ?? {}), arIdx: shownIdx }, "");
  } catch {
    // Sandboxed frame: refused Back then falls back to pushing the URL.
  }
}

/** Add a history entry for a route. Throws like pushState on a foreign URL. */
export function pushRoute(route: NavRoute, href: string): void {
  window.history.pushState({ arRoute: route, arIdx: shownIdx + 1 }, "", href);
  shownIdx += 1;
  shownHref = window.location.href;
}

/** Rewrite the current entry's URL, keeping its position. */
export function replaceRoute(route: NavRoute, href: string): void {
  window.history.replaceState({ arRoute: route, arIdx: shownIdx }, "", href);
  shownHref = window.location.href;
}

/** Undo a Back/Forward the app refused: go back to the entry still shown. */
function returnToShown(): void {
  const popped = entryIdx();
  if (popped !== null && popped !== shownIdx) {
    ignorePop = true;
    window.history.go(shownIdx - popped);
    return;
  }
  // An entry without a position (written by someone else): put the URL back.
  try {
    window.history.pushState({ ...(window.history.state ?? {}), arIdx: shownIdx }, "", shownHref);
  } catch {
    // Same origin by construction.
  }
}

/** The section a wp-admin URL points at, or null if it is not one of ours. */
export function sectionFromUrl(url: string): SectionId | null {
  return routeFromUrl(url)?.section ?? null;
}

function retitle(label: string): void {
  // wp-admin titles read "Section ‹ Site — WordPress"; keep the tail.
  const at = document.title.indexOf("‹");
  if (label && at >= 0) document.title = `${label} ${document.title.slice(at)}`;
}

/** Move WordPress's own "you are here" marker to a submenu link. */
function markCurrent(link: HTMLAnchorElement, label = link.textContent?.trim() || ""): void {
  const submenu = link.closest("ul.wp-submenu");
  if (!submenu) return;
  submenu.querySelectorAll(".current").forEach((el) => el.classList.remove("current"));
  link.classList.add("current");
  link.closest("li")?.classList.add("current");
  retitle(label);
}

/**
 * Point the WordPress submenu marker and the page title at a section.
 * Called by the router on every route change, whatever triggered it.
 */
export function syncWpMenu(section: SectionId, title?: string): void {
  const slug = getSection(section).slug;
  const link = document.querySelector<HTMLAnchorElement>(
    `#adminmenu .wp-submenu a[href$="page=${slug}"], #adminmenu .wp-submenu a[href*="page=${slug}&"]`
  );
  if (link) markCurrent(link, title || link.textContent?.trim() || "");
  else if (title) retitle(title);
}

/**
 * @param navigate switches the app to a route; see NavigateFn.
 * @returns a teardown function.
 */
export function installWpMenuNavigation(navigate: NavigateFn): () => void {
  const menu = document.getElementById("adminmenu");
  const app = document.getElementById("alpharecall-admin-app");
  adoptCurrentEntry();

  const onClick = (event: MouseEvent) => {
    // Middle-click, ctrl-click and friends mean "open elsewhere" -- leave them.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const link = (event.target as Element | null)?.closest?.<HTMLAnchorElement>("a");
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    // In-page anchors resolve to the current URL; they are not navigation.
    const raw = link.getAttribute("href");
    if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return;

    const route = routeFromUrl(link.href);
    if (!route) return;
    const result = navigate(route, pageParamsFromUrl(link.href), "click");
    if (result === "stay") {
      event.preventDefault();
      return;
    }
    if (!result) return;

    try {
      pushRoute(route, link.href);
    } catch {
      // A cross-origin href (a network install pointing elsewhere) cannot be
      // pushed; let the browser navigate rather than stranding the user on a
      // section whose URL does not match.
      return;
    }
    event.preventDefault();
    if (menu?.contains(link)) markCurrent(link);
    // A real page load started at the top; keep that.
    const main = document.querySelector<HTMLElement>("[data-admin-ready]");
    if (main) main.scrollTop = 0;
  };

  const onPopState = () => {
    if (ignorePop) {
      ignorePop = false;
      return;
    }
    const route = routeFromUrl(window.location.href);
    if (!route) return;
    const result = navigate(route, pageParamsFromUrl(window.location.href), "history");
    if (result === "stay") {
      returnToShown();
      return;
    }
    if (result !== true) return;
    shownIdx = entryIdx() ?? shownIdx;
    shownHref = window.location.href;
    syncWpMenu(route.section);
  };

  menu?.addEventListener("click", onClick);
  app?.addEventListener("click", onClick);
  window.addEventListener("popstate", onPopState);
  return () => {
    menu?.removeEventListener("click", onClick);
    app?.removeEventListener("click", onClick);
    window.removeEventListener("popstate", onPopState);
  };
}
