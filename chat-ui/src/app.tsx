"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { MessageThreadFull } from "@/components/tambo/message-thread-full";
import { ChatRuntimeProvider, useChatRuntime, type SendPermission } from "@/runtime";
import { cn } from "@/lib/utils";
import { FollowupsProvider } from "@/followups";
import { ChatTabNav } from "@/components/chat-tab-nav";
import { activeTabColorVars } from "@/lib/active-tab-color";
import { avatarImageUrl, launcherImageUrl, WidgetThemeContext } from "@/lib/widget-images";
import { FaqTab } from "@/components/faq-tab";
import { findVisibleDockSlot, prefillComposer, useDockSlot } from "@/lib/dock-slot";
import { getChatStrings } from "@/strings";
import {
  getGatedItem,
  readConsent,
  setGatedItem,
} from "@/lib/consent-storage";
import { createConsentSendGate, type ConsentSendGate } from "@/lib/consent-send-gate";
// Shared with the admin live preview so the preview can never render header
// colors the widget would not (cards rjvide6yfrwt, 1d1k60cjaawb).
import { brandHeaderColors, contrastColor } from "@/lib/brand-color";
import {
  parsePublicChatSignature,
  publicSignatureNeedsRefresh,
  publicSignatureRefreshDelayMs,
  type PublicChatSignature,
} from "@/lib/public-signature";
import { playWidgetSound, unlockAudio, hasWidgetSounds, getSoundMuted, subscribeSoundMuted, setSoundMuted } from "@/sounds";
import { motionDuration, useLauncherMotion, scheduleVisibleTimeout } from "@/widget-motion";
import { BookOpen, MessageSquare, RotateCcw, Star, Volume2, VolumeX } from "lucide-react";
import { FeedbackSheet, feedbackAlreadySent, registerFeedbackSender } from "@/components/generative-ui/feedback-sheet";
import { registerMessageRatingSender } from "@/components/generative-ui/message-rating";
import { registerRequestDraftSender } from "@/lib/request-draft-sender";
import { registerHandoffContactSender, registerHandoffNewChat } from "@/lib/handoff-contact";
import { sendVisitorPresence, useVisitorPresence } from "@/lib/visitor-presence";
import { headerIdentity } from "@/lib/header-identity";
import { AssistantAvatar } from "@/components/chat/presentation";
import { HeaderMenu, type HeaderMenuItem } from "@/components/chat/header-menu";
import { ChatSheetHost } from "@/components/chat/sheet";
import { useVisitorIdentity } from "@/hooks/use-visitor-identity";
import { PreChatForm } from "@/components/pre-chat-form";
import { getDeviceId } from "@/lib/device-id";
import { LegalFooter } from "@/components/chat/ai-disclosure";
import { PRODUCT_LINK_EVENT } from "@/lib/product-format";
import { widgetNumber } from "@/lib/widget-numbers";
import { detectHostTheme, rememberHostTheme, watchHostTheme, type ResolvedTheme } from "@/lib/host-theme";
import { restEndpoint } from "@/lib/rest-url";

const getStorageKey = () =>
  typeof window === "undefined"
    ? "alpharecall_chat_state:server"
    : `alpharecall_chat_state:${window.location.host}`;

const PRECHAT_GATE_VERSION = "3";
const getPreChatGateKey = () => `alpharecall_prechat_gate:${window.location.host}`;
const getConsentGateVersion = (policyVersion?: string) =>
  `${PRECHAT_GATE_VERSION}:${policyVersion?.trim() || "unversioned"}`;

const loadState = () => {
  if (typeof window === "undefined") {
    return { open: false, conversationId: null };
  }
  try {
    // Chat UI state is strictly necessary — user actively opened the widget
    const raw = getGatedItem(getStorageKey(), { strictlyNecessary: true });
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      open: !!parsed.open,
      conversationId: parsed.conversationId ? Number(parsed.conversationId) : null,
    };
  } catch (err) {
    return { open: false, conversationId: null };
  }
};

const saveState = (state: { open: boolean; conversationId: number | null }) => {
  if (typeof window === "undefined") return;
  // Chat UI state is strictly necessary — user actively opened the widget
  setGatedItem(getStorageKey(), JSON.stringify(state), { strictlyNecessary: true });
};

function isSafeImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const hexToHsl = (hex: string) => {
  const clean = hex.replace("#", "");
  if (![3, 6].includes(clean.length)) return "";
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  const hRound = Math.round(h);
  const sRound = Math.round(s * 100);
  const lRound = Math.round(l * 100);
  return `${hRound} ${sRound}% ${lRound}%`;
};


/**
 * "light"/"dark" pin the widget; "system" (the default, "Automatico") follows
 * the host page (lib/host-theme: the site's own marker, then its background,
 * then the OS) and re-evaluates when the site flips its theme. What it sees
 * is left for the widget editor's preview either way.
 */
const useResolvedTheme = (pref: string | undefined): ResolvedTheme => {
  const auto = !pref || pref === "system";
  const [hostTheme, setHostTheme] = React.useState<ResolvedTheme>(() =>
    auto ? detectHostTheme() : "light"
  );
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => {
      const theme = detectHostTheme();
      rememberHostTheme(theme);
      if (auto) setHostTheme(theme);
    };
    refresh();
    if (!auto) return;
    return watchHostTheme(refresh);
  }, [auto]);
  if (!auto) return pref === "dark" ? "dark" : "light";
  return hostTheme;
};

const useMediaQuery = (query: string) => {
  const [matches, setMatches] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(query);
    const handler = () => setMatches(media.matches);
    handler();
    if (media.addEventListener) {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }
    media.addListener(handler);
    return () => media.removeListener(handler);
  }, [query]);
  return matches;
};

