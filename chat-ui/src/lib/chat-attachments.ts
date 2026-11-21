import { restEndpoint } from "@/lib/rest-url";

export interface ChatAttachment {
  id: string;
  filename: string;
  kind: "image" | "text" | "pdf";
  media_type: "image/jpeg" | "text/plain";
  size_bytes: number;
  /** Until when a sent file can be opened; null keeps it without a limit (Impostazioni > Privacy > Allegati). */
  expires_at: string | null;
}
export interface AttachmentContent extends ChatAttachment { data: string; text: string }
export interface AttachmentClient {
  upload: (file: File, signal?: AbortSignal) => Promise<ChatAttachment>;
  read: (id: string, signal?: AbortSignal) => Promise<AttachmentContent>;
  remove: (id: string) => Promise<void>;
}

export const ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.txt,.pdf";
export const ATTACHMENT_MAX_FILES = 3;
/** The API's MAX_FILE / MAX_TEXT_FILE and the PHP bridge's MAX_BYTES / MAX_TEXT_BYTES. */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_TEXT_BYTES = 256 * 1024;
const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain", pdf: "application/pdf" };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function isItalian(locale?: string) {
  const configured = typeof window !== "undefined" ? (window as any).AlphaRecallChat?.language : null;
  return String(locale || configured || (typeof document !== "undefined" ? document.documentElement.lang : "it") || "it").startsWith("it");
}

/**
 * The size under an attachment: "26 byte" below 1 KB (it used to round up to
 * "1 KB"), "1,5 KB" / "340 KB", "4,2 MB", with the language's number format
 * (card o0n6di2fbboa).
 */
