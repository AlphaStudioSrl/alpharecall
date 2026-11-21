/**
 * The router: which leaf is open, how to open another one, and the small
 * channels pages use to talk to the frame (intents and sub nav badges).
 *
 *   const { view, navigate } = useView();
 *   navigate("inbox/contatti");                         // a leaf
 *   navigate("impostazioni");                           // a section (its last or first leaf)
 *   navigate("inbox/conversazioni", { params: { thread: "42" } });
 *   navigate("assistente/faq", { intent: "add-faq" });  // the page picks it up with useNavIntent
 *   <NavLink to="richieste/agenda">Agenda</NavLink>     // a real link: middle-click opens a tab
 *
 * Model and URL format: lib/nav.ts. WordPress menu and in-app <a> clicks:
 * lib/wp-nav.ts.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useApp } from "@/admin/app-context";
import { getConfig, isTabHidden } from "./config";
import {
  canOpenLeaf,
  deepLinkView,
  defaultView,
  getLeaf,
  getSection,
  hasDeepLinkParams,
  hrefForRoute,
  pageParamsFromUrl,
  routeFromName,
  routeFromUrl,
  sameRoute,
  navMode,
  pageIdOf,
  visibleLeaves,
  visibleSections,
  type NavAccess,
  type NavLeaf,
  type NavRoute,
  type NavSection,
  type SectionId,
} from "./nav";
import { installWpMenuNavigation, pushRoute, replaceRoute, syncWpMenu } from "./wp-nav";
import { confirmLeave } from "./leave-guard";

/** go() result: the user chose to stay on a page with unsaved changes. */
const STAY = Symbol("stay");

/** A leaf id ("inbox/contatti"), a section id ("inbox"), a legacy tab name, an admin href, or a route. */
export type NavTarget = string | NavRoute;

export interface NavigateOptions {
  /** Extra URL parameters for the page (thread, item, tab ...). */
  params?: Record<string, string>;
  /** A one-shot request for the page, read with useNavIntent (e.g. "sync", "invite"). */
  intent?: string;
  /** Replace the current history entry instead of adding one. */
  replace?: boolean;
}

interface PendingIntent {
  name: string;
  leafId: string;
  id: number;
}

interface NavContextValue {
  route: NavRoute;
  leaf: NavLeaf;
  section: NavSection;
  /** Page parameters of the current URL. */
  params: Record<string, string>;
  /**
   * Counts every navigation, including one to the page already open with the
   * same parameters (the same notification clicked twice). Pages that follow
   * their parameters live (useLiveParams) key their effects on it.
   */
  visit: number;
  /** Changes whenever the open page must remount (same leaf, new parameters). */
  pageKey: string;
  access: NavAccess;
  /** Sections this user can open, in top bar order. */
  sections: NavSection[];
  /** Leaves listed in a section's sub nav for this user. */
  listedLeaves: (section: SectionId) => NavLeaf[];
  navigate: (target: NavTarget, options?: NavigateOptions) => boolean;
  hrefFor: (target: NavTarget, params?: Record<string, string>) => string;
  badges: Record<string, number | string>;
  setBadge: (leafId: string, value: number | string | null | undefined) => void;
  intent: PendingIntent | null;
  clearIntent: (id: number) => void;
  /** Drop page parameters once handled, from the router and the address bar, without a navigation. */
  clearParams: (keys: string[]) => void;
  /** See useLiveParams. Returns the unregister function. */
  registerLiveLeaf: (leafId: string) => () => void;
}

const NavContext = createContext<NavContextValue | null>(null);

const LAST_VIEW_KEY = "ar-nav-last:";

function rememberView(route: NavRoute): void {
  try {
    localStorage.setItem(LAST_VIEW_KEY + route.section, route.view);
  } catch {
    // Storage can be blocked; the section then opens on its first leaf.
  }
}

function rememberedView(section: SectionId): string | null {
  try {
    return localStorage.getItem(LAST_VIEW_KEY + section);
  } catch {
    return null;
  }
}

/**
 * Fill in the view and check access. Null when the user cannot open it.
 * Without a view, a link to a record (thread=, item=, tab=) opens the leaf
 * that shows it; only a bare section link reopens the page used last.
 */
