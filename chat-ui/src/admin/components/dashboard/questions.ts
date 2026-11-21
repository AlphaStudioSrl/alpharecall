import { useEffect, useState } from "react";
import { ApiRequestError, apiFetch } from "@/admin/lib/api";
import { toNumber } from "@/admin/lib/format";

/**
 * What visitors asked: the questions the assistant could not answer
 * (`/knowledge-gaps`, grouped by normalised text) and the ones asked most
 * (`/top-questions`, from the semantic-cache clusters).
 */

export interface GapGroup {
  key: string;
  question: string;
  count: number;
  last_seen?: string;
  /** Up to five chat thread ids where it was asked, newest first. */
  conversation_ids: number[];
  /** Asks the safety filter refused (reasons.guard_blocked). */
  filtered?: number;
}

export interface GapList {
  /** Gap turns in the period. */
  total: number;
  /** Distinct questions behind them. */
  questions: number;
  groups: GapGroup[];
}

export interface TopQuestion {
  question: string;
  count: number;
  last_seen?: string;
}

/** `enabled` is false where the answer cache (the source) is off for the site. */
export interface TopQuestions {
  enabled: boolean;
  items: TopQuestion[];
  /** The days the list covers, as the API answered (shorter than asked on an older API). */
  days?: number;
}

/** loading: undefined; unavailable (older proxy, no permission): null. */
type Loaded<V> = V | null | undefined;

export function parseGaps(raw: unknown): GapList | null {
  const r = raw as { total?: unknown; questions?: unknown; groups?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.groups)) return null;
  const groups = (r.groups as Record<string, unknown>[])
    .filter((g) => g && typeof g.question === "string" && String(g.question).trim())
    .map((g) => {
      const filtered = toNumber((g.reasons as Record<string, unknown> | undefined)?.guard_blocked);
      return {
        key: String(g.key ?? g.question),
        question: String(g.question).trim(),
        count: Math.max(1, toNumber(g.count)),
        last_seen: typeof g.last_seen === "string" ? g.last_seen : undefined,
        conversation_ids: Array.isArray(g.conversation_ids) ? g.conversation_ids.map(Number).filter(Number.isFinite) : [],
        ...(filtered > 0 ? { filtered } : {}),
      };
    });
  return { total: toNumber(r.total), questions: toNumber(r.questions ?? groups.length), groups };
}

/**
 * Every ask of the question was refused by the safety filter: the model never
 * saw it, so an FAQ would not answer it. Oggi leaves such questions out of
 * its "Rispondi" row; Addestramento and Statistiche list them as filtered.
 */
export function gapFilteredOnly(group: Pick<GapGroup, "filtered" | "count">): boolean {
  return (group.filtered ?? 0) >= Math.max(1, group.count);
}

/** The questions the Oggi "Rispondi" row may quote: FAQ work only, newest groups first. */
export function answerableGapQuestions(list: GapList | null | undefined): string[] | null {
  return list ? list.groups.filter((g) => !gapFilteredOnly(g)).map((g) => g.question) : null;
}

export function parseTopQuestions(raw: unknown): TopQuestions | null {
  const r = raw as { enabled?: unknown; items?: unknown; days?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.items)) return null;
  const days = toNumber(r.days);
  const items = (r.items as Record<string, unknown>[])
    .filter((q) => q && typeof q.question === "string" && String(q.question).trim())
    .map((q) => ({
      question: String(q.question).trim(),
      count: toNumber(q.count),
      last_seen: typeof q.last_seen === "string" ? q.last_seen : undefined,
    }));
  return { enabled: r.enabled !== false, items, ...(days > 0 ? { days } : {}) };
}

interface LoadedState<V> {
  value: Loaded<V>;
  /** HTTP status of a failed request (0 when the failure had none). */
  errorStatus?: number;
}

function useLoadedState<V>(path: string | null, parse: (raw: unknown) => V | null, nonce: number): LoadedState<V> {
  const [state, setState] = useState<{ path: string | null } & LoadedState<V>>({ path: null, value: undefined });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    apiFetch<unknown>(path, nonce ? { cache: "reload" } : {})
      .then((raw) => alive && setState({ path, value: parse(raw) }))
      .catch((error: unknown) => alive && setState({ path, value: null, errorStatus: error instanceof ApiRequestError ? error.status : 0 }));
    return () => {
      alive = false;
    };
  }, [path, parse, nonce]);
  if (!path) return { value: null };
  return state.path === path ? state : { value: undefined };
}

function useLoaded<V>(path: string | null, parse: (raw: unknown) => V | null, nonce: number): Loaded<V> {
  return useLoadedState(path, parse, nonce).value;
}

/** Open gap groups of the last `days` days; `days` null skips the request. */
export function useKnowledgeGaps(days: number | null, limit: number, nonce = 0): Loaded<GapList> {
  return useLoaded(days ? `/knowledge-gaps?days=${days}&status=open&limit=${limit}` : null, parseGaps, nonce);
}

/** The periods the API counts: 7, 30 and 90 days. */
export function topQuestionsDays(days: number): 7 | 30 | 90 {
  return days <= 7 ? 7 : days <= 30 ? 30 : 90;
}

/**
 * The most asked questions of the selected period. An API from before the
 * 90-day period refuses it (422): the last 30 days stand in, marked as such
 * (`days: 30`) so the caption can say so. Any other failure (a 5xx, a
 * timeout) stays a failure: falling back there would claim a limit that
 * does not exist.
 */
export function useTopQuestions(days: number): Loaded<TopQuestions> {
  const asked = topQuestionsDays(days);
  const { value: first, errorStatus } = useLoadedState(`/top-questions?days=${asked}`, parseTopQuestions, 0);
  const fallsBack = first === null && errorStatus === 422 && asked > 30;
  const fallback = useLoaded(fallsBack ? "/top-questions?days=30" : null, parseTopQuestions, 0);
  if (!fallsBack) return first;
  return fallback && !fallback.days ? { ...fallback, days: 30 } : fallback;
}
