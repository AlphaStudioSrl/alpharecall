import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/admin/app-context";
import { NavLink } from "@/admin/lib/nav-context";
import { formatShortDate } from "@/admin/lib/datetime";
import { Avatar, IconButton, KeyValue, Status } from "@/admin/components/shared/kit";
import { fetchVisitor, type Visitor } from "@/admin/hooks/use-visitors";
import type { ChatMessage, ChatThread } from "@/admin/hooks/use-conversations";
import { ArrowLeft, FileText, Globe, ShieldBan, Users, ExternalLink } from "@/components/icons";
import { avatarName } from "./conversation-list";
import { chatOutcomes, chatSources, smartTime, sourceLabel, tf, useBotName, visitorEmail, visitorName } from "./inbox-format";

interface VisitorContextProps {
  thread: ChatThread;
  messages: ChatMessage[];
  onBlacklistVisitor?: (threadId: number, visitorId: string) => void;
  /** Narrow screens: back to the thread. */
  onClose?: () => void;
}

/**
 * The right pane of the inbox: who the visitor is, what came out of this chat
 * (the records the assistant's tools created) and what its answers were
 * built from.
 */
export function VisitorContext({ thread, messages, onBlacklistVisitor, onClose }: VisitorContextProps) {
  const { t, isAdmin } = useApp();
  const bot = useBotName();
  const visitorId = thread.visitor?.id ?? null;
  const [profile, setProfile] = useState<Visitor | null>(null);

  // The thread carries a visitor summary; the directory entry adds consent,
  // first/last visit and the number of chats.
  useEffect(() => {
    setProfile(null);
    if (!visitorId) return;
    let alive = true;
    fetchVisitor(visitorId)
      .then((v) => { if (alive) setProfile(v); })
      .catch(() => { /* the summary on the thread is enough to show */ });
    return () => { alive = false; };
  }, [visitorId]);

  const name = visitorName(thread, t);
  const email = visitorEmail(thread) || profile?.email || undefined;
  const outcomes = useMemo(() => chatOutcomes(thread, messages, t, bot), [thread, messages, t, bot]);
  const sources = useMemo(() => chatSources(messages), [messages]);
  const anonymous = !thread.visitor?.display_name && !thread.visitor_name;

  const facts: Array<[React.ReactNode, React.ReactNode]> = [];
  if (profile?.unverified_email && profile.unverified_email !== email) facts.push([t("inboxPage.context.unverified"), profile.unverified_email]);
  if (profile) {
    facts.push([
      t("inboxPage.context.chats"),
      tf(t, "inboxPage.context.chatsValue", { n: profile.thread_count ?? 1, date: formatShortDate(profile.created_at) }),
    ]);
    if (profile.last_seen_at) facts.push([t("inboxPage.context.lastSeen"), smartTime(profile.last_seen_at, t)]);
    facts.push([
      t("inboxPage.context.consent"),
      profile.notification_consent
        ? <span className="ark-c-accent">{t("inboxPage.context.consentYes")}</span>
        : <span className="ar-faint">{t("inboxPage.context.consentNo")}</span>,
    ]);
  }
  if (thread.visitor?.wp_user_id) facts.push([t("inboxPage.context.wp"), t("inboxPage.context.wpLinked")]);
  if (thread.visitor?.is_banned || profile?.is_banned) {
    facts.push([t("inboxPage.context.blocked"), <span className="ark-c-red">{t("inboxPage.context.blockedValue")}</span>]);
  }

  return (
    <div className="ar-ctx" aria-label={t("inboxPage.context.label")}>
      {onClose && (
        <IconButton icon={ArrowLeft} label={t("common.back")} onClick={onClose} className="ar-ctx-back" />
      )}
      <div className="ar-ctx-who">
        <Avatar name={avatarName(thread, t("common.visitor"))} src={thread.visitor?.avatar_url} size="l" />
        <div>
          <h3>{name}</h3>
          <p className={email ? undefined : "ar-faint"}>{email || (anonymous ? t("inboxPage.noContact") : t("inboxPage.context.anonymous"))}</p>
        </div>
      </div>

      {facts.length > 0 && <KeyValue items={facts} className="ar-ctx-kv" />}

      {outcomes.length > 0 && (
        <section className="ar-ctx-section" aria-labelledby={`ctx-out-${thread.id}`}>
          <h4 id={`ctx-out-${thread.id}`} className="ark-lbl">{t("inboxPage.context.fromChat")}</h4>
          <ul className="ar-ctx-cards">
            {outcomes.map((card) => (
              <li key={card.key} className="ar-ctx-card">
                <div className="ar-ctx-card-top">
                  <b>{card.title}</b>
                  <Status tone={card.status.tone}>{card.status.label}</Status>
                </div>
                <span className="ar-ctx-card-detail">{card.detail}</span>
                {isAdmin && card.link && (
                  <NavLink to="richieste/elenco" params={card.link} className="ar-ctx-link">
                    {t("inboxPage.context.openRequest")}
                  </NavLink>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sources.length > 0 && (
        <section className="ar-ctx-section" aria-labelledby={`ctx-src-${thread.id}`}>
          <h4 id={`ctx-src-${thread.id}`} className="ark-lbl">{tf(t, "inboxPage.context.sources", { bot })}</h4>
          <ul className="ar-ctx-sources">
            {sources.map((source) => (
              <li key={source.url || source.title}>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="ar-ctx-src ark-focus" title={source.title}>
                    <Globe aria-hidden="true" />
                    <span>{sourceLabel(source)}</span>
                    <ExternalLink aria-hidden="true" className="ar-ctx-src-ext" />
                  </a>
                ) : (
                  <span className="ar-ctx-src" title={source.title}>
                    <FileText aria-hidden="true" />
                    <span>{source.title}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(visitorId || onBlacklistVisitor) && (
        <div className="ar-ctx-actions">
          {visitorId && (
            <NavLink to="inbox/contatti" params={{ visitor: String(visitorId) }} className="ar-ctx-action ark-focus">
              <Users aria-hidden="true" />
              {t("inboxPage.context.openContact")}
            </NavLink>
          )}
          {onBlacklistVisitor && (thread.visitor_id || visitorId) && !(thread.visitor?.is_banned || profile?.is_banned) && (
            <button
              type="button"
              className="ar-ctx-action ar-ctx-danger ark-focus"
              onClick={() => onBlacklistVisitor(thread.id, String(thread.visitor_id ?? visitorId))}
            >
              <ShieldBan aria-hidden="true" />
              {t("conversations.blacklist")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