export function resolveRoute(
  route: NavRoute | null,
  access: NavAccess,
  params: Record<string, string> = {}
): NavRoute | null {
  if (!route) return null;
  if (route.view) {
    const leaf = getLeaf(route);
    return leaf && canOpenLeaf(leaf, access) ? route : null;
  }
  const deep = deepLinkView(route.section, params);
  if (deep) return resolveRoute({ section: route.section, view: deep }, access);
  const remembered = hasDeepLinkParams(params) ? null : rememberedView(route.section);
  if (remembered) {
    const leaf = getLeaf({ section: route.section, view: remembered });
    if (leaf && !leaf.unlisted && canOpenLeaf(leaf, access)) return { section: route.section, view: remembered };
  }
  const view = defaultView(route.section, access);
  return view ? { section: route.section, view } : null;
}

function parseTarget(target: NavTarget): { route: NavRoute | null; params: Record<string, string> } {
  if (typeof target !== "string") return { route: target, params: {} };
  if (target.includes("admin.php") || target.startsWith("?")) {
    return { route: routeFromUrl(target), params: pageParamsFromUrl(target) };
  }
  return { route: routeFromName(target), params: {} };
}

function initialRoute(access: NavAccess): { route: NavRoute; params: Record<string, string> } {
  const params = pageParamsFromUrl(window.location.href);
  const fromUrl = resolveRoute(routeFromUrl(window.location.href), access, params);
  if (fromUrl) return { route: fromUrl, params };
  const fromConfig = resolveRoute(routeFromName(getConfig()?.initialTab), access, params);
  if (fromConfig) return { route: fromConfig, params };
  const first = visibleSections(access)[0]?.id ?? "inbox";
  return { route: resolveRoute({ section: first, view: "" }, access) ?? { section: "inbox", view: "conversazioni" }, params: {} };
}

