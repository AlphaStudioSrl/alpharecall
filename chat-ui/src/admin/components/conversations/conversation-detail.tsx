import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import { AttachmentDraftList, AttachmentPicker, useAttachmentDraft } from "@/components/chat/attachments";
import { wpAttachmentClient } from "@/lib/chat-attachments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/admin/app-context";
import { cn } from "@/admin/lib/utils";
import { isSendShortcut, sendShortcutLabel } from "@/admin/lib/platform";
import { formatTime, toZonedDateKey, parseApiDate } from "@/admin/lib/datetime";
import { localizedId } from "@/admin/lib/config";
import { Empty, IconButton, SelectPill, Tag } from "@/admin/components/shared/kit";
import { useSupportProfiles } from "@/admin/hooks/use-support-profiles";
import { useAgentProfile } from "@/admin/hooks/use-agent-profile";
import { isAiOwned, isClosed as threadClosed, needsPerson, threadUpdateKey, type ChatThread, type ChatMessage, type ThreadUpdate } from "@/admin/hooks/use-conversations";
import {
  MessageSquare,
  Loader2,
  MoreHorizontal,
  Pencil,
  Check,
  X,
  Trash2,
  Lock,
  Unlock,
  Sparkles,
  Star,
  ShieldBan,
  ArrowLeft,
  ArrowUp,
  Bot,
  Download,
  PanelRight,
  Headset,
  AlertTriangle,
} from "@/components/icons";
import { MessageBubble } from "./message-bubble";
import { dayLabel, elapsed, isEscalation, tf, threadStatus, transcript, unansweredMessage, useBotName, visitorEmail, visitorName, waitingSince } from "./inbox-format";

interface ConversationDetailProps {
  thread: ChatThread | null;
  messages: ChatMessage[];
  loading: boolean;
  sending: boolean;
  onSendReply: (content: string, profileInfo?: { profile_id?: number; profile_name?: string; profile_avatar?: string }, attachmentIds?: string[]) => Promise<void>;
  /** Resolves false when nothing was saved (another change was pending, or it failed). */
  onUpdateThread?: (threadId: number, updates: ThreadUpdate) => Promise<boolean | void>;
  onDeleteThread?: (threadId: number) => Promise<void>;
  onGenerateTitle?: (threadId: number) => Promise<void>;
  onToggleFavorite?: (threadId: number, favorite: boolean) => Promise<void>;
  onBlacklistVisitor?: (threadId: number, visitorId: string) => void;
  /** Phones: back to the list. */
  onBack?: () => void;
  /** Narrow screens: open the visitor details pane. */
  onShowDetails?: () => void;
  /** Error from the inbox hook, shown as an alert above the transcript. */
  error?: string | null;
  /** The status/title change in flight for this thread (threadUpdateKey): its controls wait for it. */
  updating?: string | null;
}

/** The middle pane of the inbox: who, what they asked, and the operator's composer. */
/** "Rispondi come" value for answering under one's own name. */
export const REPLY_AS_SELF = "self";

/**
 * The profile an admin's reply is signed with unless they pick another: their
 * own linked profile, never the site's default one (that is another person or
 * a persona). Without a linked profile they sign as themselves.
 *
 * It is what reply_attribution signs with when no profile_id is sent, so the
 * pill and the server agree. Ids compare as numbers: wp_localize_script hands
 * the linked id over as a string ("3"), which never === 3.
 */
export function replyAsDefault<P extends { id: number | string }>(profiles: P[], linkedProfileId: number | string | null | undefined): P | undefined {
  const linked = localizedId(linkedProfileId);
  return linked > 0 ? profiles.find((p) => localizedId(p.id) === linked) : undefined;
}

/**
 * The name the server signs a profile-less reply with: public_name, which the
 * plugin computes like the proxy does (never the login or the e-mail). Empty
 * means the visitor sees "Team", so the pill must not promise a name.
 */
export function replyAsSelfName(user: { name?: string; public_name?: string } | undefined): string {
  return (user?.public_name ?? user?.name ?? "").trim();
}

