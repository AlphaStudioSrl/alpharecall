import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus,
  Sparkles,
  Upload,
  Trash2,
  AlertCircle,
  X,
  HelpCircle,
  Loader2,
  CheckCircle2,
  GripVertical,
  Pencil,
  Lock,
  ArrowRight,
  ChevronDown,
  Wand2,
  Globe,
  Check,
} from "@/components/icons";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useNav, useNavIntent, useNavigate, useNavBadge, useView } from "@/admin/lib/nav-context";
import { filteredOnly, gapKey as questionKey, useKnowledgeGaps, type KnowledgeGap } from "@/admin/components/assistant/use-knowledge-gaps";
import { gapMeta } from "@/admin/components/assistant/unanswered-questions";
import { useFrameLayout } from "@/admin/components/layout/frame-context";
import { faqErrorText } from "./faq-errors";
import { useHelpdesk, type HelpdeskItem } from "@/admin/hooks/use-helpdesk";
import { useBackgroundJobs } from "@/admin/hooks/use-background-jobs";
import { InlineSelect } from "@/admin/components/shared/inline-select";
import { PageHead, Chips, SearchField, IconButton, Tag, Toggle, Empty } from "@/admin/components/shared/kit";
import { ScrollRow } from "@/admin/components/shared/scroll-row";
import { assistantName } from "@/admin/components/assistant/shared";
import { interpolate, named, plural } from "@/admin/lib/i18n";
import {
  useHelpdeskCategories,
  type HelpdeskCategory,
} from "@/admin/hooks/use-helpdesk-categories";
import { cn } from "@/lib/utils";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bones } from "@/admin/components/shared/bones";

/* ─── Inline modal (renders INSIDE #alpharecall-admin-app, NOT via Radix portal) ─── */

function InlineModal({
  open,
  onClose,
  ariaLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const getFocusable = () => dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const focusFrame = window.requestAnimationFrame(() => {
      getFocusable()?.[0]?.focus();
    });
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handler);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "var(--ar-scrim)" }}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="relative z-10 max-h-[calc(100vh-32px)] w-full max-w-lg overflow-y-auto rounded-modal bg-panel shadow-float"
      >
        {children}
      </div>
    </div>
  );
}

/* ─── Duplicate questions ─── */

/**
 * A question reduced to what makes it the same question: case, accents,
 * spaces and punctuation do not count ("È possibile pagare?" and "e'
 * possibile  pagare" match).
 */
