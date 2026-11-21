import { useRef, useEffect, useState } from "react";
import { useApp } from "@/admin/app-context";
import { ArrowDown, Loader2 } from "lucide-react";
import { ChatComposer, ChatIdentity, ChatSuggestions, ChatWelcome } from "@/components/chat/presentation";
import { SafeMarkdown } from "@/components/safe-markdown";
import { markdownComponents } from "@/components/tambo/markdown-components";
import type { SupportMessage } from "@/admin/hooks/use-support-chat";
import { MessageAttachments, useAttachmentDraft } from "@/components/chat/attachments";
import type { AttachmentClient, ChatAttachment } from "@/lib/chat-attachments";

interface SupportChatProps {
  messages: SupportMessage[];
  streamingText: string;
  sending: boolean;
  loading: boolean;
  threadStatus: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (content: string, attachments?: ChatAttachment[]) => void;
  onNewThread: () => void;
  attachmentClient?: AttachmentClient;
}

export function SupportChat({ messages, streamingText, sending, loading, threadStatus,
  draft, onDraftChange, onSend, onNewThread, attachmentClient }: SupportChatProps) {
  const { t, lang } = useApp();
  const attachments = useAttachmentDraft(attachmentClient, undefined, lang);
  const viewportRef = useRef<HTMLDivElement>(null);
  const awayRef = useRef(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const lastMessage = messages[messages.length - 1];
  // Reconciliation polls replace the array every five seconds. Only changed
  // content should scroll, and staff replies must not pull readers out of history.
  useEffect(() => {
    if (awayRef.current && lastMessage?.role !== "user") return;
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "auto" });
  }, [messages.length, lastMessage?.id, lastMessage?.content, streamingText, sending]);

  const send = (text: string) => {
    text = text.trim() || (attachments.ready.length ? attachments.labels.defaultMessage : "");
    if (!text || sending || loading || attachments.blocked || threadStatus === "closed") return;
    awayRef.current = false;
    setAwayFromBottom(false);
    if (attachments.ready.length) onSend(text, attachments.ready); else onSend(text);
    onDraftChange("");
    attachments.clearSent();
  };
  const isClosed = threadStatus === "closed";

  return (
    <>
      {threadStatus === "escalated" || threadStatus === "handoff" || isClosed ? (
        <div className="ar-support-notice" role="status">
          {t(isClosed ? "support.closedBanner" : threadStatus === "handoff" ? "support.adminJoined" : "support.escalatedBanner")}
        </div>
      ) : null}
      <div ref={viewportRef} className="ar-thread-viewport relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        role="log" aria-label={t("support.transcript")} aria-busy={loading || sending}
        onScroll={(event) => {
          const el = event.currentTarget;
          awayRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 100;
          setAwayFromBottom(awayRef.current);
        }}>
        {loading && messages.length === 0 ? (
          <div className="ar-support-loading" role="status"><Loader2 className="size-4 animate-spin" />{t("support.loading")}</div>
        ) : messages.length === 0 && !sending ? (
          <>
            <ChatWelcome title={t("support.emptyTitle")} subtitle={t("support.startChat")} />
            {!isClosed && <ChatSuggestions questions={[t("support.suggestionSetup"), t("support.suggestionKnowledge"), t("support.suggestionHuman")]}
              onPick={send} disabled={sending || loading} />}
          </>
        ) : messages.map((message) => <SupportMessageBubble key={message.id} message={message} attachmentClient={attachmentClient} />)}
        {(streamingText || sending) && (
          <div className="ar-support-message ar-msg-group">
            <ChatIdentity name={t("support.assistantName")} />
            <div className="ar-support-message-content text-sm">
              {streamingText ? <SafeMarkdown components={markdownComponents}>{streamingText}</SafeMarkdown>
                : <span className="text-muted-foreground" role="status">{t("support.thinking")}</span>}
            </div>
          </div>
        )}
      </div>
      <div className="ar-composer-area mx-auto mt-auto flex w-full max-w-3xl flex-col gap-2"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        {awayFromBottom && <button type="button" className="ar-support-latest" onClick={() => {
          viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "auto" });
          awayRef.current = false;
          setAwayFromBottom(false);
        }}><ArrowDown className="size-4" />{t("support.latestMessages")}</button>}
        {isClosed ? <button type="button" className="ar-starter-chip" onClick={onNewThread}>{t("support.newConversation")}</button>
          : <ChatComposer value={draft} onChange={onDraftChange} onSubmit={() => send(draft)} busy={sending} disabled={loading}
            attachments={attachmentClient ? attachments : undefined}
            placeholder={t("support.placeholder")} inputLabel={t("support.placeholder")} sendLabel={t("support.send")} />}
      </div>
    </>
  );
}

function SupportMessageBubble({ message, attachmentClient }: { message: SupportMessage; attachmentClient?: AttachmentClient }) {
  const { t, lang } = useApp();
  if (message.role === "system") return <p className="ar-support-system">{message.content}</p>;
  if (message.role === "user") return (
    <div className="ar-support-message flex justify-end">
      <div className="max-w-[82%]"><MessageAttachments files={message.attachments} client={attachmentClient} locale={lang} />
        <div className="ar-bubble-user whitespace-pre-wrap text-sm font-medium">{message.content}</div></div>
    </div>
  );
  return (
    <div className="ar-support-message ar-msg-group">
      <ChatIdentity human={message.role === "human"} name={t(message.role === "human" ? "support.humanName" : "support.assistantName")} />
      <div className="ar-support-message-content text-sm">
        <MessageAttachments files={message.attachments} client={attachmentClient} locale={lang} />
        <SafeMarkdown components={markdownComponents}>{message.content}</SafeMarkdown>
      </div>
    </div>
  );
}
