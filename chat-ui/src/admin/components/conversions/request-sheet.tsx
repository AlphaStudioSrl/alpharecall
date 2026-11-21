/**
 * The detail sheet of a request (mockup richieste A, used by the board and
 * the list): every field the record has, consent, the chat it came from, the
 * status and the actions (reply, mark done, export, delete).
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SurfacePortal } from "@/components/ui/surface-portal";
import { IconButton, KeyValue, Segmented, Status } from "@/admin/components/shared/kit";
import { NavLink } from "@/admin/lib/nav-context";
import { formatLongDateTime } from "@/admin/lib/datetime";
import { leadConsent, statusLabel } from "@/admin/lib/record-fields";
import type { AppointmentRecord, ContactSubmission, FeedbackRecord, Lead } from "@/admin/hooks/use-conversions-data";
import { ArrowRight, Check, Download, Mail, MessageCircle, MoreHorizontal, Phone, RotateCcw, Trash2, X } from "@/components/icons";
import { KindTag, stageLabel, stageTone, stars } from "./parts";
import { exportItemCSV } from "./exports";
import {
  appointmentChatNote,
  appointmentMinutes,
  appointmentService,
  longWhen,
  receivedLabel,
  statusOptions,
  targetStatus,
  type RequestItem,
} from "./request-model";

type T = (key: string) => string;

const SHOWN_KEYS = new Set([
  "name", "full_name", "email", "phone", "service", "service_type", "servizio", "treatment", "trattamento", "reason",
  "motivo", "topic", "subject", "type", "notes", "note", "message", "messaggio", "comments", "details",
  "interest", "telefono", "conversation_id",
]);

/** Fields the API returned that have no dedicated row: shown as they are, so nothing is hidden. */
function otherFields(source: unknown): [string, string][] {
  if (!source || typeof source !== "object") return [];
  return Object.entries(source as Record<string, unknown>)
    .filter(([key, value]) => !SHOWN_KEYS.has(key) && value !== null && value !== "" && typeof value !== "object")
    .map(([key, value]) => [key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), String(value)]);
}

function headline(item: RequestItem, t: T): string {
  const r = item.record as unknown as Record<string, unknown>;
  switch (item.kind) {
    case "appointment":
      return item.when ? longWhen(item.when) : String((item.record as AppointmentRecord).timeslot || item.name);
    case "quote": {
      const s = item.record as ContactSubmission;
      return s.service_description || s.service_type || s.subject || item.name;
    }
    case "contact":
    case "callback":
      return (item.record as ContactSubmission).subject || item.name;
    case "escalation":
      return String(r.subject || item.name);
    case "feedback":
      return t("conversions.reviewDetail");
    default:
      return item.name;
  }
}

export function RequestSheet({ item, t, botName, onClose, onSetStatus, onDelete }: {
  item: RequestItem | null;
  t: T;
  botName: string;
  onClose: () => void;
  onSetStatus: (item: RequestItem, status: string) => void;
  /** Present only when the record can be deleted (the API has no delete for feedback or escalations). */
  onDelete?: (item: RequestItem) => void;
}) {
  // Where focus goes back on close. The sheet has no Radix Trigger (a card,
  // a row, a Ctrl K result or a notification opens it), so Radix had nothing
  // to return focus to and it fell to <body>. The element focused at open is
  // used, or the record's card or row when that element is gone (a status
  // change moved the card to another column, the palette closed).
  const trigger = useRef<{ key: string; el: Element | null } | null>(null);
  const openKey = item?.key ?? null;
  // A layout effect runs before Radix moves focus into the sheet.
  useLayoutEffect(() => {
    if (openKey) trigger.current = { key: openKey, el: document.activeElement };
  }, [openKey]);
  const restoreFocus = (event: Event) => {
    const from = trigger.current;
    if (!from) return;
    const key = CSS.escape(from.key);
    const card = document.querySelector<HTMLElement>(`[data-request-key="${key}"], [role="row"][data-key="${key}"]`);
    const target = from.el instanceof HTMLElement && from.el.isConnected && from.el !== document.body ? from.el : card;
    if (!target) return;
    event.preventDefault();
    target.focus({ preventScroll: false });
  };
  return (
    <DialogPrimitive.Root open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SurfacePortal portal={DialogPrimitive.Portal}>
        <DialogPrimitive.Overlay className="a3-scrim" />
        <DialogPrimitive.Content className="a3-sheet" aria-describedby={undefined} onCloseAutoFocus={restoreFocus}>
          {item && <SheetBody item={item} t={t} botName={botName} onClose={onClose} onSetStatus={onSetStatus} onDelete={onDelete} />}
        </DialogPrimitive.Content>
      </SurfacePortal>
    </DialogPrimitive.Root>
  );
}

