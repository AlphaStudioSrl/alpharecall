import { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect, useId } from "react";
import { BookOpen, Check, Copy, MessageSquare, Monitor, RotateCcw, Smartphone, Volume2, VolumeX, X } from "lucide-react";
import { useApp } from "@/admin/app-context";
import { Segmented } from "@/admin/components/shared/kit";
import { playSound, unlockAudio, stopSounds, hasWidgetSounds } from "@/sounds";
import { motionDuration, useLauncherMotion } from "@/widget-motion";
import type { MotionSettings } from "@/widget-motion";
import type { PreviewDemo } from "./widget-experience-controls";
import type { PreviewFocus } from "./preview-focus";
import widgetDesignCss from "@/widget-design.css?raw";
import { LegalFooter } from "@/components/chat/ai-disclosure";
import { createT, interpolate } from "@/admin/lib/i18n";
import { useSiteTheme } from "@/admin/lib/site-theme";
// Colors, images, primitives and copy come from the modules the real widget
// uses, so the preview cannot drift from what visitors see (card 1d1k60cjaawb).
import { brandHeaderColors, contrastColor } from "@/lib/brand-color";
import { headerIdentity } from "@/lib/header-identity";
import { activeTabColorVars } from "@/lib/active-tab-color";
import { avatarImageUrl, launcherImageUrl } from "@/lib/widget-images";
import { ChatTabNav } from "@/components/chat-tab-nav";
import { FaqTab } from "@/components/faq-tab";
import { HeaderMenu, type HeaderMenuItem } from "@/components/chat/header-menu";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  AssistantAvatar,
  ChatComposer,
  ChatFollowups,
  ChatSuggestions,
  ChatWelcome,
  ChatWorking,
} from "@/components/chat/presentation";
import { getChatStrings } from "@/strings";
import "./live-widget-preview.css";

export type LauncherStyle = "pill" | "circle" | "rounded-square" | "text-only";

