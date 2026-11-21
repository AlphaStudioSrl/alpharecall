import { useState, useCallback, useEffect, useRef, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, Check, Loader2, Sparkles, Wand2 } from "@/components/icons";
import { useApp } from "@/admin/app-context";
import { apiFetch } from "@/admin/lib/api";
import { interpolate } from "@/admin/lib/i18n";
import { Chips, Segmented, Tag, Toggle, Row } from "@/admin/components/shared/kit";
import { LiveWidgetPreview, type LauncherStyle } from "@/admin/components/settings/live-widget-preview";
import { brandColorPatch } from "@/admin/components/settings/widget-colors";
import { HEADER_TITLE_MAX, WELCOME_MESSAGE_MAX } from "@/lib/widget-limits";
import "../settings/impostazioni.css";

/**
 * Sentinel for "let the assistant work it out from the site".
 *
 * Saved as an empty business_profile.tone, which build_prompt_from_profile()
 * skips -- so the generated persona's own tone is the only one in the system
 * prompt. Picking a tone here instead pins it and auto-configuration leaves it
 * alone (see _is_untouched in app/autoconfig.py).
 */
const AUTO_TONE = "auto";

const TONE_OPTIONS = [
  { value: AUTO_TONE, labelKey: "onboarding.toneAuto" },
  { value: "professional", labelKey: "onboarding.toneProfessional" },
  { value: "friendly", labelKey: "onboarding.toneFriendly" },
  { value: "casual", labelKey: "onboarding.toneCasual" },
  { value: "formal", labelKey: "onboarding.toneFormal" },
] as const;

const THEME_OPTIONS = [
  { value: "light", labelKey: "onboarding.themeLight" },
  { value: "dark", labelKey: "onboarding.themeDark" },
  { value: "system", labelKey: "setupFlow.themeAuto" },
] as const;

/** Quiet brand colours offered next to the one detected on the site. */
const PRESET_COLORS = ["#2B59A8", "#2F6B55", "#B4532A", "#6B3FA0", "#1F2120"];

const slideVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
};

const sameColor = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
// Popovers opened from inside the setup render in a portal outside it.
const IN_PORTAL = "[data-ar-portal], [data-radix-popper-content-wrapper], [role=listbox], [role=menu]";

/**
 * Keeps keyboard focus inside the full-screen setup: Tab wraps, focus that
 * lands behind it is pulled back, and Ctrl/Cmd K does not open the command
 * palette over it (the palette listens on document in the capture phase, so a
 * capture listener here on window stops the shortcut first).
 */
