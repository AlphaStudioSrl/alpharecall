import { useId, useState } from "react";
import { Clock, Loader2, MessageCircle, MoreHorizontal, Plus, RotateCcw, X, XCircle } from "lucide-react";
import { useApp } from "@/admin/app-context";
import type { useSupportChat } from "@/admin/hooks/use-support-chat";
import { formatShortDate, formatTime } from "@/admin/lib/datetime";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChatWelcome } from "@/components/chat/presentation";
import { SupportChat } from "./support-chat";
import widgetDesignCss from "@/widget-design.css?raw";
import "./support-panel.css";

// Admin Tailwind utilities are ID-scoped. Give the actual widget rules that same
// scope so its spacing wins here just as it does in the public widget bundle.
const supportDesignCss = widgetDesignCss.replaceAll(".ar-chat-shell", "#alpharecall-admin-app .ar-support-shell")
  .replaceAll(".lp-root", "#alpharecall-admin-app .ar-support-shell");

/** Adapts the support lifecycle to the same presentation contract as Chat/FAQ. */
export function SupportPanel({ chat, onDismiss }: { chat: ReturnType<typeof useSupportChat>; onDismiss?: () => void }) {
  const { t, theme } = useApp();
  const [tab, setTab] = useState<"chat" | "history">("chat");
  const [draft, setDraft] = useState("");
  // A streamed conversation_id must not remount the focused composer.
  const [threadView, setThreadView] = useState(0);
  const id = useId();
  const newThread = () => { chat.startNewThread(); setDraft(""); setThreadView(value => value + 1); setTab("chat"); };
  const history = () => { setTab("history"); void chat.fetchThreads(); };

  return (
    <section className="ar-chat-shell ar-support-shell" data-theme={theme} data-header-style="soft"
      data-motion="subtle" data-starter-layout="cards" aria-label={t("support.title")}>
      <style>{supportDesignCss}</style>
      <div className="ar-chat-panel ar-support-panel" data-widget-style="popup" data-open="true">
        <header className="ar-chat-header flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="ar-chat-avatar ar-chat-avatar--mark flex shrink-0 items-center justify-center" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            </div>
            <div className="min-w-0 leading-tight">
              <div className="ar-chat-header-name truncate">{t("support.title")}</div>
              <div className="ar-chat-header-status">AlphaRecall</div>
            </div>
          </div>
          <div className="ar-chat-header-actions flex items-center">
            <button type="button" className="ar-chat-header-btn" onClick={newThread} aria-label={t("support.newConversation")} title={t("support.newConversation")}><RotateCcw size={16} /></button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" className="ar-chat-header-btn" aria-label={t("support.actions")} title={t("support.actions")}><MoreHorizontal size={16} /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="ar-support-menu" data-theme={theme}>
                <DropdownMenuItem onSelect={newThread}><Plus />{t("support.newConversation")}</DropdownMenuItem>
                <DropdownMenuItem onSelect={history}><Clock />{t("support.history")}</DropdownMenuItem>
                <DropdownMenuItem disabled={!chat.activeThreadId || chat.threadStatus === "closed"}
                  onSelect={() => { if (chat.activeThreadId) void chat.closeThread(chat.activeThreadId); }}><XCircle />{t("support.closeThread")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {onDismiss && <button type="button" className="ar-chat-header-btn ar-chat-header-btn--close" onClick={onDismiss}
              aria-label={t("support.dismiss")} title={t("support.dismiss")}><X size={16} /></button>}
          </div>
        </header>
        <div className="ar-chat-tabs flex shrink-0 gap-1" role="group" aria-label={t("support.navigation")}>
          <button type="button" aria-pressed={tab === "chat"} aria-controls={`${id}-chat`} onClick={() => setTab("chat")}><MessageCircle size={14} />{t("support.chat")}</button>
          <button type="button" aria-pressed={tab === "history"} aria-controls={`${id}-history`} onClick={history}><Clock size={14} />{t("support.history")}</button>
        </div>
        {chat.error && <div className="ar-support-error" role="alert"><span>{t(`support.error${chat.error}`)}</span>
          <button type="button" onClick={() => { void chat.refresh(); }}>{t("support.refresh")}</button></div>}
        {/* Keep the composer and scroll position alive when browsing history. */}
        <div id={`${id}-chat`} className="ar-support-content" hidden={tab !== "chat"}>
          <SupportChat key={threadView} messages={chat.messages} streamingText={chat.streamingText}
             sending={chat.sending} loading={chat.loading} threadStatus={chat.threadStatus}
             attachmentClient={chat.attachmentClient}
            draft={draft} onDraftChange={setDraft} onSend={chat.sendMessage} onNewThread={newThread} />
        </div>
        <div id={`${id}-history`} className="ar-thread-viewport ar-support-history" hidden={tab !== "history"}>
          {chat.threadsLoading && !chat.threads.length ? <div className="ar-support-loading" role="status"><Loader2 className="size-4 animate-spin" />{t("support.loading")}</div>
            : !chat.threads.length ? <ChatWelcome title={t("support.history")} subtitle={t("support.noThreads")} />
              : chat.threads.map((thread) => <button type="button" key={thread.id} className="ar-support-thread" aria-pressed={thread.id === chat.activeThreadId}
                onClick={() => { chat.selectThread(thread.id); setDraft(""); setThreadView(value => value + 1); setTab("chat"); }}>
                <span className="ar-support-thread-title">{thread.title || `${t("support.conversation")} #${thread.id}`}</span>
                <span className="ar-support-thread-meta">{t(`support.status${thread.status}`)}{thread.last_message_at ? ` · ${formatShortDate(thread.last_message_at)}, ${formatTime(thread.last_message_at)}` : ""}</span>
              </button>)}
          <button type="button" className="ar-starter-chip" onClick={newThread}><span>{t("support.newConversation")}</span><Plus size={14} /></button>
        </div>
      </div>
    </section>
  );
}
