/**
 * The admin's information architecture, in one place.
 *
 * Seven top-level sections (the tabs in the top bar), each made of one or more
 * leaves (the entries of the left sub nav). A leaf is what a URL points at:
 *
 *   WordPress   admin.php?page=<section slug>&view=<leaf key>
 *   dev server  ?tab=<section id>&view=<leaf key>
 *
 * `view` is left out for a section's first leaf. Every slug and tab name the
 * dashboard used before this IA still resolves (see LEGACY_TAB_ROUTES), so old
 * bookmarks, notification links, e-mails and the backend's deep links keep
 * landing on the right screen.
 *
 * This file is pure data + URL helpers. The React side (current route, links,
 * intents, badges) lives in lib/nav-context.tsx.
 */
import {
  Bell,
  CalendarDays,
  CreditCard,
  FileText,
  HelpCircle,
  LayoutDashboard,
  List,
  MapPin,
  MessageCircle,
  MessageSquare,
  Palette,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  BarChart3,
  Users,
  Wrench,
  type LucideIcon,
} from "@/components/icons";
import type { AdminTab } from "./config";
import type { TourSection } from "@/admin/components/tutorial/tour-steps";

export type SectionId =
  | "oggi"
  | "inbox"
  | "richieste"
  | "statistiche"
  | "assistente"
  | "widget"
  | "impostazioni";

/** How the frame lays a leaf out. Pages can override at runtime with useFrameLayout(). */
export interface FrameOptions {
  /**
   * The page fills the panel and manages its own scrolling (two-pane screens
   * such as the inbox). Default: the panel body scrolls.
   */
  fill?: boolean;
  /** No padding around the page, for edge-to-edge layouts (editor + preview). */
  flush?: boolean;
  /**
   * The page draws its own panels directly on the canvas (inbox three panes).
   * The frame then renders no white panel and no sub nav; use <Panel> from the kit.
   */
  panels?: boolean;
}

export interface NavLeaf {
  /** `${section}/${key}`: the id you pass to navigate() and <NavLink to>. */
  id: string;
  section: SectionId;
  /** Value of the `view` URL parameter. */
  key: string;
  /** i18n key of the label (sub nav, palette, page title). */
  labelKey: string;
  /** i18n key of the one-line description (palette, default page head). */
  descriptionKey: string;
  icon: LucideIcon;
  /** The pre-IA tab whose component renders this leaf. Hidden tabs hide the leaf. */
  tab: AdminTab;
  /**
   * Only admins open it. Leaves without it are the support role's dashboard
   * (Messaggi and Richieste > Elenco), matching AlphaRecall_Admin_UI::SUPPORT_SECTIONS
   * and the require_support REST routes. For support sessions with RBAC
   * permissions, `permission` can narrow those leaves further.
   */
  adminOnly: boolean;
  /** RBAC permission needed to see and open it (from the tab, see TAB_PERMISSION). None: any member. */
  permission?: string;
  /** Reachable by URL and Ctrl K but not listed in the sub nav. */
  unlisted?: boolean;
  /** Extra space above the item in the sub nav (before "Prova Sofia"). */
  gapBefore?: boolean;
  /** Guided tour that auto-starts the first time this leaf is opened. */
  tour?: TourSection;
  /** data-tour value put on this leaf's sub nav item (keeps old tour anchors alive). */
  anchor?: string;
  /** Extra search terms for Ctrl K (Italian and English). */
  keywords: string;
  frame?: FrameOptions;
}

export interface NavSection {
  id: SectionId;
  /** wp-admin page slug, mirrors AlphaRecall_Admin_UI::SUBMENU_SLUGS. */
  slug: string;
  labelKey: string;
  icon: LucideIcon;
  /** data-tour value on the top bar tab. */
  anchor: string;
  leaves: NavLeaf[];
}

export interface NavRoute {
  section: SectionId;
  /** Leaf key inside the section. */
  view: string;
}

type LeafSpec = Omit<NavLeaf, "id" | "section" | "labelKey" | "descriptionKey" | "adminOnly" | "permission"> & {
  adminOnly?: boolean;
  permission?: string;
};

