import { useEffect, useMemo, useRef } from "react";
import { RateLimitError, rateLimitedUntil } from "./rate-limit";

/**
 * The one way the admin polls.
 *
 * Every live readout (bell, inbox, sync progress, inbox count) used to own a
 * setInterval plus its own focus and visibilitychange listeners. Coming back to
 * the tab fired both listeners, intervals kept running in hidden tabs, and a
 * 429 was swallowed and the next tick went out on schedule anyway, so a rate
 * limit fed itself. A poller here:
 *
 * - chains timeouts (the next run is planned when the last one ends), so runs
 *   never overlap and changing deps never stacks a second interval;
 * - never runs twice at once: a refresh asked for during a run is held and
 *   done once right after it, since that run may have read the old state;
 * - pauses while the tab is hidden and refreshes once, debounced, on return
 *   when its data is older than `staleMs` or a run fell due meanwhile;
 * - backs off on failure (interval x2, x4... up to `maxBackoffMs`) and never
 *   runs before a 429 cool-down from lib/api has ended;
 * - aborts the run in progress when stopped (unmount).
 *
 * The task gets `init` ({ cache: "reload", signal }) to pass to apiFetch: a
 * timer must never be answered from the 15s GET cache. A task reports failure
 * by throwing (or rejecting); that is what drives the backoff.
 */

export interface PollContext {
  signal: AbortSignal;
  /** Pass to apiFetch: bypasses the GET cache and stops waiting when the poller stops. */
  init: RequestInit;
}

export type PollTask = (ctx: PollContext) => unknown;

export interface PollOptions {
  /** Pause between the end of one run and the next. A function is read after every run. Infinity: no timer, only refresh() and visibility. */
  intervalMs: number | (() => number);
  /** Run when the poller starts (default true). */
  immediate?: boolean;
  /** Back on a visible tab, refresh when the last run is at least this old (default: the interval, at most 15s). */
  staleMs?: number;
  /** refresh() calls and visibility returns this close together collapse into one run (default 500ms). */
  debounceMs?: number;
  /** A path the task reads: its family's 429 cool-down holds runs back too (the IP/global one always does). */
  path?: string;
  /** Longest pause after repeated failures (default 5 min). */
  maxBackoffMs?: number;
}

export interface Poller {
  start(): void;
  stop(): void;
  /** Run soon (debounced); after the run in flight, if there is one. A cool-down still holds it. */
  refresh(): void;
  /** Run now, or once more right after the run in flight (resolves after that one). Still waits out a cool-down. */
  runNow(): Promise<void>;
}

