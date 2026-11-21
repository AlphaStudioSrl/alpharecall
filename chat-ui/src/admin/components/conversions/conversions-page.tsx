/**
 * Richieste: everything visitors asked for in chat (leads, appointments,
 * quotes, call-backs, contact requests, escalations, feedback).
 *
 * Elenco is a board (Nuove / In corso / Fatte, drag to change status) or a
 * list of the same items; a card or a row opens the detail sheet. Agenda
 * (agenda-page.tsx) is the appointments of the same data, by day.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, SquareKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/admin/app-context";
import { assistantName } from "@/admin/components/assistant/shared";
import { interpolate, named } from "@/admin/lib/i18n";
import { formatNumber } from "@/admin/lib/format";
import { useConversionsData, type ConversionCollection } from "@/admin/hooks/use-conversions-data";
import { useFrameLayout } from "@/admin/components/layout/frame-context";
import { Chips, IconButton, PageHead, SearchField, Segmented, type Option } from "@/admin/components/shared/kit";
import { ScrollRow } from "@/admin/components/shared/scroll-row";
import { Bones } from "@/admin/components/shared/bones";
import { useLiveParams, useNavBadge, useNavIntent, useView } from "@/admin/lib/nav-context";
import { Building, Calendar, Download, Mail, MessageSquare, MoreHorizontal, RefreshCw, Search, Star, Trash2 } from "@/components/icons";
import { ConfigureResultsTools, ResultsError, ResultsState } from "./results-state";
import { ConfirmDialog, LoadMoreBar, applyStatus, exportAll, type ConfirmRequest } from "./parts";
import { RequestBoard } from "./request-board";
import { RequestList } from "./request-list";
import { RequestSheet } from "./request-sheet";
import { AgendaPage } from "./agenda-page";
import { ALL_COLLECTIONS, urlParam, useVisibleCollections } from "./collections";
import {
  KIND_ORDER,
  buildItems,
  columnFor,
  columnTotals,
  kindTotals,
  kindCollection,
  kindInfo,
  type RequestItem,
  type RequestKind,
} from "./request-model";
import { EXPORT_PATHS, exportWriter } from "./exports";
import "./conversions.css";

/** The old tab names a link may still carry (Ctrl K: `tab=leads&item=7`). */
const TAB_FILTER: Record<string, RequestKind> = { leads: "lead", appointments: "appointment", feedback: "feedback" };

const COLLECTION_ICON = { leads: Mail, appointments: Calendar, submissions: MessageSquare, feedback: Star };

/** What "Altre azioni" can empty, in menu order (conversions.board.deleteAll.<target>). */
type DeleteAllTarget = "leads" | "appointments" | "submissions" | "feedback" | "escalations";
const DELETE_ALL_TARGETS: DeleteAllTarget[] = ["leads", "appointments", "submissions", "escalations", "feedback"];

/* ========== Entry ========== */

/** @param initialTab the collection a link asked for (Ctrl K results pass `tab`). */
export function ConversionsPage({ initialTab }: { initialTab?: string } = {}) {
  const { view } = useView();
  return view === "agenda" ? <AgendaPage /> : <RequestsPage initialTab={initialTab} />;
}

/* ========== Richieste > Elenco ========== */

type Mode = "board" | "list";
type Filter = "all" | RequestKind;
const MODE_KEY = "ar-requests-mode";
/** The search goes to the server once typing pauses this long. */
const SEARCH_DEBOUNCE_MS = 300;

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

