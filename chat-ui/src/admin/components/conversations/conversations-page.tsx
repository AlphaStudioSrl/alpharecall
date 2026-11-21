import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useLiveParams } from "@/admin/lib/nav-context";
import { useFrameLayout } from "@/admin/components/layout/frame-context";
import { Panel } from "@/admin/components/shared/kit";
import { useConversations } from "@/admin/hooks/use-conversations";
import { useBlacklist } from "@/admin/hooks/use-blacklist";
import { useSupportProfiles } from "@/admin/hooks/use-support-profiles";
import { fetchVisitor, type Visitor } from "@/admin/hooks/use-visitors";
import { cn } from "@/admin/lib/utils";
import { ConversationList } from "./conversation-list";
import { ConversationDetail } from "./conversation-detail";
import { VisitorContext } from "./visitor-context";
import { VisitorList } from "./visitor-list";
import { anonymousVisitorLabel, syncParam, visitorName } from "./inbox-format";
import "./inbox.css";

/**
 * Inbox > Conversazioni (three panes) and Inbox > Contatti (table).
 * @param view set by the router; defaults to the conversations.
 */
export function ConversationsPage({ view }: { view?: "conversations" | "visitors" } = {}) {
  return view === "visitors" ? <VisitorList /> : <InboxPanes />;
}

/**
 * List, conversation and visitor details as three panels on the canvas.
 * Below 1100px the details pane replaces the list on demand; on phones one
 * pane shows at a time (list, then thread, then details).
 */