function useSetupFocusTrap(rootRef: React.RefObject<HTMLDivElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const focusables = () => {
      const root = rootRef.current;
      if (!root) return [];
      return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest("[aria-hidden=true], [inert]"));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const root = rootRef.current;
      const target = event.target as HTMLElement | null;
      if (!root || (target && !root.contains(target) && target.closest(IN_PORTAL))) return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = target ? root.contains(target) : false;
      if (event.shiftKey && (!inside || target === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || target === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const root = rootRef.current;
      const target = event.target as HTMLElement | null;
      if (!root || !target || root.contains(target) || target.closest(IN_PORTAL)) return;
      (focusables()[0] ?? root).focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [rootRef, active]);
}

/**
 * First-run setup, full screen: three steps on the left (business profile,
 * chat look, content), the real widget preview on the right updating as the
 * owner types. Finishing (or skipping) queues the site sync and marks the
 * onboarding complete, which starts the per-section guided tours.
 */
export function OnboardingModal() {
  const {
    t,
    settings,
    onboardingStep,
    setOnboardingStep,
    onboardingCompleted,
    setOnboardingCompleted,
  } = useApp();

  const [step, setStep] = useState(Math.min(onboardingStep || 0, 2));
  const [direction, setDirection] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onboardingCompleted) {
      setStep(Math.min(onboardingStep || 0, 2));
    }
  }, [onboardingStep, onboardingCompleted]);

  // Business profile
  const bp = (settings.business_profile || {}) as Record<string, string>;
  const [bizName, setBizName] = useState(bp.name || "");
  const [bizDesc, setBizDesc] = useState(bp.description || "");
  // Automatic unless this install already recorded a deliberate choice.
  const [bizTone, setBizTone] = useState(bp.tone || AUTO_TONE);

  // Chat config
  const cc = (settings.chat_config || {}) as Record<string, unknown>;
  const ccStr = (key: string, fallback = "") => (typeof cc[key] === "string" && cc[key] ? String(cc[key]) : fallback);
  const [chatColor, setChatColor] = useState(ccStr("primary_color") || ccStr("primaryColor", "#10a37f"));
  const [detectedColor, setDetectedColor] = useState<string | null>(null);
  // "Custom" stays the chosen radio while the picker is open, even before the
  // colour stops matching a preset.
  const [customActive, setCustomActive] = useState(false);
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [chatPosition, setChatPosition] = useState(ccStr("position", "right"));
  const [chatTheme, setChatTheme] = useState(ccStr("theme", "system"));
  // Left empty on purpose. An empty chat_config.welcomeMessage is what lets the
  // greeting generated from the site's own content through -- pre-filling a
  // default here would count as a customisation and permanently shadow it.
  const [welcomeMessage, setWelcomeMessage] = useState(ccStr("welcomeMessage"));

  // Sync
  const [syncPages, setSyncPages] = useState(true);
  const [syncPosts, setSyncPosts] = useState(true);

  // Auto-detect branding on mount (pre-fill name + color)
  const initialBizName = useRef(bp.name || "");
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ business_name?: string; primary_color?: string; neutral_color?: boolean }>("/branding/detect")
      .then((result) => {
        if (cancelled) return;
        if (result.business_name && !initialBizName.current) setBizName(result.business_name);
        // A cached detection from before card akq1m7oqwc05 may still carry
        // the theme's grey button: that is no brand color to preselect.
        if (result.primary_color && result.neutral_color !== true) {
          setChatColor(result.primary_color);
          setDetectedColor(result.primary_color);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const open = !onboardingCompleted && step < 3;

  const rawSteps = t("steps") as unknown;
  const stepLabels: string[] = Array.isArray(rawSteps)
    ? rawSteps
    : [t("onboarding.stepProfile"), t("onboarding.stepStyling"), t("onboarding.stepContent")];

  const goTo = useCallback((target: number) => {
    setDirection(target > step ? 1 : -1);
    setStep(target);
    setError(null);
  }, [step]);

  // Keyboard and screen-reader users land on the new step's title.
  useEffect(() => {
    if (open) titleRef.current?.focus({ preventScroll: true });
  }, [step, open]);

  const siteUrl = (window as any).AlphaRecallAdmin?.siteUrl || "";

  const handleNext = async () => {
    setSaving(true);
    setError(null);
    try {
      if (step === 0) {
        await apiFetch("/business-profile", {
          method: "POST",
          body: JSON.stringify({
            name: bizName,
            description: bizDesc,
            tone: bizTone === AUTO_TONE ? "" : bizTone,
          }),
        });
      } else if (step === 1) {
        await apiFetch("/settings", {
          method: "POST",
          body: JSON.stringify({
            chat_config: {
              // The whole widget takes the colour, as the editor swatches do:
              // a Send or chat button colour left from the defaults or an
              // earlier detection would not follow it (card akq1m7oqwc05).
              ...brandColorPatch(chatColor, cc, "whole"),
              position: chatPosition,
              theme: chatTheme,
              welcomeMessage: welcomeMessage.trim(),
            },
          }),
        });
      } else if (step === 2) {
        await apiFetch("/ingestion", {
          method: "POST",
          body: JSON.stringify({
            include_pages: syncPages,
            include_posts: syncPosts,
            mode: "wp_api",
            site_url: siteUrl,
          }),
        });

        await apiFetch("/settings", {
          method: "POST",
          body: JSON.stringify({ onboarding_completed: true, onboarding_step: 3 }),
        });
        setOnboardingCompleted(true);
        setOnboardingStep(3);
        // The per-section guided tour starts automatically via TutorialManager
        // once onboardingCompleted flips (dashboard section first).
        return;
      }

      const nextStep = step + 1;
      goTo(nextStep);
      setOnboardingStep(nextStep);
      await apiFetch("/settings", {
        method: "POST",
        body: JSON.stringify({ onboarding_step: nextStep }),
      });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("setupFlow.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (step > 0) goTo(step - 1);
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      // Skipping still queues the default pages + posts sync. Without it the
      // agent starts with no knowledge of the site at all and answers from
      // nothing, which reads as a broken widget rather than a skipped wizard.
      // Best-effort: never block the skip on it.
      try {
        await apiFetch("/ingestion", {
          method: "POST",
          body: JSON.stringify({
            include_pages: true,
            include_posts: true,
            mode: "wp_api",
            site_url: siteUrl,
          }),
        });
      } catch {
        // The site may not be provisioned yet; the request is parked in
        // pending_ingestion server-side and drained once the tenant exists.
      }
      await apiFetch("/settings", {
        method: "POST",
        body: JSON.stringify({ onboarding_completed: true, onboarding_step: 3 }),
      });
      setOnboardingCompleted(true);
      setOnboardingStep(3);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("setupFlow.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const tenant = (settings.tenant_settings || {}) as Record<string, unknown>;
  const assistantName = String(tenant.chatbot_name || "").trim();

  const previewProps = useMemo(() => {
    const num = (key: string, fallback: number) => (Number.isFinite(Number(cc[key])) && cc[key] !== "" && cc[key] != null ? Number(cc[key]) : fallback);
    const starters = Array.isArray(tenant.starter_questions) ? (tenant.starter_questions as unknown[]).map(String).filter(Boolean) : [];
    const wholeColor = brandColorPatch(chatColor, cc, "whole");
    return {
      language: String(tenant.response_language || "it"),
      primaryColor: wholeColor.primaryColor,
      accentColor: wholeColor.accentColor,
      buttonColor: wholeColor.buttonColor,
      titleColor: wholeColor.titleColor,
      activeTabBackgroundColor: wholeColor.activeTabBackgroundColor ?? ccStr("activeTabBackgroundColor"),
      widgetTitle: ccStr("widgetTitle"),
      // As AlphaRecall_Settings applies branding: an empty or default "AlphaRecall" header
      // shows the business name, so the preview follows the name being typed.
      headerTitle: ccStr("headerTitle") && ccStr("headerTitle") !== "AlphaRecall" ? ccStr("headerTitle") : Array.from(bizName.trim()).slice(0, HEADER_TITLE_MAX).join(""),
      welcomeMessage: welcomeMessage.trim() || t("onboarding.welcomeDefault"),
      logoUrl: ccStr("logoUrl"),
      defaultAvatarUrl: ccStr("defaultAvatarUrl") || undefined,
      launcherLabel: ccStr("launcherLabel"),
      theme: chatTheme,
      radius: num("radius", 18),
      panelWidth: num("panelWidth", 420),
      panelHeight: num("panelHeight", 640),
      fontScale: num("fontScale", 1),
      // Only the assistant's own name: headerIdentity() makes the business the
      // title when there is none, as the live widget does.
      chatbotName: assistantName,
      starterQuestions: starters,
      customStarterQuestions: starters,
      position: chatPosition,
      launcherStyle: ccStr("launcherStyle", "pill") as LauncherStyle,
      widgetStyle: ccStr("widgetStyle", "sidepanel"),
      headerStyle: ccStr("headerStyle", "soft"),
      headerSubtitle: ccStr("headerSubtitle"),
      inputPlaceholder: ccStr("inputPlaceholder"),
      starterLayout: ccStr("starterLayout", "cards"),
      privacyNoticeUrl: String(tenant.privacy_notice_url || "") || undefined,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cc, tenant, chatColor, chatTheme, chatPosition, welcomeMessage, bizName, assistantName, t]);

  useSetupFocusTrap(rootRef, open);

  if (!open) return null;

  const titles = [
    { title: t("setupFlow.profileTitle"), lead: t("onboarding.businessHint") },
    {
      title: assistantName ? interpolate(t("setupFlow.lookTitleNamed"), { name: assistantName }) : t("setupFlow.lookTitle"),
      lead: detectedColor ? t("setupFlow.lookLeadDetected") : t("setupFlow.lookLead"),
    },
    {
      title: assistantName ? interpolate(t("setupFlow.contentTitleNamed"), { name: assistantName }) : t("setupFlow.contentTitle"),
      lead: t("onboarding.syncHint"),
    },
  ][step];

  const swatches = [...new Set([detectedColor, ...PRESET_COLORS].filter((c): c is string => Boolean(c)).map((c) => c.toUpperCase()))];
  const customColor = !swatches.some((c) => sameColor(c, chatColor));
  const customChecked = customColor || customActive;
  // Roving tabindex: the radiogroup is one tab stop, on the chosen swatch.
  const checkedSwatch = customChecked ? swatches.length : swatches.findIndex((c) => sameColor(c, chatColor));
  const pickSwatch = (index: number) => {
    if (index === swatches.length) setCustomActive(true);
    else {
      setCustomActive(false);
      setChatColor(swatches[index]);
    }
    swatchRefs.current[index]?.focus();
  };
  const onSwatchKeyDown = (event: ReactKeyboardEvent) => {
    const count = swatches.length + 1;
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next: number | null = null;
    if (event.key in steps) next = (checkedSwatch + steps[event.key] + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    pickSwatch(next);
  };
  const openColorPicker = () => {
    setCustomActive(true);
    const input = colorInputRef.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  };

  /* Render as a fixed layer INSIDE the admin app (not a portal) so it
     inherits all CSS variable theming from #alpharecall-admin-app */
  return (
    <div ref={rootRef} className="ars-setup" role="dialog" aria-modal="true" aria-labelledby="ar-setup-title" data-tour="onboarding" tabIndex={-1}>
      <div className="ars-setup-panel">
        <div className="ars-setup-form">
          <div className="ars-setup-top">
            <span className="ars-setup-mark" aria-hidden="true">A</span>
            <b>AlphaRecall</b>
            <Button variant="ghost" size="sm" onClick={() => void handleSkip()} disabled={saving}>
              {t("onboarding.skip")}
            </Button>
          </div>

          <ol className="ars-steps" aria-label={t("onboarding.wizardTitle")}>
            {stepLabels.map((label, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => i < step && !saving && goTo(i)}
                  disabled={i >= step || saving}
                  aria-current={i === step ? "step" : undefined}
                  data-done={i < step || undefined}
                >
                  <i aria-hidden="true" />
                  <span>{i + 1}. {label}</span>
                </button>
              </li>
            ))}
          </ol>

          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="flex flex-col gap-6"
            >
              <div className="ars-setup-title">
                <h2 id="ar-setup-title" ref={titleRef} tabIndex={-1} className="outline-none">{titles.title}</h2>
                <p>{titles.lead}</p>
              </div>

              {step === 0 && (
                <div className="ars-setup-fields">
                  <div className="ars-setup-field">
                    <label htmlFor="ar-setup-name">{t("labels.businessName")}</label>
                    <Input
                      id="ar-setup-name"
                      value={bizName}
                      onChange={(e) => setBizName(e.target.value)}
                      placeholder={t("onboarding.businessNamePlaceholder")}
                    />
                  </div>
                  <div className="ars-setup-field">
                    <label htmlFor="ar-setup-desc">
                      {t("labels.description")}
                      <span className="ars-optional">{t("onboarding.optional")}</span>
                    </label>
                    <Textarea
                      id="ar-setup-desc"
                      value={bizDesc}
                      onChange={(e) => setBizDesc(e.target.value)}
                      rows={3}
                      placeholder={t("onboarding.businessDescPlaceholder")}
                      className="resize-none"
                    />
                    <p>{t("onboarding.businessDescHint")}</p>
                  </div>
                  <div className="ars-setup-field">
                    <span className="ars-setup-label" id="ar-setup-tone">{t("labels.tone")}</span>
                    <Chips
                      aria-label={t("labels.tone")}
                      value={bizTone}
                      onValueChange={setBizTone}
                      options={TONE_OPTIONS.map((o) => ({ value: o.value as string, label: t(o.labelKey) }))}
                    />
                    {bizTone === AUTO_TONE && <p>{t("onboarding.toneAutoHint")}</p>}
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="ars-setup-fields">
                  <div className="ars-setup-field">
                    <span className="ars-setup-label">{t("labels.primaryColor")}</span>
                    <div className="ars-swatches">
                      <div className="ars-swatch-group" role="radiogroup" aria-label={t("labels.primaryColor")} onKeyDown={onSwatchKeyDown}>
                        {swatches.map((color, index) => (
                          <button
                            key={color}
                            ref={(el) => { swatchRefs.current[index] = el; }}
                            type="button"
                            role="radio"
                            aria-checked={!customChecked && sameColor(color, chatColor)}
                            tabIndex={index === checkedSwatch ? 0 : -1}
                            aria-label={color === detectedColor?.toUpperCase() ? `${color} (${t("onboarding.autoDetected")})` : color}
                            className="ars-swatch"
                            style={{ background: color }}
                            onClick={() => pickSwatch(index)}
                          />
                        ))}
                        <span className="ars-swatch-custom-wrap">
                          <button
                            ref={(el) => { swatchRefs.current[swatches.length] = el; }}
                            type="button"
                            role="radio"
                            aria-checked={customChecked}
                            aria-haspopup="dialog"
                            tabIndex={checkedSwatch === swatches.length || checkedSwatch < 0 ? 0 : -1}
                            aria-label={t("setupFlow.customColor")}
                            title={t("setupFlow.customColor")}
                            className="ars-swatch ars-swatch-custom"
                            style={customChecked ? { background: chatColor } : undefined}
                            onClick={openColorPicker}
                          />
                          {/* The native picker, opened by the button above; not a tab stop of its own. */}
                          <input
                            ref={colorInputRef}
                            type="color"
                            tabIndex={-1}
                            aria-hidden="true"
                            value={/^#[0-9a-f]{6}$/i.test(chatColor) ? chatColor : "#10a37f"}
                            onChange={(e) => { setCustomActive(true); setChatColor(e.target.value); }}
                          />
                        </span>
                      </div>
                      <Input
                        className="ars-hex"
                        value={chatColor}
                        onChange={(e) => { setCustomActive(false); setChatColor(e.target.value); }}
                        maxLength={7}
                        aria-label={t("setupFlow.hexLabel")}
                      />
                      {detectedColor && sameColor(detectedColor, chatColor) && (
                        <Tag tone="accent"><Wand2 className="size-3" aria-hidden="true" />{t("onboarding.autoDetected")}</Tag>
                      )}
                    </div>
                  </div>
                  <div className="ars-setup-field">
                    <label htmlFor="ar-setup-welcome">{t("labels.welcomeMessage")}</label>
                    <Textarea
                      id="ar-setup-welcome"
                      value={welcomeMessage}
                      onChange={(e) => setWelcomeMessage(e.target.value)}
                      rows={2}
                      maxLength={WELCOME_MESSAGE_MAX}
                      placeholder={t("onboarding.welcomePlaceholder")}
                      className="resize-none"
                    />
                    <p>{t("onboarding.welcomeHint")}</p>
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <div className="ars-setup-field">
                      <span className="ars-setup-label">{t("labels.position")}</span>
                      <Segmented
                        aria-label={t("labels.position")}
                        value={chatPosition}
                        onValueChange={setChatPosition}
                        options={[
                          { value: "left", label: t("labels.positionLeft") },
                          { value: "right", label: t("labels.positionRight") },
                        ]}
                      />
                    </div>
                    <div className="ars-setup-field">
                      <span className="ars-setup-label">{t("labels.theme")}</span>
                      <Segmented
                        aria-label={t("labels.theme")}
                        value={chatTheme}
                        onValueChange={setChatTheme}
                        options={THEME_OPTIONS.map((o) => ({ value: o.value as string, label: t(o.labelKey) }))}
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="ars-setup-fields">
                  <div className="ark-rows ark-on-fill">
                    <Row label={t("labels.syncPages")} description={t("labels.syncPagesHint")} htmlFor="ar-setup-pages">
                      <Toggle id="ar-setup-pages" checked={syncPages} onCheckedChange={setSyncPages} />
                    </Row>
                    <Row label={t("labels.syncPosts")} description={t("labels.syncPostsHint")} htmlFor="ar-setup-posts">
                      <Toggle id="ar-setup-posts" checked={syncPosts} onCheckedChange={setSyncPosts} />
                    </Row>
                  </div>
                  <div className="ars-setup-note"><Sparkles aria-hidden="true" /><p>{t("onboarding.autoConfigNote")}</p></div>
                  <p className="ars-faint">{t("onboarding.syncNote")}</p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {error && <p role="alert" className="ars-alert ars-alert-red text-sm">{error}</p>}

          <div className="ars-setup-actions">
            {step > 0 && (
              <Button variant="ghost" onClick={handleBack} disabled={saving}>
                <ChevronLeft className="size-4" />
                {t("buttons.back")}
              </Button>
            )}
            <span className="ars-sp" />
            <Button className="ars-next" onClick={() => void handleNext()} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {step === 2 ? t("onboarding.finishSetup") : t("setupFlow.continue")}
              {!saving && step === 2 && <Check className="size-4" />}
            </Button>
          </div>
        </div>

        <aside className="ars-setup-preview" aria-label={t("setupFlow.livePreview")}>
          <div className="ars-setup-preview-body">
            <LiveWidgetPreview {...previewProps} className="ars-setup-stage" />
          </div>
        </aside>
      </div>
    </div>
  );
}