function RequestsPage({ initialTab }: { initialTab?: string }) {
  const { t, settings, isAdmin } = useApp();
  // A notification or Ctrl K result while Richieste is open opens its record in place.
  const { params, visit, clearParams } = useLiveParams();
  const visible = useVisibleCollections();
  const [query, setQuery] = useState("");
  const typed = query.trim();
  // The search runs on the server over every record: it used to filter only
  // the 100 rows loaded ("Nessuna richiesta caricata contiene...").
  const [serverQuery, setServerQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setServerQuery(typed), typed ? SEARCH_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const data = useConversionsData({ search: serverQuery });
  const {
    leads, leadsTotal, appointments, appointmentsTotal, submissions, submissionsTotal, submissionsDeletableTotal,
    escalationsTotal, feedback, feedbackTotal, counts, searched, serverFiltered, loading, loadingMore, errors, loadMoreErrors, reload, loadMore,
  } = data;
  // Esporta and "Elimina tutti" act on whole collections: a search must not
  // shrink their numbers ("Verranno eliminati 1 elementi" for all 290 leads).
  const whole = useRef({ leads: 0, appointments: 0, submissions: 0, feedback: 0, escalations: 0 });
  if (searched === "") {
    whole.current = {
      leads: leadsTotal, appointments: appointmentsTotal, submissions: submissionsDeletableTotal, feedback: feedbackTotal, escalations: escalationsTotal,
    };
  }
  const botName = String((settings.tenant_settings as Record<string, unknown> | undefined)?.chatbot_name || "").trim() || "AlphaRecall";
  const configuredName = assistantName(settings, "");

  const [mode, setModeState] = useState<Mode>(readMode);
  const setMode = (next: Mode) => {
    setModeState(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* the choice lasts for this visit */ }
  };
  const tab = params.tab || urlParam("tab") || initialTab || "";
  const [filter, setFilter] = useState<Filter>(() => {
    const kind = TAB_FILTER[tab];
    return kind && visible.includes(kindCollection(kind)) ? kind : "all";
  });
  // The Lead filter keeps the board (a grid of lead cards): it used to switch
  // to the list on its own, so one chip changed the whole layout.
  const board = mode === "board";
  // The board fills the panel and its columns scroll; the list scrolls with the page.
  useFrameLayout({ fill: board });
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const exportWanted = useRef(false);
  const allChipRef = useRef<HTMLDivElement>(null);

  const totals: Record<ConversionCollection, number> = {
    leads: leadsTotal, appointments: appointmentsTotal, submissions: submissionsTotal, feedback: feedbackTotal,
  };
  const loaded: Record<ConversionCollection, number> = {
    leads: leads.length, appointments: appointments.length, submissions: submissions.length, feedback: feedback.length,
  };

  const built = useMemo(
    () => buildItems({ leads, appointments, submissions, feedback }, t).filter((i) => visible.includes(i.collection)),
    [leads, appointments, submissions, feedback, t, visible],
  );
  // Optimistic status while the request is in flight: the card moves at once.
  const items = useMemo(
    () => built.map((i) => (overrides[i.key] ? { ...i, status: overrides[i.key], column: columnFor(i.kind, overrides[i.key]) } : i)),
    [built, overrides],
  );

  // Per type, over the whole collections; the loaded rows only when the API
  // does not count (an older server).
  const kindCounts = useMemo(() => {
    const loadedCounts = Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<RequestKind, number>;
    for (const i of items) loadedCounts[i.kind] += 1;
    return { ...loadedCounts, ...kindTotals(counts) };
  }, [items, counts]);

  // Once the server has answered the typed search, every loaded row is a
  // match (it also reads fields a card does not show). Until then, and for a
  // collection an older API did not filter, the rows are filtered here.
  const answered = searched === typed;
  const q = typed.toLowerCase();
  const shown = useMemo(
    () => items.filter((i) => (filter === "all" || i.kind === filter)
      && ((answered && serverFiltered[i.collection]) || !q || i.haystack.includes(q))),
    [items, filter, q, answered, serverFiltered],
  );
  // The open record stays in the sheet while a search answer leaves it out
  // of the rows: the sheet must not close under the reader.
  const lastOpen = useRef<RequestItem | null>(null);
  const foundOpen = openKey ? items.find((i) => i.key === openKey) ?? null : null;
  if (foundOpen || !openKey) lastOpen.current = foundOpen;
  const openItem = foundOpen ?? (openKey && lastOpen.current?.key === openKey ? lastOpen.current : null);

  /**
   * Column sizes over the whole collections, with the in-flight moves
   * applied. A collection the API did not count (an older server) adds its
   * loaded cards instead.
   */
  const columnSizes = (kinds: RequestKind[]) => {
    const counted = kinds.filter((k) => counts[kindCollection(k)]);
    const totals = columnTotals(counts, counted)!;
    for (const i of items) {
      if (kinds.includes(i.kind) && !counted.includes(i.kind) && i.column) totals[i.column] += 1;
    }
    for (const i of built) {
      const moved = overrides[i.key];
      if (!moved || !counted.includes(i.kind)) continue;
      const to = columnFor(i.kind, moved);
      if (i.column) totals[i.column] = Math.max(0, totals[i.column] - 1);
      if (to) totals[to] += 1;
    }
    return totals;
  };
  const visibleKinds = KIND_ORDER.filter((k) => visible.includes(kindCollection(k)));

  // Sub nav counts: what still waits for someone (leads are never waiting,
  // see columnFor), over every record. "Elenco 200" was the loaded pages.
  // A search narrows the counts, so the badge keeps its last unsearched number.
  const badge = useRef<number | null>(null);
  if (!loading && searched === "") {
    badge.current = columnSizes(visibleKinds).new;
  }
  useNavBadge("richieste/elenco", loading ? null : badge.current || null);

  // A later visit with a type (`tab=leads`) shows that type, as on arrival.
  const tabVisit = useRef(visit);
  useEffect(() => {
    if (tabVisit.current === visit) return;
    tabVisit.current = visit;
    const kind = TAB_FILTER[params.tab || ""];
    if (kind && visible.includes(kindCollection(kind))) setFilter(kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit]);

  /* ----- Ctrl K: a record id opens its sheet; "export" opens the export menu ----- */
  // Each link opens its record once: `item` then leaves the router and the
  // address, so Aggiorna (or Back) does not reopen a sheet the user closed.
  // A link followed while the page is open may name a record newer than the
  // loaded list (a notification): that list is read again once to find it.
  const itemParam = params.item || urlParam("item");
  const mountVisit = useRef(visit);
  const itemLink = useRef<{ key: string; reloaded: boolean; done: boolean } | null>(null);
  useEffect(() => {
    if (loading || !itemParam) return;
    const key = `${visit}:${itemParam}`;
    if (itemLink.current?.key !== key) itemLink.current = { key, reloaded: visit === mountVisit.current, done: false };
    const link = itemLink.current;
    if (link.done) return;
    const id = Number(itemParam);
    const order: ConversionCollection[] = tab in TAB_FILTER || tab === "submissions" ? [tab as ConversionCollection] : ALL_COLLECTIONS;
    // Escalations sit in submissions under a negative id: a real submission id wins.
    const found = order.map((c) => items.find((i) => i.collection === c && i.id === id) ?? items.find((i) => i.collection === c && Math.abs(i.id) === id)).find(Boolean);
    if (!found && !link.reloaded) {
      link.reloaded = true;
      void reload();
      return;
    }
    link.done = true;
    if (found) setOpenKey(found.key);
    clearParams(["item"]);
    // `items` is read once the list has loaded; a later change must not reopen anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, itemParam, visit]);

  const exportable = visible.some((c) => whole.current[c] > 0) || (visible.includes("submissions") && whole.current.escalations > 0);
  useNavIntent("export", () => { exportWanted.current = true; });
  useEffect(() => {
    if (loading || !exportWanted.current) return;
    exportWanted.current = false;
    if (exportable && isAdmin) setExportOpen(true);
  }, [loading, exportable, isAdmin]);

  /* ----- Actions ----- */
  const setStatus = useCallback(async (item: RequestItem, status: string) => {
    const run = () => {
      switch (item.kind) {
        case "appointment": return data.updateAppointmentStatus(item.id, status);
        case "feedback": return data.updateFeedbackStatus(item.id, status);
        case "escalation": return data.updateEscalationStatus(-item.id, status);
        default: return data.updateSubmissionStatus(item.id, status);
      }
    };
    setOverrides((prev) => ({ ...prev, [item.key]: status }));
    setBusy((prev) => new Set(prev).add(item.key));
    try {
      await applyStatus(t, run, status, item.kind);
    } catch {
      // applyStatus already told the user; the card goes back.
    } finally {
      setOverrides((prev) => { const next = { ...prev }; delete next[item.key]; return next; });
      setBusy((prev) => { const next = new Set(prev); next.delete(item.key); return next; });
    }
  }, [data, t]);

  // The support role changes a request's status; deleting stays with admins
  // (as the REST routes do), for every kind, feedback and escalations included.
  const canDelete = (_item: RequestItem) => isAdmin;

  const askDelete = (item: RequestItem) => {
    // Anonymous feedback is named by its comment (already in quotes), not "Anonimo".
    const name = item.kind === "lead"
      ? item.email || item.name
      : item.kind === "feedback" && !item.person && item.detail
        ? item.detail
        : item.name;
    const body = t("conversions.board.deleteBody").replace("{name}", name);
    setConfirm({
      title: t("conversions.board.deleteTitle"),
      description: item.kind === "escalation" ? `${body} ${t("conversions.board.deleteEscalationNote")}` : body,
      confirmLabel: t("conversions.delete"),
      run: async () => {
        if (item.kind === "lead") await data.deleteLead(item.id);
        else if (item.kind === "appointment") await data.deleteAppointment(item.id);
        else if (item.kind === "feedback") await data.deleteFeedback(item.id);
        // Escalations are listed under their negated id (escalationToSubmission).
        else if (item.kind === "escalation") await data.deleteEscalation(-item.id);
        else await data.deleteSubmission(item.id);
        if (openKey === item.key) setOpenKey(null);
      },
    });
  };

  const askDeleteAll = (collection: DeleteAllTarget, count: number) => {
    const body = t(count === 1 ? "conversions.board.deleteAllBodyOne" : "conversions.board.deleteAllBody").replace("{count}", String(count));
    const run = {
      leads: data.deleteAllLeads,
      appointments: data.deleteAllAppointments,
      submissions: data.deleteAllSubmissions,
      feedback: data.deleteAllFeedback,
      escalations: data.deleteAllEscalations,
    }[collection];
    setConfirm({
      title: t(`conversions.board.deleteAll.${collection}`),
      description: collection === "escalations" ? `${body} ${t("conversions.board.deleteAllEscalationsNote")}` : body,
      confirmLabel: t("conversions.deleteAll"),
      run: () => run(),
    });
  };

  /* ----- No tools: nothing can ever arrive here ----- */
  if (visible.length === 0) {
    return (
      <div className="a3-req">
        <PageHead title={t("conversions.board.title")} />
        <ResultsState icon={Building} title={named(t, "conversions.empty.disabledTitle", configuredName)} description={t("conversions.noToolsEnabled")} action={<ConfigureResultsTools />} />
      </div>
    );
  }

  /* ----- Filter chips: every enabled type that has something, plus the chosen one ----- */
  const chipKinds = KIND_ORDER.filter((k) => visible.includes(kindCollection(k)) && (kindCounts[k] > 0 || k === filter));
  const kindTotal = (k: RequestKind) => {
    const c = kindCollection(k);
    return c === "submissions" ? kindCounts[k] : totals[c];
  };
  const scopeKinds = filter === "all" ? visibleKinds : [filter];
  // A search the server has not answered yet: its rows and numbers are the previous search's.
  const pending = !answered;
  const chipOptions: Option<Filter>[] = [
    { value: "all", label: t("conversions.board.all"), count: loading ? undefined : visible.reduce((n, c) => n + totals[c], 0) },
    ...chipKinds.map((k) => ({ value: k as Filter, label: kindInfo(k, t).plural, count: kindTotal(k) })),
  ];

  const scope: ConversionCollection[] = filter === "all" ? visible : [kindCollection(filter)];
  const failed = scope.filter((c) => errors[c]);
  const resetFilters = () => {
    setFilter("all");
    setQuery("");
    allChipRef.current?.querySelector<HTMLButtonElement>('[role="radio"]')?.focus();
  };

  const content = (() => {
    if (shown.length > 0) {
      return board
        ? <RequestBoard
            items={shown}
            t={t}
            busy={busy}
            totals={pending ? null : columnSizes(scopeKinds)}
            leadsTotal={pending ? undefined : leadsTotal}
            leadsOnly={filter === "lead"}
            onOpen={(i) => setOpenKey(i.key)}
            onSetStatus={setStatus}
            onShowLeads={() => setFilter("lead")}
          />
        : <RequestList items={shown} t={t} busy={busy} onOpen={(i) => setOpenKey(i.key)} onSetStatus={setStatus} onDelete={askDelete} canDelete={canDelete} />;
    }
    // A failed collection is not an empty one: its error says so above.
    if (failed.length === scope.length) return null;
    if (q && pending) {
      return <ResultsState icon={Search} title={t("conversions.board.searching").replace("{query}", typed)} description="" />;
    }
    if (q) {
      return <ResultsState icon={Search} title={t("conversions.board.noMatchTitle")} description={t("conversions.board.noMatchBody").replace("{query}", query.trim())}
        action={<Button variant="secondary" onClick={resetFilters}>{t("conversions.empty.resetFilters")}</Button>} />;
    }
    const healthy = scope.filter((c) => !errors[c]);
    if (healthy.every((c) => totals[c] === 0)) {
      // With one collection unreachable, "nothing yet" would be a claim we cannot make.
      if (failed.length > 0) return null;
      const collection = filter === "all" ? null : kindCollection(filter);
      if (!collection) return <ResultsState icon={MessageSquare} title={t("conversions.empty.all.title")} description={named(t, "conversions.empty.all.description", configuredName)} action={<ConfigureResultsTools />} />;
      return <ResultsState icon={COLLECTION_ICON[collection]} title={t(`conversions.empty.${collection}.title`)} description={t(`conversions.empty.${collection}.description`)} action={<ConfigureResultsTools />} />;
    }
    if (healthy.every((c) => loaded[c] === 0)) {
      // Deleting the last loaded rows can leave more on the server.
      return <ResultsState icon={RefreshCw} title={t("conversions.empty.unloadedTitle")} description={t("conversions.empty.unloadedDescription")}
        action={<Button variant="secondary" disabled={!!loadingMore} onClick={() => healthy.forEach((c) => totals[c] > loaded[c] && void loadMore(c))}>{t("conversions.loadMore")}</Button>} />;
    }
    // A submission type with no match among the loaded requests.
    return <ResultsState icon={Search} title={t("conversions.empty.filteredSubmissionsTitle")}
      description={t(loaded.submissions < totals.submissions ? "conversions.empty.filteredSubmissionsMoreDescription" : "conversions.empty.filteredSubmissionsDescription")}
      action={<Button variant="secondary" onClick={resetFilters}>{t("conversions.empty.resetFilters")}</Button>} />;
  })();

  // Escalations sit among the requests: they show (and go) with that collection.
  const deletable: { collection: DeleteAllTarget; count: number }[] = DELETE_ALL_TARGETS
    .map((collection) => ({ collection, count: whole.current[collection] }))
    .filter((d) => visible.includes(d.collection === "escalations" ? "submissions" : d.collection) && d.count > 0);

  // Tutte, the badge and Nuove are three different numbers: say how they add
  // up ("410 in tutto: 403 nuove, 0 in corso e 0 fatte, più 7 contatti
  // raccolti"). Only with every collection counted, or the parts would not sum.
  let summary = "";
  if (!loading && !pending && searched === "" && filter === "all" && visible.every((c) => counts[c])) {
    const sizes = columnSizes(visibleKinds);
    const vars = {
      total: visible.reduce((n, c) => n + totals[c], 0),
      new: sizes.new,
      doing: sizes.doing,
      done: sizes.done,
      leads: visible.includes("leads") ? leadsTotal : 0,
    };
    const shown = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, formatNumber(v)]));
    summary = interpolate(t(vars.leads > 0 ? "conversions.board.summary" : "conversions.board.summaryNoLeads"), shown);
  }

  const exports: { label: string; run: () => void }[] = [];
  const L = (c: ConversionCollection) => t(`conversions.${c}`);
  // Every collection in both formats, the same columns in each (exports.ts).
  for (const c of ALL_COLLECTIONS) {
    if (!visible.includes(c) || whole.current[c] <= 0) continue;
    for (const format of ["csv", "json"] as const) {
      exports.push({ label: `${L(c)} · ${format.toUpperCase()}`, run: () => void exportAll(EXPORT_PATHS[c], t, exportWriter(c, format, t)) });
    }
  }
  // Escalations are listed with the requests but are their own records (and file).
  if (visible.includes("submissions") && whole.current.escalations > 0) {
    for (const format of ["csv", "json"] as const) {
      exports.push({
        label: `${t("conversions.escalations")} · ${format.toUpperCase()}`,
        run: () => void exportAll(EXPORT_PATHS.escalations, t, exportWriter("escalations", format, t)),
      });
    }
  }

  return (
    <div className="a3-req" data-mode={board ? "board" : "list"}>
      <PageHead
        title={t("conversions.board.title")}
        subtitle={[summary, !board ? t("conversions.board.listHint") : filter === "lead" ? t("conversions.board.leadsHint") : t("conversions.board.dragHint")].filter(Boolean).join(" ")}
        actions={
          <>
            <IconButton icon={RefreshCw} label={t("common.refresh")} onClick={() => void reload()} disabled={loading} className={loading ? "a3-spin" : undefined} />
            {/* Exports are an admin tool: the support role works the requests, it does not take them away. */}
            {isAdmin && exports.length > 0 && !loading && (
              <DropdownMenu open={exportOpen} onOpenChange={setExportOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" data-tour="conversions-export">
                    <Download aria-hidden="true" />
                    {t("conversions.export")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="a3-menu">
                  {exports.map((e) => <DropdownMenuItem key={e.label} onSelect={e.run}>{e.label}</DropdownMenuItem>)}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Not during a search: the matches on screen are not what it deletes. Admins only, like the proxy routes. */}
            {isAdmin && deletable.length > 0 && !loading && !typed && !searched && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton icon={MoreHorizontal} label={t("conversions.board.moreActions")} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="a3-menu">
                  <DropdownMenuLabel className="a3-menu-label">{t("conversions.deleteAll")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {deletable.map((d) => (
                    <DropdownMenuItem key={d.collection} className="a3-danger" onSelect={() => askDeleteAll(d.collection, d.count)}>
                      <Trash2 aria-hidden="true" />
                      {t(`conversions.board.deleteAll.${d.collection}`)}
                      <span className="a3-menu-count">{d.count}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Segmented<Mode>
              size="sm"
              className="a3-mode"
              aria-label={t("conversions.board.viewLabel")}
              value={mode}
              onValueChange={setMode}
              options={[
                { value: "list", icon: List, label: <span className="sr-only">{t("conversions.board.listView")}</span> },
                { value: "board", icon: SquareKanban, label: <span className="sr-only">{t("conversions.board.boardView")}</span> },
              ]}
            />
          </>
        }
      />

      <div className="a3-toolbar">
        <ScrollRow ref={allChipRef} className="a3-chips-wrap" data-tour="conversions-tabs">
          <Chips<Filter> aria-label={t("conversions.filterByType")} value={filter} onValueChange={setFilter} options={chipOptions} size="sm" />
        </ScrollRow>
        <SearchField className="a3-search" value={query} onChange={setQuery} placeholder={t("conversions.board.searchPlaceholder")} />
      </div>

      {failed.map((c) => (
        <ResultsError key={c} title={t(`conversions.errors.${c}`)} description={t("conversions.errors.description")} retryLabel={t("conversions.errors.retry")} onRetry={() => void reload()} />
      ))}

      <div className="a3-content" aria-busy={loading || pending}>
        {loading && <span role="status" className="sr-only">{t("conversions.loading")}</span>}
        <Bones name="conversions-list" loading={loading} className="a3-bones">
          <>{content}</>
        </Bones>
      </div>

      {/* Hidden while a search is on its way: "Mostrati 100 di 290" would be the previous answer. */}
      {!loading && !pending && (
        <div className="a3-footer">
          {scope.filter((c) => !errors[c]).map((c) => (
            loadMoreErrors[c] ? (
              <ResultsError key={c} title={t("conversions.errors.moreTitle")} description={t("conversions.errors.moreDescription")} retryLabel={t("conversions.errors.retry")} onRetry={() => void loadMore(c)} loading={loadingMore === c} />
            ) : loaded[c] > 0 ? (
              <LoadMoreBar key={c} label={scope.length > 1 ? L(c) : undefined} shown={loaded[c]} total={totals[c]} loading={loadingMore === c} onLoadMore={() => void loadMore(c)} t={t} />
            ) : null
          ))}
        </div>
      )}

      <RequestSheet
        item={openItem}
        t={t}
        botName={botName}
        onClose={() => setOpenKey(null)}
        onSetStatus={setStatus}
        onDelete={openItem && canDelete(openItem) ? askDelete : undefined}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} t={t} />
    </div>
  );
}
