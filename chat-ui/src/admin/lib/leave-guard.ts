/**
 * "You have unsaved changes" before leaving a page.
 *
 * Pages report what they hold with useUnsavedChanges(): `unsaved` for edits
 * that are not on the server and will not get there on their own (a failed
 * autosave, a form with a Save button), `pending` for an autosave still on
 * its way. Leaving the page inside the app (top bar, sub nav, WordPress
 * menu, Back) asks only for `unsaved`: an autosave in flight is flushed when
 * the page unmounts. Closing or reloading the tab asks for both, since a
 * debounced save that has not started yet dies with the page.
 *
 * The in-app question is a native confirm(): it blocks, so the router can ask
 * synchronously, and the browser makes it accessible. Nothing is asked when
 * everything is saved.
 */
import { useEffect, useId } from "react";
import { useApp } from "@/admin/app-context";

export interface LeaveState {
  unsaved?: boolean;
  pending?: boolean;
  /** The question asked before leaving, in the user's language. */
  message?: string;
}

const FALLBACK_MESSAGE = "Ci sono modifiche non salvate. Se esci adesso andranno perse. Vuoi uscire lo stesso?";
const states = new Map<string, LeaveState>();
let listening = false;
/** When the user last said "leave anyway"; see confirmLeave(). */
let confirmedAt = 0;
const CONFIRM_GRACE_MS = 2000;

function blocking(includePending: boolean): LeaveState | undefined {
  for (const s of states.values()) {
    if (s.unsaved || (includePending && s.pending)) return s;
  }
  return undefined;
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  const state = blocking(true);
  if (!state || Date.now() - confirmedAt < CONFIRM_GRACE_MS) return;
  event.preventDefault();
  // Older Chrome and Safari need returnValue; browsers show their own text.
  event.returnValue = state.message || FALLBACK_MESSAGE;
}

function sync(): void {
  const want = states.size > 0;
  if (want === listening) return;
  listening = want;
  if (want) window.addEventListener("beforeunload", onBeforeUnload);
  else window.removeEventListener("beforeunload", onBeforeUnload);
}

/** Register (or clear, with an empty state) what one page holds. */
export function setLeaveState(key: string, state: LeaveState): void {
  if (state.unsaved || state.pending) states.set(key, state);
  else states.delete(key);
  sync();
}

export function hasUnsavedChanges({ includePending = false } = {}): boolean {
  return blocking(includePending) !== undefined;
}

/**
 * True when the user may leave the page: nothing unsaved, or they said so.
 * The registrations stay (the page's unmount clears its own); a yes only
 * keeps the browser from asking a second time for the same edits when the
 * switch turns into a page load right after (a URL pushState refuses).
 */
export function confirmLeave(): boolean {
  const state = blocking(false);
  if (!state) return true;
  const ok = window.confirm(state.message || FALLBACK_MESSAGE);
  if (ok) confirmedAt = Date.now();
  return ok;
}

/**
 * Report this page's unsaved edits; cleared on unmount.
 *
 *   useUnsavedChanges({ unsaved: dirty });
 *   useUnsavedChanges({ unsaved: status === "failed", pending: status === "pending" });
 */
export function useUnsavedChanges({ unsaved = false, pending = false }: Pick<LeaveState, "unsaved" | "pending">): void {
  const key = useId();
  const { t } = useApp();
  const message = t("common.unsavedLeave");
  useEffect(() => {
    setLeaveState(key, { unsaved, pending, message });
  }, [key, unsaved, pending, message]);
  useEffect(() => () => setLeaveState(key, {}), [key]);
}

/** Tests only. */
export function resetLeaveGuard(): void {
  states.clear();
  confirmedAt = 0;
  sync();
}