/**
 * The permission each pre-IA tab asked for in the old sidebar. Plan and
 * integrations were open to every member there and still are.
 */
const TAB_PERMISSION: Partial<Record<AdminTab, string>> = {
  dashboard: "dashboard.read",
  conversations: "conversations.read",
  conversions: "dashboard.read",
  tools: "tools.manage",
  content: "content.manage",
  helpdesk: "helpdesk.manage",
  settings: "settings.manage",
};

function section(
  id: SectionId,
  slug: string,
  icon: LucideIcon,
  leaves: LeafSpec[]
): NavSection {
  return {
    id,
    slug,
    icon,
    labelKey: `nav.sections.${id}`,
    anchor: `nav-${id}`,
    leaves: leaves.map((leaf) => ({
      ...leaf,
      id: `${id}/${leaf.key}`,
      section: id,
      labelKey: `nav.leaves.${id}.${leaf.key}`,
      descriptionKey: `nav.leaves.${id}.${leaf.key}Description`,
      adminOnly: leaf.adminOnly ?? true,
      permission: leaf.permission ?? TAB_PERMISSION[leaf.tab],
    })),
  };
}

export const NAV_SECTIONS: readonly NavSection[] = [
  section("oggi", "alpharecall-dashboard", Sun, [
    {
      key: "oggi",
      icon: LayoutDashboard,
      tab: "dashboard",
      tour: "dashboard",
      keywords: "oggi home dashboard panoramica overview kpi attività recente today",
    },
  ]),
  section("inbox", "alpharecall-conversations", MessageSquare, [
    {
      key: "conversazioni",
      icon: MessageSquare,
      tab: "conversations",
      adminOnly: false,
      tour: "conversations",
      anchor: "conversations-tabs",
      keywords: "conversazioni chat messaggi risposte inbox thread conversations replies",
      frame: { fill: true },
    },
    {
      key: "contatti",
      icon: Users,
      tab: "conversations",
      adminOnly: false,
      keywords: "contatti visitatori persone utenti bloccati visitors people contacts",
    },
  ]),
  section("richieste", "alpharecall-conversions", List, [
    {
      key: "elenco",
      icon: List,
      tab: "conversions",
      // The support role handles requests here (view, change status).
      adminOnly: false,
      tour: "conversions",
      keywords: "richieste lead contatti moduli feedback preventivi esporta registro attività requests leads submissions",
    },
    {
      key: "agenda",
      icon: CalendarDays,
      tab: "conversions",
      keywords: "agenda appuntamenti prenotazioni visite calendario appointments bookings",
    },
    {
      key: "registro",
      icon: Wrench,
      tab: "tools",
      gapBefore: true,
      tour: "tools",
      keywords: "registro strumenti escalation prodotti ricerche tools log products",
    },
  ]),
  section("statistiche", "alpharecall-stats", BarChart3, [
    {
      key: "statistiche",
      icon: BarChart3,
      tab: "dashboard",
      keywords: "statistiche grafici andamento report consumi messaggi usati stats charts usage",
    },
  ]),
  section("assistente", "alpharecall-content", Sparkles, [
    {
      key: "contenuti",
      icon: FileText,
      tab: "content",
      tour: "content",
      keywords: "contenuti addestramento assistente training knowledge base sincronizza sync pagine articoli file carica upload indicizzati documenti",
    },
    {
      key: "dati",
      icon: MapPin,
      tab: "content",
      keywords: "dati attività indirizzo orari telefono servizi prezzi business info hours address",
    },
    {
      key: "carattere",
      icon: Sparkles,
      tab: "settings",
      anchor: "settings-agent-tab",
      keywords: "carattere persona nome tono personalità ruolo istruzioni strumenti tools prompt tone",
    },
    {
      key: "faq",
      icon: HelpCircle,
      tab: "helpdesk",
      tour: "helpdesk",
      keywords: "domande frequenti faq helpdesk risposte categorie genera importa questions answers",
      frame: { fill: true },
    },
    {
      key: "prova",
      icon: MessageCircle,
      tab: "settings",
      gapBefore: true,
      keywords: "prova test chatta anteprima simula try preview",
    },
  ]),
  section("widget", "alpharecall-widget", Palette, [
    {
      key: "widget",
      icon: Palette,
      tab: "settings",
      keywords: "personalizzazione widget aspetto colori logo pulsante posizione benvenuto tema anteprima appearance colors launcher customization",
    },
  ]),
  section("impostazioni", "alpharecall-settings", Settings, [
    {
      key: "team",
      icon: Users,
      tab: "settings",
      tour: "settings",
      anchor: "settings-team-tab",
      keywords: "team accessi membri operatori ruoli invita profili permessi members roles invite",
    },
    {
      key: "notifiche",
      icon: Bell,
      tab: "settings",
      anchor: "settings-notifications-tab",
      keywords: "notifiche avvisi email escalation alert notifications",
    },
    {
      key: "privacy",
      icon: ShieldCheck,
      tab: "settings",
      anchor: "settings-privacy-tab",
      keywords: "privacy dati gdpr consenso conservazione cancellazione retention consent",
    },
    {
      key: "piano",
      icon: CreditCard,
      tab: "upgrade",
      keywords: "piano abbonamento fattura pagamento upgrade prezzi consumi plan billing pricing",
    },
    {
      key: "avanzate",
      icon: Settings,
      tab: "settings",
      anchor: "settings-advanced-tab",
      keywords: "avanzate guida tutorial configurazione iniziale webhook woocommerce negozio google calendar advanced",
    },
  ]),
];

