/**
 * What the inbox says about a thread, a message or a tool result, derived
 * only from what the API returns (status, last message, tool + tool_output,
 * sources). Shared by the list, the thread and the context panel.
 */
import { useApp } from "@/admin/app-context";
import { interpolate, type TFunction } from "@/admin/lib/i18n";
import { formatShortDate, formatTime, getLocale, getTimezone, parseApiDate, toZonedDateKey } from "@/admin/lib/datetime";
import type { Tone } from "@/admin/components/shared/kit";
import { getLastMessageText, isAiOwned, isClosed, needsPerson, type ChatMessage, type ChatThread } from "@/admin/hooks/use-conversations";
import { CalendarDays, FileText, Mail, MessageSquare, Phone, Star, AlertTriangle, type LucideIcon } from "@/components/icons";
import { personName } from "@/admin/lib/record-fields";

export const tf = (t: TFunction, key: string, vars: Record<string, string | number> = {}) => interpolate(t(key), vars);

/** The assistant's name from the tenant settings ("Sofia"), or a generic word. */
export function useBotName(): string {
  const { settings, t } = useApp();
  const name = String((settings?.tenant_settings as Record<string, unknown> | undefined)?.chatbot_name || "").trim();
  return name || t("common.assistant");
}

/**
 * The one label for a person with no name or e-mail: "Visitatore <visitor id>".
 * Always the visitor's id, never a thread id or a list position, so the same
 * person reads the same in the list, the header, the side card, the composer,
 * the bell and Contatti. With no id at all: plain "Visitatore".
 */
export function anonymousVisitorLabel(visitorId: unknown, t: TFunction): string {
  const id = Number(visitorId);
  return Number.isSafeInteger(id) && id > 0 ? tf(t, "inboxPage.visitor", { id }) : t("common.visitor");
}

