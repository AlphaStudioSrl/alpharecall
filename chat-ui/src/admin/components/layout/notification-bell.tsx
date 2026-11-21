import { useState } from "react";
import { Bell, AlertTriangle, Calendar, Mail, Star, MessageSquare, CheckCheck, Trash2 } from "@/components/icons";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useNotifications, type NotificationItem } from "@/admin/hooks/use-notifications";
import { useApp } from "@/admin/app-context";
import { formatRelativeTime } from "@/admin/lib/format";
import { cn } from "@/admin/lib/utils";
import { useNav } from "@/admin/lib/nav-context";

const TYPE_CONFIG: Record<string, { icon: typeof Bell; color: string }> = {
  escalation: { icon: AlertTriangle, color: "text-rose-500" },
  appointment: { icon: Calendar, color: "text-blue-500" },
  lead: { icon: Mail, color: "text-emerald-500" },
  feedback: { icon: Star, color: "text-amber-500" },
  submission: { icon: MessageSquare, color: "text-indigo-500" },
  chat: { icon: MessageSquare, color: "text-primary" },
  message: { icon: MessageSquare, color: "text-primary" },
};

const TYPE_HREF: Record<string, string> = {
  escalation: "admin.php?page=alpharecall-conversions&tab=submissions",
  submission: "admin.php?page=alpharecall-conversions&tab=submissions",
  appointment: "admin.php?page=alpharecall-conversions&tab=appointments",
  lead: "admin.php?page=alpharecall-conversions&tab=leads",
  feedback: "admin.php?page=alpharecall-conversions&tab=feedback",
  chat: "admin.php?page=alpharecall-conversations",
  message: "admin.php?page=alpharecall-conversations",
};

export function notificationHref(item: NotificationItem): string {
  const baseHref = TYPE_HREF[item.type] || "admin.php?page=alpharecall-conversions";
  let href: string;
  if (item.type === "chat" || item.type === "message") {
    href = item.conversationId
      ? `${baseHref}&thread=${item.conversationId}`
      : baseHref;
  } else if (item.type === "escalation") {
    // Escalations are merged into submissions with negative IDs
    const escId = item.id.replace(/^esc-/, "");
    href = escId ? `${baseHref}&item=-${escId}` : baseHref;
  } else {
    const entityId = item.id.replace(/^[a-z]+-/, "");
    href = entityId ? `${baseHref}&item=${entityId}` : baseHref;
  }
  return href;
}

function NotificationRow({
  item,
  onMarkRead,
  onOpen,
  t,
}: {
  item: NotificationItem;
  onMarkRead: (id: string) => void;
  onOpen: (href: string) => void;
  t: (k: string) => string;
}) {
  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.escalation;
  const Icon = cfg.icon;
  const title = item.title.startsWith("notifications.") ? t(item.title) : item.title;
  const href = notificationHref(item);

  return (
    <button
      type="button"
      className={cn(
        "flex items-start gap-2.5 px-3 py-2.5 transition-colors cursor-pointer hover:bg-muted/60 w-full text-left",
        !item.read && "bg-muted/40",
      )}
      onClick={() => {
        // Chat is acknowledged only after the destination transcript loads.
        if (!item.read && item.type !== "chat" && item.type !== "message") onMarkRead(item.id);
        onOpen(href);
      }}
    >
      <div className={cn("mt-0.5 shrink-0", cfg.color)}>
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn("text-xs font-semibold", !item.read ? "text-foreground" : "text-muted-foreground")}>
            {title}
          </span>
          {!item.read && (
            <span className="size-1.5 rounded-full bg-primary shrink-0" />
          )}
          {!item.read && (item.unreadMessages ?? 0) > 0 && (
            <span className="ark-tag ark-b-accent !px-1.5 !py-0 text-[10px]" aria-label={`${t("conversations.unreadMessages")}: ${item.unreadMessages}`}>
              {item.unreadMessages! > 99 ? "99+" : item.unreadMessages}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.description}</p>
        {item.timestamp && (
          <p className="text-[10px] text-muted-foreground mt-0.5">{formatRelativeTime(item.timestamp)}</p>
        )}
      </div>
    </button>
  );
}

export function NotificationBell() {
  const { t } = useApp();
  const { navigate } = useNav();
  const [open, setOpen] = useState(false);
  const { items, unreadCount, truncated, markAsRead, markAllAsRead, clearAll } = useNotifications();
  // Same screen, no reload: the router opens the section and the page reads
  // thread= / item= / tab= from the URL as it mounts.
  const openHref = (href: string) => {
    setOpen(false);
    if (!navigate(href)) window.location.href = href;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ark-ib relative"
          aria-label={unreadCount > 0 ? `${t("notifications.title") || "Notifications"}: ${unreadCount} ${t("notifications.unread") || "unread"}` : t("notifications.title") || "Notifications"}
          title={t("notifications.title") || "Notifications"}
        >
          <Bell aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="ar-bell-count" aria-hidden="true">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-sm font-semibold text-foreground">
            {t("notifications.title") || "Notifications"}
          </span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="p-1 rounded hover:bg-muted transition-colors"
                title={t("notifications.markAllRead") || "Mark all as read"}
                aria-label={t("notifications.markAllRead") || "Mark all as read"}
              >
                <CheckCheck className="size-3.5 text-muted-foreground" />
              </button>
            )}
            {items.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="p-1 rounded hover:bg-muted transition-colors"
                title={t("notifications.clearAll") || "Clear all"}
                aria-label={t("notifications.clearAll") || "Clear all"}
              >
                <Trash2 className="size-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="max-h-[320px] overflow-y-auto scrollbar-none">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Bell className="size-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                {t("notifications.empty") || "No notifications"}
              </p>
            </div>
          ) : (
            items.map((item) => (
              <NotificationRow key={item.id} item={item} onMarkRead={markAsRead} onOpen={openHref} t={t} />
            ))
          )}
        </div>

        {/* Footer with count */}
        {items.length > 0 && (
          <div className="bg-muted/40 px-3 py-2 text-center">
            <span className="text-[10px] text-muted-foreground">
              {items.length}{truncated ? "+" : ""} {t("notifications.total") || "notifications"} · {unreadCount}{truncated ? "+" : ""} {t("notifications.unread") || "unread"}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
