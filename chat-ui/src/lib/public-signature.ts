export type PublicChatSignature = {
  chatSig: string;
  chatTs: string;
};

const DEFAULT_REFRESH_SKEW_SECONDS = 300;

export function parsePublicChatSignature(value: unknown): PublicChatSignature | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const chatSig = typeof record.chatSig === "string" ? record.chatSig : "";
  const chatTs = typeof record.chatTs === "string" ? record.chatTs : "";
  if (!/^[a-f0-9]{64}$/i.test(chatSig) || !/^\d+$/.test(chatTs)) return null;
  return { chatSig, chatTs };
}

export function publicSignatureNeedsRefresh(
  signature: PublicChatSignature,
  ttlSeconds: number,
  nowMs = Date.now(),
): boolean {
  const issuedAt = Number(signature.chatTs);
  if (!signature.chatSig || !Number.isFinite(issuedAt) || issuedAt <= 0) return true;
  const safeTtl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 3600;
  const skew = Math.min(DEFAULT_REFRESH_SKEW_SECONDS, Math.floor(safeTtl / 2));
  return nowMs >= (issuedAt + safeTtl - skew) * 1000;
}

export function publicSignatureRefreshDelayMs(
  signature: PublicChatSignature,
  ttlSeconds: number,
  nowMs = Date.now(),
): number {
  const issuedAt = Number(signature.chatTs);
  const safeTtl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 3600;
  const skew = Math.min(DEFAULT_REFRESH_SKEW_SECONDS, Math.floor(safeTtl / 2));
  if (!signature.chatSig || !Number.isFinite(issuedAt) || issuedAt <= 0) return 0;
  return Math.max(0, (issuedAt + safeTtl - skew) * 1000 - nowMs);
}