export function NavProvider({ children }: { children: React.ReactNode }) {
  const { isAdmin, permissions, t } = useApp();
  // A string key: the context hands out a new array on every render.
  const permissionKey = (permissions ?? []).join(" ");
  const access = useMemo<NavAccess>(() => {
    // Sessions from before RBAC have no permissions: the role alone decides.
    const granted = new Set(permissionKey.split(" "));
    const known = granted.has("dashboard.read") || granted.has("conversations.read");
    return { isAdmin, isHidden: isTabHidden, can: known ? (p: string) => granted.has(p) : undefined };
  }, [isAdmin, permissionKey]);
  const [state, setState] = useState(() => {
    const start = initialRoute(access);
    return { ...start, nonce: 0, visit: 0 };
  });
  const [badges, setBadges] = useState<Record<string, number | string>>({});
  const [intent, setIntent] = useState<PendingIntent | null>(null);
  const intentSeq = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Leaves whose mounted page follows its parameters itself (useLiveParams).
  const liveLeaves = useRef(new Map<string, number>());

  /**
   * Switch the route without touching history. STAY when the page has
   * unsaved changes and the user chose to keep them (lib/leave-guard.ts).
   */
  const go = useCallback(
    (raw: NavRoute | null, params: Record<string, string>): NavRoute | null | typeof STAY => {
      const route = resolveRoute(raw, access, params);
      if (!route) return null;
      const prev = stateRef.current;
      const sameLeaf = sameRoute(prev.route, route);
      const sameParams = JSON.stringify(prev.params) === JSON.stringify(params);
      // Reopening the leaf with new parameters remounts the page, so pages
      // that read the URL once on mount (item= in the Agenda) see the new
      // value. A page that follows its parameters live is left mounted: a
      // remount refetches everything it shows.
      const live = (liveLeaves.current.get(`${route.section}/${route.view}`) ?? 0) > 0;
      const remount = sameLeaf && !sameParams && !live && Object.keys(params).length > 0;
      // Ask before anything that unmounts the page (lib/leave-guard.ts). Tabs
      // of one page (Contenuti / Dati attività) keep their drafts: no question.
      const unmounts = remount || pageIdOf(getLeaf(prev.route)!) !== pageIdOf(getLeaf(route)!);
      if (unmounts && !confirmLeave()) return STAY;
      setState((p) => {
        const visit = p.visit + 1;
        const leafKept = sameRoute(p.route, route);
        if (leafKept && JSON.stringify(p.params) === JSON.stringify(params)) return { ...p, visit };
        const bump = leafKept && !live && Object.keys(params).length > 0;
        return { route, params, nonce: bump ? p.nonce + 1 : p.nonce, visit };
      });
      rememberView(route);
      return route;
    },
    [access]
  );

  const navigate = useCallback(
    (target: NavTarget, options: NavigateOptions = {}): boolean => {
      const parsed = parseTarget(target);
      const params = { ...parsed.params, ...(options.params ?? {}) };
      const route = go(parsed.route, params);
      // Staying is handled too: a link must not fall back to a page load.
      if (route === STAY) return true;
      if (!route) return false;
      if (options.intent) {
        intentSeq.current += 1;
        setIntent({ name: options.intent, leafId: `${route.section}/${route.view}`, id: intentSeq.current });
      }
      const href = hrefForRoute(route, params);
      try {
        if (options.replace) replaceRoute(route, href);
        else pushRoute(route, href);
      } catch {
        // Unpushable URL (sandboxed iframe): the screen still switches.
      }
      const main = document.querySelector<HTMLElement>("[data-admin-ready]");
      if (main) main.scrollTop = 0;
      return true;
    },
    [go]
  );

  // WordPress submenu clicks, in-app <a href> clicks and back/forward.
  // A refused Back/Forward is walked back by wp-nav itself.
  useEffect(
    () =>
      installWpMenuNavigation((route, params) => {
        const result = go(route, params);
        return result === STAY ? "stay" : result !== null;
      }),
    [go]
  );

  const leaf = getLeaf(state.route)!;
  const section = getSection(state.route.section);

  // Keep the address bar canonical (a section-only URL gains its view) and
  // the WordPress menu marker and title in step with the screen.
  // Old names (?tab=helpdesk, page=alpharecall-upgrade) are rewritten too.
  useLayoutEffect(() => {
    try {
      const here = new URL(window.location.href);
      const url = new URL(hrefForRoute(state.route, state.params), here);
      // In WordPress `tab` belongs to the page (Richieste's own tabs).
      const routing = navMode() === "tabs" ? ["page", "tab", "view", "settingsTab"] : ["page", "view"];
      if (routing.some((key) => here.searchParams.get(key) !== url.searchParams.get(key))) {
        // Keep whatever the page itself put on the URL since (filters, hash).
        here.searchParams.forEach((value, key) => {
          if (!routing.includes(key) && !url.searchParams.has(key)) url.searchParams.set(key, value);
        });
        url.hash = here.hash;
        replaceRoute(state.route, url.href);
      }
    } catch {
      // See navigate().
    }
    syncWpMenu(state.route.section, t(section.labelKey));
  }, [state.route, state.params, section.labelKey, t]);

  const setBadge = useCallback((leafId: string, value: number | string | null | undefined) => {
    setBadges((prev) => {
      if (value === null || value === undefined || value === "") {
        if (!(leafId in prev)) return prev;
        const next = { ...prev };
        delete next[leafId];
        return next;
      }
      return prev[leafId] === value ? prev : { ...prev, [leafId]: value };
    });
  }, []);

  const clearIntent = useCallback((id: number) => {
    setIntent((prev) => (prev?.id === id ? null : prev));
  }, []);

  const clearParams = useCallback((keys: string[]) => {
    setState((prev) => {
      if (!keys.some((key) => key in prev.params)) return prev;
      const params = { ...prev.params };
      for (const key of keys) delete params[key];
      return { ...prev, params };
    });
    try {
      const url = new URL(window.location.href);
      if (!keys.some((key) => url.searchParams.has(key))) return;
      for (const key of keys) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, "", url.href);
    } catch {
      // See navigate().
    }
  }, []);

  const registerLiveLeaf = useCallback((leafId: string) => {
    const leaves = liveLeaves.current;
    leaves.set(leafId, (leaves.get(leafId) ?? 0) + 1);
    return () => {
      const n = (leaves.get(leafId) ?? 1) - 1;
      if (n > 0) leaves.set(leafId, n);
      else leaves.delete(leafId);
    };
  }, []);

  const hrefFor = useCallback(
    (target: NavTarget, params: Record<string, string> = {}) => {
      const parsed = parseTarget(target);
      const all = { ...parsed.params, ...params };
      const route = resolveRoute(parsed.route, access, all) ?? parsed.route;
      return route ? hrefForRoute(route, all) : "#";
    },
    [access]
  );

  const sections = useMemo(() => visibleSections(access), [access]);
  const listedLeaves = useCallback(
    (id: SectionId) => visibleLeaves(id, access).filter((l) => !l.unlisted),
    [access]
  );

  const value = useMemo<NavContextValue>(
    () => ({
      route: state.route,
      leaf,
      section,
      params: state.params,
      visit: state.visit,
      pageKey: `${leaf.id}#${state.nonce}`,
      access,
      sections,
      listedLeaves,
      navigate,
      hrefFor,
      badges,
      setBadge,
      intent,
      clearIntent,
      clearParams,
      registerLiveLeaf,
    }),
    [state, leaf, section, access, sections, listedLeaves, navigate, hrefFor, badges, setBadge, intent, clearIntent, clearParams, registerLiveLeaf]
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavProvider");
  return ctx;
}

