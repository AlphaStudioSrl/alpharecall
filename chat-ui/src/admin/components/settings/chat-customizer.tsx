import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useSettings } from "@/admin/hooks/use-settings";
import { apiFetch } from "@/admin/lib/api";
import { interpolate } from "@/admin/lib/i18n";
import { cn } from "@/admin/lib/utils";
import { useNavIntent } from "@/admin/lib/nav-context";
import { useFrameLayout } from "@/admin/components/layout/frame-context";
import { Group, IconButton, PageHead, Segmented, SelectPill, Toggle } from "@/admin/components/shared/kit";
import { ColorPicker } from "@/admin/components/shared/color-picker";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { LiveWidgetPreview, type LauncherStyle, type PreviewFaqEntry } from "@/admin/components/settings/live-widget-preview";
import { unlockAudio } from "@/sounds";
import { contrastColor } from "@/lib/brand-color";
import { headerIdentity } from "@/lib/header-identity";
import { WidgetExperienceControls, type PreviewDemo } from "./widget-experience-controls";
import { ImageField } from "./image-field";
import { WidgetVisibilityControls } from "./widget-visibility-controls";
import { previewTargetFor, type PreviewFocus } from "./preview-focus";
import { SettingRow, StackRow } from "./widget-editor-rows";
import { BRAND_FOLLOWER_KEYS, brandColorPatch, brandFollowerValue } from "./widget-colors";
import { BrandColorChoices, useBrandChoices } from "./brand-color-choices";
import { HEADER_TITLE_MAX, LAUNCHER_LABEL_MAX, textLength, WELCOME_MESSAGE_MAX, WIDGET_TITLE_MAX } from "@/lib/widget-limits";
import { WIDGET_NUMBERS, widgetNumber, type WidgetNumberKey } from "@/lib/widget-numbers";
import { WidgetNumberField } from "./widget-number-field";
import "./widget-editor.css";

const CORNER_PRESETS = [
  { label: "cornerSoft", value: 18 },
  { label: "cornerSharp", value: 14 },
  { label: "cornerRound", value: 32 },
] as const;

const PANEL_PRESETS = [
  { label: "panelCompact", height: 520, width: 380 },
  { label: "panelRegular", height: 640, width: 420 },
  { label: "panelTall", height: 900, width: 480 },
] as const;

const POPUP_PRESETS = [
  { label: "popupSmall", height: 500, width: 380 },
  { label: "popupMedium", height: 640, width: 420 },
  { label: "popupLarge", height: 800, width: 500 },
] as const;

const FONT_PRESETS = [
  { label: "fontSmall", value: 0.9 },
  { label: "fontNormal", value: 1 },
  { label: "fontLarge", value: 1.2 },
] as const;

const DELAYS = [5, 10, 15, 20, 30];
const MAX_STARTERS = 6;

/**
 * Texts the editor holds back instead of autosaving: every keystroke goes
 * live, so an empty title or an over-long welcome must stay a draft with its
 * error until it is valid again (card caa2u6e305z0). An empty welcome is
 * valid: it lets the greeting generated from the site show.
 */
const TEXT_RULES: Record<string, { max: number; required: boolean }> = {
  widgetTitle: { max: WIDGET_TITLE_MAX, required: true },
  welcomeMessage: { max: WELCOME_MESSAGE_MAX, required: false },
  // Card 3xsmdn92aj09: one line each in the widget; empty shows the default.
  headerTitle: { max: HEADER_TITLE_MAX, required: false },
  launcherLabel: { max: LAUNCHER_LABEL_MAX, required: false },
};

/** The i18n key of what is wrong with `value`, or null when it can be saved. */
function textFieldError(key: keyof typeof TEXT_RULES, value: string): string | null {
  const rule = TEXT_RULES[key];
  if (rule.required && !value.trim()) return "widget.editor.textRequired";
  if (textLength(value) > rule.max) return "widget.editor.textTooLong";
  return null;
}

/** What every field shows when chat_config has no value; Annulla restores to these. */
const FIELD_DEFAULTS: Record<string, unknown> = {
  primaryColor: "#10a37f", titleColor: "#ffffff", activeTabBackgroundColor: "", theme: "system",
  widgetTitle: "", headerTitle: "", launcherLabel: "", logoUrl: "", logoUrlDark: "", welcomeMessage: "",
  radius: 18, panelWidth: 420, panelHeight: 640, fontScale: 1, position: "right",
  launcherStyle: "pill", widgetStyle: "sidepanel", headerStyle: "soft", headerSubtitle: "",
  inputPlaceholder: "", starterLayout: "cards", launcherIconUrl: "", launcherImageMode: "custom",
  marginX: 24, marginY: 24, auto_open_delay: 0, auto_open_greeting: "",
  displayMode: "production", demoRoles: ["administrator"], starterQuestions: [], starter_questions: [],
  motionStyle: "subtle", motionSpeed: "balanced", animateMessages: true, launcher_animation: "pulse",
  launcherRepeat: "once", launcherInterval: 15, openSound: "none", sendSound: "none",
  notificationSound: "none", attention_sound: "none", soundVolume: 35,
};
/** Aliases saved with another key; one edit is one change. */
const ALIAS_KEYS = new Set(["starter_questions"]);

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type Baseline = { chat: Record<string, unknown>; tenant: Record<string, unknown> };

/**
 * The Widget page: grouped setting rows on the left, the widget live on a
 * sketch of the site on the right. Every edit is autosaved (use-settings), so
 * the floating bar reports what this visit changed, offers Annulla (back to
 * how the widget was when the first edit was made) and never pretends there
 * is a separate publish step.
 */
