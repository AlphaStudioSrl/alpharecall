/**
 * Talks to the assistant exactly as a visitor's widget does: a public chat
 * signature, an anonymous visitor, then POST /chat through the plugin proxy.
 *
 * The admin `/invoke` route cannot be used for this: the API binds every chat
 * to a visitor token. So each test is a real conversation (it shows in the
 * Inbox and counts toward the plan), which the Prova page says up front.
 */
import { getConfig } from "@/admin/lib/config";
import { parseRetryAfter } from "@/admin/lib/rate-limit";
import { fetchWithProofOfWork } from "@/lib/pow-fetch";
import { cancelTurn, newTurnId } from "@/lib/turn-cancel";

/**
 * How long Prova waits for an answer. The plugin's chat proxy gives the API
 * 90 s (AlphaRecall_Rest::CHAT_TIMEOUT) and then answers a coded 504; this outlasts it
 * so that answer arrives first, and still ends a request a proxy left hanging.
 */
export const PROVA_TIMEOUT_MS = 100_000;

export interface ProvaCitation {
  title?: string | null;
  url?: string | null;
  source_id?: string | null;
  score?: number | null;
  chunk_index?: number | null;
}

export interface ProvaReply {
  output: string;
  citations: ProvaCitation[];
  sources: { title?: string | null; url?: string | null }[];
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } | null;
  model: string | null;
  conversationId: string | null;
  tool: string | null;
  /** The component types, for the trace. */
  components: string[];
  /** The components as the widget receives them, for the preview of its card. */
  componentData: Record<string, unknown>[];
  followups: string[];
  toolRounds: number | null;
  ms: number;
}

/**
 * Why a test did not get an answer. "quota": the plan is out of messages (402,
 * or a 429 whose code is quota_exceeded). "rate": too many requests for now,
 * retry after `retryAfterMs`. "timeout": no answer in time. "empty": a 200
 * with no answer in it. "unreadable": a 200 whose body is not the API's JSON
 * (a cache or security page, cut JSON): the question may have been received.
 * "expired": WordPress refused the page's nonce (rest_cookie_invalid_nonce),
 * only a reload gives a new one. "handoff": the chat is with the team (the
 * visitor asked for a person, or an operator took it), so the assistant does
 * not answer until it is handed back; `conversationId` is the thread.
 * "blocked": the site's anti-abuse control (the API bot shield, or the
 * plugin's own limiter) refused to open the test chat, a 429 on
 * /visitor-register or /chat-signature; `retryAfterMs` says when it lifts.
 * "challenge": the anti-abuse control asked for proof of work and the answer
 * was not accepted (or could not be computed). In both the question was never
 * sent. The message is the server's own text: it is read for the role check
 * and never shown.
 */
export type ProvaErrorKind = "session" | "visitor" | "chat" | "quota" | "rate" | "blocked" | "challenge" | "timeout" | "empty" | "unreadable" | "expired" | "handoff";

export class ProvaError extends Error {
  constructor(
    public kind: ProvaErrorKind,
    message: string,
    public status = 0,
    public retryAfterMs: number | null = null,
    /** For "handoff": the thread and its status ("handoff", "escalated", "closed"). */
    public handoff: { conversationId: string | null; chatStatus: string } | null = null
  ) {
    super(message);
  }
}

/** WordPress's answer to a stale X-WP-Nonce: the page must be reloaded. */
const EXPIRED_NONCE = "rest_cookie_invalid_nonce";

interface Signature {
  chatSig: string;
  chatTs: string;
  expiresAt: number;
}

let signature: Signature | null = null;
let visitorToken: string | null = null;
let sessionPrimed = false;

function base(): string {
  return getConfig().restUrl.replace(/\/$/, "");
}

/**
 * The chat signature needs the public session cookie the widget's page sets.
 * wp-admin does not set it, so load the site's home once (same origin only:
 * a cross-origin fetch would not carry the cookie anyway).
 */
async function primeSession(): Promise<void> {
  if (sessionPrimed) return;
  const siteUrl = getConfig().siteUrl;
  try {
    if (siteUrl && new URL(siteUrl, location.href).origin === location.origin) {
      const res = await fetch(siteUrl, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
    }
    sessionPrimed = true;
  } catch {
    // Not primed: the next try loads the page again. The signature request
    // below reports the failure.
  }
}

async function freshSignature(): Promise<Signature> {
  if (signature && signature.expiresAt - Date.now() > 60_000) return signature;
  await primeSession();
  const res = await fetch(`${base()}/chat-signature`, {
    headers: { "X-WP-Nonce": getConfig().nonce },
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!res.ok) {
    // The site may only set the session cookie once the widget is back on:
    // load the page again on the next try.
    sessionPrimed = false;
    const body = await errorBody(res);
    throw openError(res, body, "session");
  }
  const body = (await res.json()) as { chatSig?: string; chatTs?: string | number; expiresIn?: number };
  if (!body.chatSig || !body.chatTs) throw new ProvaError("session", "invalid signature", res.status);
  signature = {
    chatSig: body.chatSig,
    chatTs: String(body.chatTs),
    expiresAt: Date.now() + (Number(body.expiresIn) > 0 ? Number(body.expiresIn) : 3600) * 1000,
  };
  return signature;
}

function headers(sig: Signature): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-WP-Nonce": getConfig().nonce,
    "X-AlphaRecall-Signature": sig.chatSig,
    "X-AlphaRecall-Timestamp": sig.chatTs,
  };
}

