import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/admin/lib/api";

/**
 * Questions the assistant could not answer (GET /knowledge-gaps): visitor
 * questions whose knowledge search found nothing or whose answer said it had
 * no information, grouped by normalized text. Small talk, tool turns and
 * errors never count.
 */
export interface KnowledgeGap {
  /** Normalized text; what POST /knowledge-gaps/status takes. */
  key: string;
  /** Latest wording, used as the FAQ question. */
  question: string;
  count: number;
  first_seen: string;
  last_seen: string;
  /** guard_blocked: the safety filter refused the message (the visitor was offered the team). */
  reasons: { no_information_reply?: number; no_retrieval_results?: number; guard_blocked?: number };
  /** Inbox thread ids, newest first, at most 5. */
  conversation_ids: number[];
  helpdesk_entry_id: number | null;
}

interface GapsResponse {
  days: number;
  status: string;
  total: number;
  questions: number;
  groups: KnowledgeGap[];
}

export type GapStatus = "open" | "dismissed" | "resolved";

/**
 * A question's group key, as the API computes it (semantic_cache.normalize_text):
 * lowercase words joined by single spaces, apostrophes trimmed from their ends.
 */
export function gapKey(text: string): string {
  const words = (text || "").toLowerCase().match(/[\p{L}\p{N}_']+/gu) || [];
  return words.map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean).join(" ");
}

/** Some asks of this question were refused by the safety filter. */
export function wasFiltered(gap: Pick<KnowledgeGap, "reasons">): boolean {
  return (gap.reasons?.guard_blocked ?? 0) > 0;
}

/**
 * Every ask was refused by the safety filter: the model never saw it, so an
 * FAQ would not answer it next time either. Such a question is shown as
 * filtered, without "Scrivi risposta".
 */
export function filteredOnly(gap: Pick<KnowledgeGap, "reasons" | "count">): boolean {
  return (gap.reasons?.guard_blocked ?? 0) >= Math.max(1, gap.count);
}

/** The API stores naive UTC timestamps; read them as UTC. */
export function gapDate(value: string): string {
  return /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
}

export function useKnowledgeGaps(days = 30) {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loading, setLoading] = useState(true);
  // Support users cannot read them (and only admins can change them): the
  // pages then simply leave the section out.
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<GapsResponse>(`/knowledge-gaps?days=${days}&status=open&limit=50`, { cache: "reload" });
      setGaps(Array.isArray(res?.groups) ? res.groups : []);
      setAvailable(true);
    } catch {
      setGaps([]);
      setAvailable(false);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Change a group's status. The group leaves the list at once and comes back
   * if the request fails. "open" (undo) puts it back.
   */
  const setStatus = useCallback(
    async (gap: KnowledgeGap, status: GapStatus, helpdeskEntryId?: number) => {
      if (status !== "open") setGaps((prev) => prev.filter((g) => g.key !== gap.key));
      try {
        await apiFetch("/knowledge-gaps/status", {
          method: "POST",
          body: JSON.stringify({
            keys: [gap.key],
            status,
            ...(status === "resolved" && helpdeskEntryId ? { helpdesk_entry_id: helpdeskEntryId } : {}),
          }),
        });
        if (status === "open") {
          setGaps((prev) => (prev.some((g) => g.key === gap.key) ? prev : [...prev, gap].sort((a, b) => b.count - a.count)));
        }
      } catch (err) {
        if (status !== "open") setGaps((prev) => (prev.some((g) => g.key === gap.key) ? prev : [...prev, gap].sort((a, b) => b.count - a.count)));
        throw err;
      }
    },
    []
  );

  return { gaps, loading, available, reload: load, setStatus };
}