export function formatAttachmentSize(bytes: number, locale?: string): string {
  const italian = isItalian(locale);
  const tag = italian ? "it-IT" : "en-US";
  const size = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0;
  if (size < 1024) return `${size.toLocaleString(tag)} ${italian || size === 1 ? "byte" : "bytes"}`;
  const kb = size / 1024;
  if (kb < 1023.95) return `${kb.toLocaleString(tag, { maximumFractionDigits: kb < 10 ? 1 : 0 })} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString(tag, { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

/**
 * The line under a sent attachment (card 2y11k1s05mvp): "Disponibile fino al
 * 4 dic 2026", "Non più disponibile" once the date has passed, nothing when the
 * file is kept without a limit or the date is unreadable.
 */
export function attachmentExpiry(expiresAt: string | null | undefined, locale?: string, now: number = Date.now()): { text: string; expired: boolean } | null {
  if (!expiresAt) return null;
  // The API sends UTC; an older stored copy may lack the designator.
  const when = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(expiresAt) ? expiresAt : `${expiresAt}Z`);
  if (Number.isNaN(when.getTime())) return null;
  const italian = isItalian(locale);
  if (when.getTime() <= now) return { text: italian ? "Non più disponibile" : "No longer available", expired: true };
  const date = when.toLocaleDateString(italian ? "it-IT" : "en-US", { day: "numeric", month: "short", year: "numeric" });
  if (!italian) return { text: `Available until ${date}`, expired: false };
  // "fino all'8 dic", "fino all'11 dic", "fino all'1 dic"; "fino al 4 dic" otherwise.
  const day = when.getDate();
  return { text: `Disponibile fino ${day === 1 || day === 8 || day === 11 ? "all'" : "al "}${date}`, expired: false };
}

export function attachmentLabels(locale?: string) {
  return isItalian(locale) ? {
    add: "Allega file", remove: "Rimuovi", uploading: "Carico il file…", close: "Chiudi anteprima",
    hint: "Fino a 3 file · JPG, PNG, WebP, TXT, PDF · 5 MB/file. PDF: max 20 pagine. TXT: 256 KB.",
    tooMany: "Puoi allegare fino a 3 file per messaggio.",
    failed: "Il caricamento non è riuscito. Rimuovi il file e riprova.", download: "Scarica", extracted: "Testo estratto dal PDF",
    defaultMessage: "Dai un'occhiata agli allegati.", loading: "Apro l'allegato…", unavailable: "Questo allegato non è più disponibile.",
  } : {
    add: "Attach files", remove: "Remove", uploading: "Uploading…", close: "Close preview",
    hint: "Up to 3 files · JPG, PNG, WebP, TXT, PDF · 5 MB/file. PDFs: 20 pages. TXT: 256 KB.",
    tooMany: "You can attach up to 3 files per message.",
    failed: "The upload didn't work. Remove the file and try again.", download: "Download", extracted: "Extracted PDF text",
    defaultMessage: "Please take a look at the attached files.", loading: "Opening attachment…", unavailable: "This attachment is no longer available.",
  };
}

/**
 * What to say when a selection holds more files than the free slots (card
 * 4ctdtub8dgtr): the first ones were attached, these were left out.
 * "Allegati 3 file su 4: ricevuta.txt non è stato aggiunto, il limite è 3 per messaggio."
 */
export function attachmentOverflowText(attached: number, chosen: number, left: string[], locale?: string): string {
  const it = isItalian(locale);
  const names = left.length < 2 ? left.join("")
    : `${left.slice(0, -1).join(", ")} ${it ? "e" : "and"} ${left[left.length - 1]}`;
  const max = ATTACHMENT_MAX_FILES;
  if (it) {
    const head = attached === 1 ? `Allegato 1 file su ${chosen}` : `Allegati ${attached} file su ${chosen}`;
    return `${head}: ${names} ${left.length === 1 ? "non è stato aggiunto" : "non sono stati aggiunti"}, il limite è ${max} per messaggio.`;
  }
  return `Attached ${attached} of ${chosen} files: ${names} ${left.length === 1 ? "was" : "were"} not added, the limit is ${max} per message.`;
}

/**
 * Why a file was refused, as the API and the PHP bridge report it (`code` plus
 * its params): the text people read comes from attachmentErrorText, never from
 * the server's English `detail` / `error`.
 */
export interface AttachmentProblem { code: string; type?: string; limit?: number; allowed?: string[] }

export class AttachmentUploadError extends Error {
  constructor(public problem: AttachmentProblem, public status?: number) {
    super(problem.code);
    this.name = "AttachmentUploadError";
  }
}

const KNOWN_CODES = new Set(["attachment_type_mismatch", "attachment_type_not_allowed", "attachment_too_large", "attachment_undecodable",
  "attachment_empty", "attachment_missing", "attachment_image_too_large", "attachment_image_animated", "attachment_pdf_encrypted",
  "attachment_pdf_pages", "attachment_pdf_active", "attachment_no_text", "attachment_text_too_long", "attachment_too_complex",
  "attachment_timeout", "attachment_storage_full", "attachment_unavailable", "rate_limited"]);

const extensionOf = (name: string) => (name.includes(".") ? name.split(".").pop()?.toLowerCase() : "") || "";

/** The same checks as the bridge, before any byte is sent: type and size are told apart. */
export function checkAttachmentFile(file: File): AttachmentProblem | null {
  const extension = extensionOf(file.name);
  if (!TYPES[extension]) return { code: "attachment_type_not_allowed", allowed: Object.keys(TYPES) };
  if (!file.size) return { code: "attachment_empty" };
  if (file.size > ATTACHMENT_MAX_BYTES) return { code: "attachment_too_large", limit: ATTACHMENT_MAX_BYTES };
  if (extension === "txt" && file.size > ATTACHMENT_MAX_TEXT_BYTES) return { code: "attachment_too_large", type: "txt", limit: ATTACHMENT_MAX_TEXT_BYTES };
  if (file.type && file.type !== "application/octet-stream" && file.type !== TYPES[extension]) return { code: "attachment_type_mismatch", type: extension };
  return null;
}

export function validAttachmentFile(file: File): boolean {
  return checkAttachmentFile(file) === null;
}

/**
 * The refusal in a response body. Only known codes and well-formed params are
 * kept; a server without codes (an older API) is read from the HTTP status.
 */
export function attachmentProblem(status: number, data: unknown, filename = ""): AttachmentProblem {
  const body = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const extension = extensionOf(filename);
  const code = typeof body.code === "string" ? (body.code.startsWith("rate_limited") ? "rate_limited" : body.code) : "";
  if (KNOWN_CODES.has(code)) {
    const problem: AttachmentProblem = { code };
    if (typeof body.type === "string" && TYPES[body.type]) problem.type = body.type;
    if (typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit > 0) problem.limit = body.limit;
    if (Array.isArray(body.allowed)) problem.allowed = body.allowed.filter((value): value is string => typeof value === "string" && !!TYPES[value]);
    return problem;
  }
  const known = TYPES[extension] ? extension : undefined;
  if (status === 413) return known === "txt" ? { code: "attachment_too_large", type: "txt", limit: ATTACHMENT_MAX_TEXT_BYTES } : { code: "attachment_too_large", limit: ATTACHMENT_MAX_BYTES };
  if (status === 415) return known ? { code: "attachment_type_mismatch", type: known } : { code: "attachment_type_not_allowed", allowed: Object.keys(TYPES) };
  if (status === 422) return { code: "attachment_undecodable", type: known };
  if (status === 429) return { code: "rate_limited" };
  if (status === 502 || status === 503) return { code: "attachment_unavailable" };
  return { code: "attachment_failed" };
}

const TYPE_NAMES: Record<string, string> = { jpg: "JPG", png: "PNG", webp: "WebP", txt: "TXT", pdf: "PDF" };
const IT_NOUNS: Record<string, string> = { png: "un'immagine PNG", jpg: "un'immagine JPEG", jpeg: "un'immagine JPEG", webp: "un'immagine WebP", pdf: "un PDF", txt: "un file di testo" };
const EN_NOUNS: Record<string, string> = { png: "a PNG image", jpg: "a JPEG image", jpeg: "a JPEG image", webp: "a WebP image", pdf: "a PDF", txt: "a text file" };

function formatBytes(bytes: number, italian: boolean) {
  const locale = italian ? "it-IT" : "en-US";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`;
}