/**
 * What a page needs to know about where it is.
 *
 * `view` is the leaf key ("contatti", "agenda", "team" ...). `setView` opens a
 * sibling leaf of the same section; `navigate` goes anywhere.
 */
export function useView() {
  const { route, leaf, section, params, visit, navigate, hrefFor } = useNav();
  const setView = useCallback(
    (view: string, options?: NavigateOptions) => navigate({ section: route.section, view }, options),
    [navigate, route.section]
  );
  return { section: route.section, view: route.view, leaf, sectionInfo: section, params, visit, setView, navigate, hrefFor };
}

/**
 * Keep this page mounted when it is reopened with new parameters (a chat
 * notification clicked while the Inbox is open): the page reacts to
 * `params` and `visit` itself instead of being remounted, which would
 * refetch everything it shows. Pages without it are remounted, so a page
 * that reads its parameters once on mount keeps working.
 */
export function useLiveParams(): { params: Record<string, string>; visit: number; clearParams: (keys: string[]) => void } {
  const { leaf, params, visit, clearParams, registerLiveLeaf } = useNav();
  // Registered before paint, so a navigation right after mount already sees it.
  useLayoutEffect(() => registerLiveLeaf(leaf.id), [leaf.id, registerLiveLeaf]);
  return { params, visit, clearParams };
}

/** Shorthand for `useNav().navigate`. */
export function useNavigate() {
  return useNav().navigate;
}

/**
 * Run `handler` once when the page was opened with this intent
 * (`navigate(leaf, { intent })`, Ctrl K actions). Call it from the page the
 * intent targets; it fires after mount and is then cleared.
 */
export function useNavIntent(name: string, handler: () => void): void {
  const { intent, clearIntent, leaf } = useNav();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!intent || intent.name !== name || intent.leafId !== leaf.id) return;
    clearIntent(intent.id);
    handlerRef.current();
  }, [intent, name, leaf.id, clearIntent]);
}

/**
 * Show a count next to a leaf in the sub nav (e.g. 212 next to Contatti).
 * Pass null to clear it. The badge outlives the page, so a section that
 * knows its counts can set them for its sibling leaves too.
 */
export function useNavBadge(leafId: string, value: number | string | null | undefined): void {
  const { setBadge } = useNav();
  useEffect(() => {
    setBadge(leafId, value);
  }, [leafId, value, setBadge]);
}

type AnchorProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

/**
 * A link to a leaf. Renders a real `<a href>` (so middle-click and "open in
 * new tab" work); a plain click switches in place.
 */
export const NavLink = React.forwardRef<
  HTMLAnchorElement,
  AnchorProps & { to: NavTarget; params?: Record<string, string>; intent?: string }
>(function NavLink({ to, params, intent, onClick, ...props }, ref) {
  const { navigate, hrefFor } = useNav();
  return (
    <a
      ref={ref}
      href={hrefFor(to, params)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (navigate(to, { params, intent })) event.preventDefault();
      }}
      {...props}
    />
  );
});