function InboxPanes() {
  const { t } = useApp();
  // A notification or a link clicked while the inbox is open selects the
  // thread in place: remounting would refetch the list and everything around it.
  const { params, visit } = useLiveParams();
  useFrameLayout({ panels: true });
  const deepThread = Number(params.thread) || null;
  const [visitorFilter, setVisitorFilter] = useState<number | null>(Number(params.visitor) || null);
  // "Altri filtri" > Operatore (card gbztrbczsxzr): a support profile id, kept in the URL as `operator`.
  const [operatorFilter, setOperatorFilterState] = useState<number | null>(positiveId(params.operator));
  const setOperatorFilter = useCallback((id: number | null) => {
    setOperatorFilterState(id);
    syncParam("operator", id);
  }, []);
  const { profiles: operators } = useSupportProfiles();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const {
    threads,
    allThreads,
    messages,
    selectedThreadId,
    selectedThread,
    filter,
    setFilter,
    search,
    setSearch,
    loading,
    loadingMessages,
    sending,
    error,
    listError,
    refresh,
    counts,
    hasMore,
    loadMore,
    listHasMore,
    loadMoreList,
    loadingMore,
    searchStatus,
    searchTotal,
    searchError,
    selectThread,
    sendReply,
    updateThread,
    deleteThread,
    generateTitle,
    toggleFavorite,
    updating,
  } = useConversations(true, {
    // A deep link or a visitor filter must show its thread whatever its status.
    initialFilter: deepThread || visitorFilter || operatorFilter ? "all" : "attention",
    visitorId: visitorFilter,
    operatorId: operatorFilter,
  });

  const { blacklist } = useBlacklist();

  // "Aperte" is the landing tab only while something is waiting: an empty
  // tab on arrival reads as an empty inbox. Applied before paint.
  const landed = useRef(false);
  useLayoutEffect(() => {
    if (landed.current || loading || !counts) return;
    if (allThreads.length === 0 && !counts.all) return;
    landed.current = true;
    if (filter === "attention" && counts.attention === 0) setFilter("all");
  }, [loading, counts, allThreads.length, filter, setFilter]);

  // "Vedi le conversazioni": the API has no visitor filter, so page through
  // the inbox until this person's chats are all loaded. How many there are
  // comes from the contact: nothing pages before it is known, or without it.
  const [filterContact, setFilterContact] = useState<Visitor | null>(null);
  const [contactPending, setContactPending] = useState(false);
  useEffect(() => {
    setFilterContact(null);
    setContactPending(visitorFilter !== null);
    if (visitorFilter === null) return;
    let alive = true;
    fetchVisitor(visitorFilter)
      .then((v) => { if (alive) setFilterContact(v); })
      .catch(() => {})
      .finally(() => { if (alive) setContactPending(false); });
    return () => { alive = false; };
  }, [visitorFilter]);
  const visitorLoaded = visitorFilter === null ? 0 : allThreads.filter((th) => th.visitor?.id === visitorFilter).length;
  const wanted = filterContact?.thread_count ?? null;
  const visitorComplete = visitorFilter !== null && wanted !== null && visitorLoaded >= wanted;
  // The inbox's own pages: a search in the box does not stop this person's chats loading.
  const { autoPaging } = useVisitorAutoPaging({
    active: visitorFilter !== null && wanted !== null && !visitorComplete && listHasMore && !loading && !listError,
    resetKey: visitorFilter,
    loadMore: loadMoreList,
  });
  const searching = searchStatus !== "idle";

  const hadSelection = useRef(false);
  useEffect(() => {
    if (selectedThreadId === null && !hadSelection.current) return;
    hadSelection.current = true;
    syncParam("thread", selectedThreadId);
  }, [selectedThreadId]);

  const open = useCallback((id: number | null) => {
    setDetailsOpen(false);
    selectThread(id);
  }, [selectThread]);

  // Deep link from notifications, the dashboard and Ctrl K (`thread=`), on
  // arrival and on every later visit to the open inbox (the same link twice
  // included). A visit carries the person filter it asks for, or none.
  const handledVisit = useRef<number | null>(null);
  useEffect(() => {
    if (handledVisit.current === visit) return;
    const first = handledVisit.current === null;
    handledVisit.current = visit;
    if (!first) {
      const visitor = Number(params.visitor) || null;
      setVisitorFilter(visitor);
      const operator = positiveId(params.operator);
      setOperatorFilterState(operator);
      // The tab the inbox opens on for a deep link (see initialFilter).
      if ((deepThread || visitor || operator) && filter !== "all") setFilter("all");
    }
    // selectThread loads messages by ID even if not in the current filter.
    if (deepThread && (first || deepThread !== selectedThreadId)) open(deepThread);
    // Only a new visit is handled here; the selection then belongs to the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit]);

  const handleBlacklistVisitor = useCallback(
    (threadId: number, visitorId: string) => {
      if (confirm(t("conversations.confirmBlacklist"))) {
        void blacklist({ visitor_id: visitorId, thread_id: threadId, reason: t("common.blockedFromAdmin") }).then(() => {
          toast.warning(t("toast.visitorBlocked"));
        }).catch(() => {
          // error handled by hook
        });
      }
    },
    [blacklist, t]
  );

  const filterVisitor = visitorFilter !== null
    ? allThreads.find((th) => th.visitor?.id === visitorFilter)
    : undefined;
  const pane = selectedThread ? (detailsOpen ? "details" : "thread") : "list";

  return (
    <div className="ar-inbox" data-pane={pane} data-details={detailsOpen ? "open" : undefined}>
      <Panel
        as="section"
        width={310}
        className="ar-inbox-list"
        aria-label={t("inboxPage.list.title")}
        // Anchors appear once the list is loaded: the tour manager waits
        // for them, so the highlight is measured on the final layout.
        data-tour={loading ? undefined : "conversations-list"}
      >
        <ConversationList
          threads={threads}
          selectedThreadId={selectedThreadId}
          filter={filter}
          search={search}
          // While the visitor's chats are being paged in, "nothing here" would be premature.
          loading={searching ? false : loading || ((contactPending || autoPaging) && threads.length === 0)}
          searchState={{ status: searchStatus, total: searchTotal, error: searchError }}
          onSelectThread={open}
          onFilterChange={setFilter}
          onSearchChange={setSearch}
          counts={counts}
          // Once all of this person's chats are here, older pages hold none of theirs
          // (a search pages its own results, already narrowed to the person).
          hasMore={hasMore && (searching || !visitorComplete)}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          error={listError}
          onRetry={() => void refresh()}
          visitorFilter={visitorFilter !== null ? {
            name: filterVisitor ? visitorName(filterVisitor, t)
              : filterContact?.display_name || filterContact?.email || anonymousVisitorLabel(visitorFilter, t),
            onClear: () => { setVisitorFilter(null); syncParam("visitor", null); },
          } : null}
          operators={operators}
          operatorId={operatorFilter}
          onOperatorChange={setOperatorFilter}
        />
      </Panel>
      <Panel
        as="section"
        grow
        className={cn("ar-inbox-thread", !selectedThread && "ar-inbox-thread-idle")}
        aria-label={selectedThread ? visitorName(selectedThread, t) : t("inboxPage.thread.selectTitle")}
        data-tour={loading ? undefined : "conversations-detail"}
      >
        <ConversationDetail
          key={selectedThreadId}
          thread={selectedThread}
          messages={messages}
          loading={loadingMessages}
          sending={sending}
          error={error}
          onSendReply={sendReply}
          onUpdateThread={updateThread}
          updating={selectedThreadId === null ? null : updating[selectedThreadId] ?? null}
          onDeleteThread={deleteThread}
          onGenerateTitle={generateTitle}
          onToggleFavorite={toggleFavorite}
          onBlacklistVisitor={handleBlacklistVisitor}
          onBack={() => open(null)}
          onShowDetails={() => setDetailsOpen((v) => !v)}
        />
      </Panel>
      {selectedThread && (
        <Panel as="aside" width={262} className="ar-inbox-context" aria-label={t("inboxPage.context.label")}>
          <VisitorContext
            thread={selectedThread}
            messages={loadingMessages ? [] : messages}
            onBlacklistVisitor={handleBlacklistVisitor}
            onClose={() => setDetailsOpen(false)}
          />
        </Panel>
      )}
    </div>
  );
}

/** A positive integer id from a URL parameter, else null. */
export function positiveId(value: string | null | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

/** Pages fetched on their own for one person's chats; past this the list offers "Carica altre". */
export const AUTO_PAGE_LIMIT = 10;
/** A breath between those pages, so a person with many chats is not a burst against the rate limit. */
const AUTO_PAGE_PAUSE_MS = 150;

/**
 * Load one more page while `active`, one at a time, up to AUTO_PAGE_LIMIT
 * pages per `resetKey`. A page that fails (or comes back empty) ends it: the
 * request layer has already retried what it could, and the list keeps its
 * "Carica altre" button. Each finished page schedules the next check itself,
 * so a page that lands without changing the counts cannot stall the loop.
 */
export function useVisitorAutoPaging({ active, resetKey, loadMore }: {
  active: boolean;
  resetKey: unknown;
  loadMore: () => Promise<boolean>;
}): { autoPaging: boolean; pages: number } {
  const run = useRef({ key: resetKey, pages: 0, busy: false, stopped: false });
  if (run.current.key !== resetKey) run.current = { key: resetKey, pages: 0, busy: false, stopped: false };
  const [tick, setTick] = useState(0);
  const state = run.current;
  const going = active && !state.stopped && state.pages < AUTO_PAGE_LIMIT;

  useEffect(() => {
    if (!going || state.busy) return;
    state.busy = true;
    state.pages += 1;
    let timer = 0;
    void loadMore()
      .catch(() => false)
      .then((ok) => {
        state.busy = false;
        if (!ok) state.stopped = true;
        timer = window.setTimeout(() => setTick((n) => n + 1), ok ? AUTO_PAGE_PAUSE_MS : 0);
      });
    return () => window.clearTimeout(timer);
    // `tick` re-checks after every page; `state` is the run for this key.
  }, [going, tick, state, loadMore]);

  return { autoPaging: going || state.busy, pages: state.pages };
}