/** The visitor a thread belongs to (the embedded summary, else the bare visitor_id). */
export function threadVisitorId(thread: Pick<ChatThread, "visitor" | "visitor_id">): number | null {
  const id = Number(thread.visitor?.id ?? thread.visitor_id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function visitorName(thread: Pick<ChatThread, "id" | "visitor" | "visitor_id" | "visitor_name" | "visitor_email">, t: TFunction): string {
  return (
    personName(thread.visitor?.display_name) ||
    personName(thread.visitor_name) ||
    thread.visitor?.email ||
    thread.visitor_email ||
    anonymousVisitorLabel(threadVisitorId(thread), t)
  );
}

export function visitorEmail(thread: Pick<ChatThread, "visitor" | "visitor_email">): string | undefined {
  return thread.visitor?.email || thread.visitor?.unverified_email || thread.visitor_email || undefined;
}

/** "10:42" today, "Ieri", "sab" this week, "4 ott" before. In the tenant's timezone. */
export function smartTime(value: string | null | undefined, t: TFunction): string {
  const date = parseApiDate(value);
  if (!date) return "";
  const key = toZonedDateKey(date);
  const today = toZonedDateKey(new Date());
  if (key === today) return formatTime(date);
  if (key === toZonedDateKey(new Date(Date.now() - 86_400_000))) return t("inboxPage.yesterday");
  if (Date.now() - date.getTime() < 6 * 86_400_000) {
    try {
      return new Intl.DateTimeFormat(getLocale(), { timeZone: getTimezone(), weekday: "short" }).format(date);
    } catch {
      /* fall through to the date */
    }
  }
  return formatShortDate(date);
}

/** Day label for the separators in a transcript. */
export function dayLabel(value: string, t: TFunction): string {
  const date = parseApiDate(value);
  if (!date) return "";
  const key = toZonedDateKey(date);
  if (key === toZonedDateKey(new Date())) return t("inboxPage.today");
  if (key === toZonedDateKey(new Date(Date.now() - 86_400_000))) return t("inboxPage.yesterday");
  try {
    return new Intl.DateTimeFormat(getLocale(), { timeZone: getTimezone(), weekday: "long", day: "numeric", month: "long" }).format(date);
  } catch {
    return formatShortDate(date);
  }
}

/** "18 min", "2 h", "3 g": how long something has been waiting. */
export function elapsed(value: string | null | undefined, t: TFunction): string | null {
  const date = parseApiDate(value);
  if (!date) return null;
  const minutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return tf(t, "inboxPage.thread.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tf(t, "inboxPage.thread.hours", { n: hours });
  return tf(t, "inboxPage.thread.days", { n: Math.floor(hours / 24) });
}

type LastMessage = { role?: string; tool?: string | null; tool_output?: Record<string, unknown> | null; created_at?: string };

function lastMessageOf(thread: ChatThread): LastMessage | null {
  const last = thread.last_message;
  return last && typeof last === "object" ? (last as LastMessage) : null;
}

/**
 * Since when the visitor has been waiting, or null. A chat the assistant owns
 * waits when the visitor wrote last; a chat handed to the team waits from the
 * visitor's last message until a person answers (the assistant's own
 * "I've told the team" does not count as an answer).
 */
export function waitingSince(thread: ChatThread): string | null {
  const last = lastMessageOf(thread);
  const lastVisitor = thread.last_visitor_message?.created_at ?? null;
  if (last?.role === "user") return last.created_at || lastVisitor;
  if (needsPerson(thread) && last?.role === "assistant") return lastVisitor;
  return null;
}

/** Past this, a visitor message the assistant has not answered counts as unanswered, not as a reply on its way. */
export const UNANSWERED_AFTER_MS = 2 * 60_000;

/**
 * The visitor message the assistant never answered, or null: the assistant
 * owns the chat, the visitor wrote last and nothing came back for
 * UNANSWERED_AFTER_MS. The API records no failure flag, so this is read from
 * the transcript itself: a reply that failed upstream (a 502 from /chat)
 * leaves exactly this behind.
 */
export function unansweredMessage(thread: ChatThread, messages: ChatMessage[], now = Date.now()): ChatMessage | null {
  if (!isAiOwned(thread)) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return null;
  const at = parseApiDate(last.created_at)?.getTime();
  return at !== undefined && now - at > UNANSWERED_AFTER_MS ? last : null;
}

const TOOL_STATUS: Record<string, { key: string; tone: Tone }> = {
  appointment: { key: "appointment", tone: "info" },
  appointment_update: { key: "appointment", tone: "info" },
  appointment_availability: { key: "slots", tone: "info" },
  quote_request: { key: "quote", tone: "accent" },
  email_lead: { key: "lead", tone: "accent" },
  newsletter_subscribe: { key: "lead", tone: "accent" },
  contact_form: { key: "request", tone: "accent" },
  callback_request: { key: "request", tone: "accent" },
  property_inquiry: { key: "request", tone: "accent" },
  job_application: { key: "request", tone: "accent" },
  event_register: { key: "request", tone: "accent" },
};

/** The one-line status under a list item (x-st): who the thread is waiting on, or what came of it. */
export function threadStatus(thread: ChatThread, t: TFunction, bot: string): { tone: Tone; label: string } {
  const waiting = waitingSince(thread);
  if (thread.status === "escalated") return { tone: "warn", label: t("inboxPage.status.waitingPerson") };
  if (thread.status === "handoff") {
    return waiting ? { tone: "warn", label: t("inboxPage.status.waitingReply") } : { tone: "info", label: t("inboxPage.status.team") };
  }
  if (isClosed(thread)) return { tone: "mute", label: t("inboxPage.status.closed") };
  const last = lastMessageOf(thread);
  if (waiting && Date.now() - (parseApiDate(waiting)?.getTime() ?? Date.now()) > UNANSWERED_AFTER_MS) {
    return { tone: "violet", label: t("inboxPage.status.unanswered") };
  }
  const outcome = last?.tool && !last.tool_output?.error ? TOOL_STATUS[last.tool] : undefined;
  if (outcome) return { tone: outcome.tone, label: t(`inboxPage.status.${outcome.key}`) };
  return { tone: "mute", label: tf(t, "inboxPage.status.ai", { bot }) };
}

/** List preview: what the visitor last wrote (the last message when there is none), as one line. */
export function previewText(thread: ChatThread): string {
  return getLastMessageText(thread.last_visitor_message?.content ? thread.last_visitor_message : thread.last_message)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^[-#>]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether the list should put the thread title before the preview. A title
 * made from the visitor's first message repeats the preview ("titolo:
 * titolo"), often cut short with an ellipsis, so it only shows when it adds
 * something.
 */
export function previewTitle(title: string | null | undefined, name: string, preview: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[.…]+$/u, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const head = norm(title || "");
  if (!head || head === norm(name)) return false;
  const body = norm(preview);
  if (!body) return true;
  if (body.startsWith(head)) return false;
  // A preview cut shorter than the title is still a copy of it; a short
  // reply ("Ciao", "Sì") that happens to start the title is not.
  return !(head.startsWith(body) && body.length >= 24);
}

/* ------------------------------------------------------------------ */
/*  Tool results                                                       */
/* ------------------------------------------------------------------ */

const str = (value: unknown) => (typeof value === "string" ? value : "");

function when(value: unknown): string {
  const date = parseApiDate(value);
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat(getLocale(), {
      timeZone: getTimezone(), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(date);
  } catch {
    return formatShortDate(date);
  }
}

function day(value: unknown): string {
  const date = parseApiDate(value);
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat(getLocale(), { timeZone: getTimezone(), weekday: "short", day: "numeric", month: "short" }).format(date);
  } catch {
    return formatShortDate(date);
  }
}

export const isEscalation = (message: ChatMessage) => message.tool === "escalate" && !message.tool_output?.error;

/** Knowledge lookups are shown as sources, not as a tool line. */
const SILENT_TOOLS = new Set(["knowledge_search", "faq_search", "business_info", "display", "clarify"]);

/** The quiet line under an assistant answer saying what its tool did (x-note). */
export function toolNote(message: ChatMessage, t: TFunction): { icon: LucideIcon; text: string } | null {
  const tool = message.tool;
  const out = (message.tool_output ?? {}) as Record<string, unknown>;
  if (!tool || SILENT_TOOLS.has(tool) || tool === "escalate") return null;
  if (out.error || out.guard_blocked) return { icon: AlertTriangle, text: t("inboxPage.tools.failed") };
  switch (tool) {
    case "appointment_availability": {
      const slots = Array.isArray(out.slots) ? (out.slots as Array<Record<string, unknown>>) : [];
      if (!slots.length) return null;
      const date = day(slots[0]?.start_time ?? slots[0]?.start);
      return { icon: CalendarDays, text: date ? tf(t, slots.length === 1 ? "inboxPage.tools.slotsOne" : "inboxPage.tools.slots", { n: slots.length, date }) : tf(t, slots.length === 1 ? "inboxPage.tools.slotsNoDateOne" : "inboxPage.tools.slotsNoDate", { n: slots.length }) };
    }
    case "appointment": {
      if (out.status === "unavailable") return { icon: CalendarDays, text: t("inboxPage.tools.unavailable") };
      const date = when(out.starts_at ?? out.timeslot);
      return { icon: CalendarDays, text: date ? tf(t, "inboxPage.tools.booked", { date }) : t("inboxPage.tools.bookedNoDate") };
    }
    case "appointment_update": {
      if (out.status === "unavailable") return { icon: CalendarDays, text: t("inboxPage.tools.unavailable") };
      const date = when(out.starts_at ?? out.timeslot);
      return { icon: CalendarDays, text: date ? tf(t, "inboxPage.tools.updated", { date }) : t("inboxPage.tools.updatedNoDate") };
    }
    case "appointment_delete":
      return { icon: CalendarDays, text: t("inboxPage.tools.cancelled") };
    case "email_lead":
    case "email_lead_update":
      return { icon: Mail, text: str(out.email) ? tf(t, "inboxPage.tools.lead", { email: str(out.email) }) : t("inboxPage.tools.leadNoEmail") };
    case "newsletter_subscribe":
      return { icon: Mail, text: t("inboxPage.tools.newsletter") };
    case "quote_request":
      return { icon: FileText, text: t("inboxPage.tools.quote") };
    case "contact_form":
      return { icon: Mail, text: t("inboxPage.tools.contact") };
    case "callback_request":
      return { icon: Phone, text: t("inboxPage.tools.callback") };
    case "feedback":
      return { icon: Star, text: t("inboxPage.tools.feedback") };
    case "event_register":
      return { icon: CalendarDays, text: t("inboxPage.tools.event") };
    case "job_application":
      return { icon: FileText, text: t("inboxPage.tools.job") };
    case "property_inquiry":
      return { icon: FileText, text: t("inboxPage.tools.property") };
    case "order_lookup":
      return { icon: FileText, text: t("inboxPage.tools.order") };
    case "product_search":
      return { icon: FileText, text: t("inboxPage.tools.products") };
    case "restaurant_availability":
    case "lodging_availability":
      return { icon: CalendarDays, text: t("inboxPage.tools.availability") };
    case "appointment_get":
      return { icon: CalendarDays, text: t("inboxPage.tools.appointmentGet") };
    case "email_lead_get":
      return { icon: Mail, text: t("inboxPage.tools.leadGet") };
    case "email_lead_delete":
      return { icon: Mail, text: t("inboxPage.tools.leadDeleted") };
    case "cart_link":
      return { icon: FileText, text: t("inboxPage.tools.cart") };
    case "event_list":
      return { icon: CalendarDays, text: t("inboxPage.tools.events") };
    case "coupon_check":
      return { icon: FileText, text: t("inboxPage.tools.coupon") };
    default:
      // Integration and custom tools: their ids are not Italian, so no name.
      return { icon: MessageSquare, text: t("inboxPage.tools.generic") };
  }
}

export interface ChatOutcome {
  key: string;
  title: string;
  status: { tone: Tone; label: string };
  detail: string;
  /** Richieste deep link (admins): { tab, item }. */
  link?: { tab: string; item: string };
}

const CARD_TOOLS: Record<string, string> = {
  appointment: "appointment", appointment_update: "appointment", appointment_availability: "slots",
  email_lead: "lead", email_lead_update: "lead", newsletter_subscribe: "newsletter", quote_request: "quote",
  contact_form: "contact", callback_request: "callback", feedback: "feedback", event_register: "event",
  job_application: "job", property_inquiry: "property", escalate: "escalation",
};

/**
 * The "Passata al team" card. "Gestita" only once someone did something with
 * it: a person from the team answered after the hand-off, or the chat was
 * closed. Taking it over is not an answer: the header still says the visitor
 * is waiting for one, so the card says "Presa in carico" (card o0n6di2fbboa).
 */
export function escalationStatus(
  thread: Pick<ChatThread, "status">,
  messages: ChatMessage[],
  escalation: ChatMessage,
  t: TFunction,
  bot?: string,
): { tone: Tone; label: string } {
  if (thread.status === "escalated") return { tone: "warn", label: t("inboxPage.cards.open") };
  const after = messages.indexOf(escalation);
  const answered = messages.slice(after < 0 ? 0 : after + 1).some((m) => m.role === "human" || m.role === "admin");
  if (isClosed(thread as ChatThread) || answered) return { tone: "mute", label: t("inboxPage.cards.handled") };
  if (thread.status === "handoff") return { tone: "info", label: t("inboxPage.cards.taken") };
  return { tone: "mute", label: tf(t, "inboxPage.cards.backToBot", { bot: bot || t("common.assistant") }) };
}

/** "Da questa chat": the records the assistant's tools produced in this thread, newest first. */
export function chatOutcomes(thread: ChatThread, messages: ChatMessage[], t: TFunction, bot?: string): ChatOutcome[] {
  const cards: ChatOutcome[] = [];
  for (const message of messages) {
    const kind = message.tool ? CARD_TOOLS[message.tool] : undefined;
    if (!kind || message.role !== "assistant") continue;
    const out = (message.tool_output ?? {}) as Record<string, unknown>;
    const failed = Boolean(out.error || out.guard_blocked);
    const at = formatTime(message.created_at);
    let status: ChatOutcome["status"] = failed
      ? { tone: "red", label: t("inboxPage.cards.failed") }
      : { tone: "accent", label: t("inboxPage.cards.new") };
    let detail = tf(t, "inboxPage.cards.at", { time: at });
    let link: ChatOutcome["link"];
    if (kind === "escalation" && !failed) {
      status = escalationStatus(thread, messages, message, t, bot);
      const channel = str(out.channel);
      detail = [str(out.issue), channel ? tf(t, "inboxPage.cards.via", { channel, time: at }) : ""].filter(Boolean).join(" · ") || detail;
    } else if (kind === "appointment" && !failed) {
      if (out.status === "unavailable") continue;
      status = { tone: "info", label: t("inboxPage.cards.booked") };
      detail = when(out.starts_at ?? out.timeslot) || detail;
      if (out.appointment_id) link = { tab: "appointments", item: String(out.appointment_id) };
    } else if (kind === "slots" && !failed) {
      const slots = Array.isArray(out.slots) ? out.slots.length : 0;
      if (!slots) continue;
      status = { tone: "info", label: t("inboxPage.cards.proposed") };
      detail = toolNote(message, t)?.text ?? detail;
    } else if (kind === "lead" && !failed) {
      detail = str(out.email) || detail;
      if (out.lead_id) link = { tab: "leads", item: String(out.lead_id) };
    }
    cards.push({ key: `${message.id}`, title: t(`inboxPage.cards.${kind}`), status, detail, link });
  }
  return cards.reverse();
}

export interface SourceRef {
  title: string;
  url?: string;
}

/** Every distinct source the assistant's answers in this thread were built from. */
export function chatSources(messages: ChatMessage[]): SourceRef[] {
  const seen = new Map<string, SourceRef>();
  for (const message of messages) {
    for (const source of message.sources ?? []) {
      if (!source || typeof source !== "object") continue;
      const url = /^https?:\/\//i.test(source.url ?? "") ? source.url : undefined;
      const title = (source.title || "").trim() || (url ? url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "") : "");
      if (!title) continue;
      const key = url || title;
      if (!seen.has(key)) seen.set(key, { title, url });
    }
  }
  return [...seen.values()];
}

/** "/sedazione" for a link on the tenant's site, the title otherwise. */
export function sourceLabel(source: SourceRef): string {
  if (!source.url) return source.title;
  try {
    const url = new URL(source.url);
    if (url.host === window.location.host || source.title === source.url) return url.pathname || source.title;
  } catch {
    /* keep the title */
  }
  return source.title;
}

/** A plain-text transcript for "Scarica la conversazione". */
export function transcript(thread: ChatThread, messages: ChatMessage[], t: TFunction, bot: string): string {
  const name = visitorName(thread, t);
  const lines = [thread.title || name, ""];
  for (const message of messages) {
    const who = message.role === "user" ? name : message.role === "assistant" ? bot : message.profile_name || t("inboxPage.thread.you");
    const stamp = parseApiDate(message.created_at);
    lines.push(`[${stamp ? `${toZonedDateKey(stamp)} ${formatTime(stamp)}` : ""}] ${who}: ${message.content}`);
  }
  return lines.join("\n");
}

/** Writes `thread=` or `visitor=` on the address so a reload or a copied link reopens it. */
export function syncParam(key: "thread" | "visitor" | "operator", id: number | null) {
  try {
    const url = new URL(window.location.href);
    if (id === null) url.searchParams.delete(key);
    else url.searchParams.set(key, String(id));
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url.href);
  } catch {
    // Sandboxed frames: the inbox still works, the link just isn't updated.
  }
}
