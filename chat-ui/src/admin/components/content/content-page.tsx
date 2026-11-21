import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useDocuments, type IndexedDocument } from "@/admin/hooks/use-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  RefreshCw,
  Upload,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Loader2,
  Database,
  FileText,
  MoreHorizontal,
  Trash2,
  EyeOff,
  Eye,
  Plus,
  Globe,
  Pencil,
  ExternalLink,
  Building,
  Lock,
} from "@/components/icons";
import { toast } from "sonner";
import { cn } from "@/admin/lib/utils";
import { useApp } from "@/admin/app-context";
import { useIngestion, type IngestionRun } from "@/admin/hooks/use-ingestion";
import { useBackgroundJobs } from "@/admin/hooks/use-background-jobs";
import { apiFetch, invalidateApiCache, saveSettings } from "@/admin/lib/api";
import { getConfig } from "@/admin/lib/config";
import { formatNumber, formatRelativeTime } from "@/admin/lib/format";
import { interpolate, named, plural } from "@/admin/lib/i18n";
import { useNavIntent } from "@/admin/lib/nav-context";
import { Bones } from "@/admin/components/shared/bones";
import {
  PageHead,
  Group,
  Row,
  Toggle,
  Chips,
  SearchField,
  SoftTable,
  SoftRow,
  SoftCell,
  Status,
  Tag,
  Empty,
  IconButton,
  ProgressBar,
  Feed,
  type Tone,
} from "@/admin/components/shared/kit";
import { ScrollRow } from "@/admin/components/shared/scroll-row";
import { Ring, Tile, assistantName, hostOf, pathOf, sourceKind, wpPostId, type SourceKind } from "@/admin/components/assistant/shared";
import { UnansweredQuestions } from "@/admin/components/assistant/unanswered-questions";
import { BusinessInfoSection } from "./business-info-section";
import { SyncErrorNotice } from "./sync-error-details";

/* ─── Sync Progress ─── */

function SyncProgress({
  status,
  currentRun,
  error,
}: {
  status: string;
  currentRun: { stats?: Record<string, unknown>; error_msg?: string; finished_at?: string; started_at?: string } | null;
  error: string | null;
}) {
  const { t } = useApp();
  const stats = currentRun?.stats || {};
  const totalItems = Number(stats.total_items || stats.sources || 0);
  const processedItems = Number(stats.processed_items || 0);
  // The API sends current_stage as a machine key plus current_item as free
  // text. During discovery current_item is an untranslated English sentence,
  // so prefer the translated stage label; once indexing starts current_item is
  // a real page title and must be shown verbatim.
  const currentStage = String(stats.current_stage || "");
  const rawItem = String(stats.current_item || "");
  const currentItem =
    currentStage === "discovering" || /^Discovering content/i.test(rawItem)
      ? t("content.discoveringContent")
      : rawItem;

  let progress = 0;
  if (status === "completed") progress = 100;
  else if (status === "running" && totalItems > 0) progress = Math.min(95, Math.round((processedItems / totalItems) * 100));
  else if (status === "running") progress = 30;
  else if (status === "pending") progress = 5;

  let eta = "";
  if (status === "running" && processedItems > 0 && totalItems > processedItems) {
    const startedAt = stats.started_processing_at
      ? new Date(String(stats.started_processing_at)).getTime()
      : currentRun?.started_at ? new Date(currentRun.started_at).getTime() : 0;
    if (startedAt) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const rate = processedItems / elapsed;
      const remaining = (totalItems - processedItems) / rate;
      eta = remaining < 60 ? `~${Math.ceil(remaining)}${t("content.secondsRemaining")}` : `~${Math.ceil(remaining / 60)}${t("content.minutesRemaining")}`;
    }
  }

  if (status === "idle") return null;

  return (
    <div className="as-suggest animate-in fade-in-0 slide-in-from-top-2 duration-300" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {status === "pending" && <><Loader2 className="size-4 shrink-0 animate-spin text-tone-accent" /><span className="text-sm font-medium">{t("content.preparingSync")}</span></>}
          {status === "running" && <><Loader2 className="size-4 shrink-0 animate-spin text-tone-accent" /><span className="text-sm font-medium">{processedItems > 0 ? `${t("content.syncingContent").replace("...", "")} ${processedItems}/${totalItems}...` : t("content.syncingContent")}</span></>}
          {status === "completed" && <><CheckCircle2 className="size-4 shrink-0 text-tone-accent" /><span className="text-sm font-medium text-tone-accent">{t("content.syncComplete")}</span></>}
          {status === "failed" && <><XCircle className="size-4 shrink-0 text-tone-red" /><span className="text-sm font-medium text-tone-red">{t("content.syncFailed")}</span></>}
        </div>
        {eta && <span className="text-xs text-ink-3">{eta}</span>}
      </div>
      {/* A failed read has no progress to show: a full green bar said "done" (aria-valuenow 100) under "non riuscita". */}
      {status !== "failed" && <ProgressBar value={progress} tone="accent" label={t("content.syncingContent")} />}
      {status === "running" && currentItem && (
        <p className="truncate text-xs text-ink-2"><span className="text-ink-3">{t("content.indexing")}</span> {currentItem}</p>
      )}
      {status === "running" && processedItems > 0 && (
        <div className="flex gap-4 text-xs text-ink-3">
          {Number(stats.pages || 0) > 0 && <span>{Number(stats.pages)} {t("content.pages").toLowerCase()}</span>}
          {Number(stats.posts || 0) > 0 && <span>{Number(stats.posts)} {t("content.posts").toLowerCase()}</span>}
        </div>
      )}
      {status === "completed" && currentRun && (
        <div className="flex gap-4 text-xs text-ink-3 animate-in fade-in-0 duration-500">
          {totalItems > 0 && <span>{totalItems} {t("content.itemsIndexed")}</span>}
          {currentRun.finished_at && currentRun.started_at && (
            <span>{Math.round((new Date(currentRun.finished_at).getTime() - new Date(currentRun.started_at).getTime()) / 1000)}{t("content.secondsElapsed")}</span>
          )}
        </div>
      )}
      {status === "failed" && (error || currentRun?.error_msg) && (
        <SyncErrorNotice message={error || currentRun?.error_msg || ""} />
      )}
    </div>
  );
}

