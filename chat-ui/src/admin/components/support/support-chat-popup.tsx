import { useEffect, useRef } from "react";
import { useSupportChat } from "@/admin/hooks/use-support-chat";
import { useApp } from "@/admin/app-context";
import { useIsMobile } from "@/hooks/use-mobile";
import { SupportPanel } from "./support-panel";

export function SupportChatPopup({ onClose }: { onClose: () => void }) {
  const chat = useSupportChat();
  const { t } = useApp();
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>(".ar-chat-header-btn--close")?.focus({ preventScroll: true });
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!isMobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [isMobile]);
  return <div ref={ref} className="ar-support-popup" role={isMobile ? "dialog" : "complementary"}
    aria-modal={isMobile || undefined} aria-label={t("support.title")} onKeyDown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); onClose(); }
    if (isMobile && event.key === "Tab" && !event.defaultPrevented && event.currentTarget.contains(event.target as Node)) {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]'))
        .filter(el => el.getClientRects().length && !el.closest("[hidden]"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><SupportPanel chat={chat} onDismiss={onClose} /></div>;
}
