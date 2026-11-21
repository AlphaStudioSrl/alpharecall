import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/admin/app-context";
import { apiFetch } from "@/admin/lib/api";
import { formatNumber } from "@/admin/lib/format";
import { useLiveParams, useNavBadge, useNavigate } from "@/admin/lib/nav-context";
import { formatShortDate, toZonedDateKey } from "@/admin/lib/datetime";
import { downloadFile, exportDate, toCsv } from "@/admin/components/conversions/exports";
import {
  Avatar,
  Chips,
  Empty,
  IconButton,
  KeyValue,
  PageHead,
  SearchField,
  SoftCell,
  SoftRow,
  SoftTable,
  Status,
  type Tone,
} from "@/admin/components/shared/kit";
import { fetchVisitor, fetchVisitorPage, useVisitors, type Visitor } from "@/admin/hooks/use-visitors";
import { EXPORT_MAX_ROWS } from "@/admin/hooks/use-conversions-data";
import { readPages } from "@/admin/lib/paging";
import { Download, Loader2, MessageSquare, MoreHorizontal, ShieldBan, ShieldCheck, Users, Pencil, Trash2, FileText } from "@/components/icons";
import { anonymousVisitorLabel, smartTime, syncParam, tf, useBotName } from "./inbox-format";
import { cachedContactSignals, loadContactSignals, type ContactSignals, type Signal } from "./contact-signals";
import "./inbox.css";
import { personName } from "@/admin/lib/record-fields";

type ContactFilter = "all" | "withContact" | "lead" | "blocked";

const contactOf = (v: Visitor) => v.email || v.unverified_email || null;
const nameOf = (v: Visitor, t: (k: string) => string) =>
  personName(v.display_name) || v.email || v.unverified_email || anonymousVisitorLabel(v.id, t);

/** Lead and Appuntamento badges (contact-signals.ts). Admin only: support agents cannot read Richieste. */
function useContactSignals(enabled: boolean): ContactSignals {
  const [state, setState] = useState<ContactSignals>(() => cachedContactSignals() ?? { signals: new Map(), complete: false, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void loadContactSignals().then((next) => { if (alive) setState(next); });
    return () => { alive = false; };
  }, [enabled]);
  return state;
}

function statusOf(v: Visitor, signals: Map<string, Signal>, t: (k: string) => string): { tone: Tone; label: string } {
  if (v.is_banned) return { tone: "red", label: t("inboxPage.contacts.status.blocked") };
  const signal = signals.get((contactOf(v) || "").toLowerCase());
  if (signal === "appointment") return { tone: "info", label: t("inboxPage.contacts.status.appointment") };
  if (signal === "lead") return { tone: "accent", label: t("inboxPage.contacts.status.lead") };
  if (contactOf(v)) return { tone: "ink", label: t("inboxPage.contacts.status.contact") };
  return { tone: "mute", label: t("inboxPage.contacts.status.visitor") };
}


