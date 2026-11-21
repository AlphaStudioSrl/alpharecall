/**
 * One policy for every 429, so no poller can keep firing into a limit.
 *
 * A 429 opens a cool-down: on the path family (`pathFamily`) for a per-route
 * limit, on everything for the API's per-IP and global limits. Until it ends,
 * writes fail at once with a RateLimitError and reads wait for it (up to
 * MAX_GET_WAIT_MS, else they fail too) instead of reaching the server. Its
 * length is the server's Retry-After, or 2s, 4s, 8s... up to 60s for
 * consecutive limits without one. A GET that got the 429 is sent again once,
 * after the cool-down; a write never is (lib/api `send`).
 *
 * No imports on purpose: lib/poll reads the cool-downs from here, and test
 * files that mock lib/api must not lose them.
 */
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60000;
/** The longest Retry-After honoured; a bigger value is treated as this. */
const RETRY_AFTER_MAX_MS = 15 * 60 * 1000;
/** A read waits this long at most for a cool-down to end, then fails instead. */
export const MAX_GET_WAIT_MS = 10000;
const GLOBAL = "*";

interface CoolDown {
  /** When it opened: a 429 for a request sent before that is the same burst. */
  since: number;
  until: number;
  /** Consecutive limits without a success in between: the backoff exponent. */
  strikes: number;
}

const coolDowns = new Map<string, CoolDown>();
const rateLimitListeners = new Set<() => void>();

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** The API's machine code when it sent one ("support_profile_limit", "support_team_plan_required"). */
    public readonly code = ""
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * Routes whose 422 is the route itself rejecting the body. An old API answers
 * 405 for them (no POST on "/chat-threads/{id}"), never 422.
 */
const VALIDATING_ROUTES = new Set(["/chat-threads/read"]);

/**
 * The server does not have `path` (yet): an old API behind the current plugin
 * answers 405, or 422 where it reads the last segment as a thread id
 * ("/chat-threads/counts"); an old plugin answers 404 (rest_no_route) and,
 * through admin-ajax, 400 "Unsupported route.". Callers of newer endpoints
 * fall back on it; on a route that validates its body a 422 stays an error.
 */
export function isMissingRoute(error: unknown, path?: string): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  if (error.status === 404 || error.status === 405) return true;
  if (error.status === 422) return !(path && VALIDATING_ROUTES.has(path));
  return error.status === 400 && /unsupported route/i.test(error.message);
}

export class RateLimitError extends ApiRequestError {
  constructor(message: string, public readonly retryAt: number) {
    super(message, 429);
    this.name = "RateLimitError";
  }
}

/** A 429 as the server sent it, before the policy turns it into a RateLimitError. */
export class RateLimitResponse extends ApiRequestError {
  constructor(
    message: string,
    public readonly retryAfterMs: number | null,
    /** "rate_limited_global" | "rate_limited" from the proxy; "" from older servers. */
    public readonly code = ""
  ) {
    super(message, 429);
  }
}

/**
 * Read a 429 body (the REST body, or admin-ajax's `data`). The proxy says which
 * limit it was in `code` and how long to wait in `retry_after` (seconds);
 * older servers only send an English message and maybe the header. Null for a
 * quota: that is not a rate limit, it stays an ordinary error.
 */
export function rateLimitFrom(body: unknown, retryAfterHeader: string | null | undefined): RateLimitResponse | null {
  const data = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const message = String(data.error || data.message || "Too many requests.");
  const code = typeof data.code === "string" ? data.code : "";
  if (code === "quota_exceeded") return null;
  if (code !== "rate_limited" && code !== "rate_limited_global" && /quota/i.test(message)) return null;
  const seconds = Number(data.retry_after);
  const retryAfterMs = Number.isFinite(seconds) && seconds > 0
    ? Math.min(RETRY_AFTER_MAX_MS, seconds * 1000)
    : parseRetryAfter(retryAfterHeader);
  return new RateLimitResponse(message, retryAfterMs, code);
}

