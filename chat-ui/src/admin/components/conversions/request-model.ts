/**
 * One shape for every record Richieste shows.
 *
 * The API keeps four collections (leads, appointments, contact submissions
 * with escalations merged in, feedback), each with its own status words. The
 * board and the list need one card per record, a type, and a column, so this
 * file maps each record onto a `RequestItem` and each status onto Nuove /
 * In corso / Fatte. Column changes are written back as that collection's own
 * status; nothing here invents a field the API does not store.
 */
import type {
  AppointmentRecord,
  CollectionCounts,
  ContactSubmission,
  ConversionCollection,
  FeedbackRecord,
  Lead,
} from "@/admin/hooks/use-conversions-data";
import type { Tone } from "@/admin/components/shared/kit";
import { getLocale, getTimezone, parseApiDate, toZonedDateKey } from "@/admin/lib/datetime";
import {
  appointmentEmail,
  appointmentName,
  appointmentPhone,
  appointmentTime,
  leadConsent,
  leadName,
  personName,
} from "@/admin/lib/record-fields";
import { Calendar, FileText, Mail, MessageSquare, Phone, Star, User, type LucideIcon } from "@/components/icons";

type T = (key: string) => string;

/* ---------- Kinds ---------- */

export type RequestKind = "lead" | "appointment" | "quote" | "callback" | "contact" | "escalation" | "feedback";

export const KIND_ORDER: RequestKind[] = ["lead", "appointment", "quote", "callback", "contact", "escalation", "feedback"];

export interface KindInfo {
  icon: LucideIcon;
  tone: Tone;
  /** Singular, on the card tag. */
  label: string;
  /** Plural, on the filter chip. */
  plural: string;
  collection: ConversionCollection;
}

const KIND_META: Record<RequestKind, { icon: LucideIcon; tone: Tone; label: string; plural: string; collection: ConversionCollection }> = {
  lead: { icon: Star, tone: "accent", label: "conversions.board.kind.lead", plural: "conversions.leads", collection: "leads" },
  appointment: { icon: Calendar, tone: "info", label: "conversions.appointment", plural: "conversions.appointments", collection: "appointments" },
  quote: { icon: FileText, tone: "accent", label: "conversions.typeQuote", plural: "conversions.quotes", collection: "submissions" },
  callback: { icon: Phone, tone: "violet", label: "conversions.typeCallback", plural: "conversions.callbacks", collection: "submissions" },
  contact: { icon: Mail, tone: "mute", label: "conversions.typeContact", plural: "conversions.board.kind.contacts", collection: "submissions" },
  escalation: { icon: User, tone: "warn", label: "conversions.typeEscalation", plural: "conversions.escalations", collection: "submissions" },
  feedback: { icon: MessageSquare, tone: "mute", label: "conversions.feedback", plural: "conversions.feedback", collection: "feedback" },
};

export function kindInfo(kind: RequestKind, t: T): KindInfo {
  const meta = KIND_META[kind];
  return { ...meta, label: t(meta.label), plural: t(meta.plural) };
}

export function kindCollection(kind: RequestKind): ConversionCollection {
  return KIND_META[kind].collection;
}

/** The submission `type` column: inquiry and contact are both a contact request. */
export function submissionKind(type: string): RequestKind {
  if (type === "quote") return "quote";
  if (type === "callback") return "callback";
  if (type === "escalation") return "escalation";
  return "contact";
}

/* ---------- Columns and statuses ---------- */

export type Column = "new" | "doing" | "done";
export const COLUMNS: Column[] = ["new", "doing", "done"];

/** A status a record can be set to, and the column it lands in. */
export interface StatusOption {
  status: string;
  column: Column;
}

/**
 * The status written when a card is dropped in a column, per collection.
 * `null` means the record has no status for that column (the drop is refused).
 */
export function targetStatus(item: RequestItem, column: Column): string | null {
  switch (item.kind) {
    case "lead":
      // A lead's status is its email opt-in state (pending/captured/confirmed).
      // It is not a follow-up stage, so it is never moved.
      return null;
    case "appointment":
      return { new: "scheduled", doing: "confirmed", done: "completed" }[column];
    case "feedback":
      return { new: "received", doing: "reviewed", done: "published" }[column];
    case "escalation": {
      if (column === "doing") return null;
      if (column === "done") return "resolved";
      // Reopening restores the delivery state the record had before.
      const delivered = (item.record as unknown as Record<string, unknown>)._delivered_at;
      return delivered ? "delivered" : "pending";
    }
    default:
      return { new: "pending", doing: "read", done: "replied" }[column];
  }
}