function download(name: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const COLUMNS = "minmax(0,1.9fr) minmax(0,1fr) minmax(0,.45fr) minmax(0,.8fr) minmax(0,.75fr) 32px";

/** Inbox > Contatti: everyone who wrote to the assistant, with privacy controls. */
export function VisitorList() {
  const { t, isAdmin } = useApp();
  const bot = useBotName();
  const navigate = useNavigate();
  // Ctrl K on a person while Contatti is open opens their card in place.
  const { params, visit, clearParams } = useLiveParams();
  const {
    visitors, loading, loadingMore, failed, search, setSearch, load, loadMore, total, hasMore,
    banVisitor, unbanVisitor, patchVisitor, removeVisitor,
  } = useVisitors();
  // What the box searches for: spaces alone are no search.
  const term = search.trim();
  const { signals, complete: signalsComplete, failed: signalsFailed } = useContactSignals(isAdmin);
  const [filter, setFilter] = useState<ContactFilter>("all");
  useNavBadge("inbox/contatti", total ?? null);

  // Detail sheet (row click, or Ctrl K / the inbox with `visitor=`)
  const [openId, setOpenId] = useState<number | null>(null);
  const [opened, setOpened] = useState<Visitor | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

  // Ban dialog state
  const [banTarget, setBanTarget] = useState<Visitor | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banDialogOpen, setBanDialogOpen] = useState(false);

  // Unban confirmation dialog
  const [unbanTarget, setUnbanTarget] = useState<Visitor | null>(null);
  const [unbanDialogOpen, setUnbanDialogOpen] = useState(false);

  // GDPR: Erase dialog state
  const [eraseTarget, setEraseTarget] = useState<Visitor | null>(null);
  const [eraseDialogOpen, setEraseDialogOpen] = useState(false);
  const [erasing, setErasing] = useState(false);

  // GDPR: Rectify dialog state
  const [rectifyTarget, setRectifyTarget] = useState<Visitor | null>(null);
  const [rectifyDialogOpen, setRectifyDialogOpen] = useState(false);
  const [rectifyName, setRectifyName] = useState("");
  const [rectifyEmail, setRectifyEmail] = useState("");
  const [rectifying, setRectifying] = useState(false);

  // GDPR: per-row action loading (export)
  const [exportingId, setExportingId] = useState<number | null>(null);
  const [exportingAll, setExportingAll] = useState(false);

  // Debounced search. The hook already loads the unfiltered page on mount.
  const searched = useRef("");
  useEffect(() => {
    if (term === searched.current) return;
    const timer = setTimeout(() => {
      searched.current = term;
      void load(term || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [term, load]);

  /* ---------- Detail sheet ---------- */

  const openVisitor = useCallback((visitor: Visitor) => {
    setOpenFailed(false);
    setOpened(visitor);
    setOpenId(visitor.id);
    syncParam("visitor", visitor.id);
  }, []);

  // Deep link: open that person even when they are not on the first page.
  useEffect(() => {
    const id = Number(params.visitor);
    if (!id) return;
    setOpenId(id);
    setOpenFailed(false);
    let alive = true;
    fetchVisitor(id)
      .then((v) => {
        if (!alive) return;
        if (v) setOpened(v);
        else setOpenFailed(true);
      })
      .catch(() => { if (alive) setOpenFailed(true); });
    return () => { alive = false; };
    // `visit`: the same person asked for again after their card was closed.
  }, [params.visitor, visit]);

  // Keep the open card in step with row updates (ban, rectify).
  const current = useMemo(
    () => (openId === null ? null : visitors.find((v) => v.id === openId) ?? (opened?.id === openId ? opened : null)),
    [openId, visitors, opened]
  );

  const closeSheet = useCallback(() => {
    setOpenId(null);
    setOpened(null);
    clearParams(["visitor"]);
  }, [clearParams]);

  /* ---------- Ban / unban ---------- */

  const handleBanConfirm = useCallback(async () => {
    if (!banTarget) return;
    if (await banVisitor(banTarget.id, banReason || undefined)) {
      if (opened?.id === banTarget.id) setOpened({ ...opened, is_banned: true, ban_reason: banReason || undefined });
    }
    setBanDialogOpen(false);
    setBanTarget(null);
    setBanReason("");
  }, [banTarget, banReason, banVisitor, opened]);

  const handleUnbanConfirm = useCallback(async () => {
    if (!unbanTarget) return;
    if (await unbanVisitor(unbanTarget.id)) {
      if (opened?.id === unbanTarget.id) setOpened({ ...opened, is_banned: false, ban_reason: undefined });
    }
    setUnbanDialogOpen(false);
    setUnbanTarget(null);
  }, [unbanTarget, unbanVisitor, opened]);

  const openBanDialog = useCallback((visitor: Visitor) => {
    setBanTarget(visitor);
    setBanReason("");
    setBanDialogOpen(true);
  }, []);

  const openUnbanDialog = useCallback((visitor: Visitor) => {
    setUnbanTarget(visitor);
    setUnbanDialogOpen(true);
  }, []);

  /* ---------- GDPR ---------- */

  const handleGdprExport = useCallback(async (visitor: Visitor) => {
    setExportingId(visitor.id);
    try {
      const data = await apiFetch<unknown>(
        `/gdpr/visitors/by-id/${encodeURIComponent(String(visitor.id))}/export`
      );
      download(`visitor-${visitor.id}-export.json`, JSON.stringify(data, null, 2), "application/json");
      toast.success(t("visitors.gdprExportSuccess") || "Data exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("inboxPage.errors.export"));
    } finally {
      setExportingId(null);
    }
  }, [t]);

  const openEraseDialog = useCallback((visitor: Visitor) => {
    setEraseTarget(visitor);
    setEraseDialogOpen(true);
  }, []);

  const handleGdprErase = useCallback(async () => {
    if (!eraseTarget) return;
    setErasing(true);
    try {
      await apiFetch(
        `/gdpr/visitors/by-id/${encodeURIComponent(String(eraseTarget.id))}/erase`,
        { method: "POST" }
      );
      toast.success(t("visitors.gdprEraseSuccess") || "Visitor erased");
      setEraseDialogOpen(false);
      if (openId === eraseTarget.id) closeSheet();
      removeVisitor(eraseTarget.id);
      setEraseTarget(null);
      // Reload the list from the server as well
      void load(term || undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("inboxPage.errors.erase"));
    } finally {
      setErasing(false);
    }
  }, [eraseTarget, t, load, term, openId, closeSheet, removeVisitor]);

  const openRectifyDialog = useCallback((visitor: Visitor) => {
    setRectifyTarget(visitor);
    setRectifyName(visitor.display_name ?? "");
    setRectifyEmail(visitor.email ?? "");
    setRectifyDialogOpen(true);
  }, []);

  const handleGdprRectify = useCallback(async () => {
    if (!rectifyTarget) return;
    setRectifying(true);
    try {
      await apiFetch(
        `/gdpr/visitors/by-id/${encodeURIComponent(String(rectifyTarget.id))}/rectify`,
        {
          method: "PATCH",
          body: JSON.stringify({
            display_name: rectifyName || undefined,
            email: rectifyEmail || undefined,
          }),
        }
      );
      toast.success(t("visitors.gdprRectifySuccess") || "Data updated");
      const patch = { display_name: rectifyName || rectifyTarget.display_name, email: rectifyEmail || rectifyTarget.email };
      patchVisitor(rectifyTarget.id, patch);
      if (opened?.id === rectifyTarget.id) setOpened({ ...opened, ...patch });
      setRectifyDialogOpen(false);
      setRectifyTarget(null);
      void load(term || undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("inboxPage.errors.rectify"));
    } finally {
      setRectifying(false);
    }
  }, [rectifyTarget, rectifyName, rectifyEmail, t, load, term, patchVisitor, opened]);

  /* ---------- Export (CSV of everyone matching the search) ---------- */

  const exportAll = useCallback(async () => {
    setExportingAll(true);
    try {
      const read = await readPages<Visitor>(
        (offset, limit) => fetchVisitorPage(term || undefined, offset, limit),
        { pageSize: 200, maxRows: EXPORT_MAX_ROWS, pauseMs: 100 },
      );
      // Half a file would pass for the whole one.
      if (read.failed) throw new Error(t("inboxPage.contacts.exportFailed"));
      const rows = read.rows;
      const head = ["name", "email", "unverified", "since", "lastSeen", "chats", "consent", "blocked"]
        .map((k) => t(`inboxPage.contacts.csv.${k}`));
      const yes = t("inboxPage.contacts.yes");
      const no = t("inboxPage.contacts.no");
      const lines = rows.map((v) => [
        personName(v.display_name), v.email || "", v.unverified_email || "", exportDate(v.created_at),
        exportDate(v.last_seen_at), v.thread_count ?? "",
        v.notification_consent ? yes : no, v.is_banned ? yes : no,
      ]);
      // The same file as Richieste's exports: ";" for Italian Excel, local dd/mm/yyyy HH:MM, BOM.
      downloadFile(toCsv(head, lines), `contatti-${toZonedDateKey()}.csv`, "text/csv;charset=utf-8");
      if (read.capped) {
        toast.warning(tf(t, "conversions.exportCapped", {
          count: formatNumber(rows.length),
          total: formatNumber(read.total ?? rows.length),
        }));
      } else {
        toast.success(tf(t, rows.length === 1 ? "inboxPage.contacts.exportDoneOne" : "inboxPage.contacts.exportDone", { n: rows.length }));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("inboxPage.contacts.exportFailed"));
    } finally {
      setExportingAll(false);
    }
  }, [term, t]);

  /* ---------- Filters ---------- */

  const complete = total !== null && visitors.length >= total;
  const counts = useMemo(() => ({
    withContact: visitors.filter((v) => contactOf(v)).length,
    lead: visitors.filter((v) => signals.has((contactOf(v) || "").toLowerCase())).length,
    blocked: visitors.filter((v) => v.is_banned).length,
  }), [visitors, signals]);
  const shown = useMemo(() => visitors.filter((v) => {
    if (filter === "withContact") return !!contactOf(v);
    if (filter === "lead") return signals.has((contactOf(v) || "").toLowerCase());
    if (filter === "blocked") return v.is_banned;
    return true;
  }), [visitors, filter, signals]);

  const filterOptions: Array<{ value: ContactFilter; label: string; count?: number }> = [
    { value: "all", label: t("inboxPage.contacts.filters.all"), count: total ?? undefined },
    { value: "withContact", label: t("inboxPage.contacts.filters.withContact"), count: complete ? counts.withContact : undefined },
    ...(isAdmin && signals.size ? [{ value: "lead" as const, label: t("inboxPage.contacts.filters.lead"), count: complete && signalsComplete ? counts.lead : undefined }] : []),
    { value: "blocked", label: t("inboxPage.contacts.filters.blocked"), count: complete ? counts.blocked : undefined },
  ];

  const subtitle = total === null
    ? undefined
    : complete && !term
      ? tf(t, total === 1 ? "inboxPage.contacts.subtitleOne" : "inboxPage.contacts.subtitle", { total, bot, withContact: counts.withContact })
      : tf(t, total === 1 ? "inboxPage.contacts.subtitleShortOne" : "inboxPage.contacts.subtitleShort", { total, bot });

  const rowMenu = (visitor: Visitor) => (
    // The row opens the card on click and Enter: keep the menu's own clicks and keys to itself.
    <div className="ar-contacts-menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={exportingId === visitor.id ? Loader2 : MoreHorizontal}
            size="sm"
            label={tf(t, "inboxPage.contacts.rowMenu", { name: nameOf(visitor, t) })}
            disabled={exportingId === visitor.id}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => openVisitor(visitor)}>
            <Users className="h-4 w-4 mr-2" />
            {t("inboxPage.contacts.open")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate("inbox/conversazioni", { params: { visitor: String(visitor.id) } })}>
            <MessageSquare className="h-4 w-4 mr-2" />
            {t("inboxPage.contacts.viewChats")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {visitor.is_banned ? (
            <DropdownMenuItem onClick={() => openUnbanDialog(visitor)}>
              <ShieldCheck className="h-4 w-4 mr-2" />
              {t("visitors.unban") || "Unban"}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => openBanDialog(visitor)}>
              <ShieldBan className="h-4 w-4 mr-2" />
              {t("visitors.ban") || "Ban"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => void handleGdprExport(visitor)}>
            <FileText className="h-4 w-4 mr-2" />
            {t("visitors.gdprExport") || "Export data (GDPR)"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openRectifyDialog(visitor)}>
            <Pencil className="h-4 w-4 mr-2" />
            {t("visitors.gdprRectify") || "Rectify data (GDPR)"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => openEraseDialog(visitor)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t("visitors.gdprErase") || "Erase data (GDPR)"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="ar-contacts">
      <PageHead
        title={t("inboxPage.contacts.title")}
        subtitle={subtitle}
        actions={
          <Button variant="secondary" onClick={() => void exportAll()} disabled={exportingAll || !total}>
            {exportingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {t("inboxPage.contacts.export")}
          </Button>
        }
      />

      <div className="ar-contacts-tools">
        <Chips<ContactFilter>
          value={filter}
          onValueChange={setFilter}
          aria-label={t("inboxPage.contacts.filters.label")}
          options={filterOptions}
        />
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t("inboxPage.contacts.search")}
          className="ar-contacts-search"
        />
      </div>
      {filter !== "all" && !complete && total !== null && (
        <p className="ar-contacts-note">{tf(t, "inboxPage.contacts.partial", { shown: visitors.length, total })}</p>
      )}
      {isAdmin && (signals.size > 0 || signalsFailed) && !signalsComplete && (
        <p className="ar-contacts-note">{t(signalsFailed ? "inboxPage.contacts.signalsFailed" : "inboxPage.contacts.signalsPartial")}</p>
      )}

      {loading && visitors.length === 0 ? (
        <div className="ar-contacts-skeleton" role="status" aria-label={t("messages.loading") || "Loading"}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="ar-contacts-skel-row">
              <span className="ar-skel ar-skel-av" />
              <span className="ar-skel-lines">
                <span className="ar-skel" style={{ width: `${30 + ((i * 11) % 20)}%` }} />
                <span className="ar-skel" style={{ width: `${20 + ((i * 7) % 15)}%` }} />
              </span>
            </div>
          ))}
        </div>
      ) : failed ? (
        <Empty
          icon={Users}
          title={t("inboxPage.contacts.error")}
          action={<Button variant="secondary" onClick={() => void load(term || undefined)}>{t("inboxPage.contacts.retry")}</Button>}
        />
      ) : shown.length === 0 ? (
        term || filter !== "all"
          ? <Empty icon={Users} title={t("inboxPage.contacts.emptyFilteredTitle")} description={t("inboxPage.contacts.emptyFilteredBody")} />
          : <Empty icon={Users} title={t("inboxPage.contacts.emptyTitle")} description={tf(t, "inboxPage.contacts.emptyBody", { bot })} />
      ) : (
        <SoftTable columns={COLUMNS} label={t("inboxPage.contacts.title")} className="ar-contacts-table">
          <SoftRow head>
            <SoftCell head>{t("inboxPage.contacts.cols.person")}</SoftCell>
            <SoftCell head>{t("inboxPage.contacts.cols.status")}</SoftCell>
            <SoftCell head className="ar-col-chats">{t("inboxPage.contacts.cols.chats")}</SoftCell>
            <SoftCell head className="ar-col-seen">{t("visitors.lastSeen")}</SoftCell>
            <SoftCell head className="ar-col-consent">{t("inboxPage.contacts.cols.consent")}</SoftCell>
            <SoftCell head><span className="sr-only">{t("common.actions")}</span></SoftCell>
          </SoftRow>
          {shown.map((visitor) => {
            const status = statusOf(visitor, signals, t);
            const contact = contactOf(visitor);
            return (
              <SoftRow key={visitor.id} active={openId === visitor.id} onClick={() => openVisitor(visitor)}>
                <div role="cell" className="ark-td ark-who">
                  <Avatar name={visitor.display_name || contact || t("common.visitor").charAt(0)} src={visitor.avatar_url} size="s" />
                  <span>
                    <b>{nameOf(visitor, t)}</b>
                    {!contact
                      ? <small className="ar-faint">{t("inboxPage.noContact")}</small>
                      : contact !== nameOf(visitor, t) && <small>{contact}</small>}
                  </span>
                </div>
                <SoftCell><Status tone={status.tone}>{status.label}</Status></SoftCell>
                <SoftCell className="ar-col-chats ar-muted">{visitor.thread_count ?? 0}</SoftCell>
                <SoftCell className="ar-col-seen ar-muted">{visitor.last_seen_at ? smartTime(visitor.last_seen_at, t) : ""}</SoftCell>
                <SoftCell className="ar-col-consent">
                  {visitor.notification_consent
                    ? <span className="ark-c-accent">{t("inboxPage.contacts.yes")}</span>
                    : <span className="ar-faint">{t("inboxPage.contacts.no")}</span>}
                </SoftCell>
                <SoftCell>{rowMenu(visitor)}</SoftCell>
              </SoftRow>
            );
          })}
        </SoftTable>
      )}

      {hasMore && visitors.length > 0 && total !== null && (
        <div className="ar-contacts-more">
          <Button variant="secondary" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {tf(t, "inboxPage.contacts.loadMore", { shown: visitors.length, total })}
          </Button>
        </div>
      )}

      {/* Person card */}
      <Sheet open={openId !== null} onOpenChange={(o) => { if (!o) closeSheet(); }}>
        <SheetContent side="right" className="ar-contact-sheet">
          {current ? (
            <VisitorCard
              visitor={current}
              status={statusOf(current, signals, t)}
              exporting={exportingId === current.id}
              onViewChats={() => navigate("inbox/conversazioni", { params: { visitor: String(current.id) } })}
              onBan={() => openBanDialog(current)}
              onUnban={() => openUnbanDialog(current)}
              onExport={() => void handleGdprExport(current)}
              onRectify={() => openRectifyDialog(current)}
              onErase={() => openEraseDialog(current)}
            />
          ) : (
            <>
              <SheetTitle className="sr-only">{t("inboxPage.contacts.title")}</SheetTitle>
              <SheetDescription className="sr-only">{t("inboxPage.contacts.title")}</SheetDescription>
              {openFailed
                ? <Empty icon={Users} title={t("inboxPage.contacts.detail.notFound")} />
                : <div className="ar-contact-loading" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-label={t("messages.loading")} /></div>}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Dialogs mount only while open: SurfacePortal creates its layer on
          mount, and a layer that exists when the card opens is aria-hidden
          by the sheet, which hides the dialog from assistive tech. */}
      {/* Ban Dialog */}
      {banDialogOpen && (
        <Dialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("visitors.banDialogTitle") || "Ban visitor"}
              </DialogTitle>
              <DialogDescription>
                {t("visitors.banDialogDesc") ||
                  "This visitor will be blocked from starting new conversations."}
              </DialogDescription>
            </DialogHeader>
            {banTarget && (
              <div className="text-sm text-muted-foreground">
                {nameOf(banTarget, t)}
              </div>
            )}
            <Textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder={t("visitors.banReasonPlaceholder") || "Reason (optional)"}
              aria-label={t("visitors.banReason")}
              rows={3}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t("common.cancel") || "Cancel"}</Button>
              </DialogClose>
              <Button
                variant="destructive"
                onClick={() => void handleBanConfirm()}
              >
                {t("visitors.confirmBan") || "Ban visitor"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Unban Dialog */}
      {unbanDialogOpen && (
        <Dialog open={unbanDialogOpen} onOpenChange={setUnbanDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("visitors.unbanDialogTitle") || "Unban visitor"}
              </DialogTitle>
              <DialogDescription>
                {t("visitors.unbanDialogDesc") ||
                  "This visitor will be able to start conversations again."}
              </DialogDescription>
            </DialogHeader>
            {unbanTarget && (
              <div className="text-sm text-muted-foreground">
                {nameOf(unbanTarget, t)}
              </div>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t("common.cancel") || "Cancel"}</Button>
              </DialogClose>
              <Button onClick={() => void handleUnbanConfirm()}>
                {t("visitors.confirmUnban") || "Unban visitor"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* GDPR Erase Dialog */}
      {eraseDialogOpen && (
        <Dialog open={eraseDialogOpen} onOpenChange={setEraseDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("visitors.gdprEraseConfirmTitle") || "Confirm erasure"}
              </DialogTitle>
              <DialogDescription>
                {t("visitors.gdprEraseConfirmBody") ||
                  "You are about to permanently erase all data for this visitor. This action cannot be undone. Continue?"}
              </DialogDescription>
            </DialogHeader>
            {eraseTarget && (
              <div className="text-sm text-muted-foreground">
                {nameOf(eraseTarget, t)}
              </div>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={erasing}>
                  {t("visitors.gdprCancel") || "Cancel"}
                </Button>
              </DialogClose>
              <Button
                variant="destructive"
                disabled={erasing}
                onClick={() => void handleGdprErase()}
              >
                {erasing ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" />{t("common.saving") || "..."}</>
                ) : (
                  t("visitors.gdprEraseConfirm") || "Confirm erasure"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* GDPR Rectify Dialog */}
      {rectifyDialogOpen && (
        <Dialog open={rectifyDialogOpen} onOpenChange={setRectifyDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t("visitors.gdprRectifyTitle") || "Rectify visitor data"}
              </DialogTitle>
              <DialogDescription>
                {t("visitors.gdprRectify") || "Rectify data (GDPR)"}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div>
                <label htmlFor="ar-rectify-name" className="text-xs font-medium text-muted-foreground block mb-1">
                  {t("common.name") || "Name"}
                </label>
                <Input
                  id="ar-rectify-name"
                  value={rectifyName}
                  onChange={(e) => setRectifyName(e.target.value)}
                  placeholder={t("common.name") || "Name"}
                />
              </div>
              <div>
                <label htmlFor="ar-rectify-email" className="text-xs font-medium text-muted-foreground block mb-1">
                  {t("labels.email") || "Email"}
                </label>
                <Input
                  id="ar-rectify-email"
                  type="email"
                  value={rectifyEmail}
                  onChange={(e) => setRectifyEmail(e.target.value)}
                  placeholder={t("labels.email") || "Email"}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={rectifying}>
                  {t("common.cancel") || "Cancel"}
                </Button>
              </DialogClose>
              <Button
                disabled={rectifying}
                onClick={() => void handleGdprRectify()}
              >
                {rectifying ? (
                  <><Loader2 className="h-3 w-3 animate-spin mr-1" />{t("common.saving") || "..."}</>
                ) : (
                  t("common.save") || "Save"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface VisitorCardProps {
  visitor: Visitor;
  status: { tone: Tone; label: string };
  exporting: boolean;
  onViewChats: () => void;
  onBan: () => void;
  onUnban: () => void;
  onExport: () => void;
  onRectify: () => void;
  onErase: () => void;
}

/** The person card in the sheet: who, the facts the directory has, and the GDPR actions. */
function VisitorCard({ visitor, status, exporting, onViewChats, onBan, onUnban, onExport, onRectify, onErase }: VisitorCardProps) {
  const { t } = useApp();
  const contact = contactOf(visitor);
  const name = nameOf(visitor, t);
  const facts: Array<[React.ReactNode, React.ReactNode]> = [
    [t("labels.email"), visitor.email || <span className="ar-faint">{t("inboxPage.noContact")}</span>],
  ];
  if (visitor.unverified_email) facts.push([t("inboxPage.context.unverified"), visitor.unverified_email]);
  facts.push([t("inboxPage.contacts.detail.firstSeen"), formatShortDate(visitor.created_at)]);
  if (visitor.last_seen_at) facts.push([t("inboxPage.contacts.detail.lastSeen"), smartTime(visitor.last_seen_at, t)]);
  facts.push([t("inboxPage.contacts.detail.chats"), String(visitor.thread_count ?? 0)]);
  if (visitor.wp_user_id) facts.push([t("inboxPage.contacts.detail.wp"), t("inboxPage.context.wpLinked")]);
  if (visitor.is_banned && visitor.ban_reason) facts.push([t("inboxPage.contacts.detail.banReason"), visitor.ban_reason]);
  if (visitor.notes) facts.push([t("inboxPage.contacts.detail.notes"), visitor.notes]);

  return (
    <div className="ar-contact-card">
      <div className="ar-contact-who">
        <Avatar name={visitor.display_name || contact || t("common.visitor").charAt(0)} src={visitor.avatar_url} size="l" />
        <div>
          <SheetTitle className="ar-contact-name">{name}</SheetTitle>
          <SheetDescription className="ar-contact-line">
            <Status tone={status.tone}>{status.label}</Status>
          </SheetDescription>
        </div>
      </div>

      <div className="ar-contact-actions">
        <Button onClick={onViewChats}>
          <MessageSquare className="h-4 w-4" />
          {t("inboxPage.contacts.viewChats")}
        </Button>
        {visitor.is_banned ? (
          <Button variant="secondary" onClick={onUnban}>
            <ShieldCheck className="h-4 w-4" />
            {t("inboxPage.contacts.detail.unblock")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onBan}>
            <ShieldBan className="h-4 w-4" />
            {t("inboxPage.contacts.detail.block")}
          </Button>
        )}
      </div>

      <KeyValue items={facts} className="ar-contact-kv" />

      <section className="ar-contact-privacy ark-on-fill" aria-labelledby="ar-contact-privacy">
        <h3 id="ar-contact-privacy">{t("inboxPage.contacts.detail.privacy")}</h3>
        <p>
          {visitor.notification_consent ? t("inboxPage.contacts.detail.consentYes") : t("inboxPage.contacts.detail.consentNo")}.{" "}
          {t("inboxPage.contacts.detail.privacyBody")}
        </p>
        <div className="ar-contact-privacy-actions">
          <Button variant="secondary" size="sm" onClick={onExport} disabled={exporting}>
            {exporting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("inboxPage.contacts.detail.export")}
          </Button>
          <Button variant="secondary" size="sm" onClick={onRectify}>{t("inboxPage.contacts.detail.rectify")}</Button>
          <Button variant="destructive" size="sm" onClick={onErase}>{t("inboxPage.contacts.detail.erase")}</Button>
        </div>
      </section>
    </div>
  );
}
