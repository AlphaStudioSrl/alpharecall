/**
 * The error a chat turn ends with when nothing came back: the stream closed
 * with no token and no final event, or /chat answered 200 with an empty
 * output. The thread shows it as "{name} non ha risposto." with Riprova.
 */
export const NO_REPLY_ERROR = "Chat reply failed (no answer)";