/* ─── Sources library ─── */

const ITEMS_PER_PAGE = 10;
type LibraryFilter = "all" | "page" | "post" | "file" | "text" | "excluded";

const KIND_ICON = { site: Globe, file: FileText, text: Pencil } as const;

function SourceLibrary({
  documents,
  loading,
  filter,
  onFilter,
  excludedIds,
  onDelete,
  onToggleExclude,
  onRefresh,
}: {
  documents: IndexedDocument[];
  loading: boolean;
  filter: LibraryFilter;
  onFilter: (f: LibraryFilter) => void;
  excludedIds: Set<number>;
  onDelete: (sourceId: string) => Promise<void> | void;
  onToggleExclude: (postId: number) => void;
  onRefresh?: () => void;
}) {
  const { t } = useApp();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const isExcluded = useCallback((doc: IndexedDocument) => {
    const id = wpPostId(doc);
    return id !== null && excludedIds.has(id);
  }, [excludedIds]);

  const counts = useMemo(() => {
    const c = { all: documents.length, page: 0, post: 0, file: 0, text: 0, excluded: 0 };
    for (const d of documents) {
      const kind = sourceKind(d);
      if (kind === "site") c[d.source_type === "post" ? "post" : "page"]++;
      else c[kind]++;
      if (isExcluded(d)) c.excluded++;
    }
    return c;
  }, [documents, isExcluded]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      const kind = sourceKind(d);
      if (filter === "page" && !(kind === "site" && d.source_type !== "post")) return false;
      if (filter === "post" && !(kind === "site" && d.source_type === "post")) return false;
      if (filter === "file" && kind !== "file") return false;
      if (filter === "text" && kind !== "text") return false;
      if (filter === "excluded" && !isExcluded(d)) return false;
      if (!q) return true;
      return `${d.title || ""} ${d.source_url || ""}`.toLowerCase().includes(q);
    });
  }, [documents, filter, query, isExcluded]);

  useEffect(() => setPage(1), [filter, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const typeLabel = (doc: IndexedDocument) => {
    const kind = sourceKind(doc);
    if (kind === "file") return t("assistant.contenuti.typeFile");
    if (kind === "text") return t("assistant.contenuti.typeText");
    return doc.source_type === "post" ? t("assistant.contenuti.typePost") : t("assistant.contenuti.typePage");
  };

  const options: { value: LibraryFilter; label: string; count: number }[] = [
    { value: "all", label: t("filters.all"), count: counts.all },
    { value: "page", label: t("content.pages"), count: counts.page },
    { value: "post", label: t("content.posts"), count: counts.post },
    { value: "file", label: t("assistant.contenuti.files"), count: counts.file },
    { value: "text", label: t("assistant.contenuti.texts"), count: counts.text },
    { value: "excluded", label: t("assistant.contenuti.excludedFilter"), count: counts.excluded },
  ];

  return (
    <section className="as-section as-lib" data-tour="content-indexed" aria-labelledby="as-lib-title">
      <div className="as-section-head">
        <h2 id="as-lib-title" className="as-section-title">{t("assistant.contenuti.libraryTitle")}</h2>
        <Tag tone="mute">{documents.length}</Tag>
        <span className="as-spacer" />
        {onRefresh && <IconButton icon={RefreshCw} label={t("common.refresh")} onClick={onRefresh} size="sm" />}
      </div>
      <div className="as-toolbar">
        <ScrollRow className="as-chip-scroll">
          <Chips
            value={filter}
            onValueChange={onFilter}
            aria-label={t("assistant.contenuti.libraryFilter")}
            options={options.filter((o) => o.value === "all" || o.value === filter || o.count > 0)}
          />
        </ScrollRow>
        <span className="as-spacer" />
        <SearchField value={query} onChange={setQuery} placeholder={t("assistant.contenuti.searchSources")} />
      </div>

      {loading ? (
        // Replays the bones captured from the populated list below.
        <Bones name="content-documents" loading>{null}</Bones>
      ) : documents.length === 0 ? (
        <div className="as-suggest">
          <Empty icon={Database} title={t("assistant.contenuti.emptyTitle")} description={t("content.noContentYet")} />
        </div>
      ) : filtered.length === 0 ? (
        <Empty title={t("assistant.contenuti.noMatch")} />
      ) : (
        // This is the tree `npm run bones` measures for "content-documents".
        <Bones name="content-documents" loading={false}>
          <SoftTable columns="minmax(0,2.4fr) minmax(0,.8fr) minmax(0,.9fr) minmax(0,.8fr) 32px" label={t("assistant.contenuti.libraryTitle")}>
            <SoftRow head>
              <SoftCell head>{t("assistant.contenuti.colSource")}</SoftCell>
              <SoftCell head className="as-col-hide">{t("assistant.contenuti.colType")}</SoftCell>
              <SoftCell head className="as-col-hide">{t("assistant.contenuti.colUpdated")}</SoftCell>
              <SoftCell head>{t("assistant.contenuti.colStatus")}</SoftCell>
              <SoftCell head><span className="sr-only">{t("content.tableActions")}</span></SoftCell>
            </SoftRow>
            {paginated.map((doc) => {
              const kind = sourceKind(doc);
              const Icon = KIND_ICON[kind];
              const excluded = isExcluded(doc);
              const postId = wpPostId(doc);
              const url = doc.source_url || "";
              const detail = kind === "site" ? pathOf(url) : kind === "file" ? t("assistant.contenuti.typeFile") : t("assistant.contenuti.writtenByYou");
              const updated = doc.last_uploaded_at || doc.updated_at || "";
              const title = doc.title || (kind === "site" ? pathOf(url) : doc.source_id);
              return (
                <SoftRow key={doc.source_id}>
                  <SoftCell className={cn(excluded && "as-excluded")}>
                    <span className="as-src-title">
                      <Icon className="as-src-icon" aria-hidden="true" />
                      <span>
                        <b>{title}</b>
                        <small>{detail}</small>
                      </span>
                    </span>
                  </SoftCell>
                  <SoftCell className="as-col-hide as-muted">{typeLabel(doc)}</SoftCell>
                  <SoftCell className="as-col-hide as-muted">{updated ? formatRelativeTime(updated) : ""}</SoftCell>
                  <SoftCell>
                    {confirmDeleteId === doc.source_id ? (
                      <span className="flex items-center gap-1">
                        <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => { void onDelete(doc.source_id); setConfirmDeleteId(null); }}>
                          {t("content.remove")}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setConfirmDeleteId(null)}>
                          {t("content.cancel")}
                        </Button>
                      </span>
                    ) : excluded ? (
                      <Status tone="mute">{t("content.excluded")}</Status>
                    ) : (
                      <Status tone="accent">{t("assistant.contenuti.active")}</Status>
                    )}
                  </SoftCell>
                  <SoftCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton icon={MoreHorizontal} size="sm" label={`${t("common.actions")}: ${title}`} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {kind === "site" && url && (
                          <DropdownMenuItem asChild>
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="size-3.5" />
                              {t("assistant.contenuti.openPage")}
                            </a>
                          </DropdownMenuItem>
                        )}
                        {postId !== null && (
                          <DropdownMenuItem onSelect={() => onToggleExclude(postId)}>
                            {excluded ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                            {excluded ? t("content.reincludeInSync") : t("content.excludeFromSync")}
                          </DropdownMenuItem>
                        )}
                        {(kind === "site" && url) || postId !== null ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem className="text-tone-red" onSelect={() => setConfirmDeleteId(doc.source_id)}>
                          <Trash2 className="size-3.5" />
                          {t("content.removeFromIndex")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </SoftCell>
                </SoftRow>
              );
            })}
          </SoftTable>
          {totalPages > 1 && (
            <div className="as-pager">
              <span className="as-num">
                {interpolate(t("assistant.contenuti.pageRange"), {
                  from: (page - 1) * ITEMS_PER_PAGE + 1,
                  to: Math.min(page * ITEMS_PER_PAGE, filtered.length),
                  total: filtered.length,
                })}
              </span>
              <span className="flex items-center gap-1">
                <IconButton icon={ChevronLeft} size="sm" label={t("common.previousPage")} disabled={page <= 1} onClick={() => setPage(page - 1)} />
                <span className="as-num px-1">{page}/{totalPages}</span>
                <IconButton icon={ChevronRight} size="sm" label={t("common.nextPage")} disabled={page >= totalPages} onClick={() => setPage(page + 1)} />
              </span>
            </div>
          )}
        </Bones>
      )}
    </section>
  );
}

/* ─── Plan usage ─── */

interface PdfStats {
  pdf_bytes_used: number;
  pdf_cap_bytes: number;
  pdf_bytes_used_mb: number;
  pdf_cap_mb: number;
  kb_pages_used: number;
  kb_pages_quota: number | null;
  tier: string;
}

function PlanUsage({ stats }: { stats: PdfStats | null }) {
  const { t } = useApp();
  if (!stats || stats.pdf_cap_bytes === undefined) return null;
  const isPdfEnabled = stats.pdf_cap_bytes > 0;
  const pct = isPdfEnabled ? Math.min(100, (stats.pdf_bytes_used / stats.pdf_cap_bytes) * 100) : 0;
  const quota = stats.kb_pages_quota;
  return (
    <div className="as-section">
      <span className="ark-lbl px-1">{t("assistant.contenuti.planTitle")}</span>
      <div className="as-suggest">
        {quota ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="font-medium">{t("assistant.contenuti.memoryUsed")}</span>
              <span className="as-num as-muted">{interpolate(t("assistant.contenuti.ofQuota"), { used: formatNumber(stats.kb_pages_used), total: formatNumber(quota) })}</span>
            </div>
            <ProgressBar value={Math.min(100, (stats.kb_pages_used / quota) * 100)} tone="accent" label={t("assistant.contenuti.memoryUsed")} />
          </div>
        ) : null}
        {isPdfEnabled ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="font-medium">{t("content.fileStorageUsed")}</span>
              <span className="as-num as-muted">{stats.pdf_bytes_used_mb} / {stats.pdf_cap_mb} MB</span>
            </div>
            <ProgressBar value={pct} tone="accent" label={t("content.fileStorageUsed")} />
          </div>
        ) : (
          // Every current tier ships PDF import; this only renders if a future
          // plan sets pdf_cap_mb to 0 again (that is the switch, not a flag).
          <p className="flex items-center gap-2 text-xs text-ink-2">
            <Lock className="size-3.5 text-tone-warn" />
            {t("assistant.contenuti.pdfLocked")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Content Page ─── */

/**
 * Assistente > Contenuti and Dati attività. Both stay mounted whichever is
 * shown, so drafts, pending saves and the sync state survive a switch.
 *
 * @param view set by the router. Without it (legacy callers) the two views
 *   are tabs of this page.
 */
export function ContentPage({ view }: { view?: "knowledge" | "business" } = {}) {
  const { t } = useApp();
  const [ownTab, setTab] = useState("knowledge");
  const tab = view ?? ownTab;

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-6">
      {!view && (
        <TabsList aria-label={t("nav.content")} className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:w-auto">
          <TabsTrigger value="knowledge" className="min-w-0 gap-2 whitespace-normal py-2">
            <Database aria-hidden="true" className="size-4 shrink-0" />
            {t("content.knowledgeTab")}
          </TabsTrigger>
          <TabsTrigger value="business" className="min-w-0 gap-2 whitespace-normal py-2">
            <Building aria-hidden="true" className="size-4 shrink-0" />
            {t("conversions.businessInfo")}
          </TabsTrigger>
        </TabsList>
      )}
      <TabsContent value="knowledge" forceMount hidden={tab !== "knowledge"} className="mt-0 data-[state=inactive]:hidden">
        <KnowledgeBaseContent routed={view === "knowledge"} />
      </TabsContent>
      <TabsContent value="business" forceMount hidden={tab !== "business"} className="mt-0 data-[state=inactive]:hidden">
        <BusinessInfoSection routed={view === "business"} />
      </TabsContent>
    </Tabs>
  );
}

/** Ctrl K actions aimed at Contenuti. Only mounted when routed (needs the nav context). */
function KnowledgeIntents({ onSync, onUpload, onWrite }: { onSync: () => void; onUpload: () => void; onWrite: () => void }) {
  useNavIntent("sync", onSync);
  useNavIntent("upload", onUpload);
  useNavIntent("add-text", onWrite);
  return null;
}

interface ContentCounts { pages?: number; posts?: number }

function lastFinishedRun(runs: IngestionRun[]): IngestionRun | undefined {
  return runs.find((r) => {
    const s = String(r.status || "").toLowerCase();
    return s === "completed" || s === "failed";
  });
}

/** A failed run read nothing, so "last read" is the last run that completed. */
function lastSuccessfulRun(runs: IngestionRun[]): IngestionRun | undefined {
  return runs.find((r) => String(r.status || "").toLowerCase() === "completed");
}

/** Newest upload among the documents: the last read when no recent run completed. */
function latestUpload(docs: IndexedDocument[]): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const d of docs) {
    const ms = d.last_uploaded_at ? Date.parse(d.last_uploaded_at) : NaN;
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = d.last_uploaded_at!;
    }
  }
  return best;
}

function KnowledgeBaseContent({ routed = false }: { routed?: boolean }) {
  const { t, settings, updateSettings, licenseTier } = useApp();
  const ingestion = useIngestion();
  const { documents, loading: docsLoading, remove, refresh } = useDocuments();
  const { bumpIngestion } = useBackgroundJobs();
  const prevStatusRef = useRef<string>("idle");
  const name = assistantName(settings, t("assistant.common.fallbackName"));
  const configuredName = assistantName(settings, "");

  const [syncForm, setSyncForm] = useState({
    include_posts: true,
    include_pages: true,
    replace_all: false,
  });
  const [uploading, setUploading] = useState(false);
  const [pdfStats, setPdfStats] = useState<PdfStats | null>(null);
  const [counts, setCounts] = useState<ContentCounts | null>(null);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [textOpen, setTextOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStats = useCallback(() => {
    apiFetch<PdfStats>("/knowledge/stats").then((s) => setPdfStats(s && typeof s === "object" ? s : null)).catch(() => null);
  }, []);

  useEffect(() => {
    loadStats();
    // Published pages and posts on the site: the denominator of the coverage.
    apiFetch<{ content_counts?: ContentCounts }>("/dashboard")
      .then((d) => setCounts(d?.content_counts ?? null))
      .catch(() => setCounts(null));
  }, [loadStats]);

  // A finished sync changes the documents and the plan usage.
  useEffect(() => {
    if (prevStatusRef.current !== "completed" && ingestion.status === "completed") {
      refresh?.();
      loadStats();
    }
  }, [ingestion.status, refresh, loadStats]);

  const pdfEnabled = (pdfStats?.pdf_cap_bytes ?? 0) > 0;

  // Auto-generate persona on first successful sync
  useEffect(() => {
    if (prevStatusRef.current !== "completed" && ingestion.status === "completed") {
      const tenantSettings = (settings.tenant_settings || {}) as Record<string, unknown>;
      const hasCustomPersona = tenantSettings.chatbot_name && tenantSettings.chatbot_name !== "AlphaRecall";
      if (!hasCustomPersona) {
        void (async () => {
          try {
            await apiFetch("/persona/generate", { method: "POST" });
            toast.success(t("toast.personaGenerated"));
          } catch {
            // silently fail: persona can be generated manually later
          }
        })();
      }
    }
    prevStatusRef.current = ingestion.status;
  }, [ingestion.status, settings.tenant_settings, t]);

  const handleSync = useCallback(() => {
    if (ingestion.isActive || !ingestion.startSync) return;
    void (async () => {
      await ingestion.startSync({
        include_posts: syncForm.include_posts,
        include_pages: syncForm.include_pages,
        replace_all: syncForm.replace_all,
      });
      // Surface the run in the global header indicator immediately.
      bumpIngestion();
    })();
  }, [ingestion, syncForm, bumpIngestion]);

  const openUpload = useCallback(() => fileInputRef.current?.click(), []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".pdf")) {
          // Send PDF as multipart directly to the WP REST endpoint
          const { restUrl, nonce } = getConfig();
          const base = restUrl.replace(/\/$/, "");
          const formData = new FormData();
          formData.append("file", file, file.name);
          const res = await fetch(`${base}/knowledge-upload-pdf`, {
            method: "POST",
            headers: { "X-WP-Nonce": nonce },
            body: formData,
          });
          const data = await res.json().catch(() => ({})) as Record<string, unknown>;
          if (!res.ok) {
            const msg = (data.error as string) || t("messages.pdfUploadFailed");
            toast.error(msg);
            continue;
          }
          // A raw fetch skips apiFetch's write invalidation: drop the cached
          // /documents and /knowledge/stats bodies before reading them again.
          invalidateApiCache();
          toast.success(named(t, "assistant.contenuti.pdfUploaded", configuredName, { file: file.name }));
          loadStats();
        } else if (lower.endsWith(".txt") || lower.endsWith(".md")) {
          if (file.size > 500 * 1024) {
            toast.error(interpolate(t("assistant.contenuti.fileTooBig"), { file: file.name }));
            continue;
          }
          const text = await file.text();
          const cleaned = text.replace(/\0/g, "").slice(0, 200000);
          if (!cleaned.trim()) continue;
          await apiFetch("/knowledge-upload", {
            method: "POST",
            body: JSON.stringify({
              items: [{ title: file.name, text: cleaned, source_url: `upload://${encodeURIComponent(file.name)}` }],
            }),
          });
          toast.success(t("toast.filesUploaded"));
        }
      }
      refresh?.();
    } catch {
      toast.error(t("toast.uploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Exclusions are WordPress page/post ids; the sync turns them into URL
  // patterns it skips. They apply from the next sync on.
  const excludedIds = useMemo(
    () => new Set((settings.exclude_page_ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0)),
    [settings.exclude_page_ids]
  );
  const toggleExclude = useCallback(async (postId: number) => {
    const next = new Set(excludedIds);
    const excluding = !next.has(postId);
    if (excluding) next.add(postId);
    else next.delete(postId);
    const list = Array.from(next);
    const previous = settings.exclude_page_ids;
    updateSettings({ exclude_page_ids: list.map(String) });
    try {
      await saveSettings("/settings", { exclude_page_ids: list });
      toast.success(excluding ? t("assistant.contenuti.excludedToast") : t("assistant.contenuti.includedToast"));
    } catch {
      updateSettings({ exclude_page_ids: previous });
      toast.error(t("toast.settingsFailed"));
    }
  }, [excludedIds, settings.exclude_page_ids, updateSettings, t]);

  /*
   * "Pagine" means one thing on this screen: documents read from this site's
   * own URLs. Documents from other sources can carry https URLs too,
   * but they are not pages of the site and the published count never has them.
   */
  const siteHost = hostOf(getConfig()?.siteUrl || String(settings.tenant_domain || "")) || String(settings.tenant_domain || "");
  const bareHost = (host: string) => host.toLowerCase().replace(/^www\./, "");
  const onSite = (url: string) => !siteHost || bareHost(hostOf(url)) === bareHost(siteHost);
  const siteDocs = documents.filter((d) => sourceKind(d) === "site" && onSite(d.source_url));
  const fileDocs = documents.filter((d) => sourceKind(d) === "file");
  const textDocs = documents.filter((d) => sourceKind(d) === "text");

  const runs = ingestion.recentRuns || [];
  const lastRun = lastFinishedRun(runs);
  const lastFailed = String(lastRun?.status || "").toLowerCase() === "failed";
  const lastOk = lastSuccessfulRun(runs);
  const lastReadAt = lastOk ? String(lastOk.finished_at || lastOk.started_at || "") || null : latestUpload(siteDocs);

  // Coverage over the published pages and posts, only when the two counts
  // measure the same thing: more pages known than published means stale or
  // extra entries (deleted pages, other post types), and "13 su 9" is wrong.
  // A failed last read shows no ring either: 100% next to "Errore" misleads.
  const published = (counts?.pages ?? 0) + (counts?.posts ?? 0);
  const coverage = published > 0 && siteDocs.length <= published && !lastFailed ? (siteDocs.length / published) * 100 : null;
  const siteStatus: { tone: Tone; label: string } = ingestion.isActive
    ? { tone: "warn", label: t("assistant.contenuti.syncing") }
    : lastFailed
      ? { tone: "red", label: t("assistant.contenuti.syncError") }
      : lastRun
        ? { tone: "accent", label: t("assistant.contenuti.synced") }
        : { tone: "mute", label: t("assistant.contenuti.neverSynced") };

  const pickFilter = (f: LibraryFilter) => setFilter((cur) => (cur === f ? "all" : f));
  const fileMb = pdfStats?.pdf_bytes_used_mb;

  const addMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={uploading}>
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {uploading ? t("messages.uploading") : t("assistant.contenuti.addContent")}
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={openUpload}>
          <Upload className="size-3.5" />
          <span className="flex flex-col">
            <span>{t("buttons.uploadFiles")}</span>
            <small className="text-ink-3">{pdfStats && !pdfEnabled ? ".txt, .md" : "PDF, .txt, .md"}</small>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTextOpen(true)}>
          <Pencil className="size-3.5" />
          <span className="flex flex-col">
            <span>{t("assistant.contenuti.writeText")}</span>
            <small className="text-ink-3">{t("assistant.contenuti.writeTextHint")}</small>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleSync} disabled={ingestion.isActive}>
          <Globe className="size-3.5" />
          <span className="flex flex-col">
            <span>{t("assistant.contenuti.syncSite")}</span>
            <small className="text-ink-3">{siteHost}</small>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="as-page">
      {routed && (
        <>
          <KnowledgeIntents onSync={handleSync} onUpload={openUpload} onWrite={() => setTextOpen(true)} />
          <PageHead
            title={t("nav.leaves.assistente.contenuti")}
            subtitle={interpolate(t("assistant.contenuti.subtitle"), { name })}
            actions={
              <>
                <Button variant="secondary" onClick={handleSync} disabled={ingestion.isActive}>
                  <RefreshCw className={cn("size-4", ingestion.isActive && "animate-spin")} />
                  {t("assistant.contenuti.sync")}
                </Button>
                {addMenu}
              </>
            }
          />
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        aria-label={t("section.uploadTitle")}
        // Always offer PDFs: the plan check is the server's, and its refusal is shown as a toast.
        accept=".txt,.md,.pdf"
        multiple
        className="hidden"
        onChange={handleUpload}
      />

      {/* Coverage and the three kinds of source */}
      {docsLoading && documents.length === 0 ? (
        <div className="as-coverage-row" data-tour="content-sync" aria-busy="true">
          <div className="as-coverage">
            <Skeleton className="size-[62px] shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="as-grid3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="as-tile">
                <Skeleton className="size-4" />
                <Skeleton className="mt-2 h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      ) : (
      <div className="as-coverage-row" data-tour="content-sync">
        <div className="as-coverage">
          {coverage !== null ? (
            <Ring value={coverage} label={interpolate(t("assistant.contenuti.coverageAria"), { pct: Math.round(coverage) })} />
          ) : (
            <Database className="size-6 shrink-0 text-ink-3" aria-hidden="true" />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <b className="as-coverage-title">
              {coverage !== null
                ? plural(t, "assistant.contenuti.coverageTitleOne", "assistant.contenuti.coverageTitle", siteDocs.length, { name, read: siteDocs.length, total: published })
                : siteDocs.length > 0
                  ? plural(t, "assistant.contenuti.coverageTitleSiteOne", "assistant.contenuti.coverageTitleSite", siteDocs.length, { name, read: siteDocs.length })
                  : plural(t, "assistant.contenuti.coverageTitleNoTotalOne", "assistant.contenuti.coverageTitleNoTotal", documents.length, { name, read: documents.length })}
            </b>
            <span className="as-faint as-small">
              {lastReadAt
                ? interpolate(t("assistant.contenuti.lastSync"), { when: formatRelativeTime(lastReadAt) })
                : t("assistant.contenuti.noSyncYet")}
            </span>
          </div>
        </div>
        <div className="as-grid3">
          <Tile
            icon={Globe}
            iconClass="ark-c-info"
            status={<Status tone={siteStatus.tone}>{siteStatus.label}</Status>}
            title={t("assistant.contenuti.site")}
            sub={`${siteHost} · ${plural(t, "assistant.contenuti.nPagesOne", "assistant.contenuti.nPages", siteDocs.length)}`}
            onClick={() => pickFilter("page")}
            pressed={filter === "page"}
          />
          <Tile
            icon={FileText}
            iconClass="ark-c-accent"
            status={fileDocs.length > 0 ? <Status tone="accent">{t("assistant.contenuti.ready")}</Status> : <Status tone="mute">{t("assistant.contenuti.none")}</Status>}
            title={t("assistant.contenuti.files")}
            sub={fileDocs.length > 0
              ? `${interpolate(t("assistant.contenuti.nFiles"), { n: fileDocs.length })}${fileMb ? ` · ${fileMb} MB` : ""}`
              : t("assistant.contenuti.filesEmpty")}
            onClick={() => (fileDocs.length > 0 ? pickFilter("file") : openUpload())}
            pressed={filter === "file"}
            data-tour="content-upload"
          />
          <Tile
            icon={Pencil}
            iconClass="ark-c-violet"
            status={<Status tone="mute">{t("assistant.contenuti.manual")}</Status>}
            title={t("assistant.contenuti.texts")}
            sub={textDocs.length > 0
              ? plural(t, "assistant.contenuti.nTextsOne", "assistant.contenuti.nTexts", textDocs.length)
              : t("assistant.contenuti.textsEmpty")}
            onClick={() => (textDocs.length > 0 ? pickFilter("text") : setTextOpen(true))}
            pressed={filter === "text"}
          />
        </div>
      </div>
      )}

      {/* Needs the router (Scrivi risposta opens the FAQ page), so only when routed. */}
      {routed && <UnansweredQuestions canWrite={licenseTier === "business" || licenseTier === "enterprise"} />}

      <SyncProgress status={ingestion.status} currentRun={ingestion.currentRun ?? null} error={ingestion.error ?? null} />

      <SourceLibrary
        documents={documents}
        loading={docsLoading}
        filter={filter}
        onFilter={setFilter}
        excludedIds={excludedIds}
        onDelete={remove}
        onToggleExclude={(id) => void toggleExclude(id)}
        onRefresh={refresh}
      />

      <div className="as-split">
        <Group label={t("assistant.contenuti.syncGroup")}>
          <Row label={t("labels.syncPages")} description={t("labels.syncPagesHint")} htmlFor="ar-sync-pages">
            <Toggle id="ar-sync-pages" checked={syncForm.include_pages} onCheckedChange={(v) => setSyncForm((p) => ({ ...p, include_pages: v }))} />
          </Row>
          <Row label={t("labels.syncPosts")} description={t("labels.syncPostsHint")} htmlFor="ar-sync-posts">
            <Toggle id="ar-sync-posts" checked={syncForm.include_posts} onCheckedChange={(v) => setSyncForm((p) => ({ ...p, include_posts: v }))} />
          </Row>
          <Row label={t("labels.syncReplace")} description={t("labels.syncReplaceHint")} htmlFor="ar-sync-replace">
            <Toggle id="ar-sync-replace" checked={syncForm.replace_all} onCheckedChange={(v) => setSyncForm((p) => ({ ...p, replace_all: v }))} />
          </Row>
          <Row label={t("section.syncTitle")} description={excludedIds.size > 0 ? plural(t, "assistant.contenuti.excludedCountOne", "assistant.contenuti.excludedCount", excludedIds.size) : interpolate(t("section.syncSubtitle"), { name })}>
            <Button variant="secondary" onClick={handleSync} disabled={!!ingestion.isActive}>
              <RefreshCw className={cn("size-4", ingestion.isActive && "animate-spin")} />
              {ingestion.isActive ? t("messages.loading") : t("buttons.syncNow")}
            </Button>
          </Row>
        </Group>

        <div className="flex min-w-0 flex-col gap-6">
          {runs.length > 0 && (
            <div className="as-section">
              <span className="ark-lbl px-1">{t("content.recentSyncs")}</span>
              <Feed
                className="px-1"
                items={runs.slice(0, 4).map((run) => {
                  const status = String(run.status || "").toLowerCase();
                  const k = `content.runStatus.${status}`;
                  const label = t(k) === k ? status : t(k);
                  // Pages read, not `documents_uploaded`: that one counts chunks.
                  const docsCount = Number(run.stats?.processed_items ?? run.stats?.total_items ?? 0);
                  return {
                    key: run.id,
                    time: run.started_at ? formatRelativeTime(run.started_at) : "",
                    content: (
                      <span className="flex min-w-0 flex-col gap-1">
                        <span>
                          <b className={cn(status === "failed" && "text-tone-red")}>{label}</b>
                          {status === "completed" && docsCount > 0 && ` · ${plural(t, "assistant.contenuti.nPagesOne", "assistant.contenuti.nPages", docsCount)}`}
                        </span>
                        {status === "failed" && (
                          <>
                            {run.error_msg && <SyncErrorNotice message={run.error_msg} />}
                            <button
                              type="button"
                              title={t("content.retrySyncHint")}
                              className="inline-flex items-center gap-1 self-start text-xs font-medium text-ink hover:underline disabled:opacity-50"
                              onClick={handleSync}
                              disabled={!!ingestion.isActive}
                            >
                              <RefreshCw className="size-3" />
                              {t("content.retrySync")}
                            </button>
                          </>
                        )}
                      </span>
                    ),
                  };
                })}
              />
            </div>
          )}
          <PlanUsage stats={pdfStats} />
        </div>
      </div>

      <AddTextDialog open={textOpen} onOpenChange={setTextOpen} onSaved={() => refresh?.()} />
    </div>
  );
}

/** Write a note the assistant learns from (stored like an uploaded .txt). */
function AddTextDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const { t, settings } = useApp();
  const configuredName = assistantName(settings, "");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setTitle(""); setText(""); }
  }, [open]);

  const save = async () => {
    const cleanTitle = title.trim();
    const cleanText = text.replace(/\0/g, "").trim().slice(0, 200000);
    if (!cleanTitle || !cleanText) return;
    setSaving(true);
    try {
      const slug = cleanTitle.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "testo";
      await apiFetch("/knowledge-upload", {
        method: "POST",
        body: JSON.stringify({
          items: [{ title: cleanTitle, text: cleanText, source_url: `upload://testo/${slug}-${Date.now().toString(36)}` }],
        }),
      });
      toast.success(named(t, "assistant.contenuti.textSaved", configuredName));
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toast.uploadFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("assistant.contenuti.writeText")}</DialogTitle>
          <DialogDescription>{named(t, "assistant.contenuti.writeTextBody", configuredName)}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); void save(); }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="as-text-title">{t("assistant.contenuti.textTitle")}</Label>
            <Input id="as-text-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("assistant.contenuti.textTitlePlaceholder")} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="as-text-body">{t("assistant.contenuti.textBody")}</Label>
            <Textarea id="as-text-body" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("assistant.contenuti.textBodyPlaceholder")} className="resize-y leading-relaxed" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={saving || !title.trim() || !text.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t("assistant.contenuti.saveText")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