export interface PreviewFaqEntry {
  id: number | string;
  question: string;
  answer: string;
  category?: string;
  enabled?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface LivePreviewProps extends MotionSettings {
  language?: string;
  soundVolume?: number;
  attention_sound?: string;
  openSound?: string;
  sendSound?: string;
  notificationSound?: string;
  demo?: PreviewDemo;
  /** Set by the customizer on every edit: which part of the widget to show. */
  focus?: PreviewFocus;
  primaryColor: string;
  accentColor: string;
  buttonColor: string;
  titleColor: string;
  activeTabBackgroundColor?: string;
  widgetTitle: string;
  headerTitle: string;
  welcomeMessage: string;
  logoUrl: string;
  /** Avatar for the dark theme; empty means the same avatar for both. */
  logoUrlDark?: string;
  defaultAvatarUrl?: string;
  logoRemoval?: boolean;
  launcherLabel: string;
  theme: string;
  radius: number;
  panelWidth: number;
  panelHeight: number;
  fontScale: number;
  chatbotName: string;
  /** What the welcome shows: the tenant's questions, else its first FAQs. */
  starterQuestions: string[];
  /** Only the questions the tenant wrote: the invite's quick replies use these. */
  customStarterQuestions?: string[];
  position: string;
  launcherStyle: LauncherStyle;
  widgetStyle?: string;
  launcherAnimation?: string;
  marginX?: number;
  marginY?: number;
  headerStyle?: string;
  headerSubtitle?: string;
  inputPlaceholder?: string;
  starterLayout?: string;
  launcherIconUrl?: string;
  launcherImageMode?: string;
  buttonRadius?: number;
  /** The invite: shown next to the button after the delay, when it has a text. */
  autoOpenGreeting?: string;
  autoOpenDelay?: number;
  /** Published FAQs. The widget offers its Domande view only when there are some. */
  helpdeskEntries?: PreviewFaqEntry[];
  privacyNoticeUrl?: string;
  /** Floating editor controls drawn on the stage (the save bar). */
  overlay?: React.ReactNode;
  className?: string;
}

type StageState = "welcome" | "chat" | "faq" | "invite";
type PreviewMessage = { id: string; role: "user" | "assistant"; text: string };

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function hexToHsl(hex: string): string {
  const clean = hex.replace("#", "");
  if (![3, 6].includes(clean.length)) return "";
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function isSafeImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || !url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * The visitor copy of the widget. PHP sends the tenant's language over the
 * Italian defaults (class-ar-chat.php get_chat_strings); this mirrors the
 * English set it sends, and keeps the defaults for keys it does not send, as
 * the live widget does.
 */
const EN_STRINGS = {
  greeting: "Hi there!",
  inputPlaceholder: "Type a message...",
  onlineStatus: "Online now, we reply right away",
  personaStatus: "{business} · replies right away",
  sendMessage: "Send message",
  clearConversation: "Clear conversation",
  closeChat: "Close chat",
  muteSounds: "Mute sounds",
  unmuteSounds: "Unmute sounds",
  copyMessage: "Copy",
  retryMessage: "Retry",
  thinking: "Analyzing the information...",
  chatTab: "Chat",
  faqTab: "FAQ",
  dismissLabel: "Dismiss",
};
function previewStrings(language?: string) {
  const base = getChatStrings();
  return language && language !== "it" ? { ...base, ...EN_STRINGS } : base;
}

// Stage geometry: the desktop viewport is never narrower than this (smaller
// stages scale it down), the phone is a fixed handset.
const DESKTOP_MIN_WIDTH = 760;
const PHONE = { width: 390, height: 800 };

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function LiveWidgetPreview(props: LivePreviewProps) {
  const app = useApp();
  const { t } = app;
  // The visitor-facing copy follows the agent language, not the admin's UI.
  const visitorT = useMemo(() => props.language ? createT(props.language === "it" ? "it" : "en") : t, [props.language, t]);
  const strings = useMemo(() => previewStrings(props.language), [props.language]);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(replyTimer.current), []);
  const {
    primaryColor,
    widgetTitle,
    headerStyle = "soft",
    headerSubtitle = "",
    inputPlaceholder = "",
    starterLayout = "cards",
    buttonRadius = 999,
    titleColor,
    accentColor,
    buttonColor,
    welcomeMessage,
    logoUrl,
    launcherLabel,
    theme,
    radius,
    panelWidth: rawPanelWidth,
    panelHeight: rawPanelHeight,
    fontScale,
    chatbotName,
    headerTitle,
    starterQuestions,
    position,
    launcherStyle = "pill",
    widgetStyle = "sidepanel",
    launcherAnimation = "none",
    marginX = 24,
    marginY = 24,
    helpdeskEntries = [],
  } = props;

  /* ── Stage: device and size ── */
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const deviceTouched = useRef(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // A stage too narrow for a desktop page starts on the phone.
  useEffect(() => {
    if (!deviceTouched.current && area.width > 0 && area.width < 600) setDevice("mobile");
  }, [area.width]);
  const chooseDevice = (value: "desktop" | "mobile") => { deviceTouched.current = true; setDevice(value); };

  /* ── Widget state ── */
  const [isOpen, setIsOpen] = useState(true);
  const [view, setView] = useState<"chat" | "faq">("chat");
  const [teaserHidden, setTeaserHidden] = useState(false);
  const hasFaq = helpdeskEntries.some((entry) => entry.enabled !== false);
  useEffect(() => { if (!hasFaq) setView("chat"); }, [hasFaq]);
  const closePreview = () => { restoreFocus.current = true; setIsOpen(false); };
  useEffect(() => {
    if (!isOpen && restoreFocus.current) {
      rootRef.current?.querySelector<HTMLButtonElement>(".ar-chat-launcher")?.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
  }, [isOpen]);
  const [previewMuted, setPreviewMuted] = useState(false);
  const feedbackRef = useRef({ props, previewMuted });
  feedbackRef.current = { props, previewMuted };
  const previewSound = useCallback((field: "openSound" | "sendSound" | "notificationSound") => {
    const current = feedbackRef.current;
    if (!current.previewMuted) playSound(current.props[field] || "none", current.props.soundVolume ?? 35);
  }, []);
  const [launcherDemo, setLauncherDemo] = useState(0);
  const launcherMotion = useLauncherMotion(launcherAnimation, !isOpen, props, launcherDemo);
  const openPreview = useCallback(() => {
    setIsOpen(true);
    previewSound("openSound");
  }, [previewSound]);

  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const handleClear = useCallback(() => {
    clearTimeout(replyTimer.current);
    setMessages([]);
    setDraft("");
    setIsRunning(false);
  }, []);

  const demoId = props.demo?.id ?? 0;
  const demoEvent = props.demo?.event;
  const demoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!demoId) return;
    setIsOpen(false);
    if (demoEvent === "launcher") { setLauncherDemo((n) => n + 1); return; }
    demoTimer.current = setTimeout(openPreview, motionDuration(props.motionSpeed) + 80);
    return () => clearTimeout(demoTimer.current);
    // Replays are explicit; changing a sound or speed must not start one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoId, demoEvent]);
  // Show the part of the widget an edit is about. Silent: no open sound on edits.
  const focusId = props.focus?.id ?? 0;
  const focusTarget = props.focus?.target;
  useEffect(() => {
    if (!focusId || !focusTarget) return;
    // A replay still waiting to reopen the panel must not undo this edit.
    clearTimeout(demoTimer.current);
    if (focusTarget === "launcher" || focusTarget === "invite") {
      setTeaserHidden(false);
      setIsOpen(false);
      return;
    }
    setIsOpen(true);
    if (focusTarget === "welcome") {
      handleClear();
      setView("chat");
    }
  }, [focusId, focusTarget, handleClear]);

  /* ── Theme ── */
  // "Automatico" follows the site: show what it resolves to there (what the
  // widget last saw on the site in this browser, or the site read in a hidden
  // frame, admin/lib/site-theme). Until that is known, the stage is a sketch
  // of the site in the dashboard's own theme, so the preview follows that.
  const autoTheme = theme !== "light" && theme !== "dark";
  const siteTheme = useSiteTheme(window.AlphaRecallAdmin?.siteUrl, autoTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const siteDark = siteTheme ? siteTheme === "dark" : app.theme ? app.theme === "dark" : systemDark;
  const resolvedTheme = theme === "dark" || (autoTheme && siteDark) ? "dark" : "light";

  const isMobile = device === "mobile";
  const isLeft = position === "left";
  const isPopup = widgetStyle === "popup" && !isMobile;
  // Same fallbacks as the live thread (message-thread-full getStarterQuestions).
  const chips = starterQuestions.length > 0 ? starterQuestions.slice(0, 6) : strings.starterQuestions.slice(0, 4);
  const persona = String(chatbotName || "").trim();
  // Same header as app.tsx: the assistant's name over "{business} · risponde
  // subito", or the business name over the online status when there is none.
  const identity = headerIdentity({
    chatbotName,
    headerTitle,
    headerSubtitle,
    fallbackName: strings.assistantFallbackName,
    onlineStatus: strings.onlineStatus,
    personaStatus: strings.personaStatus,
  });
  const title = identity.name;
  const welcomeName = persona || headerTitle || strings.assistantFallbackName;
  const teaserName = persona && headerTitle && persona !== headerTitle ? `${persona} · ${headerTitle}` : title;
  const teaserReplies = (props.customStarterQuestions || []).filter((q) => q.trim()).slice(0, 2);
  const greeting = (props.autoOpenGreeting || "").trim();
  const showTeaser = !isOpen && !teaserHidden && Number(props.autoOpenDelay || 0) > 0 && !!greeting;
  // Each image drives exactly one element, same as app.tsx: the logo is the
  // header avatar, the launcher image is the button (card hgxb1pqqin4t).
  // The avatar of the theme the stage shows, as the widget picks it (card h8dosik1g6ic).
  const launcherImage = launcherImageUrl(props, resolvedTheme);
  const avatarSrc = avatarImageUrl({ logoUrl, logoUrlDark: props.logoUrlDark, defaultAvatarUrl: props.defaultAvatarUrl }, resolvedTheme);
  const avatarUrl = isSafeImageUrl(avatarSrc) ? avatarSrc : null;
  const compactLauncher = launcherStyle === "circle" || launcherStyle === "rounded-square";
  const hasLauncherImage = launcherStyle !== "text-only" && isSafeImageUrl(launcherImage);
  const hasLauncherImageLabel = hasLauncherImage && !compactLauncher && !!launcherLabel;
  const launcherHeight = compactLauncher ? 58 : 54;
  const fScale = fontScale || 1;
  const btnColor = buttonColor || primaryColor;
  const accent = accentColor || primaryColor;
  const accentFg = contrastColor(accent);

  // The same variables app.tsx sets on #alpharecall-chat-root.
  const cssVars = useMemo(() => {
    const primaryHsl = hexToHsl(primaryColor);
    const accentHsl = hexToHsl(accent);
    const header = brandHeaderColors(primaryColor, titleColor || undefined);
    return {
      ...activeTabColorVars(props.activeTabBackgroundColor),
      "--ar-font-scale": fScale,
      ...(primaryHsl ? {
        "--primary": primaryHsl,
        "--primary-foreground": hexToHsl(contrastColor(primaryColor)),
        "--ring": "0 0% 48%",
      } : {}),
      ...(accentHsl ? { "--accent": accentHsl } : {}),
      "--ar-tenant": primaryColor,
      "--ar-on-tenant": contrastColor(primaryColor),
      "--accent-color": accent,
      "--accent-foreground": hexToHsl(accentFg),
      "--ar-on-accent": accentFg,
      "--ar-on-brand": header.onBrand,
      "--ar-grad-start": header.gradStart,
      "--ar-grad-end": header.gradEnd,
      "--ar-pulse-color": `${btnColor}80`,
      "--radius": `${radius || 18}px`,
      "--ar-duration": `${motionDuration(props.motionSpeed)}ms`,
    } as React.CSSProperties;
  }, [primaryColor, titleColor, accent, accentFg, btnColor, radius, fScale, props.activeTabBackgroundColor, props.motionSpeed]);

  /* ── Simulated conversation ── */
  const fakeSend = useCallback((text: string) => {
    if (!text.trim() || isRunning) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: text.trim() }]);
    setDraft("");
    setIsRunning(true);
    previewSound("sendSound");
    clearTimeout(replyTimer.current);
    replyTimer.current = setTimeout(() => {
      setIsRunning(false);
      previewSound("notificationSound");
      setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: visitorT("widget.previewReply") }]);
    }, 1200);
  }, [isRunning, visitorT, previewSound]);

  // A finished exchange to look at, without waiting for a reply.
  const showSampleChat = useCallback(() => {
    clearTimeout(replyTimer.current);
    setIsRunning(false);
    setDraft("");
    setMessages([
      { id: "sample-u", role: "user", text: chips[0] },
      { id: "sample-a", role: "assistant", text: visitorT("widget.previewReply") },
    ]);
  }, [chips, visitorT]);

  useEffect(() => {
    if (!viewportRef.current) return;
    // The welcome opens at its top: avatar and greeting in view, as the live
    // widget does, instead of a long welcome scrolled under the header.
    if (!messages.length && !isRunning) {
      viewportRef.current.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    viewportRef.current.scrollTo({ top: viewportRef.current.scrollHeight, behavior: props.motionStyle === "none" || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [messages, isRunning, props.motionStyle]);

  const stageState: StageState = !isOpen ? "invite" : view === "faq" ? "faq" : messages.length || isRunning ? "chat" : "welcome";
  const chooseState = (next: StageState) => {
    clearTimeout(demoTimer.current);
    if (next === "invite") { setTeaserHidden(false); setIsOpen(false); return; }
    setIsOpen(true);
    if (next === "faq") { setView("faq"); return; }
    setView("chat");
    if (next === "welcome") handleClear();
    else if (!messages.length) showSampleChat();
  };

  const showWelcome = messages.length === 0 && !isRunning;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const followups = chips.filter((q) => q !== messages.find((m) => m.role === "user")?.text).slice(0, 2);

  const menuItems: HeaderMenuItem[] = [
    { id: "clear", label: strings.clearConversation, icon: <RotateCcw aria-hidden="true" />, onSelect: handleClear, disabled: isRunning },
    ...(hasWidgetSounds({ ...props }) ? [{
      id: "sounds",
      label: previewMuted ? strings.unmuteSounds : strings.muteSounds,
      icon: previewMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />,
      onSelect: () => { if (!previewMuted) stopSounds(); setPreviewMuted(!previewMuted); },
    }] : []),
    ...(hasFaq ? [{ id: "faq", label: strings.faqViewLabel, icon: <BookOpen aria-hidden="true" />, onSelect: () => setView("faq") }] : []),
  ];

  /* ── Geometry ── */
  const panelW = rawPanelWidth || 420;
  const panelH = rawPanelHeight || 640;
  const measured = area.width > 0 && area.height > 0;
  let viewport: React.CSSProperties = { inset: 0 };
  if (measured && isMobile) {
    const scale = Math.min(1, (area.width - 24) / PHONE.width, (area.height - 24) / PHONE.height);
    const w = PHONE.width * scale;
    const h = PHONE.height * scale;
    // The handset sits on the widget's side, leaving room for the stage controls.
    const free = area.width - w;
    const left = free > 340 ? (isLeft ? Math.min(free / 2, 48) : free - Math.min(free / 2, 48)) : free / 2;
    viewport = { left, top: Math.max(12, (area.height - h) / 2), width: PHONE.width, height: PHONE.height, transform: `scale(${scale})` };
  } else if (measured && area.width < DESKTOP_MIN_WIDTH) {
    const scale = area.width / DESKTOP_MIN_WIDTH;
    viewport = { left: 0, top: 0, width: DESKTOP_MIN_WIDTH, height: area.height / scale, transform: `scale(${scale})` };
  }
  // A side panel pushes the page aside, as the live widget does with the body.
  const pagePush = isOpen && !isMobile && !isPopup ? panelW : 0;

  const panelStyle: React.CSSProperties = isMobile
    ? { inset: 0, width: "100%", height: "100%", borderRadius: "0" }
    : isPopup
      ? {
          width: panelW,
          height: panelH,
          maxWidth: `calc(100% - ${marginX * 2}px)`,
          maxHeight: `calc(100% - ${marginY + launcherHeight + 60}px)`,
          bottom: marginY + launcherHeight + 14,
          borderRadius: `${radius || 18}px`,
          ...(isLeft ? { left: marginX } : { right: marginX }),
        }
      : {
          top: 0,
          width: panelW,
          maxWidth: "100%",
          height: "100%",
          borderRadius: "0",
          ...(isLeft ? { left: 0 } : { right: 0 }),
        };

  const stateOptions = [
    { value: "welcome" as const, label: t("widget.editor.stateWelcome") },
    { value: "chat" as const, label: t("widget.editor.stateChat") },
    ...(hasFaq ? [{ value: "faq" as const, label: t("widget.editor.stateFaq") }] : []),
    { value: "invite" as const, label: t("widget.editor.stateInvite") },
  ];
  const inviteHint = stageState === "invite" && !showTeaser ? t(greeting && Number(props.autoOpenDelay || 0) > 0 ? "widget.editor.inviteDismissed" : "widget.editor.inviteOff") : "";

  return (
    <div
      className={`we-stage${props.className ? ` ${props.className}` : ""}`}
      data-device={device}
      data-side={isLeft ? "left" : "right"}
      onPointerDownCapture={() => { void unlockAudio(); }}
      onKeyDownCapture={() => { void unlockAudio(); }}
    >
      <style>{widgetDesignCss.split(".lp-root").join("#alpharecall-admin-app .lp-root")}</style>
      <div className="we-stage-tools">
        <Segmented
          aria-label={t("widget.editor.previewDevice")}
          size="sm"
          value={device}
          onValueChange={chooseDevice}
          options={[
            { value: "desktop", label: t("widget.previewDesktop"), icon: Monitor },
            { value: "mobile", label: t("widget.previewMobile"), icon: Smartphone },
          ]}
        />
        <Segmented aria-label={t("widget.editor.previewState")} size="sm" value={stageState} onValueChange={chooseState} options={stateOptions} />
      </div>

      <div ref={areaRef} className="we-stage-area">
        <div className="we-viewport" data-measured={measured || undefined} style={viewport}>
          <div className="we-site" aria-hidden="true" style={pagePush ? { [isLeft ? "paddingLeft" : "paddingRight"]: pagePush + 32 } : undefined}>
            <div className="we-site-nav"><span className="we-site-logo" /><span className="we-site-sp" /><span /><span /><span /></div>
            <span className="we-site-title" />
            <span className="we-site-sub" />
            <span className="we-site-hero" />
            <span className="we-site-line" />
            <span className="we-site-line we-site-line-short" />
          </div>

          <div
            ref={rootRef}
            className="lp-root"
            data-motion={props.motionStyle || "subtle"}
            data-animate-messages={props.animateMessages !== false ? "true" : "false"}
            data-theme={resolvedTheme}
            data-preview-device={device}
            data-header-style={headerStyle}
            data-starter-layout={starterLayout}
            data-show-avatars="true"
            data-widget-style={widgetStyle}
            style={cssVars}
          >
            <div
              id={panelId}
              className="ar-chat-panel"
              role="region"
              aria-label={title}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); closePreview(); } }}
              data-open={isOpen ? "true" : "false"}
              data-position={isLeft ? "left" : "right"}
              data-widget-style={isMobile ? "sidepanel" : widgetStyle}
              data-view={view}
              aria-hidden={!isOpen}
              inert={!isOpen}
              style={panelStyle}
            >
              <div className="ar-chat-animate ar-chat-header" data-view={view}>
                {view === "chat" ? (
                  <div className="ar-chat-identity">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={chatbotName || strings.assistantFallbackName} className="ar-chat-avatar" />
                    ) : (
                      <AssistantAvatar name={title} className="ar-chat-avatar ar-chat-avatar--initial" />
                    )}
                    <div className="ar-chat-header-text">
                      <div className="ar-chat-header-name">{title}</div>
                      <div className="ar-chat-header-status">
                        <span className="ar-status-dot" aria-hidden="true" />
                        <span className="ar-chat-header-status-text">{identity.status}</span>
                      </div>
                    </div>
                  </div>
                ) : null}
                {hasFaq ? <ChatTabNav activeTab={view} onChange={setView} chatLabel={strings.chatTab} faqLabel={strings.faqTab} /> : null}
                <div className="ar-chat-header-actions">
                  {view === "chat" ? <HeaderMenu label={strings.moreOptions} items={menuItems} /> : null}
                  <button type="button" className="ar-chat-header-btn ar-chat-header-btn--close" onClick={closePreview} title={t("widget.previewClose")} aria-label={t("widget.previewClose")}>
                    <X aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="ar-chat-body">
                <div className="ar-chat-views">
                  <div className="ar-chat-animate ar-view ar-view--chat" hidden={view !== "chat"}>
                    <div className="ar-thread flex h-full flex-col overflow-hidden">
                      <div
                        ref={viewportRef}
                        className="ar-thread-viewport relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto no-scrollbar"
                        data-empty={showWelcome ? "true" : undefined}
                      >
                        <div className="ar-thread-stack">
                          {showWelcome ? (
                            <ChatWelcome
                              avatar={<AssistantAvatar name={welcomeName} imageUrl={avatarUrl} size="lg" />}
                              intro={persona ? strings.welcomeIntro.replace("{name}", persona) : strings.greeting}
                              title={widgetTitle || strings.welcomeHelp}
                              subtitle={welcomeMessage || undefined}
                            />
                          ) : null}
                          {messages.map((message) => message.role === "user" ? (
                            <div key={message.id} className="ar-turn ar-turn--user ar-message-enter">
                              <div className="ar-turn-user-body">
                                <div className="ar-bubble-user">{message.text}</div>
                              </div>
                            </div>
                          ) : (
                            <div key={message.id} className="ar-turn ar-turn--ai ar-message-enter">
                              <div className="ar-answer">
                                <div className="ar-answer-text">{message.text}</div>
                                <div className="ar-msg-actions">
                                  <button type="button" className="ar-chat-action-icon"
                                    aria-label={copiedId === message.id ? strings.copiedLabel : strings.copyMessage}
                                    title={copiedId === message.id ? strings.copiedLabel : strings.copyMessage}
                                    onClick={() => {
                                      void navigator.clipboard?.writeText(message.text).then(() => setCopiedId(message.id), () => {});
                                      window.setTimeout(() => setCopiedId((id) => (id === message.id ? null : id)), 1400);
                                    }}>
                                    {copiedId === message.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                                  </button>
                                  <button type="button" className="ar-chat-action-icon" aria-label={strings.retryMessage} title={strings.retryMessage}
                                    disabled={isRunning}
                                    onClick={() => {
                                      const question = messages.slice(0, messages.indexOf(message)).reverse().find((m) => m.role === "user")?.text;
                                      if (question) fakeSend(question);
                                    }}>
                                    <RotateCcw aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                              {!isRunning && message.id === lastAssistantId ? (
                                <ChatFollowups items={followups} onPick={fakeSend} />
                              ) : null}
                            </div>
                          ))}
                          {isRunning ? (
                            <div className="ar-turn ar-turn--ai ar-message-enter">
                              <div className="ar-answer">
                                <ChatWorking>
                                  <Shimmer as="span" duration={1.6} className="ar-working-text">{strings.thinking}</Shimmer>
                                </ChatWorking>
                              </div>
                            </div>
                          ) : null}
                          {showWelcome ? <ChatSuggestions questions={chips} onPick={fakeSend} disabled={isRunning} /> : null}
                        </div>
                      </div>
                      <div className="ar-composer-area">
                        <ChatComposer
                          value={draft}
                          onChange={setDraft}
                          onSubmit={() => fakeSend(draft)}
                          busy={isRunning}
                          onCancel={() => { clearTimeout(replyTimer.current); setIsRunning(false); }}
                          placeholder={inputPlaceholder || strings.inputPlaceholder}
                          inputLabel={t("widget.inputDefault")}
                          sendLabel={t("widget.previewSend")}
                          stopLabel={t("widget.previewStop")}
                        />
                      </div>
                    </div>
                  </div>
                  {hasFaq && view === "faq" ? (
                    <div className="ar-chat-animate ar-view ar-view--faq">
                      <FaqTab
                        entries={helpdeskEntries}
                        assistantName={persona || title}
                        onAskAbout={(question) => { setView("chat"); fakeSend(question); }}
                        onOpenChat={() => setView("chat")}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
              {/* A div: the preview sits inside the WordPress main landmark, where a footer is a misplaced contentinfo. */}
              <LegalFooter as="div" strings={strings} hidden={view === "faq"}>
                {props.privacyNoticeUrl ? (
                  <a href={props.privacyNoticeUrl} target="_blank" rel="noopener noreferrer" title={strings.privacyNoticeLinkLabel}>{strings.privacyShort}</a>
                ) : null}
                {!props.logoRemoval ? (
                  <a className="ar-chat-branding" href="https://alpharecall.com" target="_blank" rel="noopener noreferrer">Powered by Alpha Recall</a>
                ) : null}
              </LegalFooter>
            </div>

            <div className="ar-launcher-dock" style={{ bottom: marginY, ...(isLeft ? { left: marginX } : { right: marginX }) }}>
              {showTeaser ? (
                <div className="ar-teaser-bubble ar-teaser" data-position={isLeft ? "left" : "right"} role="region" aria-label={teaserName}>
                  <div className="ar-teaser-row">
                    <AssistantAvatar name={title} imageUrl={avatarUrl} size="sm" />
                    <button type="button" className="ar-teaser-body" onClick={openPreview}>
                      <span className="ar-teaser-name">{teaserName}</span>
                      <span className="ar-teaser-text">{greeting}</span>
                    </button>
                    <button type="button" className="ar-teaser-close" onClick={() => setTeaserHidden(true)} aria-label={strings.dismissLabel}>
                      <X aria-hidden="true" />
                    </button>
                  </div>
                  {teaserReplies.length > 0 ? (
                    <div className="ar-teaser-replies">
                      {teaserReplies.map((question) => (
                        <button key={question} type="button" className="ar-teaser-reply" onClick={() => { setView("chat"); openPreview(); fakeSend(question); }}>{question}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!isOpen ? (
                <button
                  type="button"
                  className="ar-chat-launcher"
                  key={launcherDemo}
                  data-style={launcherStyle}
                  data-animation={launcherMotion.animation}
                  data-image={hasLauncherImage || undefined}
                  data-image-label={hasLauncherImageLabel || undefined}
                  onClick={openPreview}
                  aria-label={launcherLabel || strings.chatTab}
                  aria-controls={panelId}
                  aria-expanded={isOpen}
                  style={{
                    backgroundColor: hasLauncherImage ? "transparent" : btnColor,
                    color: contrastColor(btnColor),
                    borderRadius: launcherStyle === "rounded-square" ? "18px" : `${Number(buttonRadius || 999)}px`,
                    ...(compactLauncher ? { width: launcherHeight, height: launcherHeight } : {}),
                  }}
                >
                  {launcherStyle !== "text-only" && (hasLauncherImage
                    ? <span className="ar-launcher-image" aria-hidden="true"><img src={launcherImage} alt="" /></span>
                    : <MessageSquare className="ar-launcher-icon" aria-hidden="true" />)}
                  {launcherStyle === "text-only" ? (
                    <span className="ar-launcher-label">{launcherLabel || "Chat"}</span>
                  ) : compactLauncher ? null : (
                    launcherLabel ? <span className="ar-launcher-label">{launcherLabel}</span> : null
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <p className="we-stage-note">
        {inviteHint || <>
          {t("widget.previewNote")}
          {autoTheme && <> {siteTheme
            ? interpolate(t("widget.previewSystemNoteSite"), { theme: t(siteTheme === "dark" ? "widget.previewThemeDark" : "widget.previewThemeLight") })
            : t("widget.previewSystemNote")}</>}
        </>}
      </p>
      {props.overlay}
    </div>
  );
}