const SECTION_BY_ID = new Map(NAV_SECTIONS.map((s) => [s.id, s]));
const SECTION_BY_SLUG = new Map(NAV_SECTIONS.map((s) => [s.slug, s]));
const LEAF_BY_ID = new Map(NAV_SECTIONS.flatMap((s) => s.leaves.map((l) => [l.id, l] as const)));

export function getSection(id: SectionId): NavSection {
  return SECTION_BY_ID.get(id)!;
}

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && SECTION_BY_ID.has(value as SectionId);
}

/** The leaf a route points at, or undefined when the view is unknown. */
export function getLeaf(route: NavRoute): NavLeaf | undefined {
  return LEAF_BY_ID.get(`${route.section}/${route.view}`);
}

export function getLeafById(id: string): NavLeaf | undefined {
  return LEAF_BY_ID.get(id);
}

export function allLeaves(): NavLeaf[] {
  return NAV_SECTIONS.flatMap((s) => s.leaves);
}

/** Who is looking, and what the deployment has switched off. */
export interface NavAccess {
  isAdmin: boolean;
  isHidden: (tab: AdminTab) => boolean;
  /**
   * The RBAC check for team members who are not admins. Leave it out for
   * sessions that predate RBAC (no permissions in the config): `adminOnly`
   * then decides, as the old sidebar did.
   */
  can?: (permission: string) => boolean;
}

export function canOpenLeaf(leaf: NavLeaf, access: NavAccess): boolean {
  if (access.isHidden(leaf.tab)) return false;
  // Admins see every section whatever their permission list says.
  if (access.isAdmin) return true;
  // Everyone else is the support role: WordPress serves them Messaggi and
  // Richieste only and the other sections' REST routes refuse them.
  if (leaf.adminOnly) return false;
  if (access.can) return !leaf.permission || access.can(leaf.permission);
  return true;
}

/** Leaves the user may open in a section, in sub nav order (unlisted ones included). */
export function visibleLeaves(sectionId: SectionId, access: NavAccess): NavLeaf[] {
  return getSection(sectionId).leaves.filter((leaf) => canOpenLeaf(leaf, access));
}

/** Sections with at least one leaf the user may open, in top bar order. */
export function visibleSections(access: NavAccess): NavSection[] {
  return NAV_SECTIONS.filter((s) => visibleLeaves(s.id, access).length > 0);
}

/** The section's first listed leaf the user can open. */
export function defaultView(sectionId: SectionId, access: NavAccess): string | undefined {
  const leaves = visibleLeaves(sectionId, access);
  return (leaves.find((l) => !l.unlisted) ?? leaves[0])?.key;
}

/* ------------------------------------------------------------------ */
/*  Legacy names                                                       */
/* ------------------------------------------------------------------ */

