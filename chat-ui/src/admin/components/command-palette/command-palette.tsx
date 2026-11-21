/**
 * Ctrl K / Cmd K: jump to any page, find a person, a conversation or a
 * request, or run a common action, from the keyboard (mockup "cerca", A).
 *
 * Opens from the shortcut anywhere in the admin and from the top bar pill
 * (OPEN_PALETTE_EVENT). People, conversations and requests come from the same
 * endpoints the Inbox and Richieste pages use; pages come from lib/nav.ts, so
 * a new leaf is searchable without touching this file. Actions that need a
 * page (sync, add a FAQ, invite) open that page with an intent the page picks
 * up via useNavIntent.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  CalendarDays,
  Download,
  ExternalLink,
  HelpCircle,
  Languages,
  Mail,
  LifeBuoy,
  MessageSquare,
  Moon,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Sun,
  Upload,
  User,
  type LucideIcon,
} from "@/components/icons";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { useApp } from "@/admin/app-context";
import { useNav } from "@/admin/lib/nav-context";
import { allLeaves, canOpenLeaf, getLeaf, getSection } from "@/admin/lib/nav";
import { apiFetch } from "@/admin/lib/api";
import { getConfig } from "@/admin/lib/config";
import { interpolate, named } from "@/admin/lib/i18n";
import { assistantName } from "@/admin/components/assistant/shared";
import { formatRelativeTime } from "@/admin/lib/format";
import { appointmentName, appointmentTime, leadName } from "@/admin/lib/record-fields";
import { useLeafDescription, useLeafLabel } from "@/admin/components/layout/sub-nav";
import { OPEN_PALETTE_EVENT, OPEN_SUPPORT_EVENT } from "@/admin/components/layout/frame-events";
import { cn } from "@/admin/lib/utils";
import { anonymousVisitorLabel, visitorName } from "@/admin/components/conversations/inbox-format";
import type { ChatThread } from "@/admin/hooks/use-conversations";

type GroupKey = "recent" | "people" | "conversations" | "requests" | "pages" | "actions";

/** What a recent entry needs to run again after a reload. */
type Target =
  | { kind: "nav"; to: string; params?: Record<string, string>; intent?: string }
  | { kind: "action"; action: string };

interface PaletteItem {
  id: string;
  group: GroupKey;
  icon: LucideIcon;
  label: string;
  detail?: string;
  /** Extra text matched by the search, never shown. */
  keywords?: string;
  target: Target;
}

const GROUP_ORDER: GroupKey[] = ["recent", "people", "conversations", "requests", "pages", "actions"];
const GROUP_LIMIT: Record<GroupKey, number> = { recent: 5, people: 4, conversations: 4, requests: 4, pages: 6, actions: 5 };
const RECENT_MAX = 5;
const MIN_REMOTE_QUERY = 2;

function recentKey(): string {
  const config = getConfig() as ReturnType<typeof getConfig> & { currentUser?: { id: number } };
  return `ar-palette-recent:${config?.siteUrl ?? ""}:${config?.currentUser?.id ?? ""}`;
}

function readRecent(): PaletteItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey()) || "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.id === "string" && r.target) : [];
  } catch {
    return [];
  }
}

function writeRecent(items: PaletteItem[]): void {
  try {
    localStorage.setItem(recentKey(), JSON.stringify(items.slice(0, RECENT_MAX)));
  } catch {
    // Without storage the palette simply has no recent list.
  }
}

