// The visitor's send or cancel on a contact, quote or call-back draft card.
// app.tsx owns the visitor token and the signature, so it registers the
// sender; the card only knows the draft id. Nothing reaches the business
// until "confirm" succeeds.

export type DraftDecision = "confirm" | "cancel";
export type DraftState = "draft" | "confirmed" | "cancelled" | "superseded";

export type DraftDecisionResult =
  | { ok: true; state: DraftState; confirmedAt: string | null; deduped: boolean }
  | { ok: false; status: number };

export type RequestDraftSender = (
  draftId: string,
  decision: DraftDecision,
  fields?: Record<string, string>,
) => Promise<DraftDecisionResult>;

let sender: RequestDraftSender | null = null;

export function registerRequestDraftSender(next: RequestDraftSender | null) {
  sender = next;
  return () => {
    if (sender === next) sender = null;
  };
}

export async function sendRequestDraftDecision(
  draftId: string,
  decision: DraftDecision,
  fields?: Record<string, string>,
): Promise<DraftDecisionResult> {
  if (!sender) return { ok: false, status: 0 };
  try {
    return await sender(draftId, decision, fields);
  } catch {
    return { ok: false, status: 0 };
  }
}
