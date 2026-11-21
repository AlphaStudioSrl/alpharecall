// The hand-off card asks a visitor who does not want to wait for an e-mail, then
// for optional details. app.tsx owns the visitor token, the signature and the chat,
// so it registers the sender; the card only knows the two steps.

export type HandoffContactStage = "details" | "sent";
export type HandoffContactBody = { email: string } | { details: string } | { finish: true };
export type HandoffContactResult = { ok: true; stage: HandoffContactStage } | { ok: false; status: number };
export type HandoffContactSender = (body: HandoffContactBody) => Promise<HandoffContactResult>;

let sender: HandoffContactSender | null = null;
let newChat: (() => void) | null = null;

export function registerHandoffContactSender(next: HandoffContactSender | null) {
  sender = next;
  return () => {
    if (sender === next) sender = null;
  };
}

export function registerHandoffNewChat(next: (() => void) | null) {
  newChat = next;
  return () => {
    if (newChat === next) newChat = null;
  };
}

/** False where the card only previews (Prova, the dashboard): no chat to attach an e-mail to. */
export const canLeaveHandoffContact = () => sender !== null;

export async function sendHandoffContact(body: HandoffContactBody): Promise<HandoffContactResult> {
  if (!sender) return { ok: false, status: 0 };
  return sender(body);
}

export function startNewChatFromHandoff() {
  newChat?.();
}