/** Every status the record can take, for the keyboard status menu and the sheet. */
export function statusOptions(item: RequestItem): StatusOption[] {
  switch (item.kind) {
    case "lead":
      return [];
    case "appointment":
      return [
        { status: "scheduled", column: "new" },
        { status: "confirmed", column: "doing" },
        { status: "completed", column: "done" },
        { status: "cancelled", column: "done" },
      ];
    case "escalation": {
      const reopen = targetStatus(item, "new")!;
      return [
        { status: item.column === "new" ? item.status : reopen, column: "new" },
        { status: "resolved", column: "done" },
      ];
    }
    default:
      return COLUMNS.map((column) => ({ status: targetStatus(item, column)!, column }));
  }
}

/**
 * The board column a record sits in, or `null` when it is not part of the
 * follow-up workflow at all: a lead's status is its email opt-in, so leads
 * live in their own "Contatti raccolti" strip and never count as waiting.
 */
export function columnFor(kind: RequestKind, status: string): Column | null {
  const s = (status || "").toLowerCase();
  switch (kind) {
    case "lead":
      return null;
    case "appointment":
      if (s === "confirmed") return "doing";
      if (s === "completed" || s === "cancelled") return "done";
      return "new";
    case "feedback":
      if (s === "reviewed") return "doing";
      if (s === "published") return "done";
      return "new";
    case "escalation":
      return s === "resolved" || s === "closed" ? "done" : "new";
    default:
      if (s === "read") return "doing";
      if (s === "replied") return "done";
      return "new";
  }
}

/* ---------- Whole-collection counts ---------- */

export type ColumnTotals = Record<Column, number>;

/** The kind a counted row stands for (submissions carry their type, escalations "escalation"). */
function countedKind(collection: ConversionCollection, type: string | undefined): RequestKind {
  if (collection === "leads") return "lead";
  if (collection === "appointments") return "appointment";
  if (collection === "feedback") return "feedback";
  return submissionKind(type || "");
}

/**
 * How many records of each kind there are, over the whole collections (the
 * API's `with_counts`), not the pages loaded: "Contatti 100" while 290 exist
 * was the loaded page. A kind is missing when its collection has no counts.
 */
export function kindTotals(counts: CollectionCounts): Partial<Record<RequestKind, number>> {
  const totals: Partial<Record<RequestKind, number>> = {};
  for (const collection of Object.keys(counts) as ConversionCollection[]) {
    const rows = counts[collection];
    if (!rows) continue;
    if (collection === "submissions") {
      for (const k of ["quote", "callback", "contact", "escalation"] as RequestKind[]) totals[k] = 0;
    } else {
      totals[countedKind(collection, undefined)] = 0;
    }
    for (const row of rows) {
      const kind = countedKind(collection, row.type);
      totals[kind] = (totals[kind] ?? 0) + row.count;
    }
  }
  return totals;
}

/**
 * The size of each board column for `kinds`, over the whole collections, or
 * null when one of them has no counts (an older API): the caller then falls
 * back to the loaded cards.
 */
export function columnTotals(counts: CollectionCounts, kinds: RequestKind[]): ColumnTotals | null {
  const totals: ColumnTotals = { new: 0, doing: 0, done: 0 };
  const wanted = new Set(kinds);
  for (const collection of new Set(kinds.map(kindCollection))) {
    if (collection === "leads") continue;
    const rows = counts[collection];
    if (!rows) return null;
    for (const row of rows) {
      const kind = countedKind(collection, row.type);
      if (!wanted.has(kind)) continue;
      const column = columnFor(kind, row.status);
      if (column) totals[column] += row.count;
    }
  }
  return totals;
}

/* ---------- "Nuove": one definition for Oggi and Richieste ---------- */

/** The kinds the enabled collections produce; leads are never waiting (see columnFor). */
export function waitingKinds(collections: ConversionCollection[]): RequestKind[] {
  return KIND_ORDER.filter((k) => k !== "lead" && collections.includes(kindCollection(k)));
}

/**
 * How many records of `kinds` sit in the board's Nuove column over the whole
 * collections: requests nobody has opened, escalations not resolved, feedback
 * not read, bookings not confirmed. Richieste's column and sidebar badge and
 * Oggi's rows all count this, so "richieste nuove" is one number everywhere
 * (Oggi read only pending contact requests: 290 there, 403 in Richieste).
 * Null when a collection has no counts (an older API).
 */
export function newTotal(counts: CollectionCounts, kinds: RequestKind[]): number | null {
  return columnTotals(counts, kinds)?.new ?? null;
}