export function ConversationDetail({
  thread,
  messages,
  loading,
  sending,
  onSendReply,
  onUpdateThread,
  onDeleteThread,
  onGenerateTitle,
  onToggleFavorite,
  onBlacklistVisitor,
  onBack,
  onShowDetails,
  error,
  updating = null,
}: ConversationDetailProps) {
  const { t, isAdmin, lang, currentUser, linkedProfileId } = useApp();
  // "⌘+Invio" on a Mac, "Ctrl+Invio" elsewhere: the label names the key that sends.
  const sendKeys = sendShortcutLabel(t("inboxPage.composer.enterKey"));
  const bot = useBotName();
  const attachmentClient = useMemo(() => wpAttachmentClient("operator-chat-attachments"), []);
  const attachments = useAttachmentDraft(attachmentClient, String(thread?.id || ""), lang);
  const [reply, setReply] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isScrolledRef = useRef(true); // NEW-4: track bottom-anchored before render
  const isSendingRef = useRef(false); // NEW-3: local double-submit guard
  const { profiles } = useSupportProfiles();
  const { profile: agentProfile } = useAgentProfile();

  // Title editing state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  // "Rispondi come": an admin signs with their own linked profile, else as
  // themselves (the server then uses their WordPress name). The other
  // profiles stay an explicit choice. Their pick holds until they change it.
  const preferredProfile = replyAsDefault(profiles, linkedProfileId);
  const [chosenProfileId, setChosenProfileId] = useState<string | null>(null);
  const selectedProfileId = chosenProfileId ?? (preferredProfile ? String(preferredProfile.id) : REPLY_AS_SELF);
  // With a linked profile, "as myself" would still be signed with it (the
  // proxy falls back to the link), so that option is not offered.
  const ownProfile = preferredProfile !== undefined;

  // NEW-1 + NEW-2: Reset reply and title-edit state when thread changes
  const prevThreadId = useRef(thread?.id);
  useEffect(() => {
    if (thread?.id !== prevThreadId.current) {
      prevThreadId.current = thread?.id;
      setReply("");
      setEditingTitle(false);
      setTitleDraft("");
      isScrolledRef.current = true; // scroll to bottom on thread switch
    }
  }, [thread?.id]);

  // NEW-4 fix: Capture anchored state before DOM updates via scroll listener
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      const threshold = 150;
      isScrolledRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [thread?.id]);

  // Auto-scroll only when user was at bottom (or first load)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (isScrolledRef.current || messages.length <= 1) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Focus title input when editing
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // The composer grows with its text, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [reply]);

  const selectedProfile = profiles.find((p) => String(p.id) === selectedProfileId);
  // The name the server signs a profile-less reply with (public_name: never the
  // login or the e-mail). Empty means the visitor sees "Team".
  const selfName = replyAsSelfName(currentUser);
  const replyProfile = isAdmin
    ? selectedProfile
      ? { profile_id: selectedProfile.id, profile_name: selectedProfile.name, profile_avatar: selectedProfile.avatar_url }
      : selfName ? { profile_name: selfName } : undefined
    : agentProfile
      ? { profile_id: agentProfile.id, profile_name: agentProfile.name, profile_avatar: agentProfile.avatar_url }
      : undefined;

  // #5 + NEW-3 fix: Defer clear + local double-submit guard
  const handleSend = useCallback(async () => {
    if ((!reply.trim() && !attachments.ready.length) || attachments.blocked || sending || isSendingRef.current) return;
    isSendingRef.current = true;
    const text = reply.trim() || attachments.labels.defaultMessage;
    const targetId = thread?.id;
    try {
      if (attachments.ready.length) await onSendReply(text, replyProfile, attachments.ready.map(file => file.id));
      else await onSendReply(text, replyProfile);
      if (prevThreadId.current === targetId) { setReply(""); attachments.clearSent(); }
    } catch {
      // Keep reply text so user doesn't lose their message
    } finally {
      isSendingRef.current = false;
    }
  }, [reply, sending, onSendReply, replyProfile, attachments, thread?.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isSendShortcut(e)) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const startEditingTitle = useCallback(() => {
    if (!thread) return;
    setTitleDraft(thread.title || visitorName(thread, t));
    setEditingTitle(true);
  }, [thread, t]);

  const saveTitle = useCallback(async () => {
    // Enter while a status change is pending used to close the editor and drop the title.
    if (!thread || !onUpdateThread || updating) return;
    const trimmed = titleDraft.trim();
    if (trimmed) {
      const saved = await onUpdateThread(thread.id, { title: trimmed });
      if (saved === false) return;
    }
    setEditingTitle(false);
  }, [thread, titleDraft, onUpdateThread, updating]);

  const cancelEditTitle = useCallback(() => {
    setEditingTitle(false);
  }, []);

  const downloadTranscript = useCallback(() => {
    if (!thread) return;
    const blob = new Blob([transcript(thread, messages, t, bot)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `conversazione-${thread.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [thread, messages, t, bot]);

  /* ---------- Empty state ---------- */
  if (!thread) {
    return (
      <div className="ar-thread-empty">
        {error && <ErrorBanner message={error} />}
        <Empty
          icon={MessageSquare}
          title={t("inboxPage.thread.selectTitle")}
          description={tf(t, "inboxPage.thread.selectBody", { bot })}
        />
      </div>
    );
  }

  const isClosed = threadClosed(thread);
  const aiOwned = isAiOwned(thread);
  const name = visitorName(thread, t);
  const email = visitorEmail(thread);
  const status = threadStatus(thread, t, bot);
  const waiting = waitingSince(thread);
  const waitingFor = waiting && (needsPerson(thread) || aiOwned) ? elapsed(waiting, t) : null;
  const left = needsPerson(thread) ? thread.visitor_left : null;
  const firstName = thread.visitor?.display_name ? thread.visitor.display_name.split(/\s+/)[0] : name;
  const placeholder = replyProfile?.profile_name
    ? tf(t, "inboxPage.composer.placeholderAs", { name: firstName, agent: replyProfile.profile_name })
    : tf(t, "inboxPage.composer.placeholder", { name: firstName });
  const takeoverAction: "takeover" | "resume_ai" | null = isClosed ? null : thread.status === "handoff" ? "resume_ai" : "takeover";
  const unanswered = loading ? null : unansweredMessage(thread, messages);
  // The buttons show the server's settled state: while a change is in flight
  // they are disabled, and the one that sent it spins.
  const busy = !!updating;
  const resolveUpdate: ThreadUpdate = { status: isClosed ? "open" : "closed" };
  const busyIcon = (updates: ThreadUpdate) =>
    updating === threadUpdateKey(updates) ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null;
  const sub = [thread.title && thread.title !== name ? thread.title : null, email && email !== name ? email : null].filter(Boolean).join(" · ");

  /* ---------- Thread selected ---------- */
  return (
    <div className="ar-thread">
      <header className="ar-thread-head">
        {onBack && (
          <IconButton icon={ArrowLeft} label={t("inboxPage.thread.back")} onClick={onBack} className="ar-thread-back" />
        )}
        <div className="ar-thread-who">
          {editingTitle ? (
            <div className="ar-thread-title-edit">
              <Input
                ref={titleInputRef}
                value={titleDraft}
                aria-label={t("conversations.editTitle")}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveTitle();
                  if (e.key === "Escape") cancelEditTitle();
                }}
                className="h-8 text-sm font-medium"
              />
              <IconButton icon={Check} size="sm" label={t("common.save") || "Save"} disabled={busy} onClick={() => void saveTitle()} />
              <IconButton icon={X} size="sm" label={t("common.cancel") || "Cancel"} onClick={cancelEditTitle} />
            </div>
          ) : (
            <>
              <div className="ar-thread-name">
                <h2>{name}</h2>
                {thread.visitor?.wp_user_id && <Tag tone="mute">WP</Tag>}
                {thread.visitor?.is_banned && <Tag tone="red">{t("visitors.statusBanned") || "Banned"}</Tag>}
                {left && <Tag tone="mute">{t(`inboxPage.visitorLeft.${left.reason}`)}</Tag>}
              </div>
              <p className="ar-thread-sub">
                {sub && <span>{sub}</span>}
                {sub && <span aria-hidden="true"> · </span>}
                <span className={`ark-c-${status.tone === "mute" ? "mute" : status.tone}`}>{status.label}</span>
                {waitingFor && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="ark-c-warn">{tf(t, "inboxPage.thread.waiting", { time: waitingFor })}</span>
                  </>
                )}
              </p>
            </>
          )}
        </div>

        <div className="ar-thread-actions">
          {onToggleFavorite && (
            <IconButton
              icon={Star}
              aria-pressed={!!thread.is_favorite}
              label={t(thread.is_favorite ? "conversations.removeFavorite" : "conversations.addFavorite")}
              className={cn("ar-thread-fav", thread.is_favorite && "ar-thread-fav-on")}
              onClick={() => void onToggleFavorite(thread.id, !thread.is_favorite)}
            />
          )}
          {onShowDetails && (
            <IconButton icon={PanelRight} label={t("inboxPage.thread.details")} onClick={onShowDetails} className="ar-thread-details" />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={MoreHorizontal} label={t("inboxPage.thread.more")} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {onToggleFavorite && (
                <DropdownMenuItem className="ar-menu-phone" onClick={() => void onToggleFavorite(thread.id, !thread.is_favorite)}>
                  <Star className="h-4 w-4 mr-2" />
                  {t(thread.is_favorite ? "conversations.removeFavorite" : "conversations.addFavorite")}
                </DropdownMenuItem>
              )}
              {onUpdateThread && takeoverAction && (
                <DropdownMenuItem disabled={busy} onClick={() => void onUpdateThread(thread.id, { action: takeoverAction })}>
                  {takeoverAction === "takeover" ? <Headset className="h-4 w-4 mr-2" /> : <Bot className="h-4 w-4 mr-2" />}
                  {takeoverAction === "takeover" ? t("inboxPage.thread.takeover") : tf(t, "inboxPage.thread.resumeAI", { bot })}
                </DropdownMenuItem>
              )}
              {onUpdateThread && thread.status === "escalated" && (
                <DropdownMenuItem disabled={busy} onClick={() => void onUpdateThread(thread.id, { action: "resume_ai" })}>
                  <Bot className="h-4 w-4 mr-2" />
                  {tf(t, "inboxPage.thread.resumeAI", { bot })}
                </DropdownMenuItem>
              )}
              {onUpdateThread && (
                <DropdownMenuItem disabled={busy} onClick={() => void onUpdateThread(thread.id, resolveUpdate)}>
                  {isClosed ? <Unlock className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                  {isClosed ? t("conversations.reopen") : t("conversations.close")}
                </DropdownMenuItem>
              )}
              {onGenerateTitle && (
                <DropdownMenuItem onClick={() => void onGenerateTitle(thread.id)}>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t("conversations.generateTitle") || "Generate title"}
                </DropdownMenuItem>
              )}
              {onUpdateThread && (
                <DropdownMenuItem disabled={busy} onClick={startEditingTitle}>
                  <Pencil className="h-4 w-4 mr-2" />
                  {t("conversations.editTitle") || "Edit title"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={downloadTranscript} disabled={!messages.length}>
                <Download className="h-4 w-4 mr-2" />
                {t("inboxPage.thread.download")}
              </DropdownMenuItem>
              {onBlacklistVisitor && (thread.visitor_id || thread.visitor?.id) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => onBlacklistVisitor(thread.id, String(thread.visitor_id ?? thread.visitor!.id))}
                  >
                    <ShieldBan className="h-4 w-4 mr-2" />
                    {t("conversations.blacklist") || "Block visitor"}
                  </DropdownMenuItem>
                </>
              )}
              {onDeleteThread && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => {
                      if (confirm(t("conversations.confirmDelete") || "Delete this conversation?")) {
                        void onDeleteThread(thread.id);
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {t("conversations.delete") || "Delete"}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {onUpdateThread && (
            <Button
              variant="secondary"
              size="sm"
              className="ar-thread-resolve"
              disabled={busy}
              aria-busy={updating === threadUpdateKey(resolveUpdate) || undefined}
              onClick={() => void onUpdateThread(thread.id, resolveUpdate)}
            >
              {busyIcon(resolveUpdate)}
              {isClosed ? t("inboxPage.thread.reopen") : t("inboxPage.thread.resolve")}
            </Button>
          )}
          {onUpdateThread && takeoverAction && (
            <Button
              size="sm"
              variant={takeoverAction === "takeover" ? "default" : "secondary"}
              className="ar-thread-primary"
              disabled={busy}
              aria-busy={updating === threadUpdateKey({ action: takeoverAction }) || undefined}
              onClick={() => void onUpdateThread(thread.id, { action: takeoverAction })}
            >
              {busyIcon({ action: takeoverAction })}
              {takeoverAction === "takeover" ? t("inboxPage.thread.takeover") : tf(t, "inboxPage.thread.resumeAI", { bot })}
            </Button>
          )}
        </div>
      </header>

      {error && <ErrorBanner message={error} />}

      {/* Messages area */}
      <div ref={scrollRef} className="ar-thread-scroll">
        <div className="ar-thread-msgs" role="log" aria-label={name} aria-busy={loading || undefined}>
          {loading ? (
            <div className="ar-thread-state" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span>{t("inboxPage.thread.loading")}</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="ar-thread-state">
              <MessageSquare className="h-5 w-5" aria-hidden="true" />
              <span>{t("inboxPage.thread.empty")}</span>
            </div>
          ) : (
            messages.map((msg, i) => {
              const key = toZonedDateKey(parseApiDate(msg.created_at) ?? new Date());
              const prevKey = i > 0 ? toZonedDateKey(parseApiDate(messages[i - 1].created_at) ?? new Date()) : null;
              return (
                <Fragment key={msg.id}>
                  {key !== prevKey && <p className="ar-thread-day">{dayLabel(msg.created_at, t)}</p>}
                  <MessageBubble message={msg} visitor={thread.visitor} visitorLabel={name} botName={bot} />
                  {msg === unanswered && (
                    <p className="ar-thread-unanswered">
                      <AlertTriangle aria-hidden="true" />
                      {tf(t, "inboxPage.thread.unanswered", { bot })}
                    </p>
                  )}
                  {isEscalation(msg) && (
                    <Tag tone="warn" className="ar-thread-event">
                      {tf(t, "inboxPage.thread.handoff", { bot, time: formatTime(msg.created_at) })}
                    </Tag>
                  )}
                </Fragment>
              );
            })
          )}
        </div>
      </div>

      {/* Composer (x-comp): a floating white card at the foot of the thread */}
      <div className="ar-thread-foot">
        {isClosed ? (
          <div className="ar-composer ar-composer-closed">
            <p>
              {t("inboxPage.composer.closed")}
              <span className="ar-composer-closed-hint">{tf(t, "inboxPage.composer.reopenHint", { bot })}</span>
            </p>
            {onUpdateThread && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-busy={updating === threadUpdateKey({ status: "open" }) || undefined}
                onClick={() => void onUpdateThread(thread.id, { status: "open" })}
              >
                {busyIcon({ status: "open" })}
                {t("conversations.reopen") || "Reopen"}
              </Button>
            )}
          </div>
        ) : (
          <div className="ar-composer ark-focus-within">
            {aiOwned && (
              <div className="ar-composer-note">
                <Sparkles aria-hidden="true" />
                {tf(t, "inboxPage.composer.aiOwned", { bot })}
              </div>
            )}
            {left && (
              <div className="ar-composer-note ar-composer-note-left" role="note">
                <span>
                  {t(`inboxPage.visitorLeft.${left.reason}Note`)}
                  {(left.email || email) && <> {tf(t, "inboxPage.visitorLeft.contactHint", { email: left.email || email || "" })}</>}
                </span>
              </div>
            )}
            <AttachmentDraftList draft={attachments} disabled={sending} />
            <textarea
              ref={inputRef}
              rows={1}
              className="ar-composer-input"
              aria-label={tf(t, "conversations.replyPlaceholder", { keys: sendKeys })}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={sending}
            />
            <div className="ar-composer-row">
              {isAdmin && profiles.length > 0 && (
                <SelectPill
                  value={selectedProfileId}
                  onValueChange={setChosenProfileId}
                  aria-label={t("inboxPage.composer.replyAs")}
                  className="ar-composer-as"
                  options={[
                    ...(ownProfile ? [] : [{ value: REPLY_AS_SELF, label: selfName ? tf(t, "inboxPage.composer.replyAsSelf", { name: selfName }) : t("inboxPage.composer.replyAsSelfUnsigned") }]),
                    ...profiles.map((p) => ({
                      value: String(p.id),
                      label: p.name + (p.title ? ` · ${p.title}` : ""),
                    })),
                  ]}
                />
              )}
              <span className="ar-composer-spacer" />
              <span className="ar-composer-hint">{tf(t, "inboxPage.composer.hint", { keys: sendKeys })}</span>
              <AttachmentPicker draft={attachments} disabled={sending} />
              <button
                type="button"
                className="ar-composer-send"
                onClick={() => void handleSend()}
                disabled={(!reply.trim() && !attachments.ready.length) || attachments.blocked || sending}
                aria-label={t("buttons.send") || "Send"}
              >
                {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div role="alert" aria-live="polite" className="ar-inbox-alert">
      {message}
    </div>
  );
}