/** Every character of the query appears in order in the target. */
function fuzzy(query: string, target: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/** Relevance of an item for a query; 0 = no match. Label matches outrank keyword matches. */
function score(query: string, item: PaletteItem): number {
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 100;
  if (label.split(/[\s"'(:]+/).some((word) => word.startsWith(q))) return 90;
  if (label.includes(q)) return 80;
  const rest = `${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  if (rest.includes(q)) return 60;
  if (q.length > 2 && fuzzy(q, label)) return 40;
  return 0;
}

function collection(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  const record = value as Record<string, unknown> | null;
  for (const key of ["items", "data", "threads"]) {
    if (Array.isArray(record?.[key])) return record![key] as Record<string, unknown>[];
  }
  return [];
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

function snippet(text: string, max = 60): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** What each kind of contact request is called in the results. */
const SUBMISSION_LABEL: Record<string, string> = { quote: "nav.palette.quote", callback: "nav.palette.callback", job_application: "nav.palette.job" };

/**
 * People, conversations and requests matching the query. Every list is
 * searched on the server, over all the site's records and with the same rules
 * as the pages they open (card 9kh6lanw2siz): Messaggi's search for the
 * conversations (visitor label and number, name, e-mail, phone, thread id,
 * title, every message), Contatti's for people (name, address, "Visitatore
 * 18131") and Richieste's for leads, bookings and contact requests. A newer
 * query cancels the requests of the one before.
 */
function useRemoteResults(query: string, enabled: boolean, canRequests: boolean) {
  const { t } = useApp();
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const version = useRef(0);

  useEffect(() => {
    const term = query.trim().replace(/\s+/g, " ");
    if (!enabled || term.length < MIN_REMOTE_QUERY) {
      version.current++;
      setItems([]);
      setLoading(false);
      return;
    }
    const mine = ++version.current;
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const read = (path: string, params: Record<string, string>) =>
        apiFetch<unknown>(`${path}?${new URLSearchParams({ ...params, search: term })}`, { signal: controller.signal });
      const none = Promise.resolve([] as unknown);
      const [people, threads, leads, appointments, submissions] = await Promise.allSettled([
        read("/visitors", { limit: "6" }),
        read("/chat-threads", { limit: String(GROUP_LIMIT.conversations + 2) }),
        canRequests ? read("/tools/leads", { limit: "4" }) : none,
        canRequests ? read("/tools/appointments", { limit: "4" }) : none,
        canRequests ? read("/contact-submissions", { limit: "4" }) : none,
      ]);
      if (mine !== version.current) return;
      const out: PaletteItem[] = [];

      if (people.status === "fulfilled") {
        for (const v of collection(people.value)) {
          // A person with no name or address reads as everywhere else: "Visitatore 18131".
          const name = str(v.display_name) || str(v.email) || anonymousVisitorLabel(v.id, t);
          const seen = str(v.last_seen_at);
          out.push({
            id: `person-${str(v.id)}`,
            group: "people",
            icon: User,
            label: name,
            detail: v.display_name && v.email ? str(v.email) : seen ? interpolate(t("nav.palette.lastChat"), { date: formatRelativeTime(seen) }) : undefined,
            keywords: `${str(v.email)} ${str(v.unverified_email)} ${str(v.id)}`,
            target: { kind: "nav", to: "inbox/contatti", params: { visitor: str(v.id) } },
          });
        }
      }

      if (threads.status === "fulfilled") {
        for (const th of collection(threads.value)) {
          if (th.thread_type === "support") continue;
          const who = visitorName(th as unknown as ChatThread, t);
          const lastOf = (value: unknown) => (typeof value === "object" && value
            ? str((value as Record<string, unknown>).content) : str(value));
          const last = lastOf(th.last_visitor_message) || lastOf(th.last_message);
          const title = str(th.title);
          out.push({
            id: `thread-${str(th.id)}`,
            group: "conversations",
            icon: MessageSquare,
            label: title ? title : last ? `“${snippet(last)}”` : t("nav.palette.untitled"),
            detail: [who || t("nav.palette.visitor"), th.last_message_at || th.updated_at || th.created_at ? formatRelativeTime(str(th.last_message_at || th.updated_at || th.created_at)) : ""].filter(Boolean).join(" · "),
            keywords: `${who} ${last}`,
            target: { kind: "nav", to: "inbox/conversazioni", params: { thread: str(th.id) } },
          });
        }
      }

      if (leads.status === "fulfilled") {
        for (const row of collection(leads.value)) {
          const name = leadName(row) || str(row.email);
          out.push({
            id: `lead-${str(row.id)}`,
            group: "requests",
            icon: Star,
            label: `${t("nav.palette.lead")}: ${name || str(row.email)}`,
            detail: snippet(str(row.interest || row.notes || row.message || row.email), 48) || undefined,
            keywords: `${str(row.email)} ${str(row.phone)}`,
            target: { kind: "nav", to: "richieste/elenco", params: { tab: "leads", item: str(row.id) } },
          });
        }
      }

      if (appointments.status === "fulfilled") {
        for (const row of collection(appointments.value)) {
          const name = appointmentName(row);
          const when = appointmentTime(row);
          out.push({
            id: `appointment-${str(row.id)}`,
            group: "requests",
            icon: CalendarDays,
            label: `${t("nav.palette.appointment")}: ${name || str(row.email)}`,
            detail: when ? formatRelativeTime(when) : undefined,
            keywords: `${str(row.email)} ${str(row.phone)}`,
            target: { kind: "nav", to: "richieste/elenco", params: { tab: "appointments", item: str(row.id) } },
          });
        }
      }

      if (submissions.status === "fulfilled") {
        for (const row of collection(submissions.value)) {
          const name = str(row.name) || str(row.email) || str(row.phone);
          out.push({
            id: `submission-${str(row.id)}`,
            group: "requests",
            icon: Mail,
            label: `${t(SUBMISSION_LABEL[str(row.type)] ?? "nav.palette.inquiry")}: ${name}`,
            detail: snippet(str(row.subject || row.message || row.service_description || row.email), 48) || undefined,
            keywords: `${str(row.email)} ${str(row.phone)} ${str(row.company)}`,
            target: { kind: "nav", to: "richieste/elenco", params: { tab: "submissions", item: str(row.id) } },
          });
        }
      }

      setItems(out);
      setLoading(false);
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled, canRequests, t]);

  return { items, loading };
}

/**
 * Ctrl K / Cmd K, unless WordPress's own command palette is already open
 * (its admin bar button opens it): that key is then its own to close it.
 */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return false;
  return !document.querySelector(".commands-command-menu");
}

export function CommandPalette() {
  const { t, theme, toggleTheme, toggleLang, isAdmin, resetTutorialSections, settings } = useApp();
  const botName = assistantName(settings, "");
  const leafDescription = useLeafDescription();
  const { navigate, access, sections } = useNav();
  const leafLabel = useLeafLabel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<PaletteItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  // Where focus goes back when the palette closes: the top bar's search
  // button that opened it, or the element of the dashboard that had focus
  // when Ctrl K was pressed. Not an element of the WordPress page around
  // the app: a site with Burst Statistics (its menu sits third in the
  // sidebar) got focus back on "Fonti", a menu item of another plugin
  // (card chfyeqh0ft8m); the search button stands in for those.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  // Ctrl K / Cmd K anywhere in the admin, and the top bar pill.
  useEffect(() => {
    const remember = (opener?: HTMLElement | null) => {
      const el = opener ?? document.activeElement;
      returnFocusRef.current =
        el instanceof HTMLElement && el.closest("#alpharecall-admin-app") && !el.closest(".ar-palette") ? el : null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        // Ctrl K again closes it: keep the element remembered on open.
        if (!openRef.current) remember();
        setOpen((v) => !v);
      }
    };
    const onOpen = (event: Event) => {
      remember((event as CustomEvent<{ opener?: HTMLElement }>).detail?.opener);
      setOpen(true);
    };
    // WordPress 6.9+ binds the same shortcut to its own command palette with a
    // keydown listener on document (bubble phase). Taking the key in the
    // capture phase on document runs first and stops it, so only one palette
    // opens. The setup screen's capture listener on window still runs before
    // this one and keeps the palette shut while setup is showing.
    document.addEventListener("keydown", onKey, true);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setRecent(readRecent());
    } else {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  // Requests are searched for whoever can open Richieste: admins and the
  // support role, which reads leads, bookings and contact requests there.
  const canRequests = useMemo(() => {
    const leaf = getLeaf({ section: "richieste", view: "elenco" });
    return !!leaf && canOpenLeaf(leaf, access);
  }, [access]);
  const remote = useRemoteResults(query, open, canRequests);
  const siteUrl = getConfig()?.siteUrl;

  const pages = useMemo<PaletteItem[]>(
    () =>
      allLeaves()
        .filter((leaf) => canOpenLeaf(leaf, access))
        .map((leaf) => {
          const label = leafLabel(leaf);
          const sectionLabel = t(getSection(leaf.section).labelKey);
          return {
            id: `page-${leaf.id}`,
            group: "pages" as const,
            icon: leaf.icon,
            label,
            detail: sectionLabel !== label ? sectionLabel : undefined,
            keywords: `${sectionLabel} ${leafDescription(leaf)} ${leaf.keywords}`,
            target: { kind: "nav" as const, to: leaf.id },
          };
        }),
    [access, leafLabel, leafDescription, t]
  );

  const actions = useMemo<PaletteItem[]>(() => {
    const list: (PaletteItem & { adminOnly?: boolean; leaf?: string })[] = [
      { id: "act-sync", group: "actions", icon: RefreshCw, label: t("nav.palette.a.sync"), keywords: "sync sincronizza aggiorna reindex knowledge", target: { kind: "nav", to: "assistente/contenuti", intent: "sync" }, leaf: "assistente/contenuti" },
      { id: "act-upload", group: "actions", icon: Upload, label: named(t, "nav.palette.a.upload", botName), keywords: "carica file upload txt md documento", target: { kind: "nav", to: "assistente/contenuti", intent: "upload" }, leaf: "assistente/contenuti" },
      { id: "act-faq", group: "actions", icon: Plus, label: t("nav.palette.a.addFaq"), keywords: "faq domanda risposta aggiungi nuova helpdesk", target: { kind: "nav", to: "assistente/faq", intent: "add-faq" }, leaf: "assistente/faq" },
      { id: "act-invite", group: "actions", icon: Plus, label: t("nav.palette.a.invite"), keywords: "invita collega team membro operatore invite", target: { kind: "nav", to: "impostazioni/team", intent: "invite" }, leaf: "impostazioni/team" },
      { id: "act-export", group: "actions", icon: Download, label: t("nav.palette.a.exportRequests"), keywords: "esporta csv lead richieste export download", target: { kind: "nav", to: "richieste/elenco", intent: "export" }, leaf: "richieste/elenco", adminOnly: true },
      { id: "act-widget", group: "actions", icon: Palette, label: t("nav.palette.a.editWidget"), keywords: "widget colori aspetto personalizza", target: { kind: "nav", to: "widget/widget" }, leaf: "widget/widget" },
      { id: "act-theme", group: "actions", icon: theme === "dark" ? Sun : Moon, label: theme === "dark" ? t("nav.palette.a.themeLight") : t("nav.palette.a.themeDark"), keywords: "tema scuro chiaro dark light theme", target: { kind: "action", action: "theme" } },
      { id: "act-lang", group: "actions", icon: Languages, label: t("nav.palette.a.language"), keywords: "lingua language english italiano", target: { kind: "action", action: "lang" } },
      { id: "act-support", group: "actions", icon: LifeBuoy, label: t("nav.palette.a.support"), keywords: "supporto aiuto help assistenza alpharecall", target: { kind: "action", action: "support" } },
      { id: "act-tour", group: "actions", icon: RotateCcw, label: t("nav.palette.a.tour"), keywords: "guida tour tutorial aiuto", target: { kind: "action", action: "tour" }, adminOnly: true },
      ...(siteUrl ? [{ id: "act-site", group: "actions" as const, icon: ExternalLink, label: t("nav.palette.a.visitSite"), keywords: "sito apri visita website", target: { kind: "action" as const, action: "site" } }] : []),
    ];
    return list.filter((a) => {
      if (a.adminOnly && !isAdmin) return false;
      if (a.leaf) {
        const [section, view] = a.leaf.split("/");
        const leaf = allLeaves().find((l) => l.section === section && l.key === view);
        return !!leaf && canOpenLeaf(leaf, access);
      }
      return true;
    });
  }, [t, theme, isAdmin, access, siteUrl, botName]);

  /** One entry per section, for the palette before anything is typed. */
  const sectionItems = useMemo<PaletteItem[]>(
    () =>
      sections.map((section) => ({
        id: `section-${section.id}`,
        group: "pages" as const,
        icon: section.icon,
        label: t(section.labelKey),
        target: { kind: "nav" as const, to: section.id },
      })),
    [sections, t]
  );

  /** Stored recents carry no component; find their icon again. */
  const iconFor = useCallback(
    (item: PaletteItem): LucideIcon => {
      if (item.id.startsWith("person-")) return User;
      if (item.id.startsWith("thread-")) return MessageSquare;
      if (item.id.startsWith("lead-")) return Star;
      if (item.id.startsWith("appointment-")) return CalendarDays;
      return [...pages, ...sectionItems, ...actions].find((a) => a.id === item.id)?.icon ?? HelpCircle;
    },
    [pages, sectionItems, actions]
  );

  /** Grouped, ranked, capped results in display order. */
  const groups = useMemo(() => {
    const q = query.trim();
    const pick = (items: PaletteItem[]) =>
      items
        .map((item) => ({ item, s: score(q, item) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.item);
    const rank = (items: PaletteItem[]) =>
      items
        .map((item, i) => ({ item, s: score(q, item), i }))
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((x) => x.item);

    const byGroup = new Map<GroupKey, PaletteItem[]>();
    if (!q) {
      if (recent.length) byGroup.set("recent", recent.map((r) => ({ ...r, group: "recent" as const, icon: iconFor(r) })));
      // No query: the sections, then a few everyday actions.
      byGroup.set("pages", sectionItems);
      byGroup.set("actions", actions.slice(0, 4));
    } else {
      byGroup.set("people", remote.items.filter((i) => i.group === "people"));
      // The server already matched these (on fields the label may not show,
      // a message or a phone number): ranked, never dropped.
      byGroup.set("conversations", rank(remote.items.filter((i) => i.group === "conversations")));
      byGroup.set("requests", rank(remote.items.filter((i) => i.group === "requests")));
      byGroup.set("pages", pick(pages));
      byGroup.set("actions", pick(actions));
    }
    return GROUP_ORDER.map((key) => ({ key, items: (byGroup.get(key) ?? []).slice(0, q ? GROUP_LIMIT[key] : key === "pages" ? 8 : GROUP_LIMIT[key]) })).filter((g) => g.items.length > 0);
  }, [query, recent, pages, sectionItems, actions, remote.items, iconFor]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    if (active >= flat.length) setActive(Math.max(0, flat.length - 1));
  }, [flat.length, active]);

  // Keep the highlighted row visible while moving with the arrows.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const run = useCallback(
    (item: PaletteItem) => {
      setOpen(false);
      const entry: PaletteItem = { ...item, group: item.group === "recent" ? "recent" : item.group };
      // Theme and language toggles are not worth remembering.
      if (!(entry.target.kind === "action" && (entry.target.action === "theme" || entry.target.action === "lang"))) {
        const { icon: _icon, ...stored } = entry;
        writeRecent([stored as PaletteItem, ...readRecent().filter((r) => r.id !== item.id)]);
      }
      const target = item.target;
      if (target.kind === "nav") {
        navigate(target.to, { params: target.params, intent: target.intent });
        return;
      }
      switch (target.action) {
        case "theme":
          toggleTheme();
          break;
        case "lang":
          toggleLang();
          break;
        case "support":
          window.dispatchEvent(new Event(OPEN_SUPPORT_EVENT));
          break;
        case "tour":
          resetTutorialSections();
          break;
        case "site":
          if (siteUrl) window.open(siteUrl, "_blank", "noopener");
          break;
      }
    },
    [navigate, toggleTheme, toggleLang, resetTutorialSections, siteUrl]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0));
    } else if (event.key === "Home" && flat.length) {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End" && flat.length) {
      event.preventDefault();
      setActive(flat.length - 1);
    } else if (event.key === "Enter") {
      const item = flat[active];
      if (item) {
        event.preventDefault();
        run(item);
      }
    }
  };

  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const q = query.trim();
  const groupLabel: Record<GroupKey, string> = {
    recent: t("nav.palette.recent"),
    people: t("nav.palette.people"),
    conversations: t("nav.palette.conversations"),
    requests: t("nav.palette.requests"),
    pages: t("nav.palette.pages"),
    actions: t("nav.palette.actions"),
  };
  let index = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPortal>
        <DialogOverlay className="ar-palette-scrim" />
        <DialogPrimitive.Content
          className="ar-palette"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            const el = returnFocusRef.current;
            returnFocusRef.current = null;
            // Opened by the shortcut with nothing (or something outside the
            // app) focused, or the element is gone or hidden because a pick
            // navigated away: land on the top bar's search button, the
            // palette's visible opener. Radix's default went back to whatever
            // had focus on open, <body> or the WordPress menu.
            const shown = (node: HTMLElement | null | undefined) => !!node?.isConnected && node.getClientRects().length > 0;
            const target = shown(el) ? el : document.querySelector<HTMLElement>("#alpharecall-admin-app button.ar-find");
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          <DialogPrimitive.Title className="sr-only">{t("nav.palette.title")}</DialogPrimitive.Title>
          <div className="ar-palette-search">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t("nav.palette.placeholder")}
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={flat[active] ? optionId(active) : undefined}
              aria-label={t("nav.palette.title")}
              autoComplete="off"
              spellCheck={false}
            />
            <DialogPrimitive.Close className="ar-palette-esc" aria-label={t("common.close")}>
              {t("nav.palette.esc")}
            </DialogPrimitive.Close>
          </div>
          <div ref={listRef} id={listId} role="listbox" aria-label={t("nav.palette.resultsLabel")} className="ar-palette-list">
            {groups.map((group) => (
              <div key={group.key} role="group" aria-labelledby={`${baseId}-g-${group.key}`} className="ar-palette-group">
                <div id={`${baseId}-g-${group.key}`} className="ar-palette-label" role="presentation">
                  {groupLabel[group.key]}
                </div>
                {group.items.map((item) => {
                  index += 1;
                  const i = index;
                  const Icon = item.icon;
                  const on = i === active;
                  return (
                    <div
                      key={`${group.key}-${item.id}`}
                      id={optionId(i)}
                      role="option"
                      aria-selected={on}
                      data-index={i}
                      className={cn("ar-palette-item", on && "ar-palette-item-on")}
                      onMouseMove={() => !on && setActive(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => run(item)}
                    >
                      <Icon aria-hidden="true" className="ar-palette-icon" />
                      <span className="ar-palette-text">
                        {item.label}
                        {item.detail && <span className="ar-palette-detail"> {item.detail}</span>}
                      </span>
                      {on && <kbd className="ar-palette-kbd">{t("nav.palette.enter")}</kbd>}
                    </div>
                  );
                })}
              </div>
            ))}
            {q.length >= MIN_REMOTE_QUERY && remote.loading && (
              <p className="ar-palette-note" role="status">{t("nav.palette.loading")}</p>
            )}
            {q && !remote.loading && flat.length === 0 && (
              <p className="ar-palette-note" role="status">{interpolate(t("nav.palette.empty"), { q })}</p>
            )}
            {q.length > 0 && q.length < MIN_REMOTE_QUERY && (
              <p className="ar-palette-note">{t("nav.palette.typeMore")}</p>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