export function normalizeQuestion(question: string): string {
  return question
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The FAQ that already asks this question, other than the one being edited. */
export function findDuplicateFaq(items: HelpdeskItem[], question: string, exceptId: number | string | null = null): HelpdeskItem | null {
  const key = normalizeQuestion(question);
  if (!key) return null;
  return items.find((item) => item.id !== exceptId && normalizeQuestion(item.question) === key) ?? null;
}

/* ─── One FAQ in the grouped accordion ─── */

function SortableFaqItem({
  item,
  open,
  onOpenChange,
  onEdit,
  onToggle,
  onRemove,
  sortable,
}: {
  item: HelpdeskItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  sortable: boolean;
}) {
  const { t } = useApp();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !sortable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };
  const isEnabled = item.enabled !== false;
  const bodyId = `as-faq-${item.id}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("as-faq-item", !isEnabled && "as-faq-off")}
      data-dragging={isDragging || undefined}
    >
      <div className="as-faq-head">
        {sortable ? (
          <button
            type="button"
            className="as-faq-grip"
            aria-label={`${t("assistant.faq.reorder")}: ${item.question}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" />
          </button>
        ) : (
          <span className="as-faq-grip" aria-hidden="true" style={{ cursor: "default", opacity: 0 }} />
        )}
        <button
          type="button"
          className="as-faq-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => onOpenChange(!open)}
        >
          <span>
            <b>{item.question}</b>
            {!open && <small>{item.answer}</small>}
          </span>
          {!isEnabled && <Tag tone="mute">{t("assistant.faq.off")}</Tag>}
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div id={bodyId} className="as-faq-body">
          <p className="as-faq-answer">{item.answer}</p>
          <div className="as-faq-controls">
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <Toggle checked={isEnabled} aria-label={item.question} onCheckedChange={onToggle} />
              {isEnabled ? t("assistant.faq.onLabel") : t("assistant.faq.offLabel")}
            </label>
            <span className="as-spacer" />
            <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="size-3.5" />
              {t("common.edit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-tone-red"
              onClick={onRemove}
              aria-label={`${t("buttons.delete")}: ${item.question}`}
            >
              <Trash2 className="size-3.5" />
              {t("buttons.delete")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Answers the assistant drafted, waiting for a review ─── */

type Suggestion = { kind: "draft"; item: HelpdeskItem } | { kind: "gap"; gap: KnowledgeGap };

function Suggestions({
  drafts,
  gaps,
  name,
  generating,
  onGenerate,
  onApprove,
  onEdit,
  onDiscard,
  onWriteGap,
  onDismissGap,
  busyId,
}: {
  drafts: HelpdeskItem[];
  /** Questions the assistant could not answer: they need an answer written. */
  gaps: KnowledgeGap[];
  name: string;
  generating: boolean;
  onGenerate: () => void;
  onApprove: (item: HelpdeskItem) => void;
  onEdit: (item: HelpdeskItem) => void;
  onDiscard: (item: HelpdeskItem) => void;
  onWriteGap: (gap: KnowledgeGap) => void;
  onDismissGap: (gap: KnowledgeGap) => void;
  busyId: number | string | null;
}) {
  const { t } = useApp();
  const [showAll, setShowAll] = useState(false);
  const all: Suggestion[] = [
    ...drafts.map((item) => ({ kind: "draft" as const, item })),
    ...gaps.map((gap) => ({ kind: "gap" as const, gap })),
  ];
  // The preview keeps one unanswered question in view next to the drafts.
  const preview = drafts.length >= 3 && gaps.length ? [...all.slice(0, 2), all[drafts.length]] : all.slice(0, 3);
  const shown = showAll ? all : preview;

  if (!all.length) {
    return (
      <section className="as-suggest" aria-labelledby="as-suggest-title">
        <div className="as-suggest-head">
          <Wand2 aria-hidden="true" />
          <h2 id="as-suggest-title" className="font-semibold">{interpolate(t("assistant.faq.emptySuggestTitle"), { name })}</h2>
          <span className="as-muted as-small">{t("assistant.faq.emptySuggestBody")}</span>
          <span className="as-spacer" />
          <Button variant="secondary" size="sm" onClick={onGenerate} disabled={generating}>
            {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {generating ? t("helpdesk.generating") : t("assistant.faq.prepare")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="as-suggest" aria-labelledby="as-suggest-title">
      <div className="as-suggest-head">
        <Wand2 aria-hidden="true" />
        <h2 id="as-suggest-title" className="font-semibold">
          {drafts.length > 0
            ? interpolate(t(drafts.length === 1 ? "assistant.faq.suggestTitleOne" : "assistant.faq.suggestTitle"), { name, n: drafts.length })
            : interpolate(t(gaps.length === 1 ? "assistant.gaps.faqTitleOne" : "assistant.gaps.faqTitle"), { n: gaps.length })}
        </h2>
        <span className="as-muted as-small">
          {drafts.length > 0
            ? `${t("assistant.faq.suggestBody")}${gaps.length ? ` ${interpolate(t(gaps.length === 1 ? "assistant.gaps.plusOne" : "assistant.gaps.plus"), { n: gaps.length })}` : ""}`
            : interpolate(t("assistant.gaps.faqBody"), { name })}
        </span>
        <span className="as-spacer" />
        <Button variant="ghost" size="sm" onClick={onGenerate} disabled={generating}>
          {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {generating ? t("helpdesk.generating") : t(drafts.length ? "assistant.faq.prepareMore" : "assistant.faq.prepare")}
        </Button>
        {all.length > 3 && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? t("assistant.faq.showFewer") : interpolate(t("assistant.faq.showAll"), { n: all.length })}
          </Button>
        )}
      </div>
      <div className="as-grid3">
        {shown.map((entry) => entry.kind === "gap" ? (
          <article key={`gap-${entry.gap.key}`} className="as-draft as-draft-gap" aria-label={entry.gap.question}>
            <b className="as-draft-q">{entry.gap.question}</b>
            <p className="as-draft-a">{interpolate(t("assistant.gaps.cardBody"), { name })}</p>
            <span className="flex flex-wrap items-center gap-2">
              <Tag tone="warn">{t("assistant.gaps.needsAnswer")}</Tag>
              <span className="as-faint text-xs">{gapMeta(t, entry.gap)}</span>
            </span>
            <div className="as-draft-actions">
              <Button size="sm" className="as-btn-sm" onClick={() => onWriteGap(entry.gap)}>
                <Pencil className="size-3.5" />
                {t("assistant.gaps.writeShort")}
              </Button>
              <span className="as-spacer" />
              <IconButton icon={X} size="sm" label={`${t("assistant.gaps.dismiss")}: ${entry.gap.question}`} onClick={() => onDismissGap(entry.gap)} />
            </div>
          </article>
        ) : (() => { const item = entry.item; return (
          <article key={item.id} className="as-draft" aria-label={item.question}>
            <b className="as-draft-q">{item.question}</b>
            <p className="as-draft-a">{item.answer}</p>
            <span className="as-src self-start"><Globe aria-hidden="true" /><span>{t("assistant.faq.fromSite")}</span></span>
            <div className="as-draft-actions">
              <Button size="sm" className="as-btn-sm" onClick={() => onApprove(item)} disabled={busyId === item.id}>
                {busyId === item.id ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {t("assistant.faq.approve")}
              </Button>
              <Button size="sm" variant="secondary" className="as-btn-sm" onClick={() => onEdit(item)}>
                {t("common.edit")}
              </Button>
              <span className="as-spacer" />
              <IconButton icon={X} size="sm" label={`${t("assistant.faq.discard")}: ${item.question}`} onClick={() => onDiscard(item)} />
            </div>
          </article>
        ); })())}
      </div>
    </section>
  );
}

/** The page parameters of an "Aggiungi FAQ" link: the question and the knowledge gap it answers. */
export const FAQ_LINK_PARAMS = ["q", "gap"] as const;

/**
 * Ctrl K "Nuova domanda", Prova's "Correggi questa risposta" and "Scrivi
 * risposta" in Statistiche / Domande senza risposta land here.
 *
 * Inside the app they arrive as an intent. The same link opened directly (a
 * reload, a shared or bookmarked URL, a new tab) has only `q` and `gap` in
 * the URL, and used to show just the list (card 092b3547byr8): on mount they
 * open the prefilled dialog too. The dialog takes them off the URL when it
 * closes (FAQ_LINK_PARAMS), so a reload does not open it again.
 */
function FaqIntents({ onAdd }: { onAdd: (question?: string, gapKey?: string) => void }) {
  const { params } = useView();
  const { intent, leaf } = useNav();
  // `gap` comes from Contenuti > Domande senza risposta: saving resolves it.
  useNavIntent("add-faq", () => onAdd(params.q, params.gap));
  const linkChecked = useRef(false);
  useEffect(() => {
    if (linkChecked.current) return;
    linkChecked.current = true;
    // The intent opens it already (useNavIntent above).
    if (intent?.name === "add-faq" && intent.leafId === leaf.id) return;
    if (params.q || params.gap) onAdd(params.q, params.gap);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on mount
  return null;
}

/* ─── Main Page ─── */

const GROUP_PREVIEW = 4;
type Filter = number | "all" | "uncategorized";

export function HelpdeskPage() {
  const { t, licenseTier, refreshLicenseTier, settings } = useApp();
  const navigate = useNavigate();
  // The leaf defaults to a filled frame for the old two-pane editor; this
  // page is one scrolling column.
  useFrameLayout({ fill: false });
  const hasHelpdeskAccess = licenseTier === "business" || licenseTier === "enterprise";
  const [refreshing, setRefreshing] = useState(false);
  const name = assistantName(settings, t("assistant.common.fallbackName"));

  // Auto-refresh license on mount when locked: catches stale transient cache
  useEffect(() => {
    if (!hasHelpdeskAccess) {
      refreshLicenseTier();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const {
    items,
    loading,
    error,
    setError,
    add,
    update,
    toggleEnabled,
    remove,
    reorder,
    generate,
    importFromFile,
    reload: reloadItems,
  } = useHelpdesk();
  const { runFaqJob } = useBackgroundJobs();

  const {
    categories,
    loading: catsLoading,
    error: catsError,
    setError: setCatsError,
    add: addCategory,
    update: updateCategory,
    remove: removeCategory,
    load: reloadCategories,
  } = useHelpdeskCategories();

  // FAQ Modal state
  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [editId, setEditId] = useState<number | string | null>(null);
  const [editingDraft, setEditingDraft] = useState(false);
  const [formQ, setFormQ] = useState("");
  const [formA, setFormA] = useState("");
  const [formCategoryId, setFormCategoryId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const duplicateRef = useRef<HTMLDivElement>(null);
  // The FAQ about to be deleted, waiting for a confirmation.
  const [confirmDelete, setConfirmDelete] = useState<HelpdeskItem | null>(null);

  // Category Modal state
  const [catModalMode, setCatModalMode] = useState<"add" | "edit" | null>(null);
  const [catEditId, setCatEditId] = useState<number | null>(null);
  const [catFormName, setCatFormName] = useState("");
  const [catFormDesc, setCatFormDesc] = useState("");
  const [catSaving, setCatSaving] = useState(false);

  // Other state
  const [generating, setGenerating] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<Set<number | string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<number | string | null>(null);

  // Drag state (dnd-kit)
  const [activeDragId, setActiveDragId] = useState<number | string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const questionInputRef = useRef<HTMLInputElement>(null);
  const catNameInputRef = useRef<HTMLInputElement>(null);

  // Build a map from category id to category for fast lookups
  const categoryMap = useMemo(() => {
    const map = new Map<number, HelpdeskCategory>();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  // Count items per category
  const categoryCounts = useMemo(() => {
    const counts = new Map<number, number>();
    let uncategorized = 0;
    items.forEach((item) => {
      if (item.category_id != null) {
        counts.set(item.category_id, (counts.get(item.category_id) || 0) + 1);
      } else {
        uncategorized++;
      }
    });
    return { counts, uncategorized };
  }, [items]);

  // Answers drafted from the site that nobody has reviewed yet.
  const drafts = useMemo(() => items.filter((i) => i.source === "generated"), [items]);
  const { gaps, loading: gapsLoading, available: gapsAvailable, setStatus: setGapStatus } = useKnowledgeGaps();
  const { clearParams } = useNav();
  // A question the safety filter refused every time never reached the
  // assistant: an FAQ would not answer it, so it is not proposed here.
  const openGaps = hasHelpdeskAccess && gapsAvailable ? gaps.filter((gap) => !filteredOnly(gap)) : [];
  // The sidebar counts what the "Tutti" chip counts: every FAQ, drafted ones
  // included (card zn0uu3d2vh8t). What is left to review is on the page.
  useNavBadge("assistente/faq", hasHelpdeskAccess && items.length ? items.length : null);
  // The gap a new FAQ answers; saved FAQs mark it resolved.
  const [pendingGap, setPendingGap] = useState<KnowledgeGap | null>(null);
  // The link named the gap (Statistiche, Domande senza risposta), rather than
  // the gap being looked up from the question (Prova's "Correggi").
  const [gapNamed, setGapNamed] = useState(false);

  // Filter items
  const filteredItems = useMemo(() => {
    let list = items;
    if (activeFilter === "uncategorized") list = list.filter((i) => i.category_id == null);
    else if (activeFilter !== "all") list = list.filter((i) => i.category_id === activeFilter);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((i) => `${i.question}\n${i.answer}`.toLowerCase().includes(q));
    return list;
  }, [items, activeFilter, query]);
  const searching = query.trim().length > 0;

  // Group filtered items by category_id
  const groupedItems = useMemo(() => {
    const groups: { key: string; categoryId: number | null; categoryName: string; items: HelpdeskItem[] }[] = [];
    const uncategorized: HelpdeskItem[] = [];

    const catMap = new Map<number, HelpdeskItem[]>();
    filteredItems.forEach((item) => {
      if (item.category_id != null) {
        if (!catMap.has(item.category_id)) catMap.set(item.category_id, []);
        catMap.get(item.category_id)!.push(item);
      } else {
        uncategorized.push(item);
      }
    });

    // Sort category groups by position
    const sortedCatIds = Array.from(catMap.keys()).sort((a, b) => {
      const catA = categoryMap.get(a);
      const catB = categoryMap.get(b);
      return (catA?.position ?? 999) - (catB?.position ?? 999);
    });

    sortedCatIds.forEach((catId) => {
      const cat = categoryMap.get(catId);
      groups.push({
        key: String(catId),
        categoryId: catId,
        categoryName: cat?.name || items.find((i) => i.category_id === catId)?.category || `#${catId}`,
        items: catMap.get(catId)!,
      });
    });

    if (uncategorized.length > 0) {
      groups.push({ key: "__uncategorized", categoryId: null, categoryName: t("filters.uncategorized"), items: uncategorized });
    }

    return groups;
  }, [filteredItems, categoryMap, items, t]);

  const flash = (msg: string) => {
    toast.success(msg);
  };

  const handleDismissGap = async (gap: KnowledgeGap) => {
    try {
      await setGapStatus(gap, "dismissed");
      toast(t("assistant.gaps.dismissed"), {
        action: { label: t("assistant.faq.undo"), onClick: () => void setGapStatus(gap, "open").catch(() => toast.error(t("assistant.gaps.failed"))) },
      });
    } catch {
      toast.error(t("assistant.gaps.failed"));
    }
  };

  // ── FAQ Modal helpers ──

  const openAddModal = useCallback((question?: string, gapKey?: string) => {
    // Prova's "Correggi questa risposta" sends only the question: if visitors
    // asked it too and it is still open, the FAQ answers that gap, silently
    // (card 092b3547byr8: the "no longer open" notice is for named gaps).
    const key = gapKey || (question ? questionKey(question) : "");
    setPendingGap(
      key
        ? gaps.find((g) => g.key === key) ?? { key, question: question || "", count: 0, first_seen: "", last_seen: "", reasons: {}, conversation_ids: [], helpdesk_entry_id: null }
        : null
    );
    setGapNamed(!!gapKey);
    setFormQ(question || "");
    setFormA("");
    setFormCategoryId(typeof activeFilter === "number" ? String(activeFilter) : "");
    setEditId(null);
    setEditingDraft(false);
    setModalMode("add");
    setTimeout(() => questionInputRef.current?.focus(), 100);
  }, [activeFilter, gaps]);

  const openEditModal = useCallback((item: HelpdeskItem) => {
    setFormQ(item.question);
    setFormA(item.answer);
    setFormCategoryId(item.category_id != null ? String(item.category_id) : "");
    setEditId(item.id);
    setEditingDraft(item.source === "generated");
    setModalMode("edit");
    setTimeout(() => questionInputRef.current?.focus(), 100);
  }, []);

  const closeModal = useCallback(() => {
    setModalMode(null);
    setEditId(null);
    setPendingGap(null);
    setGapNamed(false);
    // Saved or dismissed, the link has done its job: a reload shows the list.
    clearParams([...FAQ_LINK_PARAMS]);
  }, [clearParams]);

  // A link opened before the questions loaded links a stand-in: once they are
  // here, link the real one.
  useEffect(() => {
    if (!pendingGap) return;
    const known = gaps.find((g) => g.key === pendingGap.key);
    if (known && known !== pendingGap) setPendingGap(known);
  }, [gaps, pendingGap]);
  // The gap the link named is no longer waiting for an answer: answered
  // meanwhile or dismissed. The FAQ is still saved; it just closes no open
  // question. A gap looked up from the question (Prova) says nothing.
  const gapGone = modalMode === "add" && gapNamed && !!pendingGap && gapsLoading === false && gapsAvailable
    && !gaps.some((g) => g.key === pendingGap.key);

  // Another FAQ that already asks the question in the form.
  const duplicate = useMemo(
    () => (modalMode ? findDuplicateFaq(items, formQ, modalMode === "edit" ? editId : null) : null),
    [modalMode, items, formQ, editId]
  );

  const handleSave = async ({ confirmDuplicate = false } = {}) => {
    if (!formQ.trim() || !formA.trim()) return;
    // A question that is already there is saved only when the owner says so.
    if (duplicate && !confirmDuplicate) {
      duplicateRef.current?.focus();
      return;
    }
    setSaving(true);
    const categoryId = formCategoryId ? Number(formCategoryId) : null;
    const categoryName = categoryId ? categoryMap.get(categoryId)?.name : undefined;
    try {
      if (modalMode === "edit" && editId) {
        await update(editId, {
          question: formQ.trim(),
          answer: formA.trim(),
          category: categoryName || undefined,
          category_id: categoryId,
          // Editing a drafted answer is reviewing it.
          ...(editingDraft ? { source: "reviewed" } : {}),
        });
        flash(t("helpdesk.faqUpdated"));
      } else {
        const created = await add(formQ.trim(), formA.trim(), categoryName || undefined, categoryId);
        flash(t("helpdesk.faqAdded"));
        if (pendingGap && created?.id != null) {
          // The FAQ is saved either way; a failed link only leaves the question
          // open. A gap looked up from Prova's question is linked only if it is
          // an open one, and only a known open gap is worth an error.
          const known = gaps.some((g) => g.key === pendingGap.key);
          if (known || gapNamed) {
            setGapStatus(pendingGap, "resolved", Number(created.id)).catch(() => {
              if (known) toast.error(t("assistant.gaps.failed"));
            });
          }
        }
      }
      closeModal();
    } catch {
      // error is set in the hook
    } finally {
      setSaving(false);
    }
  };

  // ── Category Modal helpers ──

  const openAddCatModal = useCallback(() => {
    setCatFormName("");
    setCatFormDesc("");
    setCatEditId(null);
    setCatModalMode("add");
    setTimeout(() => catNameInputRef.current?.focus(), 100);
  }, []);

  const openEditCatModal = useCallback((cat: HelpdeskCategory) => {
    setCatFormName(cat.name);
    setCatFormDesc(cat.description || "");
    setCatEditId(cat.id);
    setCatModalMode("edit");
    setTimeout(() => catNameInputRef.current?.focus(), 100);
  }, []);

  const closeCatModal = useCallback(() => {
    setCatModalMode(null);
    setCatEditId(null);
  }, []);

  const handleSaveCat = async () => {
    if (!catFormName.trim()) return;
    setCatSaving(true);
    try {
      if (catModalMode === "edit" && catEditId != null) {
        await updateCategory(catEditId, {
          name: catFormName.trim(),
          description: catFormDesc.trim() || undefined,
        });
        flash(t("helpdesk.categoryUpdated"));
      } else {
        await addCategory(catFormName.trim(), catFormDesc.trim() || undefined);
        flash(t("helpdesk.categoryAdded"));
      }
      closeCatModal();
    } catch {
      // error is set in the hook
    } finally {
      setCatSaving(false);
    }
  };

  // ── FAQ Actions ──

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // Run through the app-level jobs context so the "generating FAQ" status
      // shows in the header and survives navigating between sections.
      await runFaqJob(() => generate());
      // Reload categories: the LLM may have created new ones
      await reloadCategories();
      flash(t("helpdesk.faqsGenerated"));
    } catch (err) {
      // The hook records the error but nothing rendered it, so a failed run
      // used to look like a hang until the next page load.
      // The server's message stays in the console (card gxo6eh1izsvo): it is English and names internals.
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      toast.error(timedOut ? t("helpdesk.generateTimeout") : faqErrorText(err, "generate", t));
    } finally {
      setGenerating(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      await importFromFile(file);
      flash(t("helpdesk.importedFrom").replace("{file}", file.name));
    } catch {
      // error is set in the hook
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleRemove = async (id: number | string) => {
    try {
      await remove(id);
    } catch {
      // error is set in the hook
    }
  };

  const handleToggle = async (id: number | string, enabled: boolean) => {
    try {
      await toggleEnabled(id, enabled);
    } catch {
      // error is set in the hook
    }
  };

  const handleApprove = async (item: HelpdeskItem) => {
    setBusyId(item.id);
    try {
      await update(item.id, { source: "reviewed" });
      toast.success(t("assistant.faq.approved"));
    } catch {
      // error is set in the hook
    } finally {
      setBusyId(null);
    }
  };

  // Discarding deletes the drafted answer; the toast can put it back.
  const handleDiscard = async (item: HelpdeskItem) => {
    try {
      await remove(item.id);
      toast(t("assistant.faq.discarded"), {
        action: {
          label: t("assistant.faq.undo"),
          onClick: () => {
            const categoryName = item.category_id != null ? categoryMap.get(item.category_id)?.name : item.category;
            void add(item.question, item.answer, categoryName || undefined, item.category_id ?? null).catch(() => {});
          },
        },
      });
    } catch {
      // error is set in the hook
    }
  };

  // ── Drag & Drop (dnd-kit) ──

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedItem = filteredItems.find((i) => i.id === active.id);
    const targetItem = filteredItems.find((i) => i.id === over.id);
    if (!draggedItem || !targetItem) return;

    const oldIndex = filteredItems.findIndex((i) => i.id === active.id);
    const newIndex = filteredItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Detect cross-category drag: if the target item has a different category, auto-switch
    const draggedCatId = draggedItem.category_id ?? null;
    const targetCatId = targetItem.category_id ?? null;
    const categoryChanged = draggedCatId !== targetCatId;

    if (categoryChanged) {
      // Update the dragged item's category to match the target's category
      void update(draggedItem.id, {
        category_id: targetCatId,
        category: targetCatId != null ? (categoryMap.get(targetCatId)?.name || undefined) : undefined,
      });
      toast.success(t("toast.movedToCategory").replace("{category}", targetCatId != null ? (categoryMap.get(targetCatId)?.name || "category") : t("filters.uncategorized")));
    } else {
      toast.success(t("toast.orderUpdated"));
    }

    const reorderedFiltered = arrayMove(filteredItems, oldIndex, newIndex);

    if (activeFilter === "all" && !searching) {
      reorder(reorderedFiltered);
    } else {
      const filteredIds = new Set(reorderedFiltered.map((i) => i.id));
      const result: HelpdeskItem[] = [];
      let filteredIdx = 0;
      for (const item of items) {
        if (filteredIds.has(item.id)) {
          result.push(reorderedFiltered[filteredIdx++]);
        } else {
          result.push(item);
        }
      }
      reorder(result);
    }
  };

  const activeDragItem = activeDragId ? filteredItems.find((i) => i.id === activeDragId) : null;
  const combinedError = error || catsError;

  // ── Plan-locked state ──
  if (!hasHelpdeskAccess) {
    return (
      <div className="as-page">
        <PageHead title={t("nav.leaves.assistente.faq")} subtitle={interpolate(t("assistant.faq.subtitle"), { name })} />
        <div className="as-suggest">
          <Empty
            icon={Lock}
            title={t("messages.helpdeskLocked")}
            description={<>{t("messages.helpdeskLockedDesc")}<br /><span className="text-xs text-ink-3">{t("messages.helpdeskAuto")}</span></>}
            action={
              <div className="flex flex-col items-center gap-2">
                <Button onClick={() => navigate("impostazioni/piano")}>
                  {t("messages.helpdeskLockedCta")}
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={refreshing}
                  onClick={async () => {
                    setRefreshing(true);
                    await refreshLicenseTier();
                    setRefreshing(false);
                  }}
                >
                  {refreshing && <Loader2 className="size-3 animate-spin" />}
                  {t("messages.helpdeskRefreshLicense")}
                </Button>
              </div>
            }
          />
        </div>
      </div>
    );
  }

  const chipOptions: { value: string; label: string; count: number }[] = [
    { value: "all", label: t("filters.all"), count: items.length },
    ...categories.map((c) => ({ value: String(c.id), label: c.name, count: categoryCounts.counts.get(c.id) || 0 })),
    ...(categoryCounts.uncategorized > 0
      ? [{ value: "uncategorized", label: t("filters.uncategorized"), count: categoryCounts.uncategorized }]
      : []),
  ];
  const activeCategory = typeof activeFilter === "number" ? categoryMap.get(activeFilter) : undefined;
  const toggleOpen = (id: number | string, open: boolean) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="as-page">
      <FaqIntents onAdd={openAddModal} />
      <PageHead
        title={t("nav.leaves.assistente.faq")}
        subtitle={interpolate(t("assistant.faq.subtitle"), { name })}
        actions={
          <div className="flex flex-wrap items-center gap-2" data-tour="helpdesk-actions">
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {importing ? t("helpdesk.importing") : t("assistant.faq.import")}
            </Button>
            <Button onClick={() => openAddModal()} disabled={saving}>
              <Plus className="size-4" />
              {t("assistant.faq.new")}
            </Button>
          </div>
        }
      />
      <input
        ref={fileRef}
        type="file"
        aria-label={t("buttons.importHelpdesk")}
        accept=".txt,.md"
        className="hidden"
        onChange={handleImport}
      />

      {combinedError && (
        <div role="alert" className="flex max-h-24 items-center gap-2 overflow-y-auto rounded-group bg-tone-red-soft px-4 py-3 text-sm text-tone-red">
          <AlertCircle className="size-4 shrink-0" />
          <span className="flex-1">{combinedError}</span>
          <IconButton
            icon={X}
            size="sm"
            label={t("common.close")}
            onClick={() => {
              setError(null);
              setCatsError(null);
            }}
          />
        </div>
      )}

      {/* Until the list has loaded, "no drafts" would read as an empty FAQ. */}
      {(!loading || items.length > 0) && (
      <Suggestions
        drafts={drafts}
        gaps={openGaps}
        onWriteGap={(gap) => openAddModal(gap.question, gap.key)}
        onDismissGap={(gap) => void handleDismissGap(gap)}
        name={name}
        generating={generating}
        onGenerate={() => setConfirmGenerate(true)}
        onApprove={(item) => void handleApprove(item)}
        onEdit={openEditModal}
        onDiscard={(item) => void handleDiscard(item)}
        busyId={busyId}
      />
      )}

      <div className="as-toolbar" data-tour="helpdesk-categories">
        <ScrollRow className="as-chip-scroll">
          <Chips
            value={String(activeFilter)}
            onValueChange={(v) => setActiveFilter(v === "all" || v === "uncategorized" ? v : Number(v))}
            aria-label={t("helpdesk.categories")}
            options={chipOptions}
          />
        </ScrollRow>
        {activeCategory && (
          <IconButton icon={Pencil} size="sm" label={`${t("common.editCategory")}: ${activeCategory.name}`} onClick={() => openEditCatModal(activeCategory)} />
        )}
        <Button variant="ghost" size="sm" onClick={openAddCatModal}>
          <Plus className="size-3.5" />
          {t("helpdesk.addCategory")}
        </Button>
        <span className="as-spacer" />
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={plural(t, "assistant.faq.searchOne", "assistant.faq.search", items.length)}
        />
      </div>

      <section data-tour="helpdesk-list" aria-label={t("helpdesk.faqTitle")} className="flex min-w-0 flex-col gap-5">
        <Bones name="helpdesk-list" loading={loading || (catsLoading && categories.length === 0 && items.length === 0)}>
          {items.length === 0 ? (
            <div className="as-suggest">
              <Empty
                icon={HelpCircle}
                title={t("messages.noData")}
                description={interpolate(t("helpdesk.addFaqHint"), { name })}
                action={
                  <Button variant="secondary" onClick={() => openAddModal()}>
                    <Plus className="size-4" />
                    {t("helpdesk.addFirstFaq")}
                  </Button>
                }
              />
            </div>
          ) : filteredItems.length === 0 ? (
            <Empty
              icon={HelpCircle}
              title={searching ? t("assistant.faq.noMatch") : t("helpdesk.noFaqsInCategory")}
              action={
                <Button variant="ghost" size="sm" onClick={() => { setActiveFilter("all"); setQuery(""); }}>
                  {t("helpdesk.showAllFaqs")}
                </Button>
              }
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={filteredItems.map((i) => i.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex min-w-0 flex-col gap-5">
                  {groupedItems.map((group) => {
                    const expanded = searching || expandedGroups.has(group.key) || group.items.length <= GROUP_PREVIEW + 1;
                    const visible = expanded ? group.items : group.items.slice(0, GROUP_PREVIEW);
                    const cat = group.categoryId != null ? categoryMap.get(group.categoryId) : undefined;
                    const headId = `as-faq-group-${group.key}`;
                    return (
                      <section key={group.key} className="ark-group" aria-labelledby={headId}>
                        <div className="ark-group-head">
                          <h2 id={headId} className="ark-lbl">{group.categoryName} · {group.items.length}</h2>
                          {cat && (
                            <IconButton icon={Pencil} size="sm" label={`${t("common.editCategory")}: ${cat.name}`} onClick={() => openEditCatModal(cat)} />
                          )}
                        </div>
                        <div className="ark-rows ark-on-fill">
                          {visible.map((item) => (
                            <SortableFaqItem
                              key={item.id}
                              item={item}
                              sortable={!searching}
                              open={openIds.has(item.id)}
                              onOpenChange={(open) => toggleOpen(item.id, open)}
                              onEdit={() => openEditModal(item)}
                              onToggle={(enabled) => handleToggle(item.id, enabled)}
                              onRemove={() => setConfirmDelete(item)}
                            />
                          ))}
                          {!expanded && (
                            <button
                              type="button"
                              className="as-faq-more"
                              onClick={() => setExpandedGroups((prev) => new Set(prev).add(group.key))}
                            >
                              {plural(t, "assistant.faq.moreOne", "assistant.faq.more", group.items.length - GROUP_PREVIEW)}
                            </button>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </SortableContext>

              {/* Drag overlay: a floating copy of the dragged item */}
              <DragOverlay>
                {activeDragItem && (
                  <div className="rounded-group bg-panel p-3 shadow-float">
                    <p className="text-sm font-medium">{activeDragItem.question}</p>
                    <p className="mt-1 line-clamp-1 text-xs text-ink-2">{activeDragItem.answer}</p>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          )}
        </Bones>
      </section>

      <Dialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("helpdesk.generateConfirmTitle")}</DialogTitle>
            <DialogDescription>{named(t, "helpdesk.generateConfirmBody", assistantName(settings, ""))}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmGenerate(false)}>
              {t("common.cancel") || "Annulla"}
            </Button>
            <Button onClick={() => { setConfirmGenerate(false); void handleGenerate(); }}>
              <Sparkles className="size-4" />
              {t("helpdesk.generateConfirmCta")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("assistant.faq.deleteTitle")}</DialogTitle>
            <DialogDescription>
              {named(t, "assistant.faq.deleteBody", assistantName(settings, ""), { question: confirmDelete?.question ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const item = confirmDelete;
                setConfirmDelete(null);
                if (item) void handleRemove(item.id);
              }}
            >
              <Trash2 className="size-4" />
              {t("buttons.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add / Edit FAQ Modal ── */}
      <InlineModal
        open={modalMode !== null}
        onClose={closeModal}
        ariaLabel={modalMode === "edit" ? t("helpdesk.editFaq") : t("helpdesk.addFaq")}
      >
        <form className="flex flex-col gap-5 p-6" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">
                {modalMode === "edit" ? t("helpdesk.editFaq") : t("helpdesk.addFaq")}
              </h2>
              <p className="mt-0.5 text-xs text-ink-2">
                {editingDraft
                  ? t("assistant.faq.editDraftDesc")
                  : modalMode === "edit"
                    ? t("helpdesk.editFaqDesc")
                    : interpolate(t("helpdesk.addFaqDesc"), { name })}
              </p>
            </div>
            <IconButton icon={X} label={t("common.close")} onClick={closeModal} type="button" className="-mr-2 -mt-1" />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-faq-question" className="text-xs text-ink-3">
                {t("helpdesk.questionLabel")}
              </Label>
              <Input
                id="ar-faq-question"
                ref={questionInputRef}
                value={formQ}
                onChange={(e) => setFormQ(e.target.value)}
                placeholder={t("helpdesk.questionPlaceholder")}
                className="h-11"
                aria-describedby={[gapGone && "ar-faq-gap-gone", duplicate && "ar-faq-duplicate"].filter(Boolean).join(" ") || undefined}
              />
              {gapGone && (
                <p id="ar-faq-gap-gone" role="status" className="rounded-group bg-tone-info-soft px-3 py-2 text-[12.5px] text-ink-2">
                  {t("assistant.faq.linkGapGone")}
                </p>
              )}
              {duplicate && (
                <div
                  id="ar-faq-duplicate"
                  ref={duplicateRef}
                  tabIndex={-1}
                  role="status"
                  className="flex flex-col gap-2 rounded-group bg-tone-warn-soft px-3 py-2.5 text-[12.5px] text-ink-2 outline-none"
                >
                  <p>
                    <b className="text-ink">{t("assistant.faq.duplicateTitle")}</b>{" "}
                    {interpolate(t("assistant.faq.duplicateBody"), { question: duplicate.question })}
                  </p>
                  <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => openEditModal(duplicate)}>
                    <Pencil className="size-3.5" />
                    {t("assistant.faq.openExisting")}
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-faq-answer" className="text-xs text-ink-3">
                {t("helpdesk.answerLabel")}
              </Label>
              <Textarea
                id="ar-faq-answer"
                value={formA}
                onChange={(e) => setFormA(e.target.value)}
                placeholder={t("helpdesk.answerPlaceholder")}
                rows={5}
                className="resize-y leading-relaxed"
              />
              <p className="text-[11px] text-ink-3">
                {t("helpdesk.answerHint")}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label id="ar-faq-category-label" className="text-xs text-ink-3">
                {t("helpdesk.categoryLabel")}
              </Label>
              <InlineSelect
                ariaLabelledby="ar-faq-category-label"
                value={formCategoryId}
                onChange={setFormCategoryId}
                placeholder={t("helpdesk.noneUncategorized")}
                options={[
                  { value: "", label: t("helpdesk.noneUncategorized") },
                  ...categories.map((cat) => ({
                    value: String(cat.id),
                    label: cat.name,
                  })),
                ]}
              />
              <p className="text-[11px] text-ink-3">
                {t("helpdesk.categoryHint")}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeModal} className="min-h-11">
              {t("common.cancel")}
            </Button>
            <Button
              type={duplicate ? "button" : "submit"}
              disabled={saving || !formQ.trim() || !formA.trim()}
              className="min-h-11 min-w-[100px]"
              onClick={duplicate ? () => void handleSave({ confirmDuplicate: true }) : undefined}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {modalMode === "edit" ? t("common.saving") : t("common.adding")}
                </>
              ) : duplicate ? (
                <>
                  <CheckCircle2 className="size-4" />
                  {t(modalMode === "edit" ? "assistant.faq.saveAnyway" : "assistant.faq.addAnyway")}
                </>
              ) : modalMode === "edit" ? (
                <>
                  <CheckCircle2 className="size-4" />
                  {editingDraft ? t("assistant.faq.saveAndApprove") : t("common.saveChanges")}
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  {t("buttons.addHelpdesk")}
                </>
              )}
            </Button>
          </div>
        </form>
      </InlineModal>

      {/* ── Add / Edit Category Modal ── */}
      <InlineModal
        open={catModalMode !== null}
        onClose={closeCatModal}
        ariaLabel={catModalMode === "edit" ? t("helpdesk.editCategory") : t("helpdesk.addCategory")}
      >
        <form className="flex flex-col gap-5 p-6" onSubmit={(e) => { e.preventDefault(); void handleSaveCat(); }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">
                {catModalMode === "edit" ? t("helpdesk.editCategory") : t("helpdesk.addCategory")}
              </h2>
              <p className="mt-0.5 text-xs text-ink-2">
                {catModalMode === "edit"
                  ? t("helpdesk.editCategoryDesc")
                  : t("helpdesk.addCategoryDesc")}
              </p>
            </div>
            <IconButton icon={X} label={t("common.close")} onClick={closeCatModal} type="button" className="-mr-2 -mt-1" />
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-category-name" className="text-xs text-ink-3">
                {t("common.name")}
              </Label>
              <Input
                id="ar-category-name"
                ref={catNameInputRef}
                value={catFormName}
                onChange={(e) => setCatFormName(e.target.value)}
                placeholder={t("helpdesk.categoryPlaceholder")}
                className="h-11"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ar-category-description" className="text-xs text-ink-3">
                {t("common.description")}
              </Label>
              <Textarea
                id="ar-category-description"
                value={catFormDesc}
                onChange={(e) => setCatFormDesc(e.target.value)}
                placeholder={t("helpdesk.categoryDescPlaceholder")}
                rows={2}
                className="resize-none"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            {catModalMode === "edit" && catEditId != null && (
              <Button type="button" variant="ghost" className="mr-auto min-h-11 text-tone-red" disabled={catSaving}
                aria-label={t("common.deleteCategory")}
                onClick={async () => {
                  setCatSaving(true);
                  try {
                    await removeCategory(catEditId);
                    if (activeFilter === catEditId) setActiveFilter("all");
                    await reloadItems();
                    flash(t("helpdesk.categoryDeleted"));
                    closeCatModal();
                  } catch { /* hook exposes the error */ }
                  finally { setCatSaving(false); }
                }}>
                <Trash2 className="size-4" />
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={closeCatModal} className="min-h-11">
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={catSaving || !catFormName.trim()}
              className="min-h-11 min-w-[100px]"
            >
              {catSaving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {catModalMode === "edit" ? t("common.saving") : t("common.adding")}
                </>
              ) : catModalMode === "edit" ? (
                <>
                  <CheckCircle2 className="size-4" />
                  {t("common.saveChanges")}
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  {t("helpdesk.addCategory")}
                </>
              )}
            </Button>
          </div>
        </form>
      </InlineModal>
    </div>
  );
}
