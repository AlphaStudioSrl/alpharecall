import * as React from "react";
import {
  ArrowUp,
  CalendarDays,
  Clock,
  CreditCard,
  FileText,
  MapPin,
  MessageCircle,
  Phone,
  Reply,
  Sparkle,
  Square,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { AttachmentDraftList, AttachmentPicker, type AttachmentDraft } from "./attachments";
import { clampText, WELCOME_MESSAGE_MAX } from "@/lib/widget-limits";
import { useMessageLimit } from "@/lib/message-limit";

/** Transport-free widget primitives. Support and visitor chat own their state. */

function initialOf(name: string) {
  const letter = name.trim().match(/\p{L}|\p{N}/u)?.[0];
  return letter ? letter.toUpperCase() : "?";
}

/**
 * The assistant's face: the tenant logo/portrait when there is one, otherwise
 * its initial on the brand color. Initials keep their fill (they are not an
 * icon tile); there is never a tinted square behind an icon.
 */
export function AssistantAvatar({ name, imageUrl, size = "md", className }: {
  name: string; imageUrl?: string | null; size?: "sm" | "md" | "lg"; className?: string;
}) {
  const cls = `ar-avatar ar-avatar--${size}${className ? ` ${className}` : ""}`;
  if (imageUrl) return <img src={imageUrl} alt={name} className={`${cls} ar-avatar--image`} />;
  return <span className={`${cls} ar-avatar--initial`} aria-hidden="true">{initialOf(name)}</span>;
}

/** Who wrote a turn that is not the assistant (a person from the team). */
export function ChatIdentity({ name, human = false }: { name: string; human?: boolean }) {
  return (
    <div className="ar-message-identity">
      <span className="ar-message-avatar" aria-hidden="true">
        {human ? <UserRound /> : <Sparkle />}
      </span>
      <span>{name}</span>
    </div>
  );
}

/** "Cerco nel listino...": what the assistant is doing while the turn runs. */
export function ChatWorking({ children }: { children: React.ReactNode }) {
  return (
    <div className="ar-working" role="status">
      <span className="ar-message-avatar ar-ai-mark" aria-hidden="true"><Sparkle /></span>
      {children}
    </div>
  );
}

export function ChatWelcome({ title, subtitle, intro, avatar }: {
  title: string; subtitle?: string; intro?: string; avatar?: React.ReactNode;
}) {
  return (
    <div className="ar-welcome">
      {avatar}
      {/* The title is clamped (see .ar-welcome-clamp): a long one used to grow
          upward under the header. The full text stays in the tooltip. */}
      <h2 className="ar-welcome-title" title={title.length > 60 ? title : undefined}>
        {intro ? <>{intro}<br /><span className="ar-welcome-clamp">{title}</span></> : <span className="ar-welcome-clamp" data-plain="">{title}</span>}
      </h2>
      {/* Same cap as the editor and the PHP save; a longer text saved before it is cut on a word. */}
      {subtitle ? <p className="ar-welcome-text">{clampText(subtitle, WELCOME_MESSAGE_MAX)}</p> : null}
    </div>
  );
}

const STARTER_ICONS: Array<[RegExp, LucideIcon]> = [
  [/prezz|cost|tariff|listino|pagament|rate\b|price|cost|pay/i, FileText],
  [/orari|apert|chius|quando|sabato|domenica|hours|open|close/i, Clock],
  [/prenot|appuntament|visita|disponib|book|appointment|slot/i, CalendarDays],
  [/dove|indirizz|parcheg|raggiung|where|address|parking/i, MapPin],
  [/telefon|chiam|contatt|phone|call|contact/i, Phone],
  [/carta|bancomat|fattur|card|invoice/i, CreditCard],
];

/** A quiet icon picked from what the question is about; never decorative noise. */
export function starterIcon(question: string): LucideIcon {
  for (const [pattern, icon] of STARTER_ICONS) if (pattern.test(question)) return icon;
  return MessageCircle;
}

export function ChatSuggestions({ questions, onPick, disabled }: {
  questions: string[]; onPick: (question: string) => void; disabled: boolean;
}) {
  return (
    <div className="ar-starter-chips">
      {questions.map((question, index) => {
        const Icon = starterIcon(question);
        return (
          <button key={question} type="button" className="ar-starter-chip"
            style={{ animationDelay: `${0.12 + index * 0.06}s` }}
            disabled={disabled} onClick={() => onPick(question)}>
            <Icon aria-hidden="true" /><span>{question}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Follow-up questions from the answer's <<FOLLOWUPS>> trailer. */
export function ChatFollowups({ items, onPick, disabled }: {
  items: string[]; onPick: (question: string) => void; disabled?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="ar-followups">
      {items.map((item) => (
        <button key={item} type="button" className="ar-followup" disabled={disabled} onClick={() => onPick(item)}>
          <Reply aria-hidden="true" /><span>{item}</span>
        </button>
      ))}
    </div>
  );
}

export function ChatComposer({ value, onChange, onSubmit, busy, disabled = false,
  onCancel, placeholder, inputLabel, sendLabel, stopLabel, attachments, limit }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void;
  busy: boolean; disabled?: boolean; onCancel?: () => void;
  placeholder: string; inputLabel: string; sendLabel: string; stopLabel?: string;
  attachments?: AttachmentDraft;
  /** The message length limit (CHAT_MESSAGE_MAX) with the notice for a paste it cut; none means no limit. */
  limit?: { max: number; truncated: string };
}) {
  const length = useMessageLimit(value, limit?.max ?? Number.POSITIVE_INFINITY);
  const limitId = React.useId();
  const canSend = !busy && !disabled && !attachments?.blocked && (!!value.trim() || !!attachments?.ready.length);
  return (
    <div className="ar-composer-shell" onDragOver={event => {
      if (attachments && event.dataTransfer.types.includes("Files")) event.preventDefault();
    }} onDrop={event => {
      if (attachments && event.dataTransfer.files.length) {
        event.preventDefault();
        if (!busy && !disabled && !attachments.busy) void attachments.add(Array.from(event.dataTransfer.files));
      }
    }} onPaste={event => {
      if (attachments && event.clipboardData.files.length) {
        event.preventDefault();
        if (!busy && !disabled && !attachments.busy) void attachments.add(Array.from(event.clipboardData.files));
      }
    }}>
      {attachments && <AttachmentDraftList draft={attachments} disabled={busy || disabled} />}
      <form className="ar-chat-composer" onSubmit={(event) => { event.preventDefault(); if (canSend) onSubmit(); }}>
        {attachments && <AttachmentPicker draft={attachments} disabled={busy || disabled} />}
        <textarea
          ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }}
          placeholder={placeholder} aria-label={inputLabel} rows={1} value={value} disabled={disabled}
          maxLength={limit?.max} onPaste={limit ? length.onPaste : undefined}
          aria-describedby={limit && (length.showCount || length.cut) ? limitId : undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              if (canSend) onSubmit();
            }
          }}
        />
        {busy && onCancel ? (
          <button type="button" className="ar-send" data-state="stop" onClick={onCancel} aria-label={stopLabel}>
            <Square aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="ar-send" data-state={canSend ? "ready" : "idle"} aria-label={sendLabel} disabled={!canSend}>
            <ArrowUp aria-hidden="true" />
          </button>
        )}
      </form>
      {/* Card fgcgu1tr9ee0: no height while empty, always there so a change is announced. */}
      {limit && (
        <div id={limitId} className="ar-composer-limit" aria-live="polite">
          {length.cut && <span>{limit.truncated}</span>}
          {length.showCount && <small data-full={length.count >= limit.max ? "" : undefined}>{length.count}/{limit.max}</small>}
        </div>
      )}
    </div>
  );
}