function SheetBody({ item, t, botName, onClose, onSetStatus, onDelete }: {
  item: RequestItem;
  t: T;
  botName: string;
  onClose: () => void;
  onSetStatus: (item: RequestItem, status: string) => void;
  onDelete?: (item: RequestItem) => void;
}) {
  const title = headline(item, t);
  const received = receivedLabel(item.createdAt, t);
  const who = title === item.name ? "" : item.name;
  const rows: [ReactNode, ReactNode][] = [];
  let message: { label: string; text: string } | null = null;
  const notes: { label: string; text: string }[] = [];

  if (item.phone) rows.push([t("conversions.phone"), <a href={`tel:${item.phone}`}>{item.phone}</a>]);
  if (item.email) rows.push([t("conversions.email"), <a href={`mailto:${item.email}`}>{item.email}</a>]);

  switch (item.kind) {
    case "lead": {
      const l = item.record as Lead;
      const consent = leadConsent(l);
      rows.push([t("labels.consent"), <span className={consent ? "ark-c-accent" : "ark-c-mute"}>{consent ? t("badges.consented") : t("badges.notConsented")}</span>]);
      rows.push([t("conversions.board.emailStatus"), statusLabel(t, l.status)]);
      if (l.confirmed_at) rows.push([t("conversions.board.confirmedAt"), formatLongDateTime(l.confirmed_at)]);
      if (l.tags?.length) rows.push([t("conversions.tags"), l.tags.map((tag) => (tag === "newsletter" ? t("conversions.newsletter") : tag)).join(", ")]);
      rows.push(...otherFields(l.extra));
      if (l.notes) notes.push({ label: t("conversions.notes"), text: l.notes });
      break;
    }
    case "appointment": {
      const a = item.record as AppointmentRecord;
      const minutes = appointmentMinutes(a);
      const service = appointmentService(a);
      if (service) rows.push([t("conversions.service"), service]);
      if (!item.when && a.timeslot) rows.push([t("conversions.timeslot"), a.timeslot]);
      if (minutes) rows.push([t("conversions.agenda.duration"), t("conversions.agenda.minutes").replace("{n}", String(minutes))]);
      if (a.tags?.length) rows.push([t("conversions.tags"), a.tags.join(", ")]);
      rows.push(...otherFields(a.user_info));
      const chat = appointmentChatNote(a);
      if (chat) message = { label: t("conversions.agenda.chatNote"), text: chat };
      if (a.notes) notes.push({ label: t("conversions.notes"), text: a.notes });
      break;
    }
    case "feedback": {
      const f = item.record as FeedbackRecord;
      rows.push([t("conversions.rating"), <span className="a3-stars" aria-label={f.rating != null ? `${f.rating}/5` : t("conversions.noRating")}>{stars(f.rating)}</span>]);
      if (f.category) rows.push([t("conversions.category"), f.category]);
      message = { label: t("conversions.comment"), text: f.comment || "–" };
      break;
    }
    case "escalation": {
      const r = item.record as unknown as Record<string, unknown>;
      if (r._channel) rows.push([t("conversions.board.channel"), String(r._channel)]);
      rows.push([t("conversions.board.delivery"), r._delivered_at ? formatLongDateTime(r._delivered_at) : statusLabel(t, item.status)]);
      if (r._error) rows.push([t("conversions.board.deliveryError"), String(r._error)]);
      break;
    }
    default: {
      const s = item.record as ContactSubmission;
      if (s.company) rows.push([t("conversions.company"), s.company]);
      if (s.service_type && s.service_type !== title) rows.push([t("conversions.service"), s.service_type]);
      if (s.budget_range) rows.push([t("conversions.budget"), s.budget_range]);
      if (s.service_description && s.service_description !== title) notes.push({ label: t("conversions.service"), text: s.service_description });
      if (s.message) message = { label: t("conversions.message"), text: s.message };
    }
  }
  if (item.id > 0) rows.push(["ID", String(item.id)]);

  const options = statusOptions(item);
  const done = targetStatus(item, "done");
  const reopen = targetStatus(item, "new");
  const subject = `Re: ${title}`;

  return (
    <>
      <div className="a3-sheet-top">
        <KindTag kind={item.kind} t={t} />
        <Status tone={stageTone(item.kind, item.status)}>{stageLabel(item.kind, item.status, t)}</Status>
        <span className="a3-sp" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={MoreHorizontal} label={t("common.actions")} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="a3-menu">
            <DropdownMenuItem onSelect={() => exportItemCSV(item, t)}>
              <Download aria-hidden="true" />
              {t("conversions.board.exportOne")}
            </DropdownMenuItem>
            {onDelete && (
              <DropdownMenuItem className="a3-danger" onSelect={() => onDelete(item)}>
                <Trash2 aria-hidden="true" />
                {t("conversions.delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DialogPrimitive.Close asChild>
          <IconButton icon={X} label={t("common.close")} />
        </DialogPrimitive.Close>
      </div>

      <div className="a3-sheet-body">
        <div className="a3-sheet-title">
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          <p>{[who, received].filter(Boolean).join(" · ")}</p>
        </div>

        {rows.length > 0 && <KeyValue items={rows} className="a3-kv" />}

        {message && (
          <div className="a3-note">
            <span>{message.label}</span>
            <p>{message.text}</p>
          </div>
        )}
        {notes.map((n) => (
          <div className="a3-note" key={n.label}>
            <span>{n.label}</span>
            <p>{n.text}</p>
          </div>
        ))}

        {item.conversationId && (
          <NavLink className="a3-chatlink" to="inbox/conversazioni" params={{ thread: String(item.conversationId) }} onClick={onClose}>
            <MessageCircle aria-hidden="true" />
            <span>{t("conversions.board.chatWith").replace("{name}", botName)}</span>
            <ArrowRight aria-hidden="true" />
          </NavLink>
        )}

        {options.length > 0 ? (
          <div className="a3-sheet-status">
            <span>{t("labels.status")}</span>
            <Segmented
              size="sm"
              aria-label={t("labels.status")}
              value={item.status}
              onValueChange={(status) => status !== item.status && onSetStatus(item, status)}
              options={options.map((o) => ({ value: o.status, label: stageLabel(item.kind, o.status, t) }))}
            />
          </div>
        ) : item.kind === "lead" ? (
          <p className="a3-faint">{t("conversions.board.leadNoStatus")}</p>
        ) : null}
      </div>

      <div className="a3-sheet-foot">
        {item.column !== "done" && done ? (
          <Button variant="secondary" onClick={() => onSetStatus(item, done)}>
            <Check aria-hidden="true" />
            {t("conversions.board.markDone")}
          </Button>
        ) : item.column === "done" && reopen ? (
          <Button variant="secondary" onClick={() => onSetStatus(item, reopen)}>
            <RotateCcw aria-hidden="true" />
            {t("conversions.board.reopen")}
          </Button>
        ) : null}
        {item.email ? (
          <Button asChild>
            <a href={`mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent(subject)}`}>
              <Mail aria-hidden="true" />
              {t("conversions.board.replyEmail")}
            </a>
          </Button>
        ) : item.phone ? (
          <Button asChild>
            <a href={`tel:${item.phone}`}>
              <Phone aria-hidden="true" />
              {t("conversions.board.call")}
            </a>
          </Button>
        ) : null}
      </div>
    </>
  );
}
