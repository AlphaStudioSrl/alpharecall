/**
 * The Richieste and Agenda exports, written for the owner who opens them in
 * Excel: Italian column names, the board's own status words (Nuova / In
 * corso / Fatta), dates in the site's time zone as "02/09/2026 18:12", the
 * name wherever the record knows it, and ";" between columns, which is what
 * Italian Excel splits on (a "," file opened as one column). CSV and JSON
 * carry the same columns and values, so either file reads the same.
 */
import type { AppointmentRecord, ContactSubmission, FeedbackRecord, Lead } from "@/admin/hooks/use-conversions-data";
import { getTimezone, parseApiDate, toZonedDateKey } from "@/admin/lib/datetime";
import { appointmentEmail, appointmentName, appointmentPhone, leadConsent, leadName, personName } from "@/admin/lib/record-fields";
import { stageLabel } from "./parts";
import { appointmentService, kindInfo, type RequestItem, type RequestKind } from "./request-model";

type T = (key: string) => string;
type Value = string | number | null;

/** The four collections, plus the escalations Richieste shows among the requests. */
export type ExportCollection = "leads" | "appointments" | "submissions" | "feedback" | "escalations";
export type ExportFormat = "csv" | "json";

export const EXPORT_PATHS: Record<ExportCollection, string> = {
  leads: "/tools/leads",
  appointments: "/tools/appointments",
  submissions: "/contact-submissions",
  feedback: "/feedback",
  escalations: "/tools/escalations",
};

/** File names, Italian like the rest of the file. */
const FILE_NAMES: Record<ExportCollection, string> = {
  leads: "contatti-raccolti",
  appointments: "appuntamenti",
  submissions: "richieste",
  feedback: "feedback",
  escalations: "escalation",
};

/* ---------- Formats ---------- */

