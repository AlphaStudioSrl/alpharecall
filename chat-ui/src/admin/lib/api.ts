import { getConfig, type AdminSettings } from "./config";
import { restEndpoint } from "@/lib/rest-url";
import {
  ApiRequestError,
  MAX_GET_WAIT_MS,
  RateLimitError,
  RateLimitResponse,
  clearCoolDowns,
  noteRateLimit,
  noteSuccess,
  rateLimitError,
  rateLimitFrom,
  rateLimitedUntil,
} from "./rate-limit";
import { SUPPORT_TEAM_PLAN_REQUIRED, reportSupportTeamPlanRequired } from "./support-team";

let restUnavailable = false;

// The 429 policy and the error classes live in ./rate-limit, which has no
// imports: lib/poll reads the cool-downs from there, so test files that mock
// this module still get the real policy.
export { ApiRequestError, RateLimitError, isMissingRoute, pathFamily, parseRetryAfter, rateLimitedUntil, onRateLimitChange, resetRateLimits } from "./rate-limit";

/**
 * Short-lived GET cache, shared by every hook.
 *
 * Switching tabs unmounts the whole page (see admin/app.tsx), so coming back
 * refired every request the page makes. Each one is a *full WordPress boot* --
 * the browser hits /wp-json, which loads core plus the site's plugin stack,
 * then the proxy calls the API over the network -- measured at roughly one
 * second per request on production. A page that fetches five collections
 * therefore cost seconds of staring at a skeleton for data already in memory.
 *
 * Caching here rather than in each hook means every caller benefits, including
 * the ones added later. Only useDashboard had its own cache; the other
 * nineteen hooks had none.
 */
const GET_TTL_MS = 15000;

interface CacheEntry {
  at: number;
  data: unknown;
}

const getCache = new Map<string, CacheEntry>();
/** Identical GETs already in flight, so concurrent callers share one request. */
const inflight = new Map<string, Promise<unknown>>();
let cacheScope = "";

function syncCacheScope() {
  const config = getConfig();
  const scope = JSON.stringify([config?.restUrl, config?.siteUrl, config?.settings?.tenant_id, config?.currentUser?.id, config?.nonce, config?.ajaxNonce]);
  if (scope !== cacheScope) {
    cacheScope = scope;
    restUnavailable = false;
    invalidateApiCache();
    clearCoolDowns();
  }
  return scope;
}

/**
 * Hand back a copy, never the cached object.
 *
 * Callers do mutate what they get (useDashboard attaches `conversions` to the
 * /dashboard payload), and a shared reference would let one page's edit leak
 * into the next reader's data.
 */
function copy<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

/**
 * Drop cached GETs. Called automatically after every write (scoped, see
 * invalidateAfterWrite); export it for the rare case where a change lands
 * through some other channel.
 */
export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    getCache.clear();
    inflight.clear();
    return;
  }
  for (const key of getCache.keys()) {
    if (key.startsWith(prefix)) getCache.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

/**
 * Writes whose effects stay inside a few path families, and the families they
 * clear. Marking a chat read used to wipe every cached GET, so clicking through
 * the bell turned each POST into a refetch of everything a page shows. The
 * dashboard aggregates all of these, so it goes too.
 *
 * Anything not listed (settings, content, integrations, team...) still clears
 * the whole cache: the proxy fans those out across several API resources, so
 * there is no reliable prefix to scope them to.
 */
const SCOPED_WRITES: Array<[RegExp, string[]]> = [
  [/^\/chat-threads(\/|$)/, ["/chat-threads", "/visitors", "/dashboard"]],
  [/^\/(visitors|blacklisted-visitors|gdpr)(\/|$)/, ["/visitors", "/blacklisted-visitors", "/gdpr", "/chat-threads", "/dashboard"]],
  [/^\/(tools\/(leads|appointments)|contact-submissions|feedback)(\/|$)/, ["/tools/", "/contact-submissions", "/feedback", "/dashboard"]],
  [/^\/ui-prefs$/, ["/ui-prefs"]],
  [/^\/support-chat(\/|$)/, ["/support-chat"]],
  // A plan check, not a change of content: it used to wipe every cached and
  // in-flight GET on each page load, so the requests a page had just sent
  // could no longer be shared.
  [/^\/license\/refresh$/, ["/license", "/billing", "/dashboard"]],
];

function invalidateAfterWrite(path: string): void {
  const route = path.split("?")[0];
  const scoped = SCOPED_WRITES.find(([pattern]) => pattern.test(route));
  if (!scoped) {
    invalidateApiCache();
    return;
  }
  for (const prefix of scoped[1]) invalidateApiCache(prefix);
}

/**
 * A request that failed before the API could answer it: the browser is
 * offline or the server unreachable ("network"), or WordPress refused the
 * expired nonce of a tab left open overnight ("session"). Pages used to show
 * the browser's "Failed to fetch" or WordPress's "Cookie check failed" as is;
 * the message is now the reason, in the admin's language.
 */
export class ConnectionError extends ApiRequestError {
  constructor(public readonly reason: "network" | "session", status: number) {
    super(connectionText(reason), status);
    this.name = "ConnectionError";
  }
}

function connectionText(reason: "network" | "session"): string {
  let en = false;
  try {
    en = localStorage.getItem("ar-lang") === "en";
  } catch {
    // Storage may be unavailable; Italian is the default.
  }
  if (reason === "session") {
    return en ? "Your session has expired: reload the page and try again." : "La sessione è scaduta: ricarica la pagina e riprova.";
  }
  return en ? "No connection: check your network and try again." : "Connessione assente: controlla la rete e riprova.";
}

/**
 * fetch(), with its own failure named: it rejects with a TypeError when no
 * answer came back at all (offline, DNS, server down). Only that rejection is
 * mapped; a TypeError from our own code stays what it is.
 */
async function transport(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (error instanceof TypeError && !init.signal?.aborted) throw new ConnectionError("network", 0);
    throw error;
  }
}