const useHumanPolling = ({
  conversationId,
  restBase,
  nonce,
  chatSig,
  chatTs,
  visitorToken,
  deviceId,
  enabled,
}: {
  conversationId: number | null;
  restBase: string;
  nonce?: string;
  chatSig?: string;
  chatTs?: string;
  visitorToken?: string | null;
  deviceId?: string | null;
  enabled: boolean;
}) => {
  const { appendHumanMessage, setConversationStatus } = useChatRuntime();
  const lastSeenRef = React.useRef<string | null>(null);
  const seenHumanRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!conversationId || !enabled) return;
    // Cursor timestamps come only from the server. Browser time can skip a
    // human reply committed before the first SSE frame or while reopening.
    lastSeenRef.current = null;
    seenHumanRef.current = new Set();
  }, [conversationId, enabled]);

  React.useEffect(() => {
    if (!conversationId || !enabled) return;
    let cancelled = false;
    let timer: number | null = null;
    let running = false;
    let idlePolls = 0;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        if (cancelled) return;
        poll().catch((err) => {
          if (import.meta.env.DEV) console.warn("Poll error:", err);
        });
      }, delayMs);
    };

    const poll = async () => {
      if (cancelled || running) return;
      const visibilityState =
        typeof document.visibilityState === "string" ? document.visibilityState : "visible";
      if (visibilityState !== "visible") {
        schedule(12000);
        return;
      }
      running = true;
      try {
        const after = lastSeenRef.current ? `?after=${encodeURIComponent(lastSeenRef.current)}` : "";
        const res = await fetch(restEndpoint(restBase, `/chat-threads/${conversationId}/messages${after}`), {
          headers: {
            "X-WP-Nonce": nonce || "",
            ...(chatSig ? { "X-AlphaRecall-Signature": chatSig } : {}),
            ...(chatTs ? { "X-AlphaRecall-Timestamp": chatTs } : {}),
            ...(visitorToken ? { "X-Visitor-Token": visitorToken } : {}),
            ...(deviceId ? { "X-AlphaRecall-Device-Id": deviceId } : {}),
          },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (!cancelled && !Array.isArray(data) && data?.status) {
          setConversationStatus(conversationId, String(data.status), data.handoff_contact ?? null);
        }
        const messages = Array.isArray(data) ? data : data?.messages || [];
        let humanMessages = 0;
        let latestSeen = lastSeenRef.current;
        messages.forEach((msg: any) => {
          if (msg.created_at && (!latestSeen || String(msg.created_at) > String(latestSeen))) {
            latestSeen = String(msg.created_at);
          }
          if (msg.role !== "human") return;
          const dedupeKey = String(msg.id ?? `${msg.created_at || ""}:${msg.content || ""}`);
          if (seenHumanRef.current.has(dedupeKey)) return;
          if (cancelled) return;
          seenHumanRef.current.add(dedupeKey);
          if (seenHumanRef.current.size > 512) {
            seenHumanRef.current = new Set(Array.from(seenHumanRef.current).slice(-256));
          }
          humanMessages += 1;
          appendHumanMessage(String(msg.content || ""), { id: msg.id, created_at: msg.created_at, conversationId,
            ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
            ...(typeof msg.profile_name === "string" ? { profile_name: msg.profile_name } : {}) });
        });
        if (latestSeen) {
          lastSeenRef.current = latestSeen;
        }
        if (humanMessages > 0) {
          playWidgetSound("reply");
        }
        idlePolls = humanMessages > 0 ? 0 : Math.min(idlePolls + 1, 8);
      } catch (err) {
        if (import.meta.env.DEV) console.warn("Human polling error:", err);
      } finally {
        running = false;
        if (cancelled) return;
        const nextDelay = idlePolls >= 3 ? 8000 : 4000;
        schedule(nextDelay);
      }
    };

    const onVisibilityChange = () => {
      if (cancelled || running) return;
      const visibilityState =
        typeof document.visibilityState === "string" ? document.visibilityState : "visible";
      if (visibilityState === "visible") {
        idlePolls = 0;
        schedule(150);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(0);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [conversationId, enabled, restBase, nonce, chatSig, chatTs, visitorToken, deviceId, appendHumanMessage, setConversationStatus]);
};

// Runtime widget config injected via wp_localize_script (window.AlphaRecallChat.config).
// The permissive index signature preserves the many ad-hoc config.* reads (previously
// typed `any`) while explicitly documenting the plan feature flags added for the
// pricing foundation (#14).
type WidgetConfig = {
  /** Solid hex selected Chat/FAQ fill; absent/empty uses the theme's neutral gray. */
  activeTabBackgroundColor?: string;
  requireVisitorInfo?: boolean;
  privacyNoticeUrl?: string;
  privacyPolicyVersion?: string;
  autoRegisterWpUsers?: boolean | null;
  botShieldMode?: "off" | "standard" | "strict";
  // Plan feature flags (from PLAN_CATALOG via /tenants/current)
  features?: string[];
  /** False when the plan cannot store feedback (free tier); absent means allowed. */
  feedbackEnabled?: boolean;
  logoRemoval?: boolean;
  // Image fields read by launcherImageUrl() and the header avatar.
  launcherImageMode?: string;
  launcherIconUrl?: string;
  logoUrl?: string;
  /** Avatar for the dark theme; empty uses logoUrl for both. */
  logoUrlDark?: string;
  defaultAvatarUrl?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

type ChatShellProps = {
  isOpen: boolean;
  isMobile: boolean;
  position: "left" | "right";
  marginX: number;
  marginY: number;
  panelWidth: number;
  widgetStyle: "popup" | "sidepanel";
  onOpenChange: (open: boolean) => void;
  config: any;
  resolvedTheme: string;
  restBase: string;
  nonce?: string;
  chatSig?: string;
  chatTs?: string;
  visitorToken?: string | null;
  deviceId?: string | null;
  conversationId: number | null;
  LauncherIcon: React.ComponentType;
  isRestoringState?: boolean;
  consentOpen: boolean;
  dismissConsent: () => void;
  isRegistering: boolean;
  registerVisitor: (name: string, email: string, notifyOptIn: boolean, consent?: { chatProcessing: boolean; notifications?: boolean; marketing?: boolean }, policyVersion?: string) => Promise<void>;
  privacyNoticeUrl?: string;
  policyVersion?: string;
  initialVisitorName?: string;
  initialVisitorEmail?: string;
  requireVisitorInfo: boolean;
  showTeaser: boolean;
  setShowTeaser: (show: boolean) => void;
  teaserDismissed: boolean;
  setTeaserDismissed: (dismissed: boolean) => void;
  helpdeskEntries: any[];
  logoRemoval: boolean;
};

function ChatShell({
  isOpen,
  isMobile,
  position,
  marginX,
  marginY,
  panelWidth,
  widgetStyle,
  onOpenChange,
  config,
  resolvedTheme,
  restBase,
  nonce,
  chatSig,
  chatTs,
  visitorToken,
  deviceId,
  conversationId,
  LauncherIcon,
  isRestoringState,
  consentOpen,
  dismissConsent,
  isRegistering,
  registerVisitor,
  privacyNoticeUrl,
  policyVersion,
  initialVisitorName,
  initialVisitorEmail,
  requireVisitorInfo,
  showTeaser,
  setShowTeaser,
  teaserDismissed,
  setTeaserDismissed,
  helpdeskEntries,
  logoRemoval,
}: ChatShellProps) {
  const runtime = useChatRuntime();
  const { clearConversation, isRunning } = runtime;
  const panelRef = React.useRef<HTMLDivElement>(null);
  const dock = useDockSlot(panelRef, isOpen);
  // Closed with a slot on the page, the panel lives in the slot instead of hiding.
  const docked = !!dock.slot && !isOpen;
  const humanHandling = !!runtime.humanHandling;
  // Raw thread status and whether a team member has actually written, for
  // cards that must tell "waiting for the team" from "a person joined".
  const chatStatus = typeof runtime.chatStatus === "string" ? runtime.chatStatus : null;
  const humanJoined = !!runtime.humanJoined;
  const strings = getChatStrings();
  React.useEffect(() => registerHandoffNewChat(clearConversation), [clearConversation]);
  useVisitorPresence({
    conversationId,
    awaitingPerson: !!runtime.awaitingPerson,
    present: isOpen || docked,
    send: (id, state) => sendVisitorPresence({
      restBase,
      conversationId: id,
      state,
      headers: {
        "X-WP-Nonce": nonce || "",
        ...(chatSig ? { "X-AlphaRecall-Signature": chatSig } : {}),
        ...(chatTs ? { "X-AlphaRecall-Timestamp": chatTs } : {}),
        ...(visitorToken ? { "X-Visitor-Token": visitorToken } : {}),
        ...(deviceId ? { "X-AlphaRecall-Device-Id": deviceId } : {}),
      },
    }),
  });
  useHumanPolling({
    conversationId,
    restBase,
    nonce,
    chatSig,
    chatTs,
    visitorToken,
    deviceId,
    enabled: (isOpen || docked) && !!visitorToken,
  });
  const isPopup = widgetStyle === "popup";
  const isLeft = position === "left";
  const hasFaq = helpdeskEntries.length > 0;
  const [view, setView] = React.useState<"chat" | "faq">("chat");
  const [feedbackOpen, setFeedbackOpen] = React.useState(false);
  // Feedback is offered once the assistant has answered; while the team is
  // replying a chat turn would reach a person, not the feedback tool.
  const hasAssistantReply = (runtime.messages || []).some((message: any) => message?.role === "assistant" && !message?.metadata?.human && !message?.metadata?.syntheticWelcome);
  const canRate = config.feedbackEnabled !== false && hasAssistantReply && !humanHandling && !feedbackAlreadySent();
  const launcherStyle: string = config.launcherStyle || "pill";
  const compactLauncher = launcherStyle === "circle" || launcherStyle === "rounded-square";
  const hasLauncherImage = launcherStyle !== "text-only" && isSafeImageUrl(launcherImageUrl(config, resolvedTheme));
  const hasLauncherImageLabel = hasLauncherImage && !compactLauncher && !!config.launcherLabel;
  const launcherHeight = compactLauncher ? 58 : 54;
  const muted = React.useSyncExternalStore(subscribeSoundMuted, getSoundMuted, () => false);
  const launcherMotion = useLauncherMotion(config.launcher_animation || config.launcherAnimation || "none", !isOpen && !isRestoringState, config);
  const handleClose = () => onOpenChange(false);
  const wasOpen = React.useRef(false);
  const externalTriggerRef = React.useRef<HTMLElement | null>(null);
  const identity = headerIdentity({
    chatbotName: config.chatbotName,
    headerTitle: config.headerTitle,
    headerSubtitle: config.headerSubtitle,
    fallbackName: strings.assistantFallbackName,
    onlineStatus: strings.onlineStatus,
    personaStatus: strings.personaStatus,
  });
  const title = identity.name;
  const persona = String(config.chatbotName || "").trim();
  // The dark avatar, when set, follows the theme on screen and swaps live (card h8dosik1g6ic).
  const avatarSrc = avatarImageUrl(config, resolvedTheme);
  const avatarUrl = isSafeImageUrl(avatarSrc) ? avatarSrc : null;
  const greeting = config.autoOpenGreeting || config.auto_open_greeting;
  const teaserName = persona && config.headerTitle && persona !== config.headerTitle
    ? `${persona} · ${config.headerTitle}` : title;
  // Quick replies only from questions the tenant wrote, never invented ones.
  const teaserReplies: string[] = (Array.isArray(config.starterQuestions) ? config.starterQuestions : [])
    .filter((q: unknown): q is string => typeof q === "string" && q.trim() !== "")
    .slice(0, 2);

  const dockRef = React.useRef({ docked, inView: dock.inView });
  dockRef.current = { docked, inView: dock.inView };
  // Scrolling back to the slot while the floating panel is open returns the chat to it.
  // On a phone the open panel covers the page, so the slot cannot come into view.
  React.useEffect(() => {
    if (dock.inView && isOpen && !isMobile) onOpenChange(false);
    // Only the moment the slot comes back: opening the panel must not close it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dock.inView]);
  // The slot's own fallback (no JavaScript, chat unavailable) steps aside for the real panel.
  React.useEffect(() => {
    if (!dock.slot) return;
    dock.slot.dataset.arDock = docked ? "docked" : "floating";
  }, [dock.slot, docked]);
  const prefill = dock.slot?.dataset.alpharecallPrefill;
  // Once per page, even if the slot hides and returns at a breakpoint: later the composer belongs to the visitor.
  const prefilledRef = React.useRef(false);
  React.useEffect(() => {
    if (!prefill || !docked || prefilledRef.current) return;
    prefilledRef.current = true;
    prefillComposer(panelRef.current, prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  React.useEffect(() => {
    const openFromPage = (event: Event) => {
      // Cancellation acknowledges that the widget is mounted. Host links can
      // retain a normal contact-page fallback when the widget is unavailable.
      event.preventDefault();
      // The chat is already on screen in its slot: go to it, nothing to open.
      if (dockRef.current.docked && dockRef.current.inView) {
        setView("chat");
        // After the view switch has rendered. Scrolling is wanted here: a slot only a quarter in view may hide the composer.
        requestAnimationFrame(() => panelRef.current?.querySelector<HTMLTextAreaElement>(".ar-chat-composer textarea")?.focus());
        return;
      }
      const trigger = document.activeElement;
      if (trigger instanceof HTMLElement && !panelRef.current?.contains(trigger)) {
        externalTriggerRef.current = trigger;
      }
      setView("chat");
      onOpenChange(true);
      panelRef.current?.querySelector<HTMLButtonElement>(".ar-chat-header-btn--close")?.focus({ preventScroll: true });
    };
    window.addEventListener("alpharecall:open", openFromPage);
    return () => window.removeEventListener("alpharecall:open", openFromPage);
  }, [onOpenChange]);
  React.useEffect(() => {
    if (isOpen && !wasOpen.current) {
      panelRef.current?.querySelector<HTMLButtonElement>(".ar-chat-header-btn--close")?.focus({ preventScroll: true });
    } else if (!isOpen && wasOpen.current) {
      // Re-docked by scrolling back while typing: the visitor stays in the composer.
      const keepFocus = dockRef.current.docked && dockRef.current.inView && panelRef.current?.contains(document.activeElement);
      if (!keepFocus) {
        const trigger = externalTriggerRef.current;
        (trigger?.isConnected ? trigger : document.querySelector<HTMLButtonElement>(".ar-chat-launcher"))?.focus({ preventScroll: true });
      }
      externalTriggerRef.current = null;
    }
    wasOpen.current = isOpen;
  }, [isOpen]);
  // On phones the panel covers the page, so page scrolling is locked while it is open.
  React.useEffect(() => {
    const lock = isOpen && isMobile;
    document.documentElement.classList.toggle("ar-chat-open", lock);
    return () => { document.documentElement.classList.remove("ar-chat-open"); };
  }, [isOpen, isMobile]);
  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (docked) return;
    if (event.key === "Escape" && !consentOpen) {
      event.preventDefault();
      handleClose();
    }
    if (event.key !== "Tab" || !isMobile || consentOpen) return;
    const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex="0"]'
    ) || []).filter((el) => el.getClientRects().length && !el.closest('[inert]'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const focusComposer = () => {
    window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLTextAreaElement>(".ar-chat-composer textarea")?.focus({ preventScroll: true });
    });
  };
  const dismissTeaser = () => {
    setShowTeaser(false);
    setTeaserDismissed(true);
    setGatedItem(
      `alpharecall_teaser_dismissed:${window.location.host}`,
      String(Date.now()),
      { strictlyNecessary: false, privacyNoticeConfigured: !!privacyNoticeUrl }
    );
  };

  const menuItems: HeaderMenuItem[] = [
    {
      id: "clear",
      label: strings.clearConversation,
      icon: <RotateCcw aria-hidden="true" />,
      onSelect: () => clearConversation?.(),
      disabled: isRunning,
    },
    ...(hasWidgetSounds(config) ? [{
      id: "sounds",
      // A checkbox keeps one label; its checked state says whether sounds are off.
      label: strings.muteSounds,
      icon: muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />,
      onSelect: () => { void unlockAudio(); setSoundMuted(!muted); },
      checked: muted,
    }] : []),
    ...(hasFaq ? [{
      id: "faq",
      label: strings.faqViewLabel,
      icon: <BookOpen aria-hidden="true" />,
      onSelect: () => setView("faq"),
    }] : []),
    ...(canRate ? [{
      id: "rate",
      label: strings.rateChat,
      icon: <Star aria-hidden="true" />,
      onSelect: () => setFeedbackOpen(true),
      disabled: isRunning,
    }] : []),
  ];

  const dockedStyle: React.CSSProperties = dock.frame ? {
    position: "absolute",
    top: `${dock.frame.top}px`,
    left: `${dock.frame.left}px`,
    right: "auto",
    bottom: "auto",
    width: `${dock.frame.width}px`,
    height: `${dock.frame.height}px`,
    maxWidth: "none",
    maxHeight: "none",
    borderRadius: dock.frame.radius,
    zIndex: 1,
  } : {};
  const panelPositionStyle = isPopup && !isMobile ? {
    top: "auto",
    bottom: `${marginY + launcherHeight + 14}px`,
    ...(isLeft ? { left: `${marginX}px` } : { right: `${marginX}px` }),
    width: `${config.panelWidth || 380}px`,
    height: `${config.panelHeight || 520}px`,
    // Reserve the launcher height + a comfortable top gap so a tall panelHeight
    // never crowds the viewport top edge.
    maxHeight: `calc(100dvh - ${marginY + launcherHeight + 60}px)`,
    maxWidth: `calc(100vw - ${marginX * 2}px)`,
    borderRadius: `${config.radius || 18}px`,
  } : {};

  return (
    <div className="ar-chat-shell" data-theme={resolvedTheme} data-widget-style={widgetStyle}
      style={{ ...activeTabColorVars(config.activeTabBackgroundColor), "--ar-font-scale": Number(config.fontScale || 1), "--ar-duration": `${motionDuration(config.motionSpeed)}ms` } as React.CSSProperties}
      data-motion={config.motionStyle || "subtle"}
      data-animate-messages={config.animateMessages !== false ? "true" : "false"}
      data-header-style={config.headerStyle || "soft"}
      data-starter-layout={config.starterLayout || "cards"}
      data-show-avatars="true">
      {isMobile && (
        <div className={cn("ar-chat-overlay", isOpen && "is-open")} onClick={handleClose} />
      )}
      <div
        className={cn(
          "ar-launcher-dock fixed z-[9999] bottom-0",
          position === "left" ? "left-0" : "right-0",
        )}
        style={{
          marginLeft: position === "left" ? `${marginX}px` : undefined,
          marginRight: position === "right" ? `${marginX}px` : undefined,
          marginBottom: `${marginY}px`,
        }}
        hidden={docked && dock.inView}
      >
        {showTeaser && !isOpen && greeting ? (
          <div className="ar-teaser-bubble ar-teaser" data-position={position} role="region" aria-label={teaserName}>
            <div className="ar-teaser-row">
              <AssistantAvatar name={title} imageUrl={avatarUrl} size="sm" />
              <button
                type="button"
                className="ar-teaser-body"
                onClick={() => {
                  setShowTeaser(false);
                  onOpenChange(true);
                }}
              >
                <span className="ar-teaser-name">{teaserName}</span>
                <span className="ar-teaser-text">{greeting}</span>
              </button>
              <button type="button" className="ar-teaser-close" onClick={dismissTeaser} aria-label={strings.dismissLabel}>
                <XIcon aria-hidden="true" />
              </button>
            </div>
            {teaserReplies.length > 0 ? (
              <div className="ar-teaser-replies">
                {teaserReplies.map((question) => (
                  <button key={question} type="button" className="ar-teaser-reply" onClick={() => {
                    setShowTeaser(false);
                    setView("chat");
                    onOpenChange(true);
                    void runtime.sendMessage?.(question);
                  }}>{question}</button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {!isOpen ? (
          <button
            className="ar-chat-launcher"
            data-style={launcherStyle}
            data-animation={launcherMotion.animation}
            data-image={hasLauncherImage || undefined}
            data-image-label={hasLauncherImageLabel || undefined}
            type="button"
            aria-label={config.launcherLabel || strings.chatTab}
            aria-expanded={isOpen}
            aria-controls="ar-chat-panel"
            onClick={() => onOpenChange(!isOpen)}
            style={{
              backgroundColor: hasLauncherImage ? "transparent" : config.buttonColor || config.primaryColor || "#10a37f",
              color: contrastColor(config.buttonColor || config.primaryColor || "#10a37f"),
              borderRadius:
                launcherStyle === "rounded-square"
                  ? "18px"
                  : `${Number(config.buttonRadius || 999)}px`,
              ...(compactLauncher ? { width: launcherHeight, height: launcherHeight } : {}),
            }}
          >
            {launcherStyle !== "text-only" && <LauncherIcon />}
            {launcherStyle === "text-only" ? (
              <span className="ar-launcher-label">{config.launcherLabel || "Chat"}</span>
            ) : compactLauncher ? null : (
              config.launcherLabel ? <span className="ar-launcher-label">{config.launcherLabel}</span> : null
            )}
          </button>
        ) : null}
      </div>

      <div
        id="ar-chat-panel"
        ref={panelRef}
        role={isMobile && !docked ? "dialog" : "complementary"}
        aria-modal={isMobile && isOpen ? true : undefined}
        aria-label={config.headerTitle || config.chatbotName || strings.chatTab}
        onKeyDown={handlePanelKeyDown}
        className={cn(
          "ar-chat-panel fixed z-[9999] flex flex-col",
          !isPopup && "top-0 h-screen",
          isPopup && isMobile && "top-0 h-screen w-screen",
          !isPopup && !isMobile && (isLeft ? "left-0" : "right-0"),
          !isPopup && isMobile && "top-0 h-screen w-screen",
        )}
        data-open={isOpen || docked ? "true" : "false"}
        data-docked={docked ? "true" : undefined}
        data-position={position}
        data-widget-style={widgetStyle}
        data-view={view}
        data-human={humanHandling ? "true" : undefined}
        data-chat-status={chatStatus || undefined}
        data-handoff-contact={runtime.handoffContact || undefined}
        data-human-joined={humanJoined ? "true" : undefined}
        data-restoring={isRestoringState ? "true" : undefined}
        aria-hidden={!isOpen && !docked}
        inert={!isOpen && !docked}
        style={docked ? dockedStyle : {
          ...(!isPopup ? {
            width: isMobile ? "100vw" : `${panelWidth}px`,
            height: "100dvh",
            marginLeft: isLeft && !isMobile ? "0px" : undefined,
            marginRight: !isLeft && !isMobile ? "0px" : undefined,
            borderRadius: "0px",
          } : (isMobile ? {
            width: "100vw",
            height: "100dvh",
          } : {})),
          ...panelPositionStyle,
        }}
      >
        <div className="ar-chat-animate ar-chat-header" data-view={view}>
          {view === "chat" ? (
            <div className="ar-chat-identity">
              {avatarUrl ? (
                <img src={avatarUrl} alt={config.chatbotName || strings.assistantFallbackName} className="ar-chat-avatar" />
              ) : (
                <AssistantAvatar name={title} className="ar-chat-avatar ar-chat-avatar--initial" />
              )}
              <div className="ar-chat-header-text">
                <div className="ar-chat-header-name">{title}</div>
                <div className="ar-chat-header-status">
                  <span className="ar-status-dot" aria-hidden="true" />
                  <span className="ar-chat-header-status-text">
                    {humanHandling ? strings.humanHandlingLabel : identity.status}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
          {hasFaq ? (
            <ChatTabNav activeTab={view} onChange={setView} chatLabel={strings.chatTab} faqLabel={strings.faqTab} />
          ) : null}
          <div className="ar-chat-header-actions">
            {view === "chat" ? <HeaderMenu label={strings.moreOptions} items={menuItems} /> : null}
            {docked ? null : (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="ar-chat-header-btn ar-chat-header-btn--close"
                aria-label={strings.closeChat}
                title={strings.closeChat}
              >
                <XIcon aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="ar-chat-body">
          <ChatSheetHost>
            <div
              className="ar-chat-views"
              aria-hidden={consentOpen || undefined}
              inert={consentOpen || undefined}
            >
              <div className="ar-chat-animate ar-view ar-view--chat" hidden={view !== "chat"}>
                <MessageThreadFull className="h-full" />
              </div>
              {hasFaq && view === "faq" ? (
                <div className="ar-chat-animate ar-view ar-view--faq">
                  <FaqTab
                    entries={helpdeskEntries}
                    assistantName={persona || title}
                    onAskAbout={(q) => {
                      setView("chat");
                      void runtime.sendMessage?.(q);
                    }}
                    onOpenChat={() => {
                      setView("chat");
                      focusComposer();
                    }}
                  />
                </div>
              ) : null}
            </div>
            {consentOpen ? (
              <PreChatForm
                strings={strings}
                onSubmit={(n, e, opt, consent, polVer) => registerVisitor(n, e, opt, consent, polVer)}
                onDismiss={dismissConsent}
                isSubmitting={isRegistering}
                privacyNoticeUrl={privacyNoticeUrl}
                policyVersion={policyVersion}
                initialName={initialVisitorName || ""}
                initialEmail={initialVisitorEmail || ""}
              />
            ) : null}
            <FeedbackSheet
              open={feedbackOpen}
              onClose={() => setFeedbackOpen(false)}
              onSubmit={(text) => {
                // Stars and the required comment go out as a normal turn, so the
                // agent's feedback tool records them.
                setFeedbackOpen(false);
                setView("chat");
                void runtime.sendMessage?.(text);
              }}
            />
          </ChatSheetHost>
        </div>
        <LegalFooter strings={strings} humanHandling={humanHandling} hidden={view === "faq"}>
          {privacyNoticeUrl ? (
            <a
              href={privacyNoticeUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={strings.privacyNoticeLinkLabel}
            >
              {strings.privacyShort}
            </a>
          ) : null}
          {!logoRemoval ? (
            <a className="ar-chat-branding" href="https://alpharecall.com/" target="_blank" rel="noopener noreferrer">
              Powered by Alpha Recall
            </a>
          ) : null}
        </LegalFooter>
      </div>
    </div>
  );
}

export function App() {
  const chatConfig = typeof window !== "undefined" ? (window as any).AlphaRecallChat || {} : {};
  const config: WidgetConfig = chatConfig.config || {};
  const [deviceId] = React.useState<string | null>(() =>
    config.botShieldMode === "off" ? null : getDeviceId()
  );
  chatConfig.deviceId = deviceId;
  const restBase = String(chatConfig.restUrl || "").replace(/\/$/, "");
  const streamUrl = String(chatConfig.streamUrl || "");
  const nonce = chatConfig.nonce || "";
  const chatSigTtl = Number(chatConfig.chatSigTtl) > 0 ? Number(chatConfig.chatSigTtl) : 3600;
  const [publicSignature, setPublicSignature] = React.useState<PublicChatSignature>(() => ({
    chatSig: String(chatConfig.chatSig || ""),
    chatTs: String(chatConfig.chatTs || ""),
  }));
  const publicSignatureRef = React.useRef(publicSignature);
  const signatureRefreshRef = React.useRef<Promise<PublicChatSignature> | null>(null);
  const chatSig = publicSignature.chatSig;
  const chatTs = publicSignature.chatTs;
  const wpUser = chatConfig.user || null;
  const requireVisitorInfo = config.requireVisitorInfo === true;
  // Plan feature flags injected by PHP (see class-ar-chat.php).
  const features: string[] = Array.isArray(config.features) ? config.features : [];
  void features;
  // The "Powered by Alpha Recall" credit is opt-in: it shows only when PHP says the owner
  // asked for it (logoRemoval === false). A config without the key shows no credit.
  const logoRemoval: boolean = config.logoRemoval !== false;
  // GDPR Phase 1: privacy notice URL + policy version + auto-register gate
  const privacyNoticeUrl: string | undefined = config.privacyNoticeUrl || undefined;
  const policyVersion: string | undefined = config.privacyPolicyVersion || undefined;
  // Auto-registration of logged-in WordPress users is an explicit tenant opt-in:
  // a missing flag must not create an identified visitor row without a decision.
  const autoRegisterWpUsers = config.autoRegisterWpUsers === true;
  // ePrivacy: whether the tenant has configured a privacy notice (enables consent gate)
  const privacyNoticeConfigured = !!privacyNoticeUrl;

  const ensureFreshPublicSignature = React.useCallback(async (): Promise<PublicChatSignature> => {
    const current = publicSignatureRef.current;
    if (!publicSignatureNeedsRefresh(current, chatSigTtl)) return current;
    if (signatureRefreshRef.current) return signatureRefreshRef.current;

    const refresh = (async () => {
      const headers: Record<string, string> = {};
      if (nonce) headers["X-WP-Nonce"] = nonce;
      if (current.chatSig) headers["X-AlphaRecall-Signature"] = current.chatSig;
      if (current.chatTs) headers["X-AlphaRecall-Timestamp"] = current.chatTs;
      if (deviceId) headers["X-AlphaRecall-Device-Id"] = deviceId;
      const response = await fetch(`${restBase}/chat-signature`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to refresh chat request capability");
      const next = parsePublicChatSignature(await response.json());
      if (!next) throw new Error("Invalid chat request capability response");
      publicSignatureRef.current = next;
      setPublicSignature(next);
      if (typeof window !== "undefined" && (window as any).AlphaRecallChat) {
        (window as any).AlphaRecallChat.chatSig = next.chatSig;
        (window as any).AlphaRecallChat.chatTs = next.chatTs;
      }
      return next;
    })();
    signatureRefreshRef.current = refresh;
    try {
      return await refresh;
    } finally {
      if (signatureRefreshRef.current === refresh) signatureRefreshRef.current = null;
    }
  }, [chatSigTtl, deviceId, nonce, restBase]);

  React.useEffect(() => {
    let retryTimer: number | null = null;
    const delay = publicSignatureRefreshDelayMs(publicSignatureRef.current, chatSigTtl);
    const timer = window.setTimeout(() => {
      void ensureFreshPublicSignature().catch(() => {
        retryTimer = window.setTimeout(() => {
          void ensureFreshPublicSignature().catch(() => undefined);
        }, 30000);
      });
    }, Math.min(delay, 2147483647));
    const refreshOnResume = () => {
      if (document.visibilityState === "visible") {
        void ensureFreshPublicSignature().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", refreshOnResume);
    window.addEventListener("focus", refreshOnResume);
    return () => {
      window.clearTimeout(timer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", refreshOnResume);
      window.removeEventListener("focus", refreshOnResume);
    };
  }, [chatSigTtl, chatTs, ensureFreshPublicSignature]);

  const { visitorToken, visitorName, isRegistering, registerVisitor, ensureVisitorToken } = useVisitorIdentity({
    restBase,
    nonce,
    chatSig,
    chatTs,
    deviceId,
    wpUser,
    requireVisitorInfo,
    autoRegisterWpUsers,
    privacyNoticeConfigured,
  });
  React.useEffect(() => {
    const handleConsentDecision = (event: Event) => {
      const detail = (event as CustomEvent<{
        action_id?: unknown;
        decision?: unknown;
        respond?: (result: { ok: boolean; status: number }) => void;
      }>).detail;
      if (
        typeof detail?.action_id !== "string" ||
        (detail.decision !== "accept" && detail.decision !== "decline") ||
        typeof detail.respond !== "function"
      ) {
        return;
      }

      void (async () => {
        try {
          const signature = await ensureFreshPublicSignature();
          const token = await ensureVisitorToken();
          if (!token) {
            detail.respond!({ ok: false, status: 403 });
            return;
          }
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-AlphaRecall-Signature": signature.chatSig,
            "X-AlphaRecall-Timestamp": signature.chatTs,
            "X-Visitor-Token": token,
          };
          if (nonce) headers["X-WP-Nonce"] = nonce;
          if (deviceId) headers["X-AlphaRecall-Device-Id"] = deviceId;
          const response = await fetch(`${restBase}/visitor-consent-decision`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              action_id: detail.action_id,
              decision: detail.decision,
            }),
          });
          detail.respond!({ ok: response.ok, status: response.status });
        } catch {
          detail.respond!({ ok: false, status: 0 });
        }
      })();
    };

    window.addEventListener("alpharecall:consent-decision", handleConsentDecision);
    return () => window.removeEventListener("alpharecall:consent-decision", handleConsentDecision);
  }, [deviceId, ensureFreshPublicSignature, ensureVisitorToken, nonce, restBase]);
  // Thumbs on answers post through the same signed visitor headers.
  React.useEffect(() => registerMessageRatingSender(async (id, rating) => {
    try {
      const signature = await ensureFreshPublicSignature();
      const token = await ensureVisitorToken();
      if (!token) return false;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AlphaRecall-Signature": signature.chatSig,
        "X-AlphaRecall-Timestamp": signature.chatTs,
        "X-Visitor-Token": token,
      };
      if (nonce) headers["X-WP-Nonce"] = nonce;
      if (deviceId) headers["X-AlphaRecall-Device-Id"] = deviceId;
      const response = await fetch(`${restBase}/chat-messages/${id}/rating`, {
        method: "POST",
        headers,
        body: JSON.stringify({ rating }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }), [deviceId, ensureFreshPublicSignature, ensureVisitorToken, nonce, restBase]);
  // Contact, quote and call-back cards: the request is stored only by this confirm.
  React.useEffect(() => registerRequestDraftSender(async (draftId, decision, fields) => {
    try {
      const signature = await ensureFreshPublicSignature();
      const token = await ensureVisitorToken();
      if (!token) return { ok: false, status: 403 };
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AlphaRecall-Signature": signature.chatSig,
        "X-AlphaRecall-Timestamp": signature.chatTs,
        "X-Visitor-Token": token,
      };
      if (nonce) headers["X-WP-Nonce"] = nonce;
      if (deviceId) headers["X-AlphaRecall-Device-Id"] = deviceId;
      const response = await fetch(`${restBase}/visitor-request-draft`, {
        method: "POST",
        headers,
        body: JSON.stringify({ draft_id: draftId, decision, ...(fields && Object.keys(fields).length ? { fields } : {}) }),
      });
      if (!response.ok) return { ok: false, status: response.status };
      const body = await response.json().catch(() => null);
      return {
        ok: true,
        state: body?.state ?? (decision === "confirm" ? "confirmed" : "cancelled"),
        confirmedAt: typeof body?.confirmed_at === "string" ? body.confirmed_at : null,
        deduped: !!body?.deduped,
      };
    } catch {
      return { ok: false, status: 0 };
    }
  }), [deviceId, ensureFreshPublicSignature, ensureVisitorToken, nonce, restBase]);
  const consentGateVersion = getConsentGateVersion(policyVersion);
  const [consentGranted, setConsentGranted] = React.useState(() => {
    if (typeof window === "undefined" || readConsent() !== "granted") return false;
    return getGatedItem(getPreChatGateKey(), { strictlyNecessary: true }) === consentGateVersion;
  });
  const [consentOpen, setConsentOpen] = React.useState(false);
  const consentSendGateRef = React.useRef<ConsentSendGate | null>(null);
  if (!consentSendGateRef.current) {
    consentSendGateRef.current = createConsentSendGate(() => setConsentOpen(true));
  }

  const finishConsentRequest = React.useCallback((permission: SendPermission) => {
    setConsentOpen(false);
    consentSendGateRef.current?.finish(permission);
  }, []);

  const requestSendPermission = React.useCallback(async (): Promise<SendPermission> => {
    try {
      if (!requireVisitorInfo) {
        const signature = await ensureFreshPublicSignature();
        const token = await ensureVisitorToken();
        if (!token) return { allowed: false };
        return {
          allowed: true,
          visitorToken: token,
          chatSig: signature.chatSig,
          chatTs: signature.chatTs,
        };
      }
      // Refresh before opening the consent gate so visitor registration also
      // receives a current anti-abuse capability after a long-idle tab.
      await ensureFreshPublicSignature();
      const permission = consentGranted && visitorToken
        ? { allowed: true, visitorToken }
        : await consentSendGateRef.current!.request();
      if (!permission.allowed) return permission;
      const signature = await ensureFreshPublicSignature();
      return {
        ...permission,
        chatSig: signature.chatSig,
        chatTs: signature.chatTs,
      };
    } catch (error) {
      if (import.meta.env.DEV) console.warn("Chat signature refresh failed:", error);
      return { allowed: false };
    }
  }, [consentGranted, ensureFreshPublicSignature, ensureVisitorToken, requireVisitorInfo, visitorToken]);

  React.useEffect(() => () => {
    consentSendGateRef.current?.cancel();
  }, []);

  const initial = React.useMemo(() => loadState(), []);
  // A page with a slot always starts with the chat in the slot, whatever the last page left open.
  const startOpen = initial.open && !findVisibleDockSlot();
  const [isOpen, setIsOpen] = React.useState(startOpen);
  const [conversationId, setConversationId] = React.useState<number | null>(initial.conversationId);
  // The hand-off card: the e-mail of a visitor who does not want to wait.
  React.useEffect(() => {
    if (!conversationId) return undefined;
    return registerHandoffContactSender(async (body) => {
      try {
        const signature = await ensureFreshPublicSignature();
        const token = await ensureVisitorToken();
        if (!token) return { ok: false, status: 403 };
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-AlphaRecall-Signature": signature.chatSig,
          "X-AlphaRecall-Timestamp": signature.chatTs,
          "X-Visitor-Token": token,
        };
        if (nonce) headers["X-WP-Nonce"] = nonce;
        if (deviceId) headers["X-AlphaRecall-Device-Id"] = deviceId;
        const response = await fetch(`${restBase}/visitor-handoff-contact`, {
          method: "POST",
          headers,
          body: JSON.stringify({ thread_id: conversationId, ...body }),
        });
        if (!response.ok) return { ok: false, status: response.status };
        const data = await response.json().catch(() => null);
        return { ok: true, stage: data?.stage === "sent" ? "sent" : "details" };
      } catch {
        return { ok: false, status: 0 };
      }
    });
  }, [conversationId, deviceId, ensureFreshPublicSignature, ensureVisitorToken, nonce, restBase]);
  const conversationIdRef = React.useRef(conversationId);
  conversationIdRef.current = conversationId;
  // "Valuta la conversazione" stores feedback directly. A backend without the
  // route answers 404/405 or rest_no_route: the sheet then falls back to the
  // chat turn. Any other failure is an error the visitor can retry.
  React.useEffect(() => registerFeedbackSender(async ({ rating, comment, idempotencyKey }) => {
    try {
      const signature = await ensureFreshPublicSignature();
      const token = await ensureVisitorToken();
      if (!token) return "error";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AlphaRecall-Signature": signature.chatSig,
        "X-AlphaRecall-Timestamp": signature.chatTs,
        "X-Visitor-Token": token,
      };
      if (nonce) headers["X-WP-Nonce"] = nonce;
      if (deviceId) headers["X-AlphaRecall-Device-Id"] = deviceId;
      const response = await fetch(`${restBase}/visitor-feedback`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          rating,
          comment,
          conversation_id: conversationIdRef.current,
          idempotency_key: idempotencyKey,
        }),
      });
      if (response.ok) return "ok";
      if (response.status === 404 || response.status === 405) return "missing";
      const body = await response.json().catch(() => null);
      if (body?.code === "rest_no_route") return "missing";
      // Safety net for a plan without tools (the menu item is normally hidden
      // by feedbackEnabled): fall back to the chat turn instead of a retry
      // that cannot succeed. The proxy sends code "plan_required"; older
      // ones only the "Paid license required for tools." text.
      if (response.status !== 403) return "error";
      const code = String(body?.code ?? "");
      const reason = `${body?.error ?? ""} ${body?.detail ?? ""} ${body?.message ?? ""}`;
      return code === "plan_required" || /licen[sz]/i.test(reason) ? "missing" : "error";
    } catch {
      return "error";
    }
  }), [deviceId, ensureFreshPublicSignature, ensureVisitorToken, nonce, restBase]);
  const [followups, setFollowups] = React.useState<string[]>([]);
  const [showTeaser, setShowTeaser] = React.useState(false);
  const [teaserDismissed, setTeaserDismissed] = React.useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const previousOverflowRef = React.useRef<string>("");

  // Track whether this is the initial render so we can skip animations
  // when restoring a previously-open chat across page navigation.
  const [isRestoringState, setIsRestoringState] = React.useState(startOpen);
  React.useEffect(() => {
    if (isRestoringState) {
      // Allow one frame for the panel to render at its final position,
      // then re-enable transitions for subsequent open/close actions.
      const raf = requestAnimationFrame(() => {
        setIsRestoringState(false);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [isRestoringState]);

  // Auto-open / teaser bubble timer
  React.useEffect(() => {
    const delay = Number(config.autoOpenDelay || config.auto_open_delay || 0);
    if (delay <= 0 || isOpen || teaserDismissed || findVisibleDockSlot()) return;

    const storageKey = `alpharecall_teaser_dismissed:${window.location.host}`;
    const dismissed = getGatedItem(storageKey, {
      strictlyNecessary: false,
      privacyNoticeConfigured: !!privacyNoticeUrl,
    });
    if (dismissed) {
      const ts = parseInt(dismissed, 10);
      if (Date.now() - ts < 24 * 60 * 60 * 1000) return; // 24h cooldown
    }

    return scheduleVisibleTimeout(() => {
      // Set cooldown so auto-open doesn't re-arm after manual close.
      // For non-consenting users setGatedItem returns false silently, but
      // setTeaserDismissed(true) ensures the timer cannot re-fire within
      // the current session.
      setGatedItem(storageKey, String(Date.now()), {
        strictlyNecessary: false,
        privacyNoticeConfigured: !!privacyNoticeUrl,
      });
      setTeaserDismissed(true);
      const greeting = config.autoOpenGreeting || config.auto_open_greeting;
      if (greeting) {
        setShowTeaser(true);
      } else {
        setIsOpen(true);
      }
      playWidgetSound("attention");
    }, delay * 1000);

  }, [config.autoOpenDelay, config.auto_open_delay, config.autoOpenGreeting, config.auto_open_greeting, config.attentionSound, config.attention_sound, isOpen, teaserDismissed]);

  React.useEffect(() => {
    if (!hasWidgetSounds(config)) return;
    const prime = () => { if (!getSoundMuted()) void unlockAudio(); };
    document.addEventListener("pointerdown", prime);
    document.addEventListener("keydown", prime);
    return () => { document.removeEventListener("pointerdown", prime); document.removeEventListener("keydown", prime); };
  }, [config]);

  const resolvedTheme = useResolvedTheme(config.theme);

  React.useEffect(() => {
    saveState({ open: isOpen, conversationId });
  }, [isOpen, conversationId]);

  // A product card opens its page on this site in the same tab. The side panel
  // comes back open next to it; on a phone the chat would cover the product,
  // so it comes back closed and the launcher reopens the same conversation.
  React.useEffect(() => {
    const leaving = () => {
      if (isMobile) saveState({ open: false, conversationId });
    };
    window.addEventListener(PRODUCT_LINK_EVENT, leaving);
    return () => window.removeEventListener(PRODUCT_LINK_EVENT, leaving);
  }, [isMobile, conversationId]);

  React.useEffect(() => {
    const body = document.body;
    previousOverflowRef.current = body.style.overflow;
    body.classList.add("ar-chat-host");
    return () => {
      body.classList.remove("ar-chat-host");
      body.style.removeProperty("--ar-chat-panel-width");
      body.style.removeProperty("--ar-page-duration");
      body.classList.remove("ar-chat-open-right");
      body.classList.remove("ar-chat-open-left");
      body.style.overflow = previousOverflowRef.current;
    };
  }, []);

  React.useEffect(() => {
    document.body.style.setProperty("--ar-page-duration", config.motionStyle === "none" ? "0ms" : `${motionDuration(config.motionSpeed)}ms`);
    const panelWidth = Number(config.panelWidth || 420);
    const position = config.position === "left" ? "left" : "right";
    const currentWidgetStyle = config.widgetStyle === "popup" ? "popup" : "sidepanel";

    if (currentWidgetStyle === "sidepanel") {
      document.body.style.setProperty("--ar-chat-panel-width", `${panelWidth}px`);
      // When restoring state from a previous session, temporarily disable the
      // body padding transition so the page doesn't visually shift on load.
      if (isRestoringState) {
        document.body.classList.add("ar-chat-no-transition");
      }
      const shouldOpen = isOpen && !isMobile;
      document.body.classList.toggle("ar-chat-open-right", shouldOpen && position === "right");
      document.body.classList.toggle("ar-chat-open-left", shouldOpen && position === "left");
      if (isRestoringState) {
        // Force layout, then remove the no-transition class so future
        // open/close actions animate normally.
        void document.body.offsetHeight;
        document.body.classList.remove("ar-chat-no-transition");
      }
    } else {
      // Popup mode: no body push
      document.body.classList.remove("ar-chat-open-right", "ar-chat-open-left");
      document.body.style.removeProperty("--ar-chat-panel-width");
    }

    if (isOpen && isMobile) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = previousOverflowRef.current;
    }
  }, [isOpen, isMobile, isRestoringState, config.panelWidth, config.position, config.widgetStyle, config.motionStyle, config.motionSpeed]);

  React.useEffect(() => {
    const root = document.getElementById("alpharecall-chat-root");
    if (!root) return;
    root.setAttribute("data-theme", resolvedTheme);
    const primary = String(config.primaryColor || "#10a37f");
    const accent = String(config.accentColor || primary);
    const primaryHsl = hexToHsl(primary);
    const accentHsl = hexToHsl(accent);
    if (primaryHsl) {
      root.style.setProperty("--primary", primaryHsl);
      root.style.setProperty("--primary-foreground", hexToHsl(contrastColor(primary)));
      root.style.setProperty("--ring", "0 0% 48%");
    }
    if (accentHsl) {
      root.style.setProperty("--accent", accentHsl);
    }
    // The tenant color of the Concierge design: user bubbles, primary buttons,
    // the assistant's initial. Its ink is picked for contrast, never assumed.
    root.style.setProperty("--ar-tenant", primary);
    root.style.setProperty("--ar-on-tenant", contrastColor(primary));
    root.style.setProperty("--accent-color", accent);
    root.style.setProperty("--accent-foreground", hexToHsl(contrastColor(accent)));
    root.style.setProperty("--ar-on-accent", contrastColor(accent));
    // Branded header: honor the configured title color and guarantee both
    // gradient stops clear WCAG AA against it (cards rjvide6yfrwt, 1d1k60cjaawb).
    const header = brandHeaderColors(primary, String(config.titleColor || "") || undefined);
    root.style.setProperty("--ar-on-brand", header.onBrand);
    root.style.setProperty("--ar-grad-start", header.gradStart);
    root.style.setProperty("--ar-grad-end", header.gradEnd);
    // Pulse animation color derived from button/primary color
    const btnColor = String(config.buttonColor || primary);
    root.style.setProperty("--ar-pulse-color", `${btnColor}80`);
    root.style.setProperty("--ar-font-scale", String(config.fontScale || 1));
    root.style.setProperty("--radius", `${Number(config.radius || 18)}px`);
    if (config.fontScale) {
      root.style.fontSize = `${Number(config.fontScale) * 100}%`;
    }
  }, [config, resolvedTheme]);

  const position = config.position === "left" ? "left" : "right";
  const widgetStyle = config.widgetStyle === "popup" ? "popup" : "sidepanel";
  const panelWidth = Number(config.panelWidth || 420);
  // Clamped as the editor and the PHP save clamp them: a value saved before
  // those limits ("", -50, 99999) must not push the launcher off screen.
  const marginX = widgetNumber("marginX", config.marginX);
  const marginY = widgetNumber("marginY", config.marginY);

  const runtimeConfig = React.useMemo(
    () => ({
      restBase,
      streamUrl,
      nonce,
      chatSig,
      chatTs,
      conversationId,
      visitorToken,
      deviceId,
      beforeSend: requestSendPermission,
      onFeedback: playWidgetSound,
      setConversationId: (id: number | null) => setConversationId(id),
      setFollowups: (items: string[]) => setFollowups(items),
    }),
    [restBase, streamUrl, nonce, chatSig, chatTs, conversationId, visitorToken, deviceId, requestSendPermission]
  );

  const LauncherIcon = () => {
    // The launcher image and the header logo are independent settings.
    const image = launcherImageUrl(config, resolvedTheme);
    if (isSafeImageUrl(image)) {
      return <span className="ar-launcher-image" aria-hidden="true"><img src={image} alt="" /></span>;
    }
    return <MessageSquare className="ar-launcher-icon" aria-hidden="true" />;
  };

  return (
    <WidgetThemeContext.Provider value={resolvedTheme}>
    <ChatRuntimeProvider config={runtimeConfig}>
      <FollowupsProvider value={{ followups, setFollowups }}>
        <ChatShell
          isOpen={isOpen}
          isMobile={isMobile}
          position={position}
          marginX={marginX}
          marginY={marginY}
          panelWidth={panelWidth}
          widgetStyle={widgetStyle}
          onOpenChange={(open) => {
            if (open && !isOpen) playWidgetSound("open");
            setIsOpen(open);
            if (open) { setShowTeaser(false); setTeaserDismissed(true); }
          }}
          config={config}
          resolvedTheme={resolvedTheme}
          restBase={restBase}
          nonce={nonce}
          chatSig={chatSig}
          chatTs={chatTs}
          visitorToken={visitorToken}
          deviceId={deviceId}
          conversationId={conversationId}
          LauncherIcon={LauncherIcon}
          isRestoringState={isRestoringState}
          consentOpen={consentOpen}
          dismissConsent={() => finishConsentRequest({ allowed: false })}
          isRegistering={isRegistering}
          registerVisitor={async (n, e, opt, consent, polVer) => {
            const token = await registerVisitor(
              n,
              e,
              opt,
              wpUser?.wp_user_id,
              wpUser?.avatar_url,
              consent ? { consentPurposes: consent, policyVersion: polVer } : undefined
            );
            setGatedItem(getPreChatGateKey(), consentGateVersion, { strictlyNecessary: true });
            setConsentGranted(true);
            finishConsentRequest({ allowed: true, visitorToken: token });
          }}
          privacyNoticeUrl={privacyNoticeUrl}
          policyVersion={policyVersion}
          initialVisitorName={wpUser?.display_name || visitorName || ""}
          initialVisitorEmail={wpUser?.user_email || ""}
          requireVisitorInfo={requireVisitorInfo}
          showTeaser={showTeaser}
          setShowTeaser={setShowTeaser}
          teaserDismissed={teaserDismissed}
          setTeaserDismissed={setTeaserDismissed}
          helpdeskEntries={config.helpdeskEntries || []}
          logoRemoval={logoRemoval}
        />
      </FollowupsProvider>
    </ChatRuntimeProvider>
    </WidgetThemeContext.Provider>
  );
}
