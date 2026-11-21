import { getConfig } from "./config";

/**
 * Bundled visitor avatar placeholders.
 *
 * Anonymous visitors used to get a coloured circle with the first letter of
 * their name, which made a conversation list look like a spreadsheet. These
 * are 32 illustrated placeholders shipped with the plugin
 * (assets/img/avatars/avatar-01..32.webp, ~1 KB each).
 *
 * They are deliberately illustrations rather than photorealistic faces: a
 * placeholder that looks like a photo of a real person misrepresents who the
 * visitor is.
 */

export const AVATAR_COUNT = 32;

/**
 * Stable 32-bit hash. Same visitor always maps to the same avatar, across
 * reloads and across every screen that renders them, so the avatar reads as
 * an identity rather than random decoration.
 */
function hashKey(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Resolve a placeholder avatar URL for a visitor.
 *
 * @param key Anything stable for the visitor: id, email, or display name.
 *            Falsy keys still return an avatar so nothing renders empty.
 */
export function placeholderAvatar(key: string | number | null | undefined): string {
  // getConfig() reads a global the host page injects; tolerate it being
  // absent (tests, or an admin screen rendered before localize runs) rather
  // than throwing inside a render.
  let base = "";
  try {
    base = (getConfig()?.assetsUrl || "").replace(/\/$/, "");
  } catch {
    return "";
  }
  if (!base) return "";
  const index = (hashKey(String(key ?? "anon")) % AVATAR_COUNT) + 1;
  return `${base}/img/avatars/avatar-${String(index).padStart(2, "0")}.webp`;
}

/**
 * The visitor's own avatar when they have one, otherwise a stable placeholder.
 */
export function avatarFor(
  explicitUrl: string | null | undefined,
  key: string | number | null | undefined
): string {
  return explicitUrl || placeholderAvatar(key);
}
