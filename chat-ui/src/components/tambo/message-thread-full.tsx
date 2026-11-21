"use client";

import type { messageVariants } from "@/components/tambo/message";
import {
  Message,
  MessageContent,
  MessageRenderedComponentArea,
} from "@/components/tambo/message";
import { ThreadContainer } from "@/components/tambo/thread-container";
import {
  buildGenerativeToolComponent,
  extractToolNarrative,
} from "@/components/tambo/tool-generative-renderer";
// ToolResultFallback removed — all tools render through tool-ui components
import { Shimmer } from "@/components/ai-elements/shimmer";
import { useFollowups } from "@/followups";
import { cn } from "@/lib/utils";
import { useChatRuntime, type RuntimeMessage } from "@/runtime";
import { NO_REPLY_ERROR } from "@/lib/reply-errors";
import type { TamboThreadMessage } from "@tambo-ai/react";
import type { VariantProps } from "class-variance-authority";
import { ArrowDown, Check, Copy, FileText, Globe, RefreshCw, RotateCcw } from "lucide-react";
import {
  AssistantAvatar,
  ChatComposer,
  ChatFollowups,
  ChatIdentity,
  ChatSuggestions,
  ChatWelcome,
  ChatWorking,
} from "@/components/chat/presentation";
import { MessageAttachments, useAttachmentDraft } from "@/components/chat/attachments";
import { avatarImageUrl, WidgetThemeContext } from "@/lib/widget-images";
import type { ChatAttachment } from "@/lib/chat-attachments";
import * as React from "react";
import { getChatStrings } from "@/strings";
import { widgetCopy } from "@/lib/widget-copy";
import { CHAT_MESSAGE_MAX } from "@/lib/widget-limits";
import { ToolSlotBoundary } from "@/components/chat/tool-slot";
import { MessageRating, ratedMessageId, type MessageRatingValue } from "@/components/generative-ui/message-rating";

export interface MessageThreadFullProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: VariantProps<typeof messageVariants>["variant"];
}

const toTamboMessage = (
  message: RuntimeMessage,
  renderedComponent?: React.ReactNode,
): TamboThreadMessage => {
  return {
    id: message.id,
    role: message.role,
    content: message.text ? [{ type: "text", text: message.text }] : [],
    ...(renderedComponent || message.renderedComponent
      ? { renderedComponent: renderedComponent || message.renderedComponent }
      : {}),
    threadId: "alpharecall-local-thread",
    createdAt: message.createdAt || new Date().toISOString(),
    componentState: {},
    ...(message.cancelled ? { isCancelled: true } : {}),
  } as TamboThreadMessage;
};

const findPreviousUserMessage = (messages: RuntimeMessage[], assistantIndex: number) => {
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = message.text?.trim();
    if (text) return text;
  }
  return null;
};

const widgetConfig = () => (typeof window !== "undefined" && (window as any).AlphaRecallChat?.config) || {};

const getStarterQuestions = (): string[] => {
  const config = widgetConfig();
  const configured = Array.isArray(config.starterQuestions)
    ? config.starterQuestions.filter((q: unknown): q is string => typeof q === "string" && q.trim() !== "")
    : [];
  if (configured.length > 0) return configured.slice(0, 6);
  const helpdesk = Array.isArray(config.helpdeskEntries) ? config.helpdeskEntries : [];
  const fromHelpdesk = helpdesk
    .map((entry: any) => (typeof entry?.question === "string" ? entry.question.trim() : ""))
    .filter((q: string) => q !== "")
    .slice(0, 3);
  if (fromHelpdesk.length > 0) return fromHelpdesk;
  return getChatStrings().starterQuestions.slice(0, 4);
};

const safeHttpUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
};

/** The assistant's own name (persona), used by the welcome and status lines. */
export const assistantName = (config: any = widgetConfig()) =>
  String(config.chatbotName || "").trim();

export const assistantImage = (config: any = widgetConfig(), theme?: string) =>
  safeHttpUrl(avatarImageUrl(config, theme));

const StarterChips = ({ onPick, disabled }: { onPick: (q: string) => void; disabled: boolean }) => {
  const questions = React.useMemo(getStarterQuestions, []);
  if (questions.length === 0) return null;
  return <ChatSuggestions questions={questions} onPick={onPick} disabled={disabled} />;
};

