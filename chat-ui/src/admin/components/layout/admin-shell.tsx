import React, { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useNav, useNavBadge } from "@/admin/lib/nav-context";
import { useAppViewport } from "@/admin/hooks/use-app-viewport";
import { CommandPalette } from "@/admin/components/command-palette/command-palette";
import { PageHeadView } from "@/admin/components/shared/kit";
import { cn } from "@/admin/lib/utils";
import { TopBar } from "./top-bar";
import { SubNav, useLeafDescription, useLeafLabel } from "./sub-nav";
import { FrameProvider, useFrame } from "./frame-context";
import { OPEN_SUPPORT_EVENT } from "./frame-events";
import { useInboxCount } from "./use-inbox-count";

// The support chat brings a markdown renderer (~450 kB) most visits never
// open: its own chunk, fetched on the first open.
const SupportChatPopup = lazy(async () => ({
  default: (await import("@/admin/components/support/support-chat-popup")).SupportChatPopup,
}));

/** A support chunk that does not arrive closes the popup with a toast, not the whole app. */
class SupportChunkBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The app frame (x / x-top / x-panels): the canvas, the top bar, and the
 * white panel the page lives in, with the section's sub nav on its left.
 *
 * Layout per leaf comes from lib/nav.ts (`frame`) and can be overridden by
 * the page with useFrameLayout(): `fill` (the page scrolls itself), `flush`
 * (no padding), `panels` (no white panel: the page draws <Panel>s).
 */
function Frame({ children }: { children: React.ReactNode }) {
  useAppViewport();
  const { t } = useApp();
  const { leaf, route } = useNav();
  const frame = useFrame();
  const label = useLeafLabel();
  const description = useLeafDescription();
  const inboxCount = useInboxCount();
  useNavBadge("inbox/conversazioni", inboxCount || null);
  const [supportOpen, setSupportOpen] = useState(false);

  useEffect(() => {
    const open = () => setSupportOpen(true);
    window.addEventListener(OPEN_SUPPORT_EVENT, open);
    return () => window.removeEventListener(OPEN_SUPPORT_EVENT, open);
  }, []);

  const layout = { ...leaf.frame, ...(frame?.override ?? {}) };
  const showDefaultHead = !layout.panels && (frame?.ownHeads ?? 0) === 0;

  const head = showDefaultHead ? (
    <PageHeadView title={label(leaf)} subtitle={description(leaf)} className="ar-default-head" />
  ) : null;

  return (
    // Height comes from admin.css (.ar-shell-height): WordPress's admin bar is
    // 32px on desktop but 46px under 783px, so a hardcoded calc cuts off the
    // bottom of the app on narrow viewports.
    <div className="ar-frame ar-shell-height">
      <TopBar inboxCount={inboxCount} />
      {/* One tree for every layout: a page that switches to `panels` from
          its own effect must not be remounted by the switch. */}
      <div className={cn("ar-body", layout.panels ? "ar-body-panels" : "ar-panel")}>
        {!layout.panels && <SubNav section={route.section} />}
        {/* A plain <div>, not <main> nor any landmark: WordPress already wraps
            the screen in #wpbody[role=main], the target of its "Salta al
            contenuto principale" link. A second main inside it failed both
            landmark rules, and a region here would sit between that main and
            the pages' own <aside>s and named panels (nested complementary,
            duplicate "Conversazioni" landmarks). */}
        <div
          className={cn(
            "ar-main",
            layout.panels && "ar-main-panels",
            layout.fill && "ar-main-fill",
            layout.flush && "ar-main-flush"
          )}
          data-admin-ready
          data-leaf={leaf.id}
        >
          {head}
          {children}
        </div>
      </div>
      {supportOpen && (
        <SupportChunkBoundary
          onFail={() => {
            setSupportOpen(false);
            toast.error(t("nav.shell.pageLoadFailed"));
          }}
        >
          <Suspense fallback={null}>
            <SupportChatPopup onClose={() => setSupportOpen(false)} />
          </Suspense>
        </SupportChunkBoundary>
      )}
      <CommandPalette />
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <FrameProvider>
      <Frame>{children}</Frame>
    </FrameProvider>
  );
}
