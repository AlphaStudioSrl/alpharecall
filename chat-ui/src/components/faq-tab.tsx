"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, MessageCircle, Search, X } from "lucide-react";
import { getChatStrings } from "@/strings";

interface FaqEntry {
  id: number | string;
  question: string;
  answer: string;
  category?: string;
  category_id?: number | null;
  enabled?: boolean;
}

interface FaqTabProps {
  entries: FaqEntry[];
  /** Sends the question to the chat ("Chiedi in chat" under an answer). */
  onAskAbout?: (question: string) => void;
  /** Back to the chat composer ("Non trovi? Chiedi a ..."). */
  onOpenChat?: () => void;
  /** The assistant's name for the bottom call to action. */
  assistantName?: string;
  className?: string;
}

/**
 * The FAQ as the chat's quiet second tab: search first, then every topic as a
 * group of questions that open in place. Every answer can continue in the chat
 * so nobody hits a dead end.
 */
export function FaqTab({ entries, onAskAbout, onOpenChat, assistantName, className }: FaqTabProps) {
  const strings = getChatStrings();
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<FaqEntry["id"] | null>(null);
  const baseId = React.useId();

  const visible = useMemo(() => entries.filter((e) => e.enabled !== false), [entries]);
  const categoryOf = React.useCallback(
    (e: FaqEntry) => e.category?.trim() || strings.faqGeneralCategory,
    [strings.faqGeneralCategory],
  );

  const query = search.trim().toLowerCase();
  const matches = useMemo(
    () => (query
      ? visible.filter((e) => e.question.toLowerCase().includes(query) || e.answer.toLowerCase().includes(query))
      : visible),
    [visible, query],
  );

  const groups = useMemo(() => {
    const map = new Map<string, FaqEntry[]>();
    for (const entry of matches) {
      const cat = categoryOf(entry);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(entry);
    }
    return [...map.entries()]
      .map(([name, items]) => ({ name, items }))
      // Topics keep the order the tenant wrote them in; uncategorized goes last.
      .sort((a, b) => Number(a.name === strings.faqGeneralCategory) - Number(b.name === strings.faqGeneralCategory));
  }, [matches, categoryOf, strings.faqGeneralCategory]);

  const askLabel = strings.faqAskAssistant.replace("{name}", assistantName || strings.assistantFallbackName);

  if (visible.length === 0) {
    return (
      <div className={`ar-faq ar-faq--empty ar-faq-fade-in ${className || ""}`}>
        <BookOpen aria-hidden="true" className="ar-faq-empty-icon" />
        <p className="ar-faq-empty-title">{strings.faqEmptyTitle}</p>
        <p className="ar-faq-empty-text">{strings.faqEmptyDesc}</p>
      </div>
    );
  }

  return (
    <div className={`ar-faq ${className || ""}`}>
      <div className="ar-faq-scroll">
        <div className="ar-faq-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={strings.faqSearchPlaceholder}
            placeholder={strings.faqSearchPlaceholder}
          />
          {search ? (
            <button type="button" className="ar-faq-clear" onClick={() => setSearch("")} aria-label={strings.faqClearSearch}>
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {query ? (
          <p className="ar-faq-count" role="status">
            {matches.length === 1
              ? strings.faqResultsCountOne
              : matches.length
                ? strings.faqResultsCount.replace("{n}", String(matches.length))
                : strings.faqNoResults}
          </p>
        ) : null}

        {groups.map((group, groupIndex) => {
          const headingId = `${baseId}-g${groupIndex}`;
          const titled = groups.length > 1 || group.name !== strings.faqGeneralCategory;
          return (
            <section key={group.name} className="ar-faq-group ar-faq-fade-in"
              aria-labelledby={titled ? headingId : undefined} aria-label={titled ? undefined : group.name}>
              {titled ? (
                <h3 id={headingId} className="ar-faq-group-title">{group.name}</h3>
              ) : null}
              <ul className="ar-faq-list">
                {group.items.map((entry) => {
                  const expanded = openId === entry.id;
                  const panelId = `${baseId}-a${groupIndex}-${String(entry.id).replace(/[^\w-]/g, "")}`;
                  return (
                    <li key={entry.id} className="ar-faq-item" data-open={expanded ? "true" : undefined}>
                      <button type="button" className="ar-faq-question" aria-expanded={expanded} aria-controls={panelId}
                        onClick={() => setOpenId(expanded ? null : entry.id)}>
                        <span>{entry.question}</span>
                        <ChevronDown aria-hidden="true" />
                      </button>
                      {expanded ? (
                        <div id={panelId} role="region" aria-label={entry.question} className="ar-faq-answer">
                          <p>{entry.answer}</p>
                          {onAskAbout ? (
                            <button type="button" className="ar-faq-ask" onClick={() => onAskAbout(entry.question)}>
                              <MessageCircle aria-hidden="true" />{strings.faqAskAbout}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {onOpenChat ? (
        <div className="ar-faq-footer">
          <button type="button" className="ar-faq-cta" onClick={onOpenChat}>
            <MessageCircle aria-hidden="true" />{askLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