const ThreadWelcome = () => {
  const strings = getChatStrings();
  const config = widgetConfig();
  const theme = React.useContext(WidgetThemeContext);
  const name = assistantName(config);
  const displayName = name || config.headerTitle || strings.assistantFallbackName;
  return (
    <ChatWelcome
      avatar={<AssistantAvatar name={displayName} imageUrl={assistantImage(config, theme)} size="lg" />}
      intro={name ? strings.welcomeIntro.replace("{name}", name) : strings.greeting}
      title={config.widgetTitle || strings.welcomeHelp}
      subtitle={config.welcomeMessage || undefined}
    />
  );
};

type SourceItem = { title: string; url: string | null };

/** Human names of what the answer was based on (never file paths). */
const messageSources = (message: RuntimeMessage): SourceItem[] => {
  const raw = message.metadata?.sources;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item: any): SourceItem | null => {
      const title = typeof item === "string" ? item : typeof item?.title === "string" ? item.title : "";
      if (!title.trim()) return null;
      return { title: title.trim(), url: safeHttpUrl(item?.url) };
    })
    .filter((item): item is SourceItem => !!item)
    .slice(0, 4);
};

const NETWORK_ERROR = /^(Chat request failed|Failed to fetch|NetworkError|Load failed|Request failed)/i;
/** The server took the message but sent no answer (5xx, or a body that is not JSON). */
const REPLY_ERROR = /^Chat reply failed/i;