/**
 * The text for a failed action: what did not happen ("Non siamo riusciti a
 * cambiare lo stato."), then why when the why is something the user can act
 * on (offline, expired session, too many requests). Other server messages are
 * not shown: they are English and name internals.
 */
export function errorText(error: unknown, action: string): string {
  if (error instanceof ConnectionError || error instanceof RateLimitError) return `${action} ${error.message}`;
  return action;
}

/** errorText for a settings save: a 400 is the plugin naming the value it refused, in the admin's language. */
export function saveErrorText(error: unknown, action: string): string {
  if (error instanceof ApiRequestError && error.status === 400 && error.message) return `${action} ${error.message}`;
  return errorText(error, action);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/** Settle with `promise`, or reject as soon as `signal` aborts (the request itself carries on). */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

/** Hold a request back while its cool-down runs: reads wait (bounded), writes fail. */
async function waitForCoolDown(path: string, isGet: boolean): Promise<void> {
  const started = Date.now();
  for (;;) {
    const until = rateLimitedUntil(path);
    if (!until) return;
    if (!isGet || until - started > MAX_GET_WAIT_MS) throw rateLimitError(until);
    await sleep(until - Date.now());
  }
}

/** One request under the 429 policy: cool-down first, one delayed retry for a GET. */
async function send<T>(path: string, options: RequestInit, retried: boolean): Promise<T> {
  const isGet = (options.method || "GET").toUpperCase() === "GET";
  for (let attempt = 0; ; attempt += 1) {
    await waitForCoolDown(path, isGet);
    const sentAt = Date.now();
    try {
      const data = await requestOnce<T>(path, options, retried);
      noteSuccess(path, sentAt);
      return data;
    } catch (error) {
      if (!(error instanceof RateLimitResponse)) throw error;
      const until = noteRateLimit(path, error, sentAt);
      // Writes are never replayed; a read goes again once, after the cool-down
      // (waitForCoolDown at the top of the loop), if that is not too far off.
      if (!isGet || attempt > 0 || until - Date.now() > MAX_GET_WAIT_MS) throw rateLimitError(until);
    }
  }
}

/**
 * The answer to a GET another caller already has: in flight, or cached no
 * older than `maxAgeMs`. Null when there is none; nothing is sent. For a
 * caller that can make do with a wider request of someone else (the bell
 * reading the latest rows from Oggi's own collections) instead of sending a
 * second request for the same records.
 */
export function peekGet<T = unknown>(path: string, maxAgeMs = GET_TTL_MS): Promise<T> | null {
  syncCacheScope();
  const pending = inflight.get(path);
  if (pending) return pending.then((data) => copy(data) as T);
  const hit = getCache.get(path);
  if (hit && Date.now() - hit.at < Math.min(maxAgeMs, GET_TTL_MS)) return Promise.resolve(copy(hit.data) as T);
  return null;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  retried = false
): Promise<T> {
  const scope = syncCacheScope();
  const method = (options.method || "GET").toUpperCase();
  const { signal } = options;
  // Live polls pass `cache: "reload"`: serving them a 15s-old body would stall
  // progress bars and drop incoming support messages. They still share a
  // request already in flight for the same URL: that answer is no older than
  // their own would be, and two pollers must not double the load.
  const reload = options.cache === "reload" || options.cache === "no-store";
  const shared = method === "GET" && !retried;
  const cacheable = shared && !reload;

  if (cacheable) {
    const hit = getCache.get(path);
    if (hit && Date.now() - hit.at < GET_TTL_MS) return copy(hit.data) as T;
  }
  if (shared) {
    if (signal?.aborted) throw abortError();
    const pending = inflight.get(path);
    if (pending) return copy(await untilAborted(pending, signal)) as T;
  }

  // A shared request outlives the caller that started it, so it goes out
  // without that caller's signal; each caller stops waiting on its own.
  const run = send<T>(path, shared && signal ? { ...options, signal: undefined } : options, retried);

  if (shared) {
    inflight.set(path, run as Promise<unknown>);
    // Settle in a single handler rather than a .then().catch().finally() chain:
    // each link costs a microtask, and the caller's `await` resolves in
    // between. The entry would still look in-flight after it had finished, so
    // a later call that found its cache entry stale would be handed the old
    // response instead of refetching.
    const settle = () => {
      if (inflight.get(path) === (run as Promise<unknown>)) inflight.delete(path);
    };
    void run.then(
      (data) => {
        // Store a copy, not the object handed to this caller: they are free to
        // mutate what they received, and that must not reach the next reader.
        if (cacheable && scope === syncCacheScope() && inflight.get(path) === run) {
          getCache.set(path, { at: Date.now(), data: copy(data) });
        }
        settle();
      },
      () => {
        // Failures are the caller's to report; they just must not be cached.
        settle();
      }
    );
    return untilAborted(run, signal);
  }
  if (method !== "GET") {
    void run.then(() => { if (scope === syncCacheScope()) invalidateAfterWrite(path); }, () => {});
  }

  return run;
}

async function requestOnce<T = unknown>(
  path: string,
  options: RequestInit = {},
  retried = false
): Promise<T> {
  if (restUnavailable) {
    return adminAjax<T>(path, options);
  }

  const { restUrl, nonce } = getConfig();
  const base = restUrl.replace(/\/$/, "");

  let res: Response;
  try {
    res = await transport(restEndpoint(base, path), {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": nonce,
        ...(options.headers as Record<string, string> || {}),
      },
    });
  } catch (error) {
    // A failed write may already have committed upstream; replaying it through
    // admin-ajax can duplicate replies. Only retry a proven missing REST route.
    if (options.signal?.aborted || (options.method || "GET").toUpperCase() !== "GET") throw error;
    return adminAjax<T>(path, options);
  }

  // 204 No Content (DELETE /team/members/{id}) is a success with no body.
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  // A 429 can come from a proxy or the web server as an HTML page: it is
  // still a rate limit. A quota 429 is not; it stays an ordinary error.
  if (res.status === 429) {
    const limit = rateLimitFrom(data, res.headers.get("Retry-After"));
    if (limit) throw limit;
  }
  if (!data || typeof data !== "object") throw new Error(`Invalid API response (HTTP ${res.status}).`);

  if (!res.ok) {
    const message = data.error || data.message || "Something went wrong. Try again.";
    const code = data.code || "";
    if (code === "rest_cookie_invalid_nonce") throw new ConnectionError("session", res.status);
    const shouldFallback =
      code === "rest_no_route" ||
      /No route was found/i.test(message || "");

    if (shouldFallback) {
      const wasUnavailable = restUnavailable;
      restUnavailable = true;
      try {
        return await adminAjax<T>(path, options);
      } catch (error) {
        // A rate limit on the fallback is still a rate limit; anything else
        // reports the original missing route.
        if (error instanceof RateLimitResponse) throw error;
        // admin-ajax does not know the route either: REST works, it is this
        // route that is missing (a newer endpoint on an older plugin). Do not
        // send every later request through admin-ajax for it.
        if (error instanceof ApiRequestError && error.status === 400 && /unsupported route/i.test(error.message)) {
          restUnavailable = wasUnavailable;
        }
      }
    }

    if (!retried && message === "Website not configured." && path !== "/bootstrap") {
      try {
        const boot = await apiFetch<{ tenant_id?: string; tenant_status?: string; tenant_domain?: string }>(
          "/bootstrap",
          { method: "POST" },
          true
        );
        if (boot?.tenant_id) {
          // Settings will be refreshed by the caller
        }
        return await apiFetch<T>(path, options, true);
      } catch {
        throw new Error(message);
      }
    }

    const apiCode = typeof code === "string" ? code : "";
    if (res.status === 403 && apiCode === SUPPORT_TEAM_PLAN_REQUIRED) reportSupportTeamPlanRequired();
    throw new ApiRequestError(message, res.status, apiCode);
  }

  return data as T;
}

