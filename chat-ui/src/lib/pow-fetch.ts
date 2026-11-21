import { parsePowChallenge, powHeader, solveProofOfWork } from "@/lib/proof-of-work";

type PowFetchOptions = {
  onChallenge?: () => void;
  onSolved?: () => void;
};

/**
 * Asks the WordPress proxy to hand a bot-shield challenge back as a 200 with
 * this marker instead of a 428. The challenge is the same and still has to be
 * solved; only the browser stops logging the expected challenge as a red
 * "428 Precondition Required" on every widget open. Proxies (or the API
 * itself) that ignore the header keep answering 428, which is handled too.
 */
export const POW_INLINE_REQUEST_HEADER = "X-AlphaRecall-PoW-Inline";
export const POW_INLINE_RESPONSE_HEADER = "X-AlphaRecall-PoW-Challenge";

const isInlineChallenge = (response: Response) =>
  typeof response?.headers?.get === "function" && response.headers.get(POW_INLINE_RESPONSE_HEADER) === "1";

/** An inline challenge left unanswered reads as the 428 callers already handle. */
const asPreconditionRequired = async (response: Response) => {
  if (!isInlineChallenge(response)) return response;
  const body = await response.text().catch(() => "");
  return new Response(body, {
    status: 428,
    statusText: "Precondition Required",
    headers: { "Content-Type": response.headers.get("Content-Type") || "application/json" },
  });
};

export async function fetchWithProofOfWork(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: PowFetchOptions = {}
): Promise<Response> {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const retryInput = isRequest ? (input as Request).clone() : input;
  const headersFor = (base: Request | null) => {
    const headers = new Headers(base ? base.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set(POW_INLINE_REQUEST_HEADER, "1");
    return headers;
  };
  // A plain header object stays a plain object on the first attempt.
  const plainHeaders = !isRequest && init?.headers && !(init.headers instanceof Headers) && !Array.isArray(init.headers);
  const firstHeaders = plainHeaders
    ? { ...(init!.headers as Record<string, string>), [POW_INLINE_REQUEST_HEADER]: "1" }
    : headersFor(isRequest ? (input as Request) : null);
  const response = await fetch(input, { ...init, headers: firstHeaders });
  if (response.status !== 428 && !isInlineChallenge(response)) return response;

  let challenge = null;
  try {
    challenge = parsePowChallenge(await response.clone().json());
  } catch {
    return asPreconditionRequired(response);
  }
  if (!challenge) return asPreconditionRequired(response);

  opts.onChallenge?.();
  const nonce = await solveProofOfWork(challenge, { signal: init?.signal || undefined });
  opts.onSolved?.();
  const headers = headersFor(isRequest ? (retryInput as Request) : null);
  headers.set("X-AlphaRecall-PoW", powHeader(challenge, nonce));
  return asPreconditionRequired(await fetch(retryInput, { ...init, headers }));
}