/**
 * The error body's message, machine code and retry_after (seconds); empty when
 * it is not JSON. A 502/504 from a proxy in front of the site is an HTML page,
 * and over HTTP/2 statusText is empty, so neither is a message to show: the
 * page words it from the status instead.
 */
async function errorBody(res: Response): Promise<{ message: string; code: string; retryAfter: number }> {
  try {
    const body = await res.json();
    return {
      message: String(body?.message || body?.detail || body?.error || ""),
      code: typeof body?.code === "string" ? body.code : "",
      retryAfter: Number(body?.retry_after) || 0,
    };
  } catch {
    return { message: "", code: "", retryAfter: 0 };
  }
}

/** A 429's wait: the body's retry_after, else the header (both capped by parseRetryAfter). */
function retryAfterMsOf(res: Response, retryAfter: number): number | null {
  return retryAfter > 0 ? parseRetryAfter(String(retryAfter)) : parseRetryAfter(res.headers.get("Retry-After"));
}

/** The longest anti-abuse wait Prova names (a day; the bot shield's own windows are an hour at most). */
const BLOCKED_WAIT_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * The wait of an anti-abuse block as the server states it. Not capped at the
 * 15 minutes the admin's polling cool-down uses: the bot shield blocks until
 * its hourly window rolls over, and "riprova tra 15 minuti" for a 41-minute
 * block would send the owner back too early.
 */
function blockedWaitMs(res: Response, retryAfter: number): number | null {
  if (retryAfter > 0) return Math.min(BLOCKED_WAIT_MAX_MS, retryAfter * 1000);
  const raw = (res.headers.get("Retry-After") || "").trim();
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.min(BLOCKED_WAIT_MAX_MS, Number(raw) * 1000);
  const at = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(at) ? null : Math.min(BLOCKED_WAIT_MAX_MS, Math.max(0, at - Date.now()));
}

/**
 * Why the test chat could not be opened (signature or visitor), by status and
 * code. A 429 there is the anti-abuse control, not a broken session: card
 * 3ntateg1vxw2 showed "ricarica la pagina" for a 41-minute bot-shield block,
 * where reloading changes nothing. A 428 left after the retry is a proof of
 * work that was not accepted.
 */
function openError(res: Response, body: { message: string; code: string; retryAfter: number }, fallback: "session" | "visitor"): ProvaError {
  if (body.code === EXPIRED_NONCE) return new ProvaError("expired", body.message, res.status);
  if (res.status === 429) return new ProvaError("blocked", body.message, res.status, blockedWaitMs(res, body.retryAfter));
  if (res.status === 428 || body.code === "pow_required") return new ProvaError("challenge", body.message, res.status);
  return new ProvaError(fallback, body.message, res.status);
}

/** One anonymous visitor per admin page load; "Ricomincia" only opens a new conversation. */
async function ensureVisitor(sig: Signature): Promise<string> {
  if (visitorToken) return visitorToken;
  // The bot shield can ask for proof of work here once an IP registers often
  // (benchmarks, several admins behind one office IP); solve it as the widget does.
  let challenged = false;
  let res: Response;
  try {
    res = await fetchWithProofOfWork(`${base()}/visitor-register`, {
      method: "POST",
      headers: headers(sig),
      credentials: "same-origin",
      body: JSON.stringify({ anonymous: true }),
    }, { onChallenge: () => { challenged = true; } });
  } catch (error) {
    // The proof could not be computed (expired while solving): the check
    // failed, not the network.
    if (challenged) throw new ProvaError("challenge", error instanceof Error ? error.message : "", 428);
    throw error;
  }
  if (!res.ok) throw openError(res, await errorBody(res), "visitor");
  const body = (await res.json()) as { visitor_token?: string };
  if (!body.visitor_token) throw new ProvaError("visitor", "missing visitor token", res.status);
  visitorToken = body.visitor_token;
  return visitorToken;
}

function componentObjects(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object" && !Array.isArray(c));
}

function componentNames(components: Record<string, unknown>[]): string[] {
  return components.map((c) => String(c.type || c.component || c.name || "")).filter(Boolean);
}

