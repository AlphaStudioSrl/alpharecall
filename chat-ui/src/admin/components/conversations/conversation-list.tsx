import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/admin/app-context";
import { NavLink } from "@/admin/lib/nav-context";
import { cn } from "@/admin/lib/utils";
import { Avatar, Empty, IconButton, ListItem, SearchField, Segmented, Status, Tag } from "@/admin/components/shared/kit";
import { needsPerson, searchTerm, type ChatThread, type ConversationFilter, type SearchStatus } from "@/admin/hooks/use-conversations";
import { MessageSquare, Search, Star, Users, X, Loader2 } from "@/components/icons";
import { previewText, previewTitle, smartTime, tf, threadStatus, useBotName, visitorEmail, visitorName } from "./inbox-format";
import { personName } from "@/admin/lib/record-fields";

interface ConversationListProps {
  threads: ChatThread[];
  selectedThreadId: number | null;
  filter: ConversationFilter;
  search: string;
  loading: boolean;
  onSelectThread: (id: number) => void;
  onFilterChange: (f: ConversationFilter) => void;
  onSearchChange: (q: string) => void;
  /** Tab counts; null while the API filters the list (favorites, unread). */
  counts?: { attention: number; ai: number; all: number } | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** "Solo Giulia": the list is narrowed to one visitor (from Contatti). */
  visitorFilter?: { name: string; onClear: () => void } | null;
  /** The list could not be loaded: shown here, since phones hide the thread pane. */
  error?: string | null;
  onRetry?: () => void;
  /** The server search behind the box (useConversations searchStatus / searchTotal / searchError). */
  searchState?: { status: SearchStatus; total: number | null; error: string | null };
  /** The team members to filter by ("Altri filtri" > Operatore): the support profiles. */
  operators?: { id: number; name: string }[];
  /** The chosen team member, or null for every chat. */
  operatorId?: number | null;
  onOperatorChange?: (id: number | null) => void;
}

const TABS: ConversationFilter[] = ["attention", "ai", "all"];
const MORE: ConversationFilter[] = ["unread", "favorites", "resolved"];

