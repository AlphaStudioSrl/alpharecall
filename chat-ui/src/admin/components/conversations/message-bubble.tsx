import { useMemo, useState, useCallback } from "react";
import DOMPurify from "dompurify";
import { CircleStop, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/admin/lib/utils";
import { formatTime, formatDateTime } from "@/admin/lib/datetime";
import { useApp } from "@/admin/app-context";
import { Avatar } from "@/admin/components/shared/kit";
import type { ChatMessage, ThreadVisitor } from "@/admin/hooks/use-conversations";
import { Copy, Check, Sparkles } from "@/components/icons";
import { MessageAttachments } from "@/components/chat/attachments";
import { wpAttachmentClient } from "@/lib/chat-attachments";
import { toolNote } from "./inbox-format";
import { personName } from "@/admin/lib/record-fields";

interface MessageBubbleProps {
  message: ChatMessage;
  visitor?: ThreadVisitor;
  /** Visitor's display name, for the screen-reader sender label. */
  visitorLabel?: string;
  /** The assistant's name ("Sofia"). */
  botName?: string;
}

/** Only these open from the transcript; anything else (javascript:, data:) stays text. */
const SAFE_LINK = /^(?:https?:\/\/|mailto:|tel:)/i;
// A backtick never belongs to an address: `https://x.it` is the address in a code span.
// Nor do the quotes and ellipsis Italian puts around one («https://x.it», “https://x.it”, https://x.it…).
// An underscore may open it (_https://x.it_ is italics), a letter or digit may not.
const BARE_URL = /(?<![A-Za-z0-9])https?:\/\/[^\s<>"`«»“”‘’‹›…]+/gi;
const MD_LINK = /\[([^\]\n]+)\]\(([^()\s"<>]+)\)/g;

/**
 * A bare URL loses the punctuation that ends its sentence ("vedi https://x.it/a."),
 * the emphasis markers that close around it ("**https://x.it/a**", "_https://x.it/a_")
 * and a closing parenthesis it never opened ("(vedi https://x.it/(x))"), as GFM does.
 */
function trimUrl(url: string): [string, string] {
  let end = url.length;
  for (;;) {
    const head = url.slice(0, end);
    const entity = /&(?:gt|lt|quot|#39);$/.exec(head);
    if (entity) { end -= entity[0].length; continue; }
    const last = head.charAt(head.length - 1);
    const unbalanced = last === ")" && head.split(")").length > head.split("(").length;
    if (".,:;!?'*_~".includes(last) || unbalanced || last === "]") { end -= 1; continue; }
    break;
  }
  return [url.slice(0, end), url.slice(end)];
}

/**
 * Links in an answer: `[testo](url)` and bare http(s) URLs, opened in a new
 * tab without handing the admin page to the site (card o0n6di2fbboa). The
 * input is already HTML-escaped; each link becomes a placeholder so the
 * bold/italic/code rules below cannot reach into its address.
 */
function linkify(html: string, links: string[]): string {
  const anchor = (href: string, label: string) => {
    links.push(`<a href="${href}" target="_blank" rel="noopener noreferrer" class="ar-msg-link">${label}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  };
  return html
    .replace(MD_LINK, (whole, label: string, href: string) => (SAFE_LINK.test(href.replace(/&amp;/g, "&")) ? anchor(href, label) : whole))
    .replace(BARE_URL, (match: string) => {
      const [url, rest] = trimUrl(match);
      return url.length > "https://".length ? anchor(url, url) + rest : match;
    });
}

/**
 * Markdown to HTML supporting headings, bold, italic, code, lists, tables, hr,
 * and (with `links`) clickable http/https/mailto/tel links.
 */
export function renderMarkdown(text: string, { links = false }: { links?: boolean } = {}): string {
  // Escape HTML
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const anchors: string[] = [];
  if (links) html = linkify(html, anchors);

  // Headings (### before ## before #)
  html = html.replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-1">$1</h2>');

  // Horizontal rule (spacing only: the admin is borderless)
  html = html.replace(/^---+$/gm, "<hr/>");

  // Tables: detect lines with | and convert
  const lines = html.split("\n");
  const out: string[] = [];
  let inTable = false;
  let headerDone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const isTableRow = line.startsWith("|") && line.endsWith("|") && line.includes("|");
    const isSeparator = /^\|[\s\-:|]+\|$/.test(line);

    if (isTableRow) {
      if (!inTable) {
        out.push('<table class="text-xs w-full my-2">');
        inTable = true;
        headerDone = false;
      }
      if (isSeparator) {
        headerDone = true;
        continue;
      }
      const cells = line.split("|").filter((c) => c.trim() !== "");
      const tag = !headerDone ? "th" : "td";
      const cls = !headerDone ? 'class="text-left px-2 py-1 font-medium opacity-70"' : 'class="px-2 py-1"';
      out.push("<tr>" + cells.map((c) => `<${tag} ${cls}>${c.trim()}</${tag}>`).join("") + "</tr>");
      if (!headerDone) headerDone = true;
    } else {
      if (inTable) {
        out.push("</table>");
        inTable = false;
        headerDone = false;
      }
      out.push(lines[i]);
    }
  }
  if (inTable) out.push("</table>");
  html = out.join("\n");

  // Bold, italic, inline code
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Underscore italics as the widget's markdown reads them: never inside a
  // word (nome_file_v2, __init__ stay as written).
  html = html.replace(/(?<![\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu, "<em>$1</em>");
  html = html.replace(/`(.+?)`/g, '<code class="px-1 py-0.5 rounded text-[0.85em] font-mono">$1</code>');

  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');

  // Line breaks
  html = html.replace(/\n/g, "<br/>");

  // Clean up consecutive <br/> around block elements
  html = html.replace(/<br\/>\s*<(h[2-4]|hr|table|li)/g, "<$1");
  html = html.replace(/<\/(h[2-4]|table|li)>\s*<br\/>/g, "</$1>");

  return anchors.length ? html.replace(/\u0000(\d+)\u0000/g, (_, i: string) => anchors[Number(i)] ?? "") : html;
}

/** DOMPurify drops `target` unless told to keep it; it still vets every href. */
const PURIFY = { ADD_ATTR: ["target"] };

/**
 * One turn of the transcript. The visitor writes on the right on a soft fill
 * (x-v); the assistant answers on the left as plain text after a bare spark
 * (x-ai), with what its tool did on a quiet line under it (x-note); a person
 * from the team answers on the left with their avatar and name.
 */
export function MessageBubble({ message, visitor, visitorLabel, botName }: MessageBubbleProps) {
  const { t, lang } = useApp();
  const attachmentClient = useMemo(() => wpAttachmentClient("operator-chat-attachments"), []);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isHuman = message.role === "admin" || message.role === "human";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }, []);

  // #11 fix: safe stringify for non-string content
  let content: string;
  if (typeof message.content === "string") {
    content = message.content;
  } else {
    try {
      content = JSON.stringify(message.content);
    } catch {
      content = String(message.content ?? "");
    }
  }

  // The team's and the assistant's links open; a visitor's stay text: an
  // anonymous visitor's URL is not something to click from the admin.
  const html = useMemo(() => DOMPurify.sanitize(renderMarkdown(content, { links: !isUser }), PURIFY), [content, isUser]);
  const note = isAssistant ? toolNote(message, t) : null;
  const sender = isUser
    ? visitorLabel || personName(visitor?.display_name) || visitor?.email || t("common.visitor")
    : isAssistant
      ? botName || t("common.assistant")
      // A reply with no operator (sent before replies were signed) is the team's.
      : message.profile_name || t("inboxPage.thread.you");

  if (!isUser && !isAssistant && !isHuman) {
    // Tool or system rows: a quiet centred line.
    return content.trim() ? <p className="ar-msg-system">{content}</p> : null;
  }

  const time = (
    <time className="ar-msg-time" dateTime={message.created_at} title={formatDateTime(message.created_at)}>
      {formatTime(message.created_at)}
      {message.rating === "up" && <ThumbsUp className="ar-msg-rating" aria-label={t("inboxPage.rating.up")} />}
      {message.rating === "down" && <ThumbsDown className="ar-msg-rating" aria-label={t("inboxPage.rating.down")} />}
    </time>
  );

  const copy = (
    <button
      type="button"
      className={cn("ar-msg-copy", copied && "ar-msg-copied")}
      onClick={() => handleCopy(content)}
      title={t("common.copy") || "Copy"}
      aria-label={t("common.copy") || "Copy"}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );

  const body = content.trim() ? (
    <div className="ar-msg-md" dangerouslySetInnerHTML={{ __html: html }} />
  ) : null;

  if (isUser) {
    return (
      <div className="ar-msg ar-msg-visitor">
        <span className="sr-only">{sender}</span>
        <MessageAttachments files={message.attachments} client={attachmentClient} locale={lang} />
        {body && <div className="ar-msg-bubble">{body}</div>}
        <div className="ar-msg-meta">
          {copy}
          {time}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("ar-msg ar-msg-team", isHuman && "ar-msg-human")}>
      {isAssistant ? (
        <Sparkles className="ar-msg-mark" aria-hidden="true" />
      ) : (
        <Avatar name={message.profile_name || t("inboxPage.thread.you")} src={message.profile_avatar} size="s" className="ar-msg-avatar" />
      )}
      <div className="ar-msg-col">
        {isHuman ? <span className="ar-msg-name">{sender}</span> : <span className="sr-only">{sender}</span>}
        <MessageAttachments files={message.attachments} client={attachmentClient} locale={lang} />
        {body}
        {note && (
          <span className="ar-msg-note">
            <note.icon aria-hidden="true" />
            {note.text}
          </span>
        )}
        {isAssistant && message.stopped && (
          // The visitor pressed Stop / Ricomincia: this is only what they saw.
          <span className="ar-msg-note ar-msg-stopped">
            <CircleStop aria-hidden="true" />
            {t("inboxPage.thread.stopped")}
          </span>
        )}
        <div className="ar-msg-meta">
          {time}
          {copy}
        </div>
      </div>
    </div>
  );
}
