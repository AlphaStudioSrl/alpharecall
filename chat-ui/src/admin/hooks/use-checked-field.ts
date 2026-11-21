import { useEffect, useId, useRef, useState } from "react";

/**
 * A text setting edited in place that must pass a check first (an email, a
 * URL). The typed text lives here and is saved only on `save` (Fatto, Enter,
 * leaving the field), so a half-typed or wrong address is never sent.
 *
 * `commit` saves and resolves once the server has the value; the stored one
 * changes only then. When it throws, the stored value stays as it was and
 * the field keeps the typed text with the reason (`failed`) until the next
 * edit or save: a failed save never looks saved (card o6zjpvqxb2zl).
 *
 * @param check returns the error to show, or null when the value may be saved.
 * @param describe turns a failed commit into the line shown under the field.
 */
export function useCheckedField(
  saved: string,
  check: (value: string) => string | null,
  commit: (value: string) => Promise<unknown>,
  describe: (error: unknown) => string,
) {
  const errorId = useId();
  const [draft, setDraft] = useState(saved);
  const [shown, setShown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const failedRef = useRef(failed);
  failedRef.current = failed;
  // Enter then blur: one request for the same value, not two racing ones.
  const inFlight = useRef<{ value: string; done: Promise<boolean> } | null>(null);
  const error = check(draft);

  // A save (or another tab) changed the stored value: follow it unless the
  // owner is holding text that cannot be saved, or that failed to save.
  useEffect(() => {
    setDraft((current) => (check(current) || failedRef.current ? current : saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const visibleError = failed ?? (shown ? error : null);

  /** Saves the typed value; true once it is stored (or nothing changed). */
  const save = async (): Promise<boolean> => {
    if (error) {
      setShown(true);
      return false;
    }
    const value = draft.trim();
    if (inFlight.current?.value === value) return inFlight.current.done;
    if (value === saved.trim()) {
      setFailed(null);
      return true;
    }
    setSaving(true);
    // Started on the next microtask, so `inFlight` is set before it can settle.
    const done = Promise.resolve().then(async () => {
      try {
        await commit(value);
        setFailed(null);
        return true;
      } catch (cause) {
        setFailed(describe(cause));
        return false;
      } finally {
        if (inFlight.current?.value === value) inFlight.current = null;
        setSaving(false);
      }
    });
    inFlight.current = { value, done };
    return done;
  };

  return {
    draft,
    error,
    visibleError,
    errorId,
    saving,
    failed,
    save,
    /** Show the reason now (a Fatto/Enter on a field that cannot be saved). */
    reveal: () => setShown(true),
    /** Back to the stored value (Escape). */
    reset: () => { setDraft(saved); setShown(false); setFailed(null); },
    inputProps: {
      value: draft,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setDraft(event.target.value);
        setFailed(null);
      },
      onBlur: () => setShown(true),
      // A refused save is not a wrong value: described, not marked invalid.
      "aria-invalid": shown && error ? true : undefined,
      "aria-describedby": visibleError ? errorId : undefined,
    },
  };
}