/** What to tell the person about a refused file, in the widget's language. */
export function attachmentErrorText(problem: AttachmentProblem, locale?: string): string {
  const it = isItalian(locale);
  const type = problem.type;
  const image = type === "png" || type === "jpg" || type === "jpeg" || type === "webp";
  const allowed = [...new Set((problem.allowed?.length ? problem.allowed : Object.keys(TYPES)).map(value => TYPE_NAMES[value === "jpeg" ? "jpg" : value]).filter(Boolean))].join(", ");
  const size = problem.limit ? formatBytes(problem.limit, it) : formatBytes(type === "txt" ? ATTACHMENT_MAX_TEXT_BYTES : ATTACHMENT_MAX_BYTES, it);
  const count = (value: number | undefined, fallback: number) => (value ?? fallback).toLocaleString(it ? "it-IT" : "en-US");
  switch (problem.code) {
    case "attachment_type_mismatch":
      return type ? (it ? `Il contenuto non corrisponde a ${IT_NOUNS[type]}` : `The content doesn't match ${EN_NOUNS[type]}`)
        : (it ? "Il contenuto non corrisponde al tipo di file" : "The content doesn't match the file type");
    case "attachment_type_not_allowed":
      return it ? `Tipo di file non ammesso (sono ammessi: ${allowed})` : `File type not allowed (allowed: ${allowed})`;
    case "attachment_too_large":
      if (type === "txt") return it ? `I file di testo possono essere al massimo di ${size}` : `Text files can be up to ${size}`;
      return it ? (size.startsWith("1 ") ? `Supera ${size}` : `Supera i ${size}`) : `Larger than ${size}`;
    case "attachment_undecodable":
      if (type === "pdf") return it ? "Il PDF non si può aprire" : "The PDF can't be opened";
      if (image) return it ? "L'immagine non si può aprire" : "The image can't be opened";
      if (type === "txt") return it ? "Il file di testo non si può leggere: deve essere in UTF-8" : "The text file can't be read: it must be UTF-8";
      return it ? "Il file non si può aprire" : "The file can't be opened";
    case "attachment_empty": return it ? "Il file è vuoto" : "The file is empty";
    case "attachment_missing": return it ? "Scegli un file valido" : "Choose a valid file";
    case "attachment_image_too_large":
      return it ? `L'immagine supera i ${Math.round((problem.limit ?? 16_000_000) / 1_000_000)} megapixel` : `The image is larger than ${Math.round((problem.limit ?? 16_000_000) / 1_000_000)} megapixels`;
    case "attachment_image_animated": return it ? "Le immagini animate non sono ammesse" : "Animated images aren't allowed";
    case "attachment_pdf_encrypted": return it ? "I PDF protetti da password non sono ammessi" : "Password-protected PDFs aren't allowed";
    case "attachment_pdf_pages": return it ? `Il PDF può avere al massimo ${count(problem.limit, 20)} pagine` : `PDFs can have up to ${count(problem.limit, 20)} pages`;
    case "attachment_pdf_active": return it ? "I PDF con script o file incorporati non sono ammessi" : "PDFs with scripts or embedded files aren't allowed";
    case "attachment_no_text": return it ? "Nel file non c'è testo leggibile" : "There is no readable text in this file";
    case "attachment_text_too_long":
      return it ? `Il testo supera i ${count(problem.limit, 40000)} caratteri: dividilo in file più piccoli` : `The text is longer than ${count(problem.limit, 40000)} characters: split it into smaller files`;
    case "attachment_too_complex": return it ? "Il file è troppo complesso da elaborare in sicurezza" : "The file is too complex to process safely";
    case "attachment_timeout": return it ? "L'elaborazione ha richiesto troppo tempo: prova con un file più piccolo" : "Processing took too long: try a smaller file";
    case "attachment_storage_full": return it ? "Lo spazio per gli allegati è esaurito: riprova più tardi" : "Attachment storage is full: try again later";
    case "attachment_unavailable": return it ? "Gli allegati non sono disponibili in questo momento: riprova più tardi" : "Attachments aren't available right now: try again later";
    case "rate_limited": return it ? "Troppi caricamenti insieme: riprova tra qualche secondo" : "Too many uploads at once: try again in a few seconds";
    default: return attachmentLabels(locale).failed;
  }
}