/** The status a record has before anyone touches it, per kind (what the API stores by default). */
export function defaultStatus(kind: RequestKind): string {
  if (kind === "appointment") return "scheduled";
  if (kind === "feedback") return "received";
  return "pending";
}

/** Tone of a status word, for the dot and the sheet tag. */
export function statusTone(status: string): Tone {
  switch (status) {
    case "scheduled":
    case "pending":
    case "received":
      return "warn";
    case "confirmed":
    case "replied":
    case "published":
    case "resolved":
    case "delivered":
    case "captured":
      return "accent";
    case "read":
    case "reviewed":
      return "info";
    case "cancelled":
    case "failed":
      return "red";
    default:
      return "mute";
  }
}

/* ---------- Items ---------- */

export type RequestRecord = Lead | AppointmentRecord | ContactSubmission | FeedbackRecord;

export interface RequestItem {
  /** Unique across collections: `${collection}:${id}`. */
  key: string;
  kind: RequestKind;
  collection: ConversionCollection;
  /** The record id (negative for escalations, as use-conversions-data stores them). */
  id: number;
  name: string;
  /** The person behind it, when the record names one (escalations and anonymous feedback do not). */
  person: string | null;
  /** One line under the name: the service, the message, the comment. */
  detail: string;
  email: string;
  phone: string;
  createdAt: string;
  status: string;
  /** `null`: outside the workflow (see columnFor). */
  column: Column | null;
  /** chat_threads.id of the conversation it came from, when the API links one. */
  conversationId: number | null;
  /** Appointments: the booked moment, when it parses. */
  when: Date | null;
  rating: number | null;
  /** Lowercased text the search box matches against. */
  haystack: string;
  record: RequestRecord;
}

const str = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value).trim() : "";

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstOf(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = str(source[key]);
    if (value) return value;
  }
  return "";
}

const SERVICE_KEYS = ["service", "service_type", "servizio", "treatment", "trattamento", "reason", "motivo", "topic", "subject", "type"];
const NOTE_KEYS = ["notes", "note", "message", "messaggio", "comments", "details"];

/** "Prima visita": what the appointment is for, when the booking said. */
export function appointmentService(a: AppointmentRecord): string {
  return firstOf(obj(a.user_info), SERVICE_KEYS);
}

/** What the visitor wrote in chat about the booking. */
export function appointmentChatNote(a: AppointmentRecord): string {
  return firstOf(obj(a.user_info), NOTE_KEYS);
}

/** The booked moment, or null when the timeslot is free text ("martedì pomeriggio"). */
export function appointmentDate(a: AppointmentRecord): Date | null {
  const d = parseApiDate(appointmentTime(a));
  // Garbage parses land in the distant past; treat them as free text.
  return d && d.getFullYear() >= 2020 ? d : null;
}

/** Minutes between starts_at and ends_at, when both are known. */
export function appointmentMinutes(a: AppointmentRecord): number | null {
  const start = parseApiDate(a.starts_at);
  const end = parseApiDate(a.ends_at);
  if (!start || !end) return null;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return minutes > 0 ? minutes : null;
}

function leadDetail(l: Lead, t: T, named: boolean): string {
  const extra = obj(l.extra);
  const interest = firstOf(extra, ["interest", "service", "servizio", "message", "notes", "subject"]);
  if (interest) return interest;
  if (named) return l.email;
  if (l.tags?.includes("newsletter")) return t("conversions.board.newsletterSignup");
  return t("conversions.board.leftEmail");
}

