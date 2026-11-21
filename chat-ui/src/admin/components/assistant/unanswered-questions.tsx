import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { formatRelativeTime } from "@/admin/lib/format";
import { useNavigate } from "@/admin/lib/nav-context";
import { IconButton, Tag } from "@/admin/components/shared/kit";
import { Button } from "@/components/ui/button";
import { HelpCircle, MessageSquare, X } from "@/components/icons";
import { filteredOnly, gapDate, useKnowledgeGaps, wasFiltered, type KnowledgeGap } from "./use-knowledge-gaps";

const PREVIEW = 4;

/** "chiesto 5 volte · ultima 2g fa" */
export function gapMeta(t: (key: string) => string, gap: KnowledgeGap): string {
  const asked = gap.count === 1 ? t("assistant.gaps.askedOnce") : interpolate(t("assistant.gaps.asked"), { n: gap.count });
  const meta = `${asked} · ${interpolate(t("assistant.gaps.last"), { when: formatRelativeTime(gapDate(gap.last_seen)) })}`;
  return wasFiltered(gap) ? `${meta} · ${t("assistant.gaps.filteredHint")}` : meta;
}

/**
 * Contenuti: questions visitors asked that the assistant could not answer
 * from its content, most asked first. "Scrivi risposta" opens a new FAQ with
 * the question filled in; the FAQ page marks the gap resolved once saved.
 */
export function UnansweredQuestions({ days = 30, canWrite = true }: { days?: number; canWrite?: boolean }) {
  const { t } = useApp();
  const navigate = useNavigate();
  const { gaps, loading, available, setStatus } = useKnowledgeGaps(days);
  const [showAll, setShowAll] = useState(false);

  if (!available || loading) return null;

  const shown = showAll ? gaps : gaps.slice(0, PREVIEW);

  const dismiss = async (gap: KnowledgeGap) => {
    try {
      await setStatus(gap, "dismissed");
      toast(t("assistant.gaps.dismissed"), {
        action: { label: t("assistant.faq.undo"), onClick: () => void setStatus(gap, "open").catch(() => toast.error(t("assistant.gaps.failed"))) },
      });
    } catch {
      toast.error(t("assistant.gaps.failed"));
    }
  };

  return (
    <section className="as-section" aria-labelledby="as-gaps-title">
      <div className="as-section-head">
        <h2 id="as-gaps-title" className="as-section-title">{t("assistant.gaps.title")}</h2>
        {gaps.length > 0 && <Tag tone="violet">{gaps.length}</Tag>}
        <span className="as-spacer" />
        {!canWrite && gaps.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => navigate("impostazioni/piano")}>
            {t("assistant.gaps.unlock")}
          </Button>
        )}
        {gaps.length > PREVIEW && (
          <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? t("assistant.faq.showFewer") : t("assistant.gaps.seeAll")}
          </Button>
        )}
      </div>
      {!canWrite && gaps.length > 0 && <p className="px-1 text-xs text-ink-3">{t("assistant.gaps.lockedHint")}</p>}
      {gaps.length === 0 ? (
        <p className="as-gaps-empty">{interpolate(t("assistant.gaps.empty"), { days })}</p>
      ) : (
        <ul className="ark-rows ark-on-fill as-gaps" aria-labelledby="as-gaps-title">
          {shown.map((gap, i) => (
            <li key={gap.key} className="as-gap">
              <HelpCircle className="as-gap-icon" aria-hidden="true" />
              <span className="as-gap-text">
                <b>
                  {gap.question}
                  {wasFiltered(gap) && <Tag tone="warn" className="ml-2 align-middle">{t("assistant.gaps.filtered")}</Tag>}
                </b>
                <small>{gapMeta(t, gap)}</small>
              </span>
              <span className="as-gap-actions">
                {gap.conversation_ids.length > 0 && (
                  <IconButton
                    icon={MessageSquare}
                    size="sm"
                    label={t("assistant.gaps.openConversation")}
                    onClick={() => navigate("inbox/conversazioni", { params: { thread: String(gap.conversation_ids[0]) } })}
                  />
                )}
                {/* Answers are FAQ entries: on plans without them the FAQ page is locked. */}
                {canWrite && !filteredOnly(gap) && (
                  <Button
                    size="sm"
                    variant={i === 0 ? "default" : "secondary"}
                    className="as-btn-sm"
                    onClick={() => navigate("assistente/faq", { intent: "add-faq", params: { q: gap.question, gap: gap.key } })}
                  >
                    {t("assistant.gaps.write")}
                  </Button>
                )}
                <IconButton icon={X} size="sm" label={`${t("assistant.gaps.dismiss")}: ${gap.question}`} onClick={() => void dismiss(gap)} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