export function createAttachmentClient(request: (suffix: string, init: RequestInit) => Promise<Response>): AttachmentClient {
  const run = async (suffix: string, init: RequestInit, filename = "") => {
    const response = await request(suffix, { ...init, cache: "no-store", redirect: "error" });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new AttachmentUploadError(attachmentProblem(response.status, data, filename), response.status);
    if (!data || !uuid.test(data.id) || typeof data.filename !== "string" || !["image", "text", "pdf"].includes(data.kind)) throw new Error("Invalid attachment response");
    return data;
  };
  const path = (id: string) => { if (!uuid.test(id)) throw new Error("Invalid attachment ID"); return `/${id}`; };
  return {
    upload: async (file, signal) => {
      const problem = checkAttachmentFile(file);
      if (problem) throw new AttachmentUploadError(problem);
      const body = new FormData(); body.append("file", file);
      return run("", { method: "POST", body, signal }, file.name);
    },
    read: (id, signal) => run(path(id), { signal }),
    remove: async id => { await run(path(id), { method: "DELETE" }); },
  };
}

export function wpAttachmentClient(scope: "support-chat/attachments" | "operator-chat-attachments"): AttachmentClient {
  return createAttachmentClient((suffix, init) => {
    const cfg = (window as any).AlphaRecallAdmin || {};
    return fetch(restEndpoint(String(cfg.restUrl || ""), `/${scope}${suffix}`), {
      ...init, headers: { "X-WP-Nonce": cfg.nonce || "" }, credentials: "same-origin",
    });
  });
}

export function attachmentBlob(content: AttachmentContent): Blob {
  if (content.kind === "image" && content.media_type === "image/jpeg" && typeof content.data === "string" && content.data.length <= 3 * 1024 * 1024) {
    const bytes = Uint8Array.from(atob(content.data), character => character.charCodeAt(0));
    if (bytes.length < 3 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error("Invalid image response");
    return new Blob([bytes], { type: "image/jpeg" });
  }
  if (["pdf", "text"].includes(content.kind) && content.media_type === "text/plain" && typeof content.text === "string" && content.text.length <= 40000) {
    return new Blob([content.text], { type: "text/plain;charset=utf-8" });
  }
  throw new Error("Invalid attachment content");
}