export function buildItems(
  data: { leads: Lead[]; appointments: AppointmentRecord[]; submissions: ContactSubmission[]; feedback: FeedbackRecord[] },
  t: T,
): RequestItem[] {
  const items: RequestItem[] = [];
  const push = (item: Omit<RequestItem, "haystack" | "column">, extra: string[] = []) => {
    const column = columnFor(item.kind, item.status);
    const haystack = [item.name, item.detail, item.email, item.phone, ...extra].join(" ").toLowerCase();
    items.push({ ...item, column, haystack });
  };

  for (const l of data.leads) {
    const name = leadName(l);
    push({
      key: `leads:${l.id}`, kind: "lead", collection: "leads", id: l.id,
      name: name || l.email, person: name || l.email || null, detail: leadDetail(l, t, !!name), email: l.email || "", phone: firstOf(obj(l.extra), ["phone", "telefono"]),
      createdAt: l.created_at, status: l.status, conversationId: numeric(obj(l.extra).conversation_id),
      when: null, rating: null, record: l,
    }, [...(l.tags || []), l.notes || ""]);
  }

  for (const a of data.appointments) {
    const when = appointmentDate(a);
    const service = appointmentService(a);
    const slot = when ? shortWhen(when) : str(a.timeslot);
    push({
      key: `appointments:${a.id}`, kind: "appointment", collection: "appointments", id: a.id,
      name: appointmentName(a) || appointmentEmail(a) || t("conversions.board.visitor"),
      person: appointmentName(a) || appointmentEmail(a) || null,
      detail: [service, slot].filter(Boolean).join(" · "),
      email: appointmentEmail(a), phone: appointmentPhone(a),
      createdAt: a.created_at, status: a.status || "scheduled", conversationId: null,
      when, rating: null, record: a,
    }, [a.notes || "", appointmentChatNote(a), ...(a.tags || [])]);
  }

  for (const s of data.submissions) {
    const kind = submissionKind(s.type);
    const sName = personName(s.name);
    const raw = s as unknown as Record<string, unknown>;
    const detail = kind === "escalation"
      ? deliveryLabel(s.status, t)
      : kind === "quote"
        ? s.service_description || s.service_type || s.subject || s.message || ""
        : s.subject || s.message || s.service_type || "";
    push({
      key: `submissions:${s.id}`, kind, collection: "submissions", id: s.id,
      name: (kind === "escalation" ? s.name : sName) || s.email || t("conversions.board.visitor"),
      person: kind === "escalation" ? null : sName || s.email || null,
      detail: oneLine(detail),
      email: s.email || "", phone: s.phone || "",
      createdAt: s.created_at, status: s.status || "pending",
      conversationId: numeric(s.conversation_id ?? raw._conversation_id),
      when: null, rating: null, record: s,
    }, [s.message || "", s.company || "", s.service_description || ""]);
  }

  for (const f of data.feedback) {
    const fName = personName(f.name);
    push({
      key: `feedback:${f.id}`, kind: "feedback", collection: "feedback", id: f.id,
      name: fName || f.email || t("conversions.anonymous"),
      person: fName || f.email || null,
      detail: f.comment ? `"${oneLine(f.comment)}"` : "",
      email: f.email || "", phone: "",
      createdAt: f.created_at, status: f.status || "received", conversationId: numeric(f.conversation_id),
      when: null, rating: typeof f.rating === "number" ? f.rating : null, record: f,
    }, [f.category || ""]);
  }

  // Newest first everywhere; a column keeps that order.
  return items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function numeric(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function deliveryLabel(status: string, t: T): string {
  if (status === "delivered") return t("conversions.board.escalationDelivered");
  if (status === "failed") return t("conversions.board.escalationFailed");
  if (status === "resolved" || status === "closed") return t("conversions.board.escalationResolved");
  return t("conversions.board.escalationWaiting");
}

export function leadHasConsent(item: RequestItem): boolean {
  return item.kind === "lead" && leadConsent(item.record);
}

/* ---------- Dates ---------- */

function fmt(date: Date, options: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(getLocale(), { timeZone: getTimezone(), ...options }).format(date);
  } catch {
    return "";
  }
}

/** Whole days between two "YYYY-MM-DD" keys (b - a). */
export function dayDiff(a: string, b: string): number {
  const parse = (key: string) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
  return Math.round((parse(b) - parse(a)) / 86_400_000);
}

/** "oggi", "ieri", "gio", "4 ago": how old a request is, in the card corner. */
export function ageLabel(value: string, t: T): string {
  const date = parseApiDate(value);
  if (!date) return "";
  const diff = dayDiff(toZonedDateKey(date), toZonedDateKey(new Date()));
  if (diff <= 0) return t("conversions.board.today");
  if (diff === 1) return t("conversions.board.yesterday");
  if (diff < 7) return fmt(date, { weekday: "short" }).replace(/\.$/, "");
  return fmt(date, { day: "numeric", month: "short" });
}

/** "9:00" */
export function clock(date: Date): string {
  return fmt(date, { hour: "numeric", minute: "2-digit" });
}

/** "gio 17, 9:00" */
export function shortWhen(date: Date): string {
  return `${fmt(date, { weekday: "short", day: "numeric" }).replace(/\.$/, "")}, ${clock(date)}`;
}

/** "gio 16 ott" */
export function shortDay(date: Date): string {
  return fmt(date, { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
}

/** "Giovedì 16 ottobre, 9:00" */
export function longWhen(date: Date): string {
  const day = fmt(date, { weekday: "long", day: "numeric", month: "long" });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${clock(date)}`;
}

/** "ieri alle 21:14", "12 ott alle 9:30" */
export function receivedLabel(value: string, t: T): string {
  const date = parseApiDate(value);
  if (!date) return "";
  return t("conversions.board.atTime").replace("{day}", ageLabel(value, t)).replace("{time}", clock(date));
}