/** The left pane of the inbox (x-p, 310px): title, tabs, search and the threads. */
export function ConversationList({
  threads,
  selectedThreadId,
  filter,
  search,
  loading,
  onSelectThread,
  onFilterChange,
  onSearchChange,
  counts,
  hasMore,
  loadingMore,
  onLoadMore,
  visitorFilter,
  error,
  onRetry,
  searchState,
  operators = [],
  operatorId = null,
  onOperatorChange,
}: ConversationListProps) {
  const { t } = useApp();
  const bot = useBotName();
  const label = (f: ConversationFilter) => tf(t, `inboxPage.filters.${f}`, { bot });
  const tabValue = TABS.includes(filter) ? filter : ("" as ConversationFilter);
  const extra = MORE.includes(filter) ? filter : null;
  const term = searchTerm(search);
  const operatorName = operatorId !== null
    ? operators.find((o) => o.id === operatorId)?.name || `#${operatorId}`
    : null;
  // The operator filter is answered by the API, like the search box.
  const searchStatus = term || operatorName ? searchState?.status ?? "idle" : "idle";
  // Nothing to show yet but the search is on its way: the skeleton, not "no results".
  const waitingForSearch = searchStatus === "pending" && threads.length === 0;
  // Matches in the other tabs, when this one has none (counts are the search's).
  const elsewhere = searchStatus === "done" && threads.length === 0 && filter !== "all" && counts ? counts.all : 0;

  return (
    <div className="ar-inbox-list-body">
      {/* The sub nav is hidden in the three-pane layout: the switch to Contatti lives here. */}
      <div className="ar-inbox-list-head" data-tour={loading ? undefined : "conversations-tabs"}>
        {/* The page title: the three panes have no frame head (lib/nav.ts `panels`). */}
        <h1>{t("inboxPage.list.title")}</h1>
        <NavLink to="inbox/contatti" className="ar-inbox-head-link ark-focus" title={t("inboxPage.list.contacts")}>
          <Users aria-hidden="true" />
          <span>{t("inboxPage.list.contacts")}</span>
        </NavLink>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={ListFilter}
              label={t("inboxPage.list.moreFilters")}
              className={cn((extra || operatorName) && "ar-inbox-filter-on")}
              aria-pressed={extra || operatorName ? true : undefined}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{t("inboxPage.filters.label")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filter} onValueChange={(v) => onFilterChange(v as ConversationFilter)}>
              {[...TABS, ...MORE].map((f) => (
                <DropdownMenuRadioItem key={f} value={f}>
                  {label(f)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {onOperatorChange && (operators.length > 0 || operatorId !== null) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>{t("inboxPage.filters.operator")}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={operatorId === null ? "" : String(operatorId)}
                  onValueChange={(v) => onOperatorChange(v ? Number(v) : null)}
                >
                  <DropdownMenuRadioItem value="">{t("inboxPage.filters.operatorAll")}</DropdownMenuRadioItem>
                  {operators.map((o) => (
                    <DropdownMenuRadioItem key={o.id} value={String(o.id)}>
                      {o.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="ar-inbox-list-tools">
        <Segmented
          size="sm"
          className="ar-inbox-tabs"
          aria-label={t("inboxPage.filters.label")}
          value={tabValue}
          onValueChange={onFilterChange}
          options={TABS.map((f) => ({
            value: f,
            label: label(f),
            count: counts && f !== "all" ? counts[f] : undefined,
          }))}
        />
        <SearchField
          value={search}
          onChange={onSearchChange}
          placeholder={t("inboxPage.list.search")}
          className="ar-inbox-search"
        />
        {(term || operatorName) && searchStatus !== "idle" && (searchStatus !== "done" || term) && (
          <p className={cn("ar-inbox-search-status", searchStatus === "error" && "ark-c-warn")} role="status" aria-live="polite">
            {searchStatus === "pending" && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {searchStatus === "pending"
              ? t("inboxPage.list.searching")
              : searchStatus === "error"
                ? searchState?.error || t("inboxPage.errors.search")
                : tf(t, searchState?.total === 1 ? "inboxPage.list.searchFoundOne" : "inboxPage.list.searchFound", { n: searchState?.total ?? threads.length })}
          </p>
        )}
        {(extra || visitorFilter || operatorName) && (
          <div className="ar-inbox-active-filters">
            {extra && (
              <button type="button" className="ar-inbox-chip ark-focus" onClick={() => onFilterChange("all")} aria-label={`${label(extra)}: ${t("inboxPage.filters.clear")}`}>
                {label(extra)}
                <X aria-hidden="true" />
              </button>
            )}
            {visitorFilter && (
              <button type="button" className="ar-inbox-chip ark-focus" onClick={visitorFilter.onClear} aria-label={`${tf(t, "inboxPage.filters.visitor", { name: visitorFilter.name })}: ${t("inboxPage.filters.clear")}`}>
                {tf(t, "inboxPage.filters.visitor", { name: visitorFilter.name })}
                <X aria-hidden="true" />
              </button>
            )}
            {operatorName && onOperatorChange && (
              <button type="button" className="ar-inbox-chip ark-focus" onClick={() => onOperatorChange(null)} aria-label={`${tf(t, "inboxPage.filters.operatorChip", { name: operatorName })}: ${t("inboxPage.filters.clear")}`}>
                {tf(t, "inboxPage.filters.operatorChip", { name: operatorName })}
                <X aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="ar-inbox-scroll" aria-busy={loading || undefined}>
        {error && (
          <div role="alert" className="ar-inbox-alert ar-inbox-list-alert">
            <span>{error}</span>
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry} disabled={loading}>
                {t("inboxPage.list.retry")}
              </Button>
            )}
          </div>
        )}
        {(loading || waitingForSearch) && threads.length === 0 ? (
          <div className="ar-inbox-skeleton" role="status" aria-label={t("inboxPage.list.loading")}>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="ar-inbox-skel-row">
                <span className="ar-skel ar-skel-av" />
                <span className="ar-skel-lines">
                  <span className="ar-skel" style={{ width: `${55 + ((i * 13) % 30)}%` }} />
                  <span className="ar-skel" style={{ width: `${70 + ((i * 7) % 25)}%` }} />
                  <span className="ar-skel" style={{ width: "40%" }} />
                </span>
              </div>
            ))}
          </div>
        ) : threads.length === 0 ? (
          error ? null : <EmptyList filter={filter} search={term} operator={operatorName} bot={bot} elsewhere={elsewhere} onShowAll={() => onFilterChange("all")} />
        ) : (
          <ul className="ar-inbox-items">
            {threads.map((thread) => {
              const name = visitorName(thread, t);
              const status = threadStatus(thread, t, bot);
              const unread = thread.unread_count ?? 0;
              const preview = previewText(thread);
              const left = needsPerson(thread) ? thread.visitor_left : null;
              return (
                <li key={thread.id}>
                  <ListItem
                    active={selectedThreadId === thread.id}
                    onClick={() => onSelectThread(thread.id)}
                    className={cn("ar-inbox-item", unread > 0 && "ar-inbox-item-unread")}
                    leading={<Avatar name={avatarName(thread, t("common.visitor"))} src={thread.visitor?.avatar_url} />}
                    title={
                      <>
                        {name}
                        {thread.is_favorite && <Star className="ar-inbox-star" aria-label={t("filters.favorites")} />}
                      </>
                    }
                    meta={smartTime(thread.last_message_at || thread.created_at, t)}
                    preview={
                      <>
                        {previewTitle(thread.title, name, preview) && <span className="ar-inbox-item-title">{thread.title}: </span>}
                        {preview || t("conversations.noMessagesYet")}
                      </>
                    }
                    status={
                      <span className="ar-inbox-item-foot">
                        {left
                          ? <Tag tone="mute" className="ar-inbox-left">{t(`inboxPage.visitorLeft.${left.reason}`)}</Tag>
                          : <Status tone={status.tone}>{status.label}</Status>}
                        {unread > 0 && (
                          <span className="ar-inbox-unread" aria-label={`${t("conversations.unreadMessages")}: ${unread}`}>
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
        {/* Also under an empty list: tabs, search and the visitor filter only
            see the loaded pages, so older matches may be one click away. */}
        {hasMore && onLoadMore && !((loading || waitingForSearch) && threads.length === 0) && (
          <div className="ar-inbox-more">
            <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("inboxPage.list.loadMore")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Initials from the name or the address; a lone "V" for anonymous visitors. */
export function avatarName(thread: ChatThread, visitorWord: string): string {
  return personName(thread.visitor?.display_name) || personName(thread.visitor_name) || visitorEmail(thread) || visitorWord.charAt(0);
}

function EmptyList({ filter, search, operator = null, bot, elsewhere = 0, onShowAll }: {
  filter: ConversationFilter;
  search: string;
  /** The team member the list is narrowed to. */
  operator?: string | null;
  bot: string;
  /** Search matches in the other tabs. */
  elsewhere?: number;
  onShowAll?: () => void;
}) {
  const { t } = useApp();
  const showAll = elsewhere > 0 && onShowAll ? (
    <Button variant="secondary" size="sm" onClick={onShowAll}>
      {tf(t, elsewhere === 1 ? "inboxPage.empty.searchElsewhereOne" : "inboxPage.empty.searchElsewhere", { n: elsewhere })}
    </Button>
  ) : undefined;
  if (operator && !search) {
    return (
      <Empty
        icon={MessageSquare}
        title={tf(t, "inboxPage.empty.operatorTitle", { name: operator })}
        description={tf(t, "inboxPage.empty.operatorBody", { name: operator })}
        action={showAll}
      />
    );
  }
  if (search) {
    return (
      <Empty
        icon={Search}
        title={tf(t, "inboxPage.empty.searchTitle", { q: search })}
        description={t("inboxPage.empty.searchBody")}
        action={showAll}
      />
    );
  }
  if (filter === "attention") {
    return <Empty icon={MessageSquare} title={t("inboxPage.empty.attentionTitle")} description={tf(t, "inboxPage.empty.attentionBody", { bot })} />;
  }
  if (filter === "ai") {
    return <Empty icon={MessageSquare} title={t("inboxPage.empty.handledTitle")} description={tf(t, "inboxPage.empty.handledBody", { bot })} />;
  }
  if (filter !== "all") {
    return <Empty icon={MessageSquare} title={t("inboxPage.empty.filteredTitle")} description={t("inboxPage.empty.filteredBody")} />;
  }
  return <Empty icon={MessageSquare} title={t("inboxPage.empty.noneTitle")} description={t("inboxPage.empty.noneBody")} />;
}