/** The failed chat call as a ProvaError, by status and the proxy's code (never by its words). */
async function chatError(res: Response): Promise<ProvaError> {
  const { message, code, retryAfter } = await errorBody(res);
  if (res.status === 401 || res.status === 403) {
    // A stale signature or visitor: start over on the next try.
    signature = null;
    visitorToken = null;
  }
  if (code === EXPIRED_NONCE) return new ProvaError("expired", message, res.status);
  if (res.status === 402 || code === "quota_exceeded") return new ProvaError("quota", message, res.status);
  if (res.status === 429) {
    // The body and the header are capped alike (parseRetryAfter: 15 minutes at most).
    return new ProvaError("rate", message, res.status, retryAfterMsOf(res, retryAfter));
  }
  // The proxy's coded 504, or a CDN's own page when it gave up first
  // (Cloudflare: 524 at 100 s; a gateway: 504).
  if (res.status === 504 || res.status === 524 || code === "upstream_timeout") return new ProvaError("timeout", message, res.status);
  return new ProvaError("chat", message, res.status);
}

export async function askAssistant(text: string, conversationId: string | null, signal?: AbortSignal): Promise<ProvaReply> {
  const sig = await freshSignature();
  const token = await ensureVisitor(sig);
  // One controller for the page's abort ("Ricomincia") and the timeout, told apart by `timedOut`.
  const controller = new AbortController();
  let timedOut = false;
  let answered = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PROVA_TIMEOUT_MS);
  // The proxy keeps waiting on the API after the browser gives up, and the
  // API would answer, save the test in Messaggi and count it: name the turn
  // so "Ricomincia" stops it there too (lib/turn-cancel).
  const turnId = newTurnId();
  const stop = () => {
    controller.abort();
    if (answered) return;
    void cancelTurn({ restBase: base(), headers: { ...headers(sig), "X-Visitor-Token": token }, turnId, shownChars: 0 });
  };
  if (signal?.aborted) controller.abort(); // nothing was sent yet
  signal?.addEventListener("abort", stop, { once: true });
  const started = performance.now();
  try {
    const res = await fetchWithProofOfWork(`${base()}/chat`, {
      method: "POST",
      // X-AlphaRecall-Prova: the proxy sends a logged-in admin the whole reply
      // (usage, model, citations, rounds) for "Cosa ha usato"; a visitor's
      // /chat gets only what the widget shows (AlphaRecall_Chat::public_chat_reply).
      headers: { ...headers(sig), "X-Visitor-Token": token, "X-AlphaRecall-Prova": "1" },
      credentials: "same-origin",
      signal: controller.signal,
      body: JSON.stringify({
        workflow: "chat",
        input: { text },
        visitor_token: token,
        turn_id: turnId,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    });
    answered = true;
    if (!res.ok) throw await chatError(res);
    // A 200 that is not JSON (a cache or security page, a cut body) cannot be
    // read; the question may well have been received and counted.
    const body = (await res.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      throw new ProvaError("unreadable", "", res.status);
    })) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ProvaError("unreadable", "", res.status);
    const data = body as Record<string, any>;
    const output = typeof data.output === "string" ? data.output : typeof data.text === "string" ? data.text : "";
    const componentData = componentObjects(data.components);
    if (!output.trim() && componentData.length === 0) {
      // The chat is with the team: the question is in the thread, and the
      // assistant stays quiet until an operator hands it back.
      if (data.handoff === true || data.ai_enabled === false || ["handoff", "escalated", "closed"].includes(String(data.status ?? ""))) {
        throw new ProvaError("handoff", "", res.status, null, {
          conversationId: data.conversation_id != null ? String(data.conversation_id) : conversationId,
          chatStatus: String(data.status || "handoff"),
        });
      }
      // "{}" or "output": null is no answer, whatever the status says. A
      // tool-only answer (a card and no text) still is one.
      throw new ProvaError("empty", "", res.status);
    }
    const ms = Math.round(performance.now() - started);
    return {
      output,
      citations: Array.isArray(data.citations) ? data.citations : [],
      sources: Array.isArray(data.sources) ? data.sources : [],
      usage: data.usage && typeof data.usage === "object" ? data.usage : null,
      model: data.model ? String(data.model) : null,
      conversationId: data.conversation_id ? String(data.conversation_id) : conversationId,
      tool: data.tool ? String(data.tool) : null,
      components: componentNames(componentData),
      componentData,
      followups: Array.isArray(data.followups) ? data.followups.map(String) : [],
      // The API sends the rounds as a list; older builds sent a count.
      toolRounds: Array.isArray(data.tool_rounds) ? data.tool_rounds.length : typeof data.tool_rounds === "number" ? data.tool_rounds : null,
      ms,
    };
  } catch (error) {
    if (timedOut && !signal?.aborted) throw new ProvaError("timeout", "", 0);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}
