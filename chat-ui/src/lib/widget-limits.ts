/**
 * Lengths the widget editor, the WordPress save and the visitor widget agree
 * on (card caa2u6e305z0). PHP mirrors them in AlphaRecall_Settings::WIDGET_TITLE_MAX,
 * WELCOME_MESSAGE_MAX, HEADER_TITLE_MAX and LAUNCHER_LABEL_MAX: keep the three
 * in step.
 */

/** The welcome title: longer ones pushed the title up under the widget header. */
export const WIDGET_TITLE_MAX = 80;

/** The welcome text under the title: about five lines in a 420px panel. */
export const WELCOME_MESSAGE_MAX = 300;

/**
 * Aspetto > Intestazione > Nome dell'attività (chat_config.headerTitle): one
 * line of the header next to the avatar; the widget cuts what does not fit
 * with an ellipsis (card 3xsmdn92aj09). AlphaRecall_Settings::HEADER_TITLE_MAX.
 */
export const HEADER_TITLE_MAX = 60;

/** Pulsante > Testo del pulsante chat (chat_config.launcherLabel): one line on the launcher. AlphaRecall_Settings::LAUNCHER_LABEL_MAX. */
export const LAUNCHER_LABEL_MAX = 40;

/**
 * A message typed in the visitor widget or in Assistente > Prova (card
 * fgcgu1tr9ee0). Both composers stop at this length and show a counter near
 * it. The API has no per-message limit of its own (WorkflowInvokeRequest.input
 * is a free dict, extract_user_text returns it whole); the only server bound is
 * the WordPress proxy's 256 KB request body (AlphaRecall_Chat::PUBLIC_MAX_BODY_BYTES),
 * far above this. Counted in UTF-16 units, as the browser's maxlength counts.
 */
export const CHAT_MESSAGE_MAX = 2000;

/** The counter of a message composer shows from this share of the limit (1600 of 2000). */
export const MESSAGE_COUNTER_FROM = 0.8;

/** Whether the composer shows "n/max". */
export function showsMessageCounter(length: number, max: number = CHAT_MESSAGE_MAX): boolean {
  return length >= Math.ceil(max * MESSAGE_COUNTER_FROM);
}

/**
 * Whether pasting `pasted` over the selection [start, end) of `value` goes past
 * `max`, so the browser's maxlength silently drops the end of it.
 */
export function pasteIsCut(value: string, pasted: string, start: number, end: number, max: number = CHAT_MESSAGE_MAX): boolean {
  const selected = Math.max(0, Math.min(end, value.length) - Math.min(start, value.length));
  return value.length - selected + pasted.length > max;
}

/** Characters as PHP's mb_strlen counts them (code points, not UTF-16 units). */
export function textLength(text: string): number {
  return Array.from(text).length;
}

/**
 * `text` cut to `max` characters for display. A value saved before the limit
 * existed ends on a word with an ellipsis instead of mid-word.
 */
export function clampText(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max - 1).join("");
  const space = head.search(/\s\S*$/);
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
}