/**
 * Every name a section went by before the 7-section IA: old AdminTab values,
 * the tool tabs PHP once passed as initialTab, and old wp-admin page slugs.
 */
const LEGACY_TAB_ROUTES: Record<string, NavRoute> = {
  dashboard: { section: "oggi", view: "oggi" },
  conversations: { section: "inbox", view: "conversazioni" },
  visitors: { section: "inbox", view: "contatti" },
  conversions: { section: "richieste", view: "elenco" },
  appointments: { section: "richieste", view: "registro" },
  leads: { section: "richieste", view: "registro" },
  escalations: { section: "richieste", view: "registro" },
  tools: { section: "richieste", view: "registro" },
  content: { section: "assistente", view: "contenuti" },
  helpdesk: { section: "assistente", view: "faq" },
  settings: { section: "impostazioni", view: "" },
  upgrade: { section: "impostazioni", view: "piano" },
  stats: { section: "statistiche", view: "statistiche" },
};

/** Old Impostazioni tabs (`ar-settings-tab`, dev `?settingsTab=`). */
const LEGACY_SETTINGS_TABS: Record<string, NavRoute> = {
  widget: { section: "widget", view: "widget" },
  agent: { section: "assistente", view: "carattere" },
  team: { section: "impostazioni", view: "team" },
  notifications: { section: "impostazioni", view: "notifiche" },
  privacy: { section: "impostazioni", view: "privacy" },
  advanced: { section: "impostazioni", view: "avanzate" },
};

/** Old wp-admin slugs that are no longer a section of their own. */
const LEGACY_SLUGS: Record<string, NavRoute> = {
  alpharecall: { section: "oggi", view: "oggi" },
  "alpharecall-helpdesk": { section: "assistente", view: "faq" },
  "alpharecall-upgrade": { section: "impostazioni", view: "piano" },
  "alpharecall-integrations": { section: "impostazioni", view: "avanzate" },
};

/**
 * Parameters that point at one record or list. Links from before this IA
 * carry them without a `view`: the bell, Slack and the notification e-mails
 * (`page=alpharecall-conversions&tab=leads&item=5`,
 * `page=alpharecall-conversations&thread=42`). Their view comes from them,
 * never from the one used last.
 */
export const DEEP_LINK_PARAMS = ["thread", "visitor", "item", "tab", "toolsTab", "gap", "q"] as const;

/** Richieste's old `tab` values whose records now live in the Agenda. */
const AGENDA_TABS = new Set(["appointments"]);

export function hasDeepLinkParams(params: Record<string, string>): boolean {
  return DEEP_LINK_PARAMS.some((key) => !!params[key]);
}

/** The leaf a link without `view` means, from its page parameters. Null when they do not say. */
export function deepLinkView(sectionId: SectionId, params: Record<string, string>): string | null {
  switch (sectionId) {
    case "inbox":
      // An operator filter (`operator`, card gbztrbczsxzr) lives in the conversations only.
      if (params.thread || params.operator) return "conversazioni";
      if (params.visitor) return "contatti";
      return null;
    case "richieste":
      if (params.toolsTab) return "registro";
      if (AGENDA_TABS.has(params.tab)) return "agenda";
      if (params.tab || params.item) return "elenco";
      return null;
    case "assistente":
      // An "Aggiungi FAQ" link (helpdesk-page FAQ_LINK_PARAMS): the question and its knowledge gap.
      if (params.gap || params.q) return "faq";
      return null;
    default:
      return null;
  }
}

/**
 * A section id, a leaf id ("inbox/contatti") or any legacy tab name, as a
 * route. `view` is "" when the name only picks a section.
 */
export function routeFromName(name: string | null | undefined): NavRoute | null {
  if (!name) return null;
  if (isSectionId(name)) return { section: name, view: "" };
  const leaf = LEAF_BY_ID.get(name);
  if (leaf) return { section: leaf.section, view: leaf.key };
  return LEGACY_TAB_ROUTES[name] ?? LEGACY_SETTINGS_TABS[name] ?? null;
}