export function ChatCustomizer() {
  const { t, settings } = useApp();
  // The save bar reports every autosave; a toast on top of it would say it twice.
  const { updateChatDraft, holdChatSaves, updateTenantDraft, saving, error, saveStatus, retryFailedSaves } = useSettings({ silent: true });
  useFrameLayout({ fill: true, flush: true });
  const chat = (settings.chat_config || {}) as Record<string, unknown>;
  const tenantSettings = (settings.tenant_settings || {}) as Record<string, unknown>;

  const str = (key: string, fallback = "") => String(chat[key] ?? fallback);
  // A numeric setting saved out of range (or as "") reads as its clamped value.
  const num = (key: string, fallback = 0) => key in WIDGET_NUMBERS
    ? widgetNumber(key as WidgetNumberKey, chat[key] ?? fallback)
    : Number(chat[key] ?? fallback);
  const [marginHint, setMarginHint] = useState("");

  const [previewDemo, setPreviewDemo] = useState<PreviewDemo>({ id: 0, event: "open" });
  const [previewFocus, setPreviewFocus] = useState<PreviewFocus | null>(null);

  /* ── What this visit changed ── */
  const baseline = useRef<Baseline | null>(null);
  const [touched, setTouched] = useState<string[]>([]);
  const track = (keys: string[], scope: "chat" | "tenant") => {
    if (!baseline.current) baseline.current = { chat: { ...chat }, tenant: { require_visitor_info: !!tenantSettings.require_visitor_info } };
    setTouched((previous) => [...new Set([...previous, ...keys.map((key) => `${scope}:${key}`)])]);
  };
  const baselineChat = (key: string) => {
    const base = baseline.current?.chat ?? {};
    if (key in base) return base[key];
    if (key === "accentColor" || key === "buttonColor") return base.primaryColor ?? FIELD_DEFAULTS.primaryColor;
    return FIELD_DEFAULTS[key];
  };
  const chatValue = (key: string) => key in chat ? chat[key] : (key === "accentColor" || key === "buttonColor" ? chat.primaryColor ?? FIELD_DEFAULTS.primaryColor : FIELD_DEFAULTS[key]);
  const changed = touched.filter((entry) => {
    const [scope, key] = entry.split(/:(.*)/s);
    if (scope === "tenant") return !same(!!tenantSettings[key], baseline.current?.tenant[key]);
    if (ALIAS_KEYS.has(key)) return false;
    return !same(chatValue(key), baselineChat(key));
  });
  // A launcher, Send, header text or tab color that moved along with the brand color is part of that one
  // change, also when the swatch picked was the brand color already and only they moved.
  const brandChanged = touched.includes("chat:primaryColor");
  const followsBrand = (entry: string) => {
    const key = entry.slice(5) as (typeof BRAND_FOLLOWER_KEYS)[number];
    return entry.startsWith("chat:") && (BRAND_FOLLOWER_KEYS as readonly string[]).includes(key)
      && same(String(chatValue(key) ?? "").toLowerCase(), brandFollowerValue(key, String(chat.primaryColor ?? "").toLowerCase()));
  };
  const changeCount = new Set(changed
    .map((entry) => (brandChanged && followsBrand(entry) ? "chat:primaryColor" : entry))
    .map((entry) => (entry === "chat:panelWidth" ? "chat:panelHeight" : entry))).size;

  function update(patch: Record<string, unknown>) {
    track(Object.keys(patch), "chat");
    updateChatDraft(patch);
    // Show the part of the widget the edit belongs to.
    const target = previewTargetFor(patch);
    if (target) setPreviewFocus((previous) => ({ id: (previous?.id ?? 0) + 1, target }));
  }
  function updateTenant(patch: Record<string, unknown>) {
    track(Object.keys(patch), "tenant");
    updateTenantDraft?.(patch);
  }
  function undoChanges() {
    const chatPatch: Record<string, unknown> = {};
    const tenantPatch: Record<string, unknown> = {};
    for (const entry of touched) {
      const [scope, key] = entry.split(/:(.*)/s);
      if (scope === "tenant") tenantPatch[key] = baseline.current?.tenant[key];
      else chatPatch[key] = baselineChat(key);
    }
    if (Object.keys(chatPatch).length) {
      updateChatDraft(chatPatch);
      const target = previewTargetFor(chatPatch);
      if (target) setPreviewFocus((previous) => ({ id: (previous?.id ?? 0) + 1, target }));
    }
    if (Object.keys(tenantPatch).length) updateTenantDraft?.(tenantPatch);
    forgetChanges();
  }
  function forgetChanges() {
    baseline.current = null;
    setTouched([]);
  }
  function undoAll() {
    // An invalid draft was never saved: Annulla drops it with the rest.
    setTextDrafts({});
    textBefore.current = {};
    undoChanges();
  }

  /* ── Brand detection ── */
  const [resettingBrand, setResettingBrand] = useState(false);
  // Detection answers after a network round trip: by then the visitor may have
  // pressed Fatto or edited, so apply it through this render's update and
  // baseline, never the ones captured when the click started.
  const latestUpdate = useRef(update);
  latestUpdate.current = update;
  const latestChat = useRef(chat);
  latestChat.current = chat;
  async function resetToBranding() {
    setResettingBrand(true);
    try {
      const branding = await apiFetch<{
        business_name?: string;
        logo_url?: string;
        primary_color?: string;
        accent_color?: string;
        neutral_color?: boolean;
      }>("/branding/detect?force=1");
      const patch: Record<string, unknown> = {};
      // A grey/black/white "brand" (e.g. the WordPress core default button
      // #32373c) is the theme's default, not the site's color: keep the
      // widget's color and say none was found (card akq1m7oqwc05).
      const detected = typeof branding.primary_color === "string" ? branding.primary_color.trim().toLowerCase() : "";
      const siteColor = branding.neutral_color === true ? "" : detected;
      // The whole widget takes the site color: launcher, Send, header text and tab included.
      if (siteColor) Object.assign(patch, brandColorPatch(siteColor, latestChat.current, "whole"));
      if (branding.logo_url) {
        patch.logoUrl = branding.logo_url;
        patch.launcherIconUrl = branding.logo_url;
      }
      if (branding.business_name) {
        // A site title can be longer than the header holds (AlphaRecall_Settings caps it the same way).
        patch.headerTitle = Array.from(branding.business_name.trim()).slice(0, HEADER_TITLE_MAX).join("");
      }
      if (Object.keys(patch).length > 0) latestUpdate.current(patch);
      // Name and logo are always found; saying "colors applied" for them is
      // what made the button look broken on a theme with no brand color.
      if (siteColor) toast.success(t("widget.brandingApplied"));
      else if (branding.neutral_color === true) toast.info(t("widget.brandingNeutralColor"));
      else toast.info(t(Object.keys(patch).length ? "widget.brandingNoColor" : "widget.brandingNoneFound"));
    } catch {
      toast.error(t("toast.settingsFailed"));
    } finally {
      setResettingBrand(false);
    }
  }

  /* ── "Powered by Alpha Recall": the owner's opt-in (WordPress.org guideline
     10), editable on every site and every plan; the plan never decides it. ── */
  const [attribution, setAttribution] = useState<{ shown: boolean } | null>(null);
  const [savingAttribution, setSavingAttribution] = useState(false);
  useEffect(() => {
    let active = true;
    void apiFetch<unknown>("/branding/attribution", { cache: "no-store" })
      .then((value) => { if (active) setAttribution(attributionState(value)); })
      .catch(() => { /* No switch when it cannot be read. */ });
    return () => { active = false; };
  }, []);
  async function saveAttribution(show: boolean) {
    setSavingAttribution(true);
    try {
      const value = attributionState(await apiFetch<unknown>("/branding/attribution", {
        method: "POST",
        body: JSON.stringify({ show }),
      }));
      if (!value) throw new Error("Unexpected answer");
      setAttribution(value);
    } catch {
      toast.error(t("toast.settingsFailed"));
    } finally {
      setSavingAttribution(false);
    }
  }

  /* ── Published FAQs: the welcome falls back to them, the preview shows them ── */
  const [helpdeskEntries, setHelpdeskEntries] = useState<PreviewFaqEntry[]>([]);
  useEffect(() => {
    let active = true;
    setHelpdeskEntries([]);
    if (!settings.tenant_id) return;
    void apiFetch<PreviewFaqEntry[]>("/helpdesk")
      .then((entries) => {
        if (active) setHelpdeskEntries(Array.isArray(entries)
          ? entries.filter((entry) => entry.enabled && typeof entry.question === "string" && entry.question.trim())
          : []);
      }).catch(() => { /* Keep the localized example questions if unavailable. */ });
    return () => { active = false; };
  }, [settings.tenant_id]);

  const customStarters = useMemo(() => {
    const sq = chat.starterQuestions ?? chat.starter_questions;
    return Array.isArray(sq) ? sq.filter((q): q is string => typeof q === "string" && !!q.trim()) : [];
  }, [chat]);
  const starterQuestions = useMemo(() => {
    if (customStarters.length) return customStarters;
    return helpdeskEntries.slice(0, 3).map((entry) => entry.question.trim());
  }, [customStarters, helpdeskEntries]);

  const previewProps = useMemo(
    () => ({
      language: String(tenantSettings.response_language || "it"),
      primaryColor: str("primaryColor", "#10a37f"),
      accentColor: str("accentColor", str("primaryColor", "#10a37f")),
      buttonColor: str("buttonColor", str("primaryColor", "#10a37f")),
      titleColor: str("titleColor", "#ffffff"),
      activeTabBackgroundColor: str("activeTabBackgroundColor"),
      widgetTitle: str("widgetTitle", ""),
      headerTitle: str("headerTitle", ""),
      launcherLabel: str("launcherLabel", ""),
      logoUrl: str("logoUrl", ""),
      logoUrlDark: str("logoUrlDark", ""),
      defaultAvatarUrl: str("defaultAvatarUrl"),
      // As class-ar-chat.php: the credit shows only where the owner turned it on.
      logoRemoval: attribution?.shown !== true,
      welcomeMessage: str("welcomeMessage", ""),
      theme: str("theme", "system"),
      radius: num("radius", 18),
      panelWidth: num("panelWidth", 420),
      panelHeight: num("panelHeight", 640),
      fontScale: num("fontScale", 1),
      // As class-ar-chat.php: no assistant name means none, not a placeholder one.
      chatbotName: String(tenantSettings.chatbot_name || "").trim(),
      starterQuestions,
      customStarterQuestions: customStarters,
      position: str("position", "right"),
      launcherStyle: (str("launcherStyle", "pill") as LauncherStyle),
      widgetStyle: str("widgetStyle", "sidepanel"),
      launcherAnimation: str("launcher_animation", "pulse"),
      motionStyle: str("motionStyle", "subtle"),
      motionSpeed: str("motionSpeed", "balanced"),
      animateMessages: chat.animateMessages !== false,
      launcherRepeat: str("launcherRepeat", "once"),
      launcherInterval: num("launcherInterval", 15),
      soundVolume: num("soundVolume", 35),
      openSound: str("openSound", "none"),
      sendSound: str("sendSound", "none"),
      notificationSound: str("notificationSound", "none"),
      attention_sound: str("attention_sound", "none"),
      headerStyle: str("headerStyle", "soft"),
      headerSubtitle: str("headerSubtitle"),
      inputPlaceholder: str("inputPlaceholder"),
      starterLayout: str("starterLayout", "cards"),
      launcherIconUrl: str("launcherIconUrl"),
      launcherImageMode: str("launcherImageMode", "custom"),
      buttonRadius: num("buttonRadius", 999),
      marginX: num("marginX", 24),
      marginY: num("marginY", 24),
      autoOpenGreeting: str("auto_open_greeting"),
      autoOpenDelay: num("auto_open_delay", 0),
      helpdeskEntries,
      privacyNoticeUrl: String(tenantSettings.privacy_notice_url || ""),
    }),
    // str/num read `chat`, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, tenantSettings, starterQuestions, customStarters, helpdeskEntries, attribution],
  );

  const primary = str("primaryColor", "#10a37f");
  // The picker, then the colors this widget was saved with (or the defaults).
  const brandChoices = useBrandChoices(primary, chat.recentColors);
  const customBrand = brandChoices.custom;
  // What the widget shows under the title while the subtitle is empty.
  const defaultStatus = headerIdentity({
    chatbotName: previewProps.chatbotName,
    headerTitle: previewProps.headerTitle,
    fallbackName: "",
    onlineStatus: t("widget.editor.statusOnline"),
    personaStatus: t("widget.editor.statusPersona"),
  }).status;
  /** A swatch or its picker: the whole widget takes the color. */
  const setBrandColor = (color: string) => update(brandColorPatch(color, chat, "whole"));
  /** Colori > Colore principale: the button and Send colors follow only while they matched it. */
  const setPrimaryColor = (color: string) => update(brandColorPatch(color, chat, "matching"));

  /* ── Texts held back while invalid ── */
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});
  const textValue = (key: keyof typeof TEXT_RULES) => textDrafts[key] ?? str(key);
  // What each text was live as when this editing round began. Valid keystrokes
  // autosave as typed, so clearing "Titolo" with Backspace publishes "Titol" ...
  // "T" before the empty value is held: going invalid puts this one back, so the
  // widget really keeps the text of before. A round ends on blur with a valid value.
  const textBefore = useRef<Record<string, string>>({});
  const editText = (key: keyof typeof TEXT_RULES, value: string) => {
    if (!(key in textBefore.current)) textBefore.current[key] = str(key);
    if (textFieldError(key, value)) {
      setTextDrafts((previous) => ({ ...previous, [key]: value }));
      const before = textBefore.current[key];
      if (str(key) !== before) update({ [key]: before });
      return;
    }
    setTextDrafts((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    update({ [key]: value });
  };
  const endTextRound = (key: keyof typeof TEXT_RULES) => {
    if (!(key in textDrafts)) delete textBefore.current[key];
  };
  // An edit is judged as typed; a saved value only when it is over the limit
  // (saved before the limit existed), so an untouched empty title raises nothing.
  const textError = (key: keyof typeof TEXT_RULES) => key in textDrafts
    ? textFieldError(key, textDrafts[key])
    : textLength(str(key)) > TEXT_RULES[key].max ? "widget.editor.textTooLong" : null;
  const titleError = textError("widgetTitle");
  const welcomeError = textError("welcomeMessage");
  const headerTitleError = textError("headerTitle");
  const launcherLabelError = textError("launcherLabel");

  const isPopup = str("widgetStyle", "sidepanel") === "popup";
  const sizePresets = isPopup ? POPUP_PRESETS : PANEL_PRESETS;
  const sizeValue = sizePresets.find((p) => num("panelHeight", 640) === p.height && num("panelWidth", 420) === p.width)?.label ?? "";
  const delay = num("auto_open_delay", 0);
  const greeting = str("auto_open_greeting");
  const [startersOpen, setStartersOpen] = useState(false);
  // Assistente > Carattere links here to edit the suggested questions.
  useNavIntent("starters", () => setStartersOpen(true));

  const saveBar = (
    <SaveBar
      count={changeCount}
      held={Object.keys(textDrafts).length}
      saving={saveStatus ? Object.values(saveStatus).includes("pending") : saving}
      failed={saveStatus ? Object.values(saveStatus).includes("failed") : !!error && !saving}
      onUndo={undoAll}
      onDone={forgetChanges}
      onRetry={retryFailedSaves ? () => { void retryFailedSaves(); } : undefined}
    />
  );

  return (
    <div className="we-page">
      <div className="we-settings">
        <PageHead title={t("nav.leaves.widget.widget")} subtitle={t("nav.leaves.widget.widgetDescription")} />

        <Group
          label={t("widget.editor.groupLook")}
          action={
            <button type="button" className="we-group-link" disabled={resettingBrand} onClick={() => { void resetToBranding(); }}>
              <RotateCcw className={cn(resettingBrand && "animate-spin")} aria-hidden="true" />
              {t("widget.editor.fromSite")}
            </button>
          }
        >
          <SettingRow label={t("widget.editor.color")} help={t("widget.helpPrimaryColor")}
            description={customBrand ? `${t("widget.editor.customColor")} · ${primary.toLowerCase()}` : undefined}>
            {/* The picker's shades are saved (and remembered as a recent color) once, when it closes. */}
            <BrandColorChoices value={primary} state={brandChoices} onPick={setBrandColor} onPickerOpenChange={holdChatSaves} />
          </SettingRow>
          <SettingRow label={t("labels.theme")} help={t("widget.helpTheme")}>
            <Segmented aria-label={t("labels.theme")} size="sm" value={str("theme", "system")} onValueChange={(v) => update({ theme: v })} options={[
              { value: "system", label: t("widget.editor.themeAuto") },
              { value: "light", label: t("widget.themeLight") },
              { value: "dark", label: t("widget.themeDark") },
            ]} />
          </SettingRow>
          <SettingRow label={t("widget.headerStyle")} help={t("widget.helpHeaderStyle")}>
            <Segmented aria-label={t("widget.headerStyle")} size="sm" value={str("headerStyle", "soft")} onValueChange={(v) => update({ headerStyle: v })} options={[
              { value: "soft", label: t("widget.headerSoft") },
              { value: "brand", label: t("widget.editor.headerBrand") },
            ]} />
          </SettingRow>
          <SettingRow label={t("widget.editor.corners")} help={t("widget.helpCornerRadius")}>
            <Segmented aria-label={t("labels.cornerRadius")} size="sm" value={String(num("radius", 18))} onValueChange={(v) => update({ radius: Number(v) })}
              options={CORNER_PRESETS.map((p) => ({ value: String(p.value), label: t(`labels.${p.label}`) }))} />
          </SettingRow>
          <SettingRow label={t("widget.editor.textSize")} help={t("widget.helpFontScale")}>
            <Segmented aria-label={t("labels.fontScale")} size="sm" value={String(num("fontScale", 1))} onValueChange={(v) => update({ fontScale: Number(v) })}
              options={FONT_PRESETS.map((p) => ({ value: String(p.value), label: t(`labels.${p.label}`) }))} />
          </SettingRow>
        </Group>

        <Group label={t("widget.editor.groupHeader")}>
          <ImageField
            id="widget-logo-url"
            label={t("widget.avatarLabel")}
            help={t("widget.helpLogoUrl")}
            value={str("logoUrl")}
            fallbackUrl={str("defaultAvatarUrl")}
            avatarPool
            onChange={(url) => update({ logoUrl: url })}
          />
          {/* Optional second avatar for the dark chat; empty keeps one avatar for both (card h8dosik1g6ic). */}
          <ImageField
            id="widget-logo-url-dark"
            label={t("widget.avatarDarkLabel")}
            help={t("widget.helpAvatarDark")}
            description={t("widget.avatarDarkHint")}
            actionLabel={t("widget.changeDarkAvatar")}
            clearLabel={t("widget.sameAvatarBothThemes")}
            tone="dark"
            value={str("logoUrlDark")}
            fallbackUrl={str("logoUrl") || str("defaultAvatarUrl")}
            avatarPool
            onChange={(url) => update({ logoUrlDark: url })}
          />
          <StackRow label={t("labels.chatTitle")} help={t("widget.helpHeaderTitle")} htmlFor="widget-header-title">
            {/* Same cap as AlphaRecall_Settings::HEADER_TITLE_MAX; the header cuts a longer saved name with an ellipsis. */}
            <Input id="widget-header-title" placeholder="AlphaRecall" maxLength={HEADER_TITLE_MAX}
              aria-describedby="widget-header-title-count" aria-invalid={!!headerTitleError || undefined}
              value={textValue("headerTitle")} onChange={(e) => editText("headerTitle", e.target.value)} onBlur={() => endTextRound("headerTitle")} />
            <TextLimit id="widget-header-title-count" value={textValue("headerTitle")} max={HEADER_TITLE_MAX} error={headerTitleError}
              held={"headerTitle" in textDrafts} clampedKey="widget.editor.textCut" />
          </StackRow>
          <StackRow label={t("widget.headerSubtitle")} htmlFor="widget-header-subtitle">
            <Input id="widget-header-subtitle" maxLength={120} value={str("headerSubtitle")} placeholder={defaultStatus} onChange={(e) => update({ headerSubtitle: e.target.value })} />
          </StackRow>
        </Group>

        <Group label={t("widget.editor.groupWelcome")}>
          <StackRow label={t("labels.widgetTitle")} help={t("widget.helpWidgetTitle")} htmlFor="widget-title">
            {/* Same cap as the PHP save (AlphaRecall_Settings::WIDGET_TITLE_MAX); the widget clamps longer saved titles. */}
            <Input id="widget-title" maxLength={WIDGET_TITLE_MAX} aria-describedby="widget-title-count" aria-invalid={!!titleError || undefined}
              placeholder={t("widget.previewWelcome")} value={textValue("widgetTitle")} onChange={(e) => editText("widgetTitle", e.target.value)} onBlur={() => endTextRound("widgetTitle")} />
            <TextLimit id="widget-title-count" value={textValue("widgetTitle")} max={WIDGET_TITLE_MAX} error={titleError} held={"widgetTitle" in textDrafts} />
          </StackRow>
          <StackRow label={t("labels.welcomeMessage")} help={t("widget.helpWelcomeMessage")} htmlFor="widget-welcome-message">
            {/* Same cap as AlphaRecall_Settings::WELCOME_MESSAGE_MAX; the widget clamps longer saved welcomes. */}
            <Textarea id="widget-welcome-message" rows={2} className="min-h-[64px] resize-y" placeholder={t("widget.editor.welcomePlaceholder")}
              maxLength={WELCOME_MESSAGE_MAX} aria-describedby="widget-welcome-count" aria-invalid={!!welcomeError || undefined}
              value={textValue("welcomeMessage")} onChange={(e) => editText("welcomeMessage", e.target.value)} onBlur={() => endTextRound("welcomeMessage")} />
            <TextLimit id="widget-welcome-count" value={textValue("welcomeMessage")} max={WELCOME_MESSAGE_MAX} error={welcomeError} held={"welcomeMessage" in textDrafts} />
          </StackRow>
          <button type="button" className="ark-row ark-row-button" onClick={() => setStartersOpen(true)}>
            <span className="ark-row-text">
              <span className="ark-row-label">{t("widget.editor.starters")}</span>
              <small className="ark-row-desc">{customStarters.length
                ? interpolate(t(customStarters.length === 1 ? "widget.editor.startersOne" : "widget.editor.startersMany"), { n: customStarters.length })
                : t(helpdeskEntries.length ? "widget.editor.startersFromFaq" : "widget.editor.startersDefault")}</small>
            </span>
            <span className="ark-row-value">{t("widget.editor.edit")}</span>
          </button>
          <StackRow label={t("widget.editor.starterLayout")} help={t("widget.helpStarterLayout")}>
            <Segmented aria-label={t("widget.starterLayout")} size="sm" value={str("starterLayout", "cards")} onValueChange={(v) => update({ starterLayout: v })} options={[
              { value: "cards", label: t("widget.starterCards") },
              { value: "chips", label: t("widget.starterChips") },
            ]} />
          </StackRow>
          <StackRow label={t("widget.inputPlaceholder")} htmlFor="widget-input-placeholder">
            <Input id="widget-input-placeholder" maxLength={120} value={str("inputPlaceholder")} placeholder={t("widget.inputDefault")} onChange={(e) => update({ inputPlaceholder: e.target.value })} />
          </StackRow>
        </Group>

        <Group label={t("widget.editor.groupLauncher")}>
          <SettingRow label={t("labels.position")} help={t("widget.helpPosition")}>
            <Segmented aria-label={t("labels.position")} size="sm" value={str("position", "right")} onValueChange={(v) => update({ position: v })} options={[
              { value: "left", label: t("widget.positionLeft") },
              { value: "right", label: t("widget.positionRight") },
            ]} />
          </SettingRow>
          <StackRow label={t("widget.editor.launcherShape")}>
            <LauncherStyleSelector
              value={str("launcherStyle", "pill") as LauncherStyle}
              color={str("buttonColor", primary)}
              onChange={(v) => update({ launcherStyle: v })}
            />
          </StackRow>
          <StackRow label={t("labels.launcherLabel")} help={t("widget.helpLauncherLabel")} htmlFor="widget-launcher-label">
            {/* Same cap as AlphaRecall_Settings::LAUNCHER_LABEL_MAX; the launcher cuts a longer saved text with an ellipsis. */}
            <Input id="widget-launcher-label" placeholder={t("chat.launcherDefault")} maxLength={LAUNCHER_LABEL_MAX}
              aria-describedby="widget-launcher-label-count" aria-invalid={!!launcherLabelError || undefined}
              value={textValue("launcherLabel")} onChange={(e) => editText("launcherLabel", e.target.value)} onBlur={() => endTextRound("launcherLabel")} />
            <TextLimit id="widget-launcher-label-count" value={textValue("launcherLabel")} max={LAUNCHER_LABEL_MAX} error={launcherLabelError}
              held={"launcherLabel" in textDrafts} clampedKey="widget.editor.textCut" />
          </StackRow>
          <SettingRow label={t("widget.launcherImageMode")} description={t("widget.editor.launcherImageHelp")}>
            <SelectPill aria-label={t("widget.launcherImageMode")} value={str("launcherImageMode", "custom")}
              onValueChange={(value) => update({ launcherImageMode: value })}
              options={[
                { value: "logo", label: t("widget.launcherImageLogo") },
                { value: "custom", label: t("widget.launcherImageCustom") },
                { value: "icon", label: t("widget.launcherImageNone") },
              ]} />
          </SettingRow>
          {str("launcherImageMode", "custom") === "custom" && <ImageField
            id="widget-launcher-icon"
            label={t("widget.launcherIcon")}
            help={t("widget.helpLauncherIcon")}
            value={str("launcherIconUrl")}
            fallbackUrl={str("defaultAvatarUrl")}
            avatarPool
            actionLabel={t("widget.changeImage")}
            onChange={(url) => update({ launcherIconUrl: url })}
          />}
          <SettingRow label={t("widget.editor.margins")} help={`${t("widget.helpMarginX")}. ${t("widget.helpMarginY")}.`}
            description={marginHint ? <span id="widget-margin-hint" role="status">{marginHint}</span> : undefined}>
            <span className="we-margins">
              <label className="we-margin">
                <span>{t("widget.editor.marginSide")}</span>
                <WidgetNumberField field="marginX" label={t("labels.marginX")} name={t("widget.editor.marginSide")} hintId="widget-margin-hint"
                  value={num("marginX", 24)} onCommit={(value) => update({ marginX: value })} onHint={setMarginHint} />
              </label>
              <label className="we-margin">
                <span>{t("widget.editor.marginBottom")}</span>
                <WidgetNumberField field="marginY" label={t("labels.marginY")} name={t("widget.editor.marginBottom")} hintId="widget-margin-hint"
                  value={num("marginY", 24)} onCommit={(value) => update({ marginY: value })} onHint={setMarginHint} />
              </label>
            </span>
          </SettingRow>
        </Group>

        <Group label={t("widget.editor.groupInvite")}>
          <SettingRow
            label={t("widget.editor.invite")}
            help={t("widget.helpAutoOpenDelay")}
            htmlFor="widget-invite"
            description={delay > 0
              ? interpolate(t(greeting.trim() ? "widget.editor.inviteAfter" : "widget.editor.inviteOpensAfter"), { n: delay })
              : t("widget.editor.inviteOffShort")}
          >
            <Toggle id="widget-invite" checked={delay > 0} onCheckedChange={(on) => update({ auto_open_delay: on ? 20 : 0 })} />
          </SettingRow>
          {delay > 0 && <>
            <SettingRow label={t("widget.autoOpenDelay")}>
              <SelectPill aria-label={t("widget.autoOpenDelay")} value={String(delay)} onValueChange={(v) => update({ auto_open_delay: Number(v) })}
                options={(DELAYS.includes(delay) ? DELAYS : [...DELAYS, delay].sort((a, b) => a - b)).map((v) => ({ value: String(v), label: interpolate(t("widget.delaySeconds"), { n: v }) }))} />
            </SettingRow>
            <StackRow label={t("widget.greetingMessage")} help={t("widget.helpGreetingMessage")} htmlFor="widget-auto-greeting">
              <Input id="widget-auto-greeting" placeholder={t("widget.greetingPlaceholder")} value={greeting} maxLength={200}
                onChange={(e) => update({ auto_open_greeting: e.target.value })} />
            </StackRow>
          </>}
        </Group>

        <Group label={t("widget.editor.groupWindow")}>
          <SettingRow label={t("widget.widgetStyle")} help={t("widget.helpWidgetStyle")}>
            <Segmented aria-label={t("widget.widgetStyle")} size="sm" value={str("widgetStyle", "sidepanel")} onValueChange={(v) => update({ widgetStyle: v })} options={[
              { value: "sidepanel", label: t("widget.styleSidepanel") },
              { value: "popup", label: t("widget.stylePopup") },
            ]} />
          </SettingRow>
          <SettingRow label={t("widget.editor.size")} help={t("widget.helpPanelSize")} description={t(isPopup ? "widget.editor.sizePopupHelp" : "widget.editor.sizePanelHelp")}>
            <Segmented aria-label={t("labels.panelSize")} size="sm" value={sizeValue}
              onValueChange={(label) => { const p = sizePresets.find((x) => x.label === label); if (p) update({ panelHeight: p.height, panelWidth: p.width }); }}
              options={sizePresets.map((p) => ({ value: p.label, label: t(`labels.${p.label}`) }))} />
          </SettingRow>
        </Group>

        <Group label={t("widget.editor.groupBehaviour")}>
          {updateTenantDraft && (
            <SettingRow label={t("widget.editor.askContact")} description={t("widget.editor.askContactHelp")} htmlFor="widget-ask-contact">
              <Toggle id="widget-ask-contact" checked={!!tenantSettings.require_visitor_info} onCheckedChange={(on) => updateTenant({ require_visitor_info: on })} />
            </SettingRow>
          )}
          <WidgetVisibilityControls chat={chat} onChange={update} />
          {attribution && (
            <SettingRow label={t("widget.editor.attribution")} description={t("widget.editor.attributionHelp")} htmlFor="widget-attribution">
              <Toggle id="widget-attribution" checked={attribution.shown} disabled={savingAttribution}
                onCheckedChange={(on) => { void saveAttribution(on); }} />
            </SettingRow>
          )}
        </Group>

        <Group label={t("widget.editor.groupColors")}>
          <ColorRow label={t("widget.editor.primaryColor")} help={t("widget.helpPrimaryColor")} ariaLabel={t("labels.primaryColor")}
            value={primary} onChange={setPrimaryColor} />
          <ColorRow label={t("widget.editor.buttonColor")} help={t("widget.helpButtonColor")} ariaLabel={t("labels.buttonColor")}
            value={str("buttonColor", primary)} onChange={(v) => update({ buttonColor: v })} />
          <ColorRow label={t("widget.editor.sendColor")} help={t("widget.helpAccentColor")} ariaLabel={t("labels.accentColor")}
            value={str("accentColor", primary)} onChange={(v) => update({ accentColor: v })} />
          <ColorRow label={t("widget.editor.titleColor")} help={t("widget.helpTitleColor")} ariaLabel={t("labels.titleColor")}
            value={str("titleColor", "#ffffff")} onChange={(v) => update({ titleColor: v })} />
          <ColorRow label={t("widget.editor.activeTabColor")} help={t("widget.helpActiveTabBackgroundColor")} ariaLabel={t("labels.activeTabBackgroundColor")}
            value={str("activeTabBackgroundColor")} defaultLabel={t("widget.activeTabThemeDefault")}
            onChange={(v) => update({ activeTabBackgroundColor: v })}
            extra={<IconButton icon={RotateCcw} size="sm" label={t("widget.resetActiveTabBackgroundColor")}
              disabled={!str("activeTabBackgroundColor")} onClick={() => update({ activeTabBackgroundColor: "" })} />} />
        </Group>

        <WidgetExperienceControls chat={chat} update={update} onDemo={(event) => { void unlockAudio(); setPreviewDemo((previous) => ({ id: previous.id + 1, event })); }} />
      </div>

      <LiveWidgetPreview {...previewProps} demo={previewDemo} focus={previewFocus ?? undefined} overlay={saveBar} className="we-preview" />

      <StarterQuestionsDialog
        open={startersOpen}
        onOpenChange={setStartersOpen}
        questions={customStarters}
        fallback={starterQuestions}
        onChange={(questions) => update({ starterQuestions: questions, starter_questions: questions })}
      />
    </div>
  );
}

/**
 * /branding/attribution's answer, or null when it is not one (the switch stays
 * hidden). "editable" is always true from this plugin; it is not read.
 */
function attributionState(value: unknown): { shown: boolean } | null {
  const v = value as { shown?: unknown } | null;
  return v && typeof v.shown === "boolean" ? { shown: v.shown } : null;
}

/* ── Rows ─────────────────────────────────────────── */

/** The n/max counter under a text field, with the reason it is not saved. */
function TextLimit({ id, value, max, error, held, clampedKey = "widget.editor.textClamped" }: {
  id: string; value: string; max: number; error: string | null; held: boolean;
  /** What the widget does with a longer text saved before the limit. */
  clampedKey?: string;
}) {
  const { t } = useApp();
  // Held: this edit is not saved. Otherwise it is a longer text saved before the limit.
  return (
    <span id={id} className="we-text-limit" data-invalid={error ? "true" : undefined}>
      {error && <span className="we-text-error" role="alert">{interpolate(t(error), { max })} {interpolate(t(held ? "widget.editor.textNotSaved" : clampedKey), { max })}</span>}
      <small className="as-num">{textLength(value)}/{max}</small>
    </span>
  );
}

function ColorRow({ label, help, ariaLabel, value, onChange, defaultLabel, extra }: {
  label: string;
  help: string;
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  defaultLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <SettingRow label={label} help={help}>
      <div className="we-color">
        <ColorPicker value={value} onChange={onChange} label={ariaLabel} defaultLabel={defaultLabel} enableGradients={false} />
      </div>
      {extra}
    </SettingRow>
  );
}

/* ── Save bar ─────────────────────────────────────── */

function SaveBar({ count, held = 0, saving, failed, onUndo, onDone, onRetry }: {
  count: number;
  /** Texts kept in their field because they are invalid: not live, but Annulla drops them. */
  held?: number;
  saving: boolean;
  failed: boolean;
  onUndo: () => void;
  onDone: () => void;
  onRetry?: () => void;
}) {
  const { t } = useApp();
  if (!count && !held && !saving && !failed) return null;
  const text = failed
    ? t("widget.editor.saveFailed")
    : held && !saving
      ? t(held === 1 ? "widget.editor.heldOne" : "widget.editor.heldMany")
    : saving
      ? (count ? interpolate(t(count === 1 ? "widget.editor.savingOne" : "widget.editor.savingMany"), { n: count }) : t("widget.editor.saving"))
      : interpolate(t(count === 1 ? "widget.editor.savedOne" : "widget.editor.savedMany"), { n: count });
  return (
    <div className="we-savebar" data-state={failed ? "failed" : saving ? "saving" : "saved"}>
      <span role="status" aria-live="polite">{text}</span>
      {failed && onRetry ? (
        <button type="button" className="we-savebar-main" onClick={onRetry}>{t("widget.editor.retry")}</button>
      ) : held > 0 ? (
        // Fatto would leave the field invalid: fixing it or Annulla are the ways out.
        <button type="button" className="we-savebar-main" onClick={onUndo} disabled={saving}>{t("widget.editor.undo")}</button>
      ) : count > 0 ? <>
        <button type="button" className="we-savebar-ghost" onClick={onUndo} disabled={saving}>{t("widget.editor.undo")}</button>
        <button type="button" className="we-savebar-main" onClick={onDone} disabled={saving}>{t("widget.editor.done")}</button>
      </> : null}
    </div>
  );
}

/* ── Suggested questions ──────────────────────────── */

function StarterQuestionsDialog({ open, onOpenChange, questions, fallback, onChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questions: string[];
  fallback: string[];
  onChange: (questions: string[]) => void;
}) {
  const { t } = useApp();
  const [draft, setDraft] = useState("");
  const full = questions.length >= MAX_STARTERS;
  const add = () => {
    const q = draft.trim();
    if (!q || full || questions.includes(q)) return;
    onChange([...questions, q]);
    setDraft("");
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { setDraft(""); onOpenChange(next); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("widget.editor.starters")}</DialogTitle>
          <DialogDescription>{t("widget.editor.startersHelp")}</DialogDescription>
        </DialogHeader>
        {questions.length ? (
          <ul className="we-starters" aria-label={t("widget.editor.starters")}>
            {questions.map((question, index) => (
              <li key={`${question}-${index}`}>
                <span>{question}</span>
                <IconButton icon={Trash2} size="sm" label={`${t("widget.editor.removeQuestion")}: ${question}`}
                  onClick={() => onChange(questions.filter((_, i) => i !== index))} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-2">
            {fallback.length ? t("widget.editor.startersFallbackFaq") : t("widget.editor.startersFallbackDefault")}
          </p>
        )}
        <form className="we-starter-add" onSubmit={(event) => { event.preventDefault(); add(); }}>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} disabled={full} maxLength={120}
            aria-label={t("widget.editor.newQuestion")} placeholder={t(full ? "widget.editor.startersFull" : "widget.editor.newQuestionPlaceholder")} />
          <Button type="submit" variant="secondary" disabled={full || !draft.trim()}><Plus aria-hidden="true" />{t("widget.editor.add")}</Button>
        </form>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>{t("widget.editor.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Launcher Style Selector ─────────────────────────── */

const LAUNCHER_STYLES: { value: LauncherStyle; labelKey: string }[] = [
  { value: "pill", labelKey: "widget.launcherPill" },
  { value: "circle", labelKey: "widget.launcherCircle" },
  { value: "rounded-square", labelKey: "widget.launcherSquare" },
  { value: "text-only", labelKey: "widget.launcherText" },
];

function LauncherStyleSelector({
  value,
  color,
  onChange,
}: {
  value: LauncherStyle;
  color: string;
  onChange: (v: LauncherStyle) => void;
}) {
  const { t } = useApp();
  return (
    <div className="we-shapes" role="group" aria-label={t("widget.launcherStyle")}>
      {LAUNCHER_STYLES.map((style) => (
        <button
          key={style.value}
          type="button"
          aria-pressed={value === style.value}
          onClick={() => onChange(style.value)}
          className="we-shape"
        >
          <LauncherThumb style={style.value} color={color} label={t("widget.launcherDefaultLabel")} />
          <span>{t(style.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}

/** Mini thumbnail of each launcher style */
function LauncherThumb({ style, color, label }: { style: LauncherStyle; color: string; label: string }) {
  const iconSvg = (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 4h12a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H9l-5 4v-4a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z"
      />
    </svg>
  );

  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: color,
    color: contrastColor(color),
    fontWeight: 600,
    fontSize: 9,
    gap: 4,
    lineHeight: 1,
  };

  switch (style) {
    case "circle":
      return <div style={{ ...base, width: 30, height: 30, borderRadius: "50%" }}>{iconSvg}</div>;
    case "rounded-square":
      return <div style={{ ...base, width: 30, height: 30, borderRadius: 9 }}>{iconSvg}</div>;
    case "text-only":
      return <div style={{ ...base, height: 30, borderRadius: 999, padding: "0 10px" }}>{label}</div>;
    case "pill":
    default:
      return (
        <div style={{ ...base, height: 30, borderRadius: 999, padding: "0 10px" }}>
          {iconSvg}
          <span>{label}</span>
        </div>
      );
  }
}