const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000;

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function createPoller(task: PollTask, options: PollOptions): Poller {
  const debounceMs = options.debounceMs ?? 500;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const interval = () => (typeof options.intervalMs === "function" ? options.intervalMs() : options.intervalMs);
  const staleMs = () => options.staleMs ?? Math.min(interval(), 15000);

  let active = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let busy = false;
  /** A refresh asked for while a run was in flight: run again when it ends. */
  let pending = false;
  let current: Promise<void> = Promise.resolve();
  let controller: AbortController | null = null;
  let failures = 0;
  /** When the last run started; -Infinity before the first. */
  let lastRun = -Infinity;
  /** When the next timed run is due (kept across a hidden spell). */
  let nextAt = 0;
  /** The retryAt of the last RateLimitError a run threw. */
  let heldUntil = 0;

  const holdLeft = () => Math.max(heldUntil, rateLimitedUntil(options.path)) - Date.now();

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function clearDebounce() {
    if (debounce !== null) clearTimeout(debounce);
    debounce = null;
  }

  function schedule(delay: number) {
    clearTimer();
    if (!active) return;
    nextAt = Date.now() + delay;
    if (!Number.isFinite(delay) || isHidden()) return;
    timer = setTimeout(tick, Math.max(0, delay));
  }

  function nextDelay() {
    const base = interval();
    const backoff = failures ? Math.min(Math.max(maxBackoffMs, base), base * 2 ** failures) : base;
    return Math.max(backoff, holdLeft());
  }

  function tick() {
    timer = null;
    if (!active || busy || isHidden()) return;
    const hold = holdLeft();
    if (hold > 0) {
      schedule(hold);
      return;
    }
    void run();
  }

  function run(): Promise<void> {
    if (busy) return current;
    busy = true;
    clearTimer();
    const own = new AbortController();
    controller = own;
    lastRun = Date.now();
    current = (async () => {
      try {
        await task({ signal: own.signal, init: { cache: "reload", signal: own.signal } });
        failures = 0;
        heldUntil = 0;
      } catch (error) {
        if (own.signal.aborted) return;
        failures += 1;
        heldUntil = error instanceof RateLimitError ? error.retryAt : 0;
      } finally {
        busy = false;
        if (controller === own) controller = null;
        if (active && !own.signal.aborted) {
          if (pending) {
            pending = false;
            // Due now: tick() runs it, or holds it for a cool-down or a hidden tab.
            nextAt = Date.now();
            tick();
          } else {
            schedule(nextDelay());
          }
        }
      }
    })();
    return current;
  }

  function onVisibility() {
    if (!active) return;
    if (isHidden()) {
      // A refresh still debouncing is due on return.
      if (debounce !== null) nextAt = 0;
      clearTimer();
      clearDebounce();
      return;
    }
    if (busy) return;
    const now = Date.now();
    const due = now >= nextAt || (failures === 0 && now - lastRun >= staleMs());
    if (due) refresh();
    else schedule(nextAt - now);
  }

  function refresh() {
    if (!active) return;
    clearDebounce();
    debounce = setTimeout(() => {
      debounce = null;
      if (!active || isHidden()) return;
      if (busy) {
        pending = true;
        return;
      }
      const hold = holdLeft();
      if (hold > 0) schedule(hold);
      else void run();
    }, debounceMs);
  }

  return {
    start() {
      if (active) return;
      active = true;
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
      if (options.immediate === false) {
        lastRun = Date.now();
        schedule(interval());
      } else if (isHidden()) {
        nextAt = 0; // Due as soon as the tab shows.
      } else {
        tick();
      }
    },
    stop() {
      active = false;
      pending = false;
      clearTimer();
      clearDebounce();
      controller?.abort();
      controller = null;
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
    refresh,
    runNow() {
      if (!active) return Promise.resolve();
      clearDebounce();
      if (busy) {
        pending = true;
        // `current` is the follow-up run by the time the run in flight settles.
        return current.then(() => current);
      }
      const hold = holdLeft();
      if (hold > 0) {
        schedule(hold);
        return Promise.resolve();
      }
      return run();
    },
  };
}

export interface PollHandle {
  refresh(): void;
  runNow(): Promise<void>;
}

/**
 * createPoller for a component: runs while mounted and `enabled`. The task and
 * options are read fresh on every run, so passing new closures each render
 * neither restarts the poller nor stacks timers. A new `resetKey` (say, the
 * open thread) does: the old poller stops and the new one starts afresh.
 */
export function usePoll(
  task: PollTask,
  { enabled = true, resetKey, ...options }: PollOptions & { enabled?: boolean; resetKey?: unknown }
): PollHandle {
  const taskRef = useRef(task);
  const optionsRef = useRef(options);
  taskRef.current = task;
  optionsRef.current = options;
  const pollerRef = useRef<Poller | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const opts = optionsRef.current;
    const poller = createPoller((ctx) => taskRef.current(ctx), {
      ...opts,
      intervalMs: () => {
        const value = optionsRef.current.intervalMs;
        return typeof value === "function" ? value() : value;
      },
    });
    pollerRef.current = poller;
    poller.start();
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [enabled, resetKey]);

  return useMemo(() => ({
    refresh: () => pollerRef.current?.refresh(),
    runNow: () => pollerRef.current?.runNow() ?? Promise.resolve(),
  }), []);
}

const WATCH_HARD_STOP_MS = 15 * 60 * 1000;

/**
 * A short-lived watch, such as an OAuth popup's status: a poller started at
 * once whose first run comes one interval later, like the setInterval it
 * replaces. It pauses in a hidden tab, backs off on failures and 429s (to 30s
 * at most, so the popup flow stays responsive) and stops for good after
 * `stopAfterMs` whatever the task does, then calls `onExpire`. That timer runs
 * in a hidden tab too, so a timeout belongs in `onExpire` (close the popup,
 * free the button), not in the task, which a hidden tab never runs. The task
 * decides when it is done and calls stop() on the handle.
 */
export function startWatch(
  task: PollTask,
  intervalMs: number,
  { stopAfterMs = WATCH_HARD_STOP_MS, path, onExpire }: { stopAfterMs?: number; path?: string; onExpire?: () => void } = {}
): Poller {
  const poller = createPoller(task, { intervalMs, immediate: false, maxBackoffMs: 30000, path });
  const hardStop = setTimeout(() => {
    poller.stop();
    onExpire?.();
  }, stopAfterMs);
  poller.start();
  return {
    ...poller,
    stop() {
      clearTimeout(hardStop);
      poller.stop();
    },
  };
}