/** The route of a wp-admin page slug, or null when the slug is not ours. */
export function routeFromSlug(slug: string | null | undefined): NavRoute | null {
  if (!slug) return null;
  const s = SECTION_BY_SLUG.get(slug);
  if (s) return { section: s.id, view: "" };
  return LEGACY_SLUGS[slug] ?? null;
}

export type NavMode = "wp" | "tabs";

export function navMode(): NavMode {
  return (window as any).AlphaRecallAdmin?.navMode === "tabs" ? "tabs" : "wp";
}

/**
 * The route a URL points at, or null if it is not one of ours.
 *
 * WordPress: `admin.php?page=<slug>[&view=<key>]`. Dev server: `?tab=<name>[&view=<key>]`,
 * only honoured in dev mode so a WordPress link's own `tab` (the Richieste
 * sub-tab) is never mistaken for a section.
 */
export function routeFromUrl(url: string, mode: NavMode = navMode()): NavRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    return null;
  }
  const params = parsed.searchParams;
  let route = routeFromSlug(params.get("page"));
  if (!route && mode === "tabs" && !params.get("page")) {
    route = routeFromName(params.get("tab")) ?? routeFromName(params.get("settingsTab"));
  }
  if (!route) return null;
  const view = params.get("view");
  if (view && getLeaf({ section: route.section, view })) return { section: route.section, view };
  // Old Impostazioni deep link: admin.php?page=alpharecall-settings&tab=team
  if (route.section === "impostazioni" && !route.view) {
    const legacy = LEGACY_SETTINGS_TABS[params.get("tab") || ""] ?? LEGACY_SETTINGS_TABS[params.get("settingsTab") || ""];
    if (legacy) return legacy;
  }
  if (!route.view) {
    const deep = deepLinkView(route.section, pageParamsFromUrl(parsed.href, mode));
    if (deep) return { section: route.section, view: deep };
  }
  return route;
}

/** URL parameters that belong to the router, never forwarded as page params. */
export const ROUTER_PARAMS = ["page", "view", "settingsTab"] as const;
/** Dev-harness switches kept on every URL the dev server pushes. */
const DEV_STICKY_PARAMS = ["demo", "slow", "quota", "tour"];

/**
 * The URL of a route, in the form the current host expects. `params` are
 * extra query parameters for the page (thread=42, tab=leads, item=7).
 */
export function hrefForRoute(
  route: NavRoute,
  params: Record<string, string> = {},
  mode: NavMode = navMode()
): string {
  const s = getSection(route.section);
  const query = new URLSearchParams();
  if (mode === "tabs") {
    const current = new URLSearchParams(window.location.search);
    for (const key of DEV_STICKY_PARAMS) {
      const value = current.get(key);
      if (value !== null) query.set(key, value);
    }
    query.set("tab", s.id);
  } else {
    query.set("page", s.slug);
  }
  // Always explicit: a section-only URL means "the page you used last", so a
  // history entry without its view would reopen the wrong page on Back.
  if (route.view) query.set("view", route.view);
  for (const [key, value] of Object.entries(params)) {
    // In dev `tab` is the section; a page's own `tab` would overwrite it.
    if (mode === "tabs" && key === "tab") continue;
    query.set(key, value);
  }
  return mode === "tabs" ? `?${query.toString()}` : `admin.php?${query.toString()}`;
}

/** Page parameters carried by a URL (everything that is not routing). */
export function pageParamsFromUrl(url: string, mode: NavMode = navMode()): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    new URL(url, window.location.href).searchParams.forEach((value, key) => {
      if ((ROUTER_PARAMS as readonly string[]).includes(key)) return;
      if (mode === "tabs" && (key === "tab" || DEV_STICKY_PARAMS.includes(key))) return;
      out[key] = value;
    });
  } catch {
    // An unparsable href carries no parameters.
  }
  return out;
}

/**
 * The page component a leaf renders on. Contenuti and Dati attività are the
 * two tabs of one page that keeps the drafts of both, so they share it:
 * switching between them never remounts (app.tsx keys the page on this).
 */
export function pageIdOf(leaf: NavLeaf): string {
  return leaf.tab === "content" ? "assistente/content" : leaf.id;
}

export function sameRoute(a: NavRoute, b: NavRoute): boolean {
  return a.section === b.section && a.view === b.view;
}