/** "02/09/2026 18:12" in the site's zone; "" when the value is not a date. */
export function exportDate(value: unknown): string {
  const date = parseApiDate(value);
  if (!date) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: getTimezone(),
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("day")}/${part("month")}/${part("year")} ${part("hour")}:${part("minute")}`;
  } catch {
    return "";
  }
}

const SEPARATOR = ";";

function csvCell(value: Value): string {
  let text = value === null ? "" : String(value);
  // Visitors write these cells: "=HYPERLINK(...)" must not run as a formula
  // in Excel, and "+39 340..." must stay a phone number. A number stays one.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^[+-]?\d+([.,]\d+)?$/.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Semicolon-separated rows, CRLF like Excel writes them. The BOM is added by downloadFile. */
export function toCsv(header: string[], rows: Value[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(SEPARATOR)).join("\r\n");
}

export function downloadFile(content: string, filename: string, mime: string) {
  // UTF-8 BOM so Excel reads accented Italian text correctly.
  const data = mime.startsWith("text/csv") ? "﻿" + content : content;
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------- Columns ---------- */

interface ExportColumn<R> {
  /** conversions.exportCols.<key> */
  key: string;
  value: (row: R, t: T) => Value;
}

const str = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");
const extraOf = (row: { extra?: unknown }) =>
  row.extra && typeof row.extra === "object" ? (row.extra as Record<string, unknown>) : {};
const yesNo = (flag: boolean, t: T) => t(flag ? "conversions.exportYes" : "conversions.exportNo");
const id = (row: { id: number }) => Math.abs(row.id);

const LEAD_COLUMNS: ExportColumn<Lead>[] = [
  { key: "name", value: (l) => leadName(l) },
  { key: "email", value: (l) => l.email || "" },
  { key: "phone", value: (l) => str(extraOf(l).phone || extraOf(l).telefono) },
  { key: "interest", value: (l) => str(extraOf(l).interest || extraOf(l).service || extraOf(l).message) },
  { key: "status", value: (l, t) => stageLabel("lead", l.status, t) },
  { key: "consent", value: (l, t) => yesNo(leadConsent(l), t) },
  { key: "tags", value: (l) => (l.tags || []).join(", ") },
  { key: "created", value: (l) => exportDate(l.created_at) },
];

const APPOINTMENT_COLUMNS: ExportColumn<AppointmentRecord>[] = [
  { key: "id", value: id },
  { key: "name", value: (a) => appointmentName(a) },
  { key: "email", value: (a) => appointmentEmail(a) },
  { key: "phone", value: (a) => appointmentPhone(a) },
  { key: "service", value: (a) => appointmentService(a) },
  // The booked moment when it is a real time, else what the visitor said ("martedì pomeriggio").
  { key: "when", value: (a) => exportDate(a.starts_at) || str(a.timeslot) },
  { key: "ends", value: (a) => exportDate(a.ends_at) },
  { key: "status", value: (a, t) => stageLabel("appointment", a.status || "scheduled", t) },
  { key: "notes", value: (a) => a.notes || "" },
  { key: "created", value: (a) => exportDate(a.created_at) },
];

function submissionKind(type: string): RequestKind {
  return type === "quote" || type === "callback" || type === "escalation" ? type : "contact";
}

const SUBMISSION_COLUMNS: ExportColumn<ContactSubmission>[] = [
  { key: "id", value: id },
  { key: "type", value: (s, t) => kindInfo(submissionKind(s.type), t).label },
  { key: "name", value: (s) => personName(s.name) },
  { key: "email", value: (s) => s.email || "" },
  { key: "phone", value: (s) => s.phone || "" },
  { key: "company", value: (s) => s.company || "" },
  { key: "subject", value: (s) => s.subject || "" },
  { key: "service", value: (s) => s.service_description || s.service_type || "" },
  { key: "budget", value: (s) => s.budget_range || "" },
  { key: "message", value: (s) => s.message || "" },
  { key: "status", value: (s, t) => stageLabel(submissionKind(s.type), s.status || "pending", t) },
  { key: "created", value: (s) => exportDate(s.created_at) },
];

const FEEDBACK_COLUMNS: ExportColumn<FeedbackRecord>[] = [
  { key: "id", value: id },
  { key: "rating", value: (f) => (typeof f.rating === "number" ? f.rating : null) },
  { key: "comment", value: (f) => f.comment || "" },
  { key: "name", value: (f) => personName(f.name) },
  { key: "email", value: (f) => f.email || "" },
  { key: "category", value: (f) => f.category || "" },
  { key: "status", value: (f, t) => stageLabel("feedback", f.status || "received", t) },
  { key: "created", value: (f) => exportDate(f.created_at) },
];

/** An escalation as GET /tools/escalations returns it (not merged into the requests). */
export interface EscalationRecord {
  id: number;
  issue?: string | null;
  channel?: string | null;
  status?: string | null;
  conversation_id?: number | null;
  delivered_at?: string | null;
  error?: string | null;
  created_at?: string | null;
}

const ESCALATION_COLUMNS: ExportColumn<EscalationRecord>[] = [
  { key: "id", value: id },
  { key: "subject", value: (e) => str(e.issue) },
  { key: "channel", value: (e) => str(e.channel) },
  { key: "status", value: (e, t) => stageLabel("escalation", e.status || "pending", t) },
  { key: "delivered", value: (e) => exportDate(e.delivered_at) },
  { key: "error", value: (e) => str(e.error) },
  { key: "conversation", value: (e) => (typeof e.conversation_id === "number" ? e.conversation_id : null) },
  { key: "created", value: (e) => exportDate(e.created_at) },
];

const COLUMNS: { [C in ExportCollection]: ExportColumn<RowOf<C>>[] } = {
  leads: LEAD_COLUMNS,
  appointments: APPOINTMENT_COLUMNS,
  submissions: SUBMISSION_COLUMNS,
  feedback: FEEDBACK_COLUMNS,
  escalations: ESCALATION_COLUMNS,
};

type RowOf<C extends ExportCollection> = C extends "leads"
  ? Lead
  : C extends "appointments"
    ? AppointmentRecord
    : C extends "submissions"
      ? ContactSubmission
      : C extends "escalations"
        ? EscalationRecord
        : FeedbackRecord;

/* ---------- Files ---------- */

/** Header and rows of a collection, as both formats write them. */
export function exportTable<C extends ExportCollection>(collection: C, rows: RowOf<C>[], t: T): { header: string[]; rows: Value[][] } {
  const columns = COLUMNS[collection] as ExportColumn<RowOf<C>>[];
  return {
    header: columns.map((c) => t(`conversions.exportCols.${c.key}`)),
    rows: rows.map((row) => columns.map((c) => c.value(row, t))),
  };
}

function write(header: string[], rows: Value[][], format: ExportFormat, name: string) {
  if (format === "csv") {
    downloadFile(toCsv(header, rows), `${name}.csv`, "text/csv;charset=utf-8");
    return;
  }
  const records = rows.map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
  downloadFile(JSON.stringify(records, null, 2), `${name}.json`, "application/json");
}

/** The writer exportAll calls with every record of the collection. */
export function exportWriter<C extends ExportCollection>(collection: C, format: ExportFormat, t: T) {
  return (rows: RowOf<C>[]) => {
    const table = exportTable(collection, rows, t);
    write(table.header, table.rows, format, `${FILE_NAMES[collection]}-${toZonedDateKey()}`);
  };
}

/** Fields the columns above already carry, left out of a record's other fields. */
const COVERED = new Set([
  "id", "type", "name", "email", "phone", "company", "subject", "service_description", "service_type", "budget_range",
  "message", "status", "created_at", "rating", "comment", "category", "notes", "starts_at", "ends_at", "timeslot",
  "tags", "consent",
]);

/** Every other field the API returned ("extra.budget", "user_info.motivo"), flattened. */
function otherFields(record: Record<string, unknown>): [string, Value][] {
  const out: [string, Value][] = [];
  const walk = (prefix: string, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) walk(prefix ? `${prefix}.${k}` : k, v);
    } else if (value !== undefined && value !== null && value !== "") {
      out.push([prefix, Array.isArray(value) ? value.join(", ") : typeof value === "number" ? value : String(value)]);
    }
  };
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith("_") && !COVERED.has(key)) walk(key, value);
  }
  return out;
}

/**
 * One record: the same columns as its collection's export, then every other
 * field the record holds (a form's custom fields, the chat it came from):
 * the sheet's "Esporta".
 */
export function exportItemCSV(item: RequestItem, t: T) {
  const name = `${item.kind}-${Math.abs(item.id)}`;
  const record = item.record as unknown as Record<string, unknown>;
  const extra = otherFields(record);
  if (item.kind === "escalation") {
    // Escalations are not a collection export; their record is the hand-off itself.
    write(
      [...["type", "subject", "status", "created"].map((k) => t(`conversions.exportCols.${k}`)), ...extra.map(([k]) => k)],
      [[kindInfo("escalation", t).label, str(record.subject), stageLabel("escalation", item.status, t), exportDate(item.createdAt), ...extra.map(([, v]) => v)]],
      "csv",
      name,
    );
    return;
  }
  const table = exportTable(item.collection, [item.record] as never[], t);
  write([...table.header, ...extra.map(([k]) => k)], [[...table.rows[0], ...extra.map(([, v]) => v)]], "csv", name);
}
