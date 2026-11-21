import { useEffect, useState, type ClipboardEvent } from "react";
import { CHAT_MESSAGE_MAX, pasteIsCut, showsMessageCounter } from "./widget-limits";

/**
 * The length limit of a message composer (card fgcgu1tr9ee0): the textarea
 * keeps its maxlength, a counter shows from 80% of it, and a paste the
 * maxlength cut is said, not silent. The notice stays while the text is still
 * at the limit and goes once it is shorter (edited or sent).
 */
export function useMessageLimit(value: string, max: number = CHAT_MESSAGE_MAX) {
  const [cut, setCut] = useState(false);
  const atLimit = value.length >= max;
  useEffect(() => {
    if (!atLimit) setCut(false);
  }, [atLimit]);
  return {
    max,
    count: value.length,
    showCount: showsMessageCounter(value.length, max),
    cut: cut && atLimit,
    onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
      const field = event.currentTarget;
      const pasted = event.clipboardData?.getData("text") ?? "";
      if (pasted && pasteIsCut(field.value, pasted, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, max)) {
        setCut(true);
      }
    },
  };
}