export const MessageThreadFull = React.forwardRef<HTMLDivElement, MessageThreadFullProps>(
  ({ className, ...props }, ref) => {
    const { messages, isRunning, statusMessage, humanHandling, error, sendMessage, cancel, attachmentClient, conversationKey } = useChatRuntime();
    const attachments = useAttachmentDraft(attachmentClient, conversationKey);
    const { followups } = useFollowups();
    const strings = getChatStrings();
    const config = widgetConfig();
    const [awayFromBottom, setAwayFromBottom] = React.useState(false);
    const awayRef = React.useRef(false);
    const [draft, setDraft] = React.useState("");
    const [preparing, setPreparing] = React.useState(false);
    const submitting = React.useRef(false);
    const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(null);
    const mountedAt = React.useRef(Date.now());
    const viewportRef = React.useRef<HTMLDivElement>(null);
    const prevMessageCountRef = React.useRef(0);
    const hasHydratedRef = React.useRef(false);
    const name = assistantName(config) || config.headerTitle || strings.assistantFallbackName;

    const lastAssistantId = React.useMemo(() => {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message.role === "assistant" && !message.metadata?.human) {
          return message.id;
        }
      }
      return null;
    }, [messages]);

    const lastUserText = React.useMemo(() => findPreviousUserMessage(messages, messages.length), [messages]);

    React.useEffect(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const prevCount = prevMessageCountRef.current;
      prevMessageCountRef.current = messages.length;
      // First time messages appear (history load): instant scroll, no animation
      // Subsequent messages (user typing / AI responding): smooth scroll
      const isHistoryLoad = prevCount === 0 && messages.length > 0 && !hasHydratedRef.current;
      if (isHistoryLoad) hasHydratedRef.current = true;
      // Only the welcome: open at its top, so a long one keeps the avatar and
      // the greeting in view instead of under the header (card caa2u6e305z0).
      if (messages.every((m) => m.metadata?.syntheticWelcome)) {
        viewport.scrollTo({ top: 0, behavior: "auto" });
        return;
      }
      if (awayRef.current && !isHistoryLoad && messages[messages.length - 1]?.role !== "user") return;
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: isRunning || isHistoryLoad || config.motionStyle === "none" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }, [messages, isRunning]);

    const submit = React.useCallback(async () => {
      const text = draft.trim() || (attachments.ready.length ? attachments.labels.defaultMessage : "");
      if (!text || isRunning || attachments.blocked || submitting.current) return;
      submitting.current = true; setPreparing(true);
      try {
        const sent = attachments.ready.length ? await sendMessage(text, attachments.ready) : await sendMessage(text);
        if (sent) { setDraft(""); attachments.clearSent(); }
      } finally { submitting.current = false; setPreparing(false); }
    }, [draft, isRunning, sendMessage, attachments]);

    const onlyWelcome = messages.length === 0 || messages.every((m) => m.metadata?.syntheticWelcome);
    const errorText = !error ? ""
      : error === NO_REPLY_ERROR ? strings.noReplyError.replace("{name}", name)
      : REPLY_ERROR.test(error) ? strings.replyError
      : NETWORK_ERROR.test(error) ? strings.connectionError
      : error;

    return (
      <ThreadContainer ref={ref} disableSidebarSpacing className={cn("ar-thread h-full", className)} {...props}>
        {humanHandling && <div role="status" className="ar-sys">{strings.humanHandlingLabel}</div>}
        <div
          ref={viewportRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            awayRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 100;
            setAwayFromBottom(awayRef.current);
          }}
          className="ar-thread-viewport relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto no-scrollbar"
          data-empty={onlyWelcome ? "true" : undefined}
        >
          <div className="ar-thread-stack">
            {onlyWelcome ? <ThreadWelcome /> : null}

            {messages.map((message, index) => {
              if (message.metadata?.syntheticWelcome) return null;
              const isAssistant = message.role === "assistant";
              const isStreamingMessage = isRunning && index === messages.length - 1 && isAssistant;
              const generatedComponent =
                isAssistant && message.toolResult && !message.renderedComponent
                  ? buildGenerativeToolComponent({
                      toolName: message.toolName || "tool",
                      result: message.toolResult,
                      onSendMessage: (value) => {
                        void sendMessage(value);
                      },
                      // Booking and flow sheets open by themselves only for the newest answer.
                      isLatest: message.id === lastAssistantId,
                    })
                  : null;
              const toolNarrative =
                isAssistant && !message.text?.trim() && message.toolResult
                  ? extractToolNarrative(message.toolResult, message.toolName || "tool")
                  : "";
              // Don't pass generatedComponent to tambo — we render it ourselves inline
              const tamboMessage = toTamboMessage(message);

              const entering = message.createdAt && Date.parse(message.createdAt) >= mountedAt.current;
              if (!isAssistant) {
                return (
                  <Message
                    key={message.id}
                    role="user"
                    message={tamboMessage}
                    className={cn("ar-turn ar-turn--user", entering && "ar-message-enter")}
                  >
                    <div className="ar-turn-user-body">
                      <MessageAttachments files={message.metadata?.attachments as ChatAttachment[]} client={attachmentClient} />
                      <MessageContent className="ar-bubble-user" markdown />
                    </div>
                  </Message>
                );
              }

              if (message.metadata?.human) {
                return (
                  <Message
                    key={message.id}
                    role="assistant"
                    message={tamboMessage}
                    className={cn("ar-turn ar-turn--human", entering && "ar-message-enter")}
                  >
                    <ChatIdentity human name={(typeof message.metadata?.operatorName === "string" && message.metadata.operatorName) || strings.humanReplyLabel} />
                    <div className="ar-bubble-human">
                      <MessageAttachments files={message.metadata?.attachments as ChatAttachment[]} client={attachmentClient} />
                      {message.text?.trim() ? <MessageContent className="ar-answer-text" markdown /> : null}
                    </div>
                  </Message>
                );
              }

              const sources = messageSources(message);
              const hasText = !!message.text?.trim();
              const showActions = !isStreamingMessage && (hasText || !!toolNarrative);
              return (
                <Message
                  key={message.id}
                  role="assistant"
                  message={tamboMessage}
                  isLoading={isStreamingMessage}
                  className={cn("ar-turn ar-turn--ai", entering && "ar-message-enter")}
                >
                  <div className="ar-answer">
                    <MessageAttachments files={message.metadata?.attachments as ChatAttachment[]} client={attachmentClient} />
                    {hasText ? (
                      <MessageContent className="ar-answer-text" markdown />
                    ) : null}
                    {!hasText && toolNarrative ? (
                      <div className="ar-answer-text ar-answer-narrative">{toolNarrative}</div>
                    ) : null}
                    {isRunning && !hasText && !toolNarrative ? (
                      <ChatWorking>
                        <Shimmer as="span" duration={1.6} className="ar-working-text">{statusMessage || strings.thinking}</Shimmer>
                      </ChatWorking>
                    ) : null}
                    {/* Tool results sit in the thread as soft cards (see .ar-tool-slot) */}
                    <ToolSlotBoundary tool={message.toolName || "tool"}>
                      {generatedComponent ? (
                        <div className="ar-tool-slot" data-tool={message.toolName || "tool"}>{generatedComponent}</div>
                      ) : (
                        <MessageRenderedComponentArea className="ar-tool-slot" />
                      )}
                    </ToolSlotBoundary>
                    {/* A stopped answer with no text (an action ran, its card came
                        back on reload): the mark normally sits after the text. */}
                    {message.cancelled && !hasText ? (
                      <span className="ar-cancelled">{widgetCopy().cancelled}</span>
                    ) : null}

                    {sources.length > 0 ? (
                      <ul className="ar-sources" aria-label={strings.sourcesLabel}>
                        {sources.map((source) => (
                          <li key={`${source.title}-${source.url || ""}`}>
                            {source.url ? (
                              <a className="ar-source" href={source.url} target="_blank" rel="noopener noreferrer">
                                <Globe aria-hidden="true" />{source.title}
                              </a>
                            ) : (
                              <span className="ar-source"><FileText aria-hidden="true" />{source.title}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {showActions ? (
                      <div className="ar-msg-actions">
                        <button
                          type="button"
                          className="ar-chat-action-icon"
                          aria-label={copiedMessageId === message.id ? strings.copiedLabel : strings.copyMessage}
                          title={copiedMessageId === message.id ? strings.copiedLabel : strings.copyMessage}
                          onClick={async () => {
                            const value = message.text?.trim() || toolNarrative.trim();
                            if (!value) return;
                            try {
                              await navigator.clipboard.writeText(value);
                              setCopiedMessageId(message.id);
                              window.setTimeout(() => {
                                setCopiedMessageId((prev) => (prev === message.id ? null : prev));
                              }, 1400);
                            } catch {
                              // ignore clipboard errors
                            }
                          }}
                        >
                          {copiedMessageId === message.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          className="ar-chat-action-icon"
                          aria-label={strings.retryMessage}
                          title={strings.retryMessage}
                          disabled={isRunning}
                          onClick={() => {
                            const previousUserMessage = findPreviousUserMessage(messages, index);
                            if (!previousUserMessage || isRunning) return;
                            void sendMessage(previousUserMessage);
                          }}
                        >
                          <RotateCcw aria-hidden="true" />
                        </button>
                        <MessageRating
                          messageId={ratedMessageId(message.metadata as Record<string, unknown> | undefined, message.id)}
                          initial={(message.metadata?.rating === "up" || message.metadata?.rating === "down" ? message.metadata.rating : null) as MessageRatingValue}
                        />
                      </div>
                    ) : null}
                  </div>

                  {!isRunning && message.id === lastAssistantId ? (
                    <ChatFollowups items={followups.slice(0, 2)} onPick={(item) => { void sendMessage(item); }} />
                  ) : null}
                </Message>
              );
            })}

            {onlyWelcome ? (
              <StarterChips
                disabled={isRunning}
                onPick={(question) => {
                  void sendMessage(question);
                }}
              />
            ) : null}
          </div>
        </div>

        <div className="ar-composer-area">
          {awayFromBottom && (
            <button type="button" className="ar-jump-latest" onClick={() => {
              viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: "auto" });
              awayRef.current = false;
              setAwayFromBottom(false);
            }}><ArrowDown aria-hidden="true" />{strings.latestMessages}</button>
          )}
          {errorText ? (
            <div className="ar-alert" role="alert">
              <RefreshCw aria-hidden="true" />
              <span className="ar-alert-text">{errorText}</span>
              {lastUserText && !isRunning ? (
                <button type="button" className="ar-alert-action" onClick={() => { void sendMessage(lastUserText); }}>
                  {strings.retryMessage}
                </button>
              ) : null}
            </div>
          ) : null}
          <ChatComposer value={draft} onChange={setDraft} onSubmit={() => { void submit(); }}
            attachments={attachmentClient ? attachments : undefined}
            disabled={preparing}
            busy={isRunning} onCancel={cancel} placeholder={config.inputPlaceholder || strings.inputPlaceholder}
            inputLabel={strings.messageInput} sendLabel={strings.sendMessage} stopLabel={strings.stopGenerating}
            limit={{ max: CHAT_MESSAGE_MAX, truncated: widgetCopy().messageTruncated(CHAT_MESSAGE_MAX) }} />
        </div>
      </ThreadContainer>
    );
  },
);

MessageThreadFull.displayName = "MessageThreadFull";