/** "/tools/leads/5?x=1" -> "/tools/leads", "/chat-threads/42/read" -> "/chat-threads". */
export function pathFamily(path: string): string {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  if (!parts.length) return "/";
  if ((parts[0] === "tools" || parts[0] === "integrations") && parts[1]) return `/${parts[0]}/${parts[1]}`;
  return `/${parts[0]}`;
}

/** Retry-After in ms: delay-seconds or an HTTP date. Null when absent or unreadable. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.min(RETRY_AFTER_MAX_MS, Number(raw) * 1000);
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, at - now));
}

/**
 * The API's per-IP and global limits cover every route, not just the one that
 * hit them. The proxy's code says so; without one (older servers) the
 * API's English message does.
 */
function isGlobalLimit(limit: RateLimitResponse): boolean {
  if (limit.code) return limit.code === "rate_limited_global";
  return /rate limit exceeded for ip|global rate limit/i.test(limit.message);
}

function emitRateLimit() {
  for (const listener of rateLimitListeners) {
    try {
      listener();
    } catch {
      // A listener's failure must not break the request that reported the limit.
    }
  }
}

/**
 * When the cool-down covering `path` ends (epoch ms), or 0 when there is none.
 * Without a path, only the IP/global cool-down counts.
 */
export function rateLimitedUntil(path?: string): number {
  const now = Date.now();
  let until = 0;
  for (const key of path ? [GLOBAL, pathFamily(path)] : [GLOBAL]) {
    const entry = coolDowns.get(key);
    if (entry && entry.until > now) until = Math.max(until, entry.until);
  }
  return until;
}

/** Called whenever a cool-down opens or closes early. Returns the unsubscribe. */
export function onRateLimitChange(listener: () => void): () => void {
  rateLimitListeners.add(listener);
  return () => {
    rateLimitListeners.delete(listener);
  };
}

/** Forget every cool-down (tests, and a change of site or operator). */
export function resetRateLimits(): void {
  coolDowns.clear();
  emitRateLimit();
}

export function clearCoolDowns(): void {
  coolDowns.clear();
}

/** Open (or extend) the cool-down a 429 calls for. Returns when it ends. */
export function noteRateLimit(path: string, limit: RateLimitResponse, sentAt: number): number {
  const now = Date.now();
  const key = isGlobalLimit(limit) ? GLOBAL : pathFamily(path);
  const prev = coolDowns.get(key);
  // The rest of a burst sent before the cool-down opened answers 429 too:
  // that is the same limit, not another strike.
  // (A request is held back while a cool-down runs, so one sent at or before
  // its start was already out.)
  const sameBurst = !!prev && sentAt <= prev.since;
  // A limit long after the last one (and no success since) starts over.
  const fresh = !prev || prev.until < now - BACKOFF_MAX_MS;
  const strikes = sameBurst ? prev!.strikes : fresh ? 1 : prev!.strikes + 1;
  const wait = limit.retryAfterMs ?? Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (strikes - 1));
  // Never sooner than a second: a 429 must not turn into an immediate retry.
  const until = Math.max(prev && prev.until > now ? prev.until : 0, now + Math.max(1000, wait));
  coolDowns.set(key, { since: sameBurst ? prev!.since : now, until, strikes });
  emitRateLimit();
  return until;
}

/** A request sent after a cool-down opened came back fine: the limit is over. */
export function noteSuccess(path: string, sentAt: number): void {
  let changed = false;
  for (const key of [GLOBAL, pathFamily(path)]) {
    const entry = coolDowns.get(key);
    // A request already on the wire when the limit opened says nothing about it.
    if (entry && sentAt > entry.since) {
      coolDowns.delete(key);
      changed = changed || entry.until > Date.now();
    }
  }
  if (changed) emitRateLimit();
}

/** The error a caller sees: the time left, in the admin's language. */
export function rateLimitError(until: number): RateLimitError {
  const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  let en = false;
  try {
    en = localStorage.getItem("ar-lang") === "en";
  } catch {
    // Storage may be unavailable; Italian is the default.
  }
  const message = en
    ? `Too many requests. Try again in ${seconds} s.`
    : `Troppe richieste in poco tempo. Riprova tra ${seconds} s.`;
  return new RateLimitError(message, until);
}