export async function wpFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<{ data: T; res: Response }> {
  const { wpRestUrl, nonce } = getConfig();
  const base = (wpRestUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("Something went wrong. Try again.");

  const res = await fetch(restEndpoint(base, path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-WP-Nonce": nonce,
      ...(options.headers as Record<string, string> || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.message || data?.error || "Something went wrong. Try again.";
    throw new Error(message);
  }

  return { data: data as T, res };
}

/**
 * JSON for a form field of the admin-ajax call. WordPress sanitizes that field as
 * text before decoding it (sanitize_textarea_field() in AlphaRecall_Rest::ajax_admin()),
 * which removes anything tag-shaped and every percent-encoded character. Those
 * characters only occur inside JSON strings, where a \uXXXX escape means the same
 * character, so they are escaped here and the text reaches PHP intact.
 */
export function formSafeJson(json: string): string {
  return json.replace(/[<>&%]/g, (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
}

export async function adminAjax<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const { ajaxUrl, ajaxNonce } = getConfig();
  if (!ajaxUrl || !ajaxNonce) throw new Error("Something went wrong. Try again.");

  const [route, qs] = path.split("?");
  const method = (options.method || "GET").toUpperCase();
  const params = qs ? Object.fromEntries(new URLSearchParams(qs)) : {};

  const payload = new URLSearchParams();
  payload.set("action", "alpharecall_admin");
  payload.set("nonce", ajaxNonce);
  payload.set("route", route);
  payload.set("method", method);

  if (Object.keys(params).length) {
    payload.set("params", formSafeJson(JSON.stringify(params)));
  }
  if (options.body) {
    payload.set(
      "body",
      formSafeJson(typeof options.body === "string" ? options.body : JSON.stringify(options.body))
    );
  }

  const res = await transport(ajaxUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: payload.toString(),
    signal: options.signal,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    const message = data?.data?.error || "Something went wrong. Try again.";
    // ajax_admin's answer to an expired nonce (class-ar-rest.php).
    if (res.status === 403 && message === "Invalid nonce.") throw new ConnectionError("session", 403);
    // admin-ajax reports the limit in data.code even if a host rewrites the status.
    if (res.status === 429 || /^rate_limited/.test(String(data?.data?.code || ""))) {
      const limit = rateLimitFrom(data?.data, res.headers.get("Retry-After"));
      if (limit) throw limit;
    }
    const code = typeof data?.data?.code === "string" ? data.data.code : "";
    if (res.status === 403 && code === SUPPORT_TEAM_PLAN_REQUIRED) reportSupportTeamPlanRequired();
    throw new ApiRequestError(message, res.status, code);
  }

  return (data.data || {}) as T;
}

export async function ajaxFetchPages(params: {
  page: number;
  perPage: number;
  search: string;
}): Promise<{ pages: unknown[]; totalPages: number }> {
  const { ajaxUrl, ajaxNonce } = getConfig();
  if (!ajaxUrl || !ajaxNonce) throw new Error("Something went wrong. Try again.");

  const payload = new URLSearchParams();
  payload.set("action", "alpharecall_pages");
  payload.set("nonce", ajaxNonce);
  payload.set("page", String(params.page));
  payload.set("per_page", String(params.perPage));
  if (params.search) {
    payload.set("search", params.search);
  }

  const res = await fetch(ajaxUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body: payload.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    const message = data?.data?.error || "Something went wrong. Try again.";
    throw new Error(message);
  }

  return {
    pages: data.data?.pages || [],
    totalPages: data.data?.total_pages || 1,
  };
}

export async function saveSettings(
  endpoint: string,
  body: Record<string, unknown>
): Promise<AdminSettings> {
  return apiFetch<AdminSettings>(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
