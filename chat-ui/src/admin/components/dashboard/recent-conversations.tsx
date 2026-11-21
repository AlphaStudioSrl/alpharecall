import { useApp } from "@/admin/app-context";
import { formatRelativeTime } from "@/admin/lib/format";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, ChevronRight } from "@/components/icons";
import { NavLink } from "@/admin/lib/nav-context";
import type { ConversationItem, DashboardThread } from "@/admin/hooks/use-dashboard";
import { anonymousVisitorLabel } from "@/admin/components/conversations/inbox-format";
import type { TFunction } from "@/admin/lib/i18n";

interface RecentConversationsProps {
  conversations: ConversationItem[];
  /** Chat threads from the dashboard payload; these ids open in Conversazioni. */
  threads?: DashboardThread[];
  total?: number;
  onViewAll?: () => void;
}

/** Exported for tests. The last resort is the visitor's own label (never the thread id), as in Messaggi. */
export function threadPreview(thread: DashboardThread, t: TFunction): string {
  const last = thread.last_message;
  const lastText = typeof last === "string" ? last : last?.content || last?.text || "";
  return (
    thread.title ||
    lastText ||
    thread.visitor?.display_name ||
    thread.visitor?.name ||
    thread.visitor?.email ||
    anonymousVisitorLabel(thread.visitor?.id ?? thread.visitor_id, t)
  );
}

function getPreview(conv: ConversationItem): string {
  if (conv.query) return conv.query;
  if (conv.first_message) return conv.first_message;
  if (conv.input) {
    if (typeof conv.input === "string") return conv.input;
    if (typeof conv.input === "object" && (conv.input as Record<string, unknown>).text) {
      return String((conv.input as Record<string, unknown>).text);
    }
  }
  if (conv.output) {
    if (typeof conv.output === "string") return conv.output;
    if (typeof conv.output === "object" && (conv.output as Record<string, unknown>).output) {
      return String((conv.output as Record<string, unknown>).output);
    }
  }
  return `Chat #${conv.id || conv.session_id || ""}`;
}

export function RecentConversations({ conversations, threads, total, onViewAll }: RecentConversationsProps) {
  const { t } = useApp();

  // The legacy `conversations` rows are inference turns whose ids the
  // Conversazioni page cannot open; when the payload carries chat threads,
  // list those so every link lands on a real thread.
  if (threads && threads.length) {
    const rows = threads.slice(0, 6);
    return (
      <div className="space-y-1">
        {rows.map((thread) => {
          const preview = threadPreview(thread, t)
            .replace(/\*\*(.+?)\*\*/g, "$1")
            .replace(/\*(.+?)\*/g, "$1")
            .replace(/^- /gm, "");
          const when = thread.last_message_at || thread.created_at;
          const time = when ? formatRelativeTime(when) : "";
          return (
            <NavLink
              key={thread.id}
              to="inbox/conversazioni"
              params={{ thread: String(thread.id) }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors group cursor-pointer"
            >
              <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground line-clamp-1">{preview}</p>
                {time && <p className="text-xs text-muted-foreground mt-0.5">{time}</p>}
              </div>
              <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </NavLink>
          );
        })}
        {(total ?? threads.length) > 6 && (
          <NavLink
            to="inbox/conversazioni"
            className="block text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
          >
            {t("buttons.view")} ({total ?? threads.length})
          </NavLink>
        )}
      </div>
    );
  }

  const items = conversations.slice(0, 6);

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground gap-2">
        <MessageSquare className="size-8 opacity-30" />
        <p>{t("messages.noConversations")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {items.map((conv, i) => {
        const preview = getPreview(conv)
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/\*(.+?)\*/g, "$1")
          .replace(/^- /gm, "");
        const time = conv.created_at ? formatRelativeTime(conv.created_at) : "";

        return (
          <NavLink
            key={conv.id ?? conv.session_id ?? i}
            to="inbox/conversazioni"
            params={{ thread: String(conv.id || conv.session_id || "") }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors group cursor-pointer"
          >
            <MessageSquare className="size-3.5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground line-clamp-1">{preview}</p>
              {time && (
                <p className="text-xs text-muted-foreground mt-0.5">{time}</p>
              )}
            </div>
            <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </NavLink>
        );
      })}

      {conversations.length > 6 && (
        <NavLink
          to="inbox/conversazioni"
          className="block text-center text-xs text-muted-foreground hover:text-foreground py-2 transition-colors"
        >
          {t("buttons.view")} ({conversations.length})
        </NavLink>
      )}
    </div>
  );
}
