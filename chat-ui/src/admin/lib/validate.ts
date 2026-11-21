/**
 * Checks for the settings fields that take an address: an email, a list of
 * emails, a public web page, a webhook. The server repeats every one of them
 * (class-ar-rest.php, app/schemas.py); these only let the form say what is
 * wrong before anything is sent.
 */

// What PHP's FILTER_VALIDATE_EMAIL takes (class-ar-rest.php is_valid_email):
// ASCII dot-atoms before the @, hostname labels after it, a 2+ letter TLD. A
// looser check here would let through addresses the server then refuses.
const ATOM = "[a-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const EMAIL_RE = new RegExp(`^(?=.{1,64}@)${ATOM}(?:\\.${ATOM})*@(?:${LABEL}\\.)+[a-z]{2,63}$`, "i");

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Comma separated recipients: the clean list and the entries that are not emails. */
export function parseEmailList(value: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of value.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (!isEmail(entry)) invalid.push(entry);
    else if (!emails.some((email) => email.toLowerCase() === entry.toLowerCase())) emails.push(entry);
  }
  return { emails, invalid };
}

function parseHttpUrl(value: string): URL | null {
  const text = value.trim();
  if (!/^https?:\/\//i.test(text) || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.hostname ? url : null;
  } catch {
    return null;
  }
}

/** An http(s) address a visitor can open: a dotted host name or an IP. */
export function isWebUrl(value: string): boolean {
  const url = parseHttpUrl(value);
  return !!url && (url.hostname.includes(".") || url.hostname.startsWith("["));
}

function privateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

/**
 * Why a webhook address is refused, or null when it is fine: http(s) only,
 * no user:password@, and never this server or the local network (loopback,
 * private ranges, link-local and the cloud metadata address). The API checks
 * the resolved address again when it sends.
 */
export function webhookUrlProblem(value: string): "format" | "private" | null {
  const url = parseHttpUrl(value);
  if (!url || url.username || url.password) return "format";
  // URL() has already turned decimal/hex IPv4 spellings into dotted form.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) {
    // IPv6 literals are refused in every layer (PHP, API) so the three agree;
    // a name with a public AAAA record works. Non-global ones read as internal.
    return /^[23][0-9a-f]{0,3}:/.test(host) ? "format" : "private";
  }
  if (host === "localhost" || /\.(localhost|local|internal|lan|home|arpa)$/.test(host)) return "private";
  if (privateIpv4(host)) return "private";
  const labels = host.split(".");
  if (labels.length < 2 || host.length > 253 || labels.some((label) => !label || label.length > 63)) return "format";
  return null;
}

/**
 * Why a link shown to visitors (Dati attività: Google Maps, social profiles)
 * is refused, or null: the webhook rules (no credentials, never this server
 * or the local network) and https:// only, so a visitor never gets a
 * javascript:, data: or plain http: link. class-ar-rest.php and app/schemas.py
 * apply the same rule when the form is saved.
 */
export function publicLinkProblem(value: string): "format" | "private" | null {
  const problem = webhookUrlProblem(value);
  if (problem) return problem;
  return /^https:\/\//i.test(value.trim()) ? null : "format";
}

/**
 * A phone number as a visitor dials it: digits, spaces, ( ) and -, with an
 * optional leading +, and 5 to 20 digits. The server applies the same rule.
 */
export function isPhone(value: string): boolean {
  const text = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(text)) return false;
  const digits = text.replace(/\D/g, "").length;
  return digits >= 5 && digits <= 20;
}
