import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useSettings } from "@/admin/hooks/use-settings";
import { apiFetch } from "@/admin/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/admin/lib/datetime";
import { interpolate } from "@/admin/lib/i18n";
import { useNavigate } from "@/admin/lib/nav-context";
import { Group, Row, SelectPill } from "@/admin/components/shared/kit";
import { assistantName } from "@/admin/components/assistant/shared";
import { Wand2, Loader2, MessageSquare, Pencil, Check, ChevronUp } from "@/components/icons";
import { clampText, WELCOME_MESSAGE_MAX } from "@/lib/widget-limits";

const PERSONALITY_PRESETS = [
  { key: "friendly", tone: "friendly" },
  { key: "professional", tone: "professional" },
  { key: "creative", tone: "creative" },
] as const;

const LANGUAGES = [
  { value: "it", label: "Italiano" },
  { value: "en-US", label: "English" },
];

/** First sentence of the role description, short enough for a subtitle. */
function roleSummary(role: string): string {
  const first = role.trim().split(/(?<=[.!?])\s/)[0] || "";
  return first.length > 110 ? `${first.slice(0, 107).trimEnd()}...` : first;
}

/**
 * Assistente > Carattere: who the assistant is and how it talks, as a persona
 * card. Every field autosaves (useSettings drafts), as before.
 *
 * @param toolsSlot rendered between "how it talks" and the special
 *   instructions: the tools section, so the page reads as one profile.
 * @param onTry opens the test chat ("Prova").
 */
export function AiPersonaSection({ toolsSlot, onTry }: { toolsSlot?: React.ReactNode; onTry?: () => void } = {}) {
  const { t, settings } = useApp();
  const { updateTenantDraft, updateChatDraft, saving } = useSettings();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const identityId = useId();

  const tenant = (settings.tenant_settings || {}) as Record<string, unknown>;
  const chat = (settings.chat_config || {}) as Record<string, unknown>;

  const botName = String(tenant.chatbot_name ?? "AlphaRecall");
  const botRole = String(tenant.chatbot_role ?? tenant.bot_role ?? "");
  const botTone = String(tenant.chatbot_tone ?? "professional");
  const responseLanguage = String(tenant.response_language ?? "it");
  const customPrompt = String(tenant.custom_prompt ?? "");
  // Counted as the Widget editor counts them: blank entries are not shown.
  const starterQuestions = ((
    Array.isArray(chat.starterQuestions)
      ? chat.starterQuestions
      : Array.isArray(chat.starter_questions)
        ? chat.starter_questions
        : []
  ) as unknown[]).filter((q): q is string => typeof q === "string" && !!q.trim());
  const avatarSrc = String(chat.logoUrl || chat.defaultAvatarUrl || "");
  const displayName = assistantName(settings, t("assistant.common.fallbackName"));
  const navigate = useNavigate();
  // With no questions chosen the widget shows the published FAQs (chat-customizer.tsx).
  const [faqCount, setFaqCount] = useState(0);
  useEffect(() => {
    let active = true;
    void apiFetch<Array<{ enabled?: boolean; question?: string }>>("/helpdesk")
      .then((entries) => { if (active && Array.isArray(entries)) setFaqCount(entries.filter((e) => e.enabled && String(e.question ?? "").trim()).length); })
      .catch(() => { /* The row then says "Domande di esempio". */ });
    return () => { active = false; };
  }, []);

  // "custom" is the sentinel written when the Personalizzato preset is picked
  // without a specific tone yet: show an empty input (placeholder) for it, not
  // the literal word "custom".
  const [customTone, setCustomTone] = useState(
    PERSONALITY_PRESETS.some((p) => p.tone === botTone) || botTone === "custom" ? "" : botTone
  );
  // Personalizzato picked with no description yet: shown as chosen, but the
  // saved tone stays what it was until there is text (card 85rkorpufcuq).
  const [customOpen, setCustomOpen] = useState(false);
  // The tone in effect before this round of custom typing: emptying the field
  // goes back to it, so the last letter typed is never left as the tone.
  const toneBeforeCustom = useRef<string | null>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  // The identity fields open by default until the assistant has a name.
  const [editing, setEditing] = useState(!String(tenant.chatbot_name ?? "").trim() || botName === "AlphaRecall");

  const isCustomTone = customOpen || !PERSONALITY_PRESETS.some((p) => p.tone === botTone);
  // Tone radios: presets then "Personalizzato". Roving tabindex, arrows move and select.
  const toneRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedTone = isCustomTone ? PERSONALITY_PRESETS.length : PERSONALITY_PRESETS.findIndex((p) => p.tone === botTone);
  const selectToneAt = (index: number) => {
    if (index === PERSONALITY_PRESETS.length) selectCustomTone();
    else handleToneSelect(PERSONALITY_PRESETS[index].tone);
  };
  const onToneKey = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const count = PERSONALITY_PRESETS.length + 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (index + 1) % count
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (index - 1 + count) % count
      : e.key === "Home" ? 0
      : e.key === "End" ? count - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    selectToneAt(next);
    toneRefs.current[next]?.focus();
  };

  // Provenance written by the API after it configured this assistant from the
  // site's content. Shown so an auto-generated persona reads as a deliberate
  // setup step rather than values that appeared from nowhere.
  const autoConfig = tenant.auto_config as { generated_at?: string } | null | undefined;
  const autoConfiguredLabel = formatDate(autoConfig?.generated_at) || null;

  async function handleGeneratePersona() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await apiFetch<{
        chatbot_name?: string;
        chatbot_role?: string;
        chatbot_tone?: string;
        welcome_message?: string;
        starter_questions?: string[];
        enabled_tools?: Record<string, boolean>;
      }>("/persona/generate", { method: "POST" });

      // Update tenant settings fields
      const tenantPatch: Record<string, unknown> = {};
      if (result.chatbot_name) tenantPatch.chatbot_name = result.chatbot_name;
      if (result.chatbot_role) {
        tenantPatch.chatbot_role = result.chatbot_role;
        tenantPatch.bot_role = result.chatbot_role;
      }
      if (result.chatbot_tone) {
        tenantPatch.chatbot_tone = result.chatbot_tone;
        setCustomOpen(false);
        toneBeforeCustom.current = null;
        if (PERSONALITY_PRESETS.some((p) => p.tone === result.chatbot_tone)) {
          setCustomTone("");
        } else {
          setCustomTone(result.chatbot_tone);
        }
      }
      // The same call picks the tool set for this business. It is already
      // persisted server-side; mirroring it into the draft is what makes the
      // Tools section reflect it without a reload.
      if (result.enabled_tools && Object.keys(result.enabled_tools).length) {
        tenantPatch.enabled_tools = result.enabled_tools;
      }
      if (Object.keys(tenantPatch).length) updateTenantDraft(tenantPatch);

      // Update chat config fields
      const chatPatch: Record<string, unknown> = {};
      // The Widget editor's cap (AlphaRecall_Settings::WELCOME_MESSAGE_MAX); the save would cut it anyway.
      if (result.welcome_message) chatPatch.welcomeMessage = clampText(result.welcome_message, WELCOME_MESSAGE_MAX);
      if (Array.isArray(result.starter_questions) && result.starter_questions.length) {
        chatPatch.starterQuestions = result.starter_questions;
        chatPatch.starter_questions = result.starter_questions;
      }
      if (Object.keys(chatPatch).length) updateChatDraft(chatPatch);
      toast.success(t("toast.personaGenerated"));
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : t("common.generationFailed"));
      toast.error(t("toast.personaFailed"));
    } finally {
      setGenerating(false);
    }
  }

  function handleToneSelect(tone: string) {
    // The custom description is kept: picking Personalizzato again restores it.
    setCustomOpen(false);
    toneBeforeCustom.current = null;
    updateTenantDraft({ chatbot_tone: tone });
  }

  /** Personalizzato: saved only with a description, otherwise it waits for one. */
  function selectCustomTone() {
    if (customTone.trim()) {
      setCustomOpen(false);
      if (toneBeforeCustom.current === null) toneBeforeCustom.current = botTone;
      if (customTone.trim() !== botTone) updateTenantDraft({ chatbot_tone: customTone.trim() });
      return;
    }
    if (toneBeforeCustom.current === null) toneBeforeCustom.current = botTone;
    setCustomOpen(true);
    window.requestAnimationFrame(() => customInputRef.current?.focus());
  }

  function handleCustomTone(value: string) {
    setCustomTone(value);
    if (toneBeforeCustom.current === null) toneBeforeCustom.current = botTone;
    if (value.trim()) {
      setCustomOpen(false);
      updateTenantDraft({ chatbot_tone: value.trim() });
      return;
    }
    // Emptied: the tone from before the typing comes back (the hint says the
    // assistant keeps talking as before), instead of the first letter typed.
    setCustomOpen(true);
    const previous = toneBeforeCustom.current;
    if (previous && previous !== botTone) updateTenantDraft({ chatbot_tone: previous });
  }

  const openIdentity = () => {
    setEditing(true);
    window.requestAnimationFrame(() => nameInputRef.current?.focus());
  };

  const languageLabel = LANGUAGES.find((l) => l.value === responseLanguage)?.label || responseLanguage;
  const summary = roleSummary(botRole);

  return (
    <div className="as-page">
      {/* Persona card head */}
      <div className="as-persona">
        {avatarSrc && !avatarFailed ? (
          <img src={avatarSrc} alt="" className="as-persona-av" onError={() => setAvatarFailed(true)} />
        ) : (
          <span className="as-persona-av" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>
        )}
        <div className="as-persona-text">
          <h1 className="as-persona-name">{displayName}</h1>
          <p className="as-muted text-[13.5px]">
            {summary || t("assistant.carattere.noRole")} · {interpolate(t("assistant.carattere.speaks"), { language: languageLabel.toLowerCase() })}
          </p>
          <p className="as-faint flex flex-wrap items-center gap-x-2 text-xs" aria-live="polite">
            {autoConfiguredLabel && <span>{t("persona.autoGeneratedOn").replace("%s", autoConfiguredLabel)}</span>}
            <span>{saving ? t("common.saving") : t("assistant.carattere.autosave")}</span>
          </p>
          {generateError && <p className="text-xs text-tone-red">{generateError}</p>}
        </div>
        <div className="as-persona-actions">
          <Button
            variant="secondary"
            onClick={() => (editing ? setEditing(false) : openIdentity())}
            aria-expanded={editing}
            aria-controls={identityId}
          >
            {editing ? <ChevronUp className="size-4" /> : <Pencil className="size-4" />}
            {editing ? t("assistant.carattere.closeEdit") : t("common.edit")}
          </Button>
          {onTry && (
            <Button onClick={onTry}>
              <MessageSquare className="size-4" />
              {interpolate(t("assistant.carattere.try"), { name: displayName })}
            </Button>
          )}
        </div>
      </div>

      {/* Identity */}
      {editing && (
        <div id={identityId} className="as-suggest">
          <div className="as-grid2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="agent-name" className="text-xs text-ink-3">{t("persona.assistantName")}</Label>
              <Input
                id="agent-name"
                ref={nameInputRef}
                value={botName}
                onChange={(e) => updateTenantDraft({ chatbot_name: e.target.value })}
                placeholder={t("persona.assistantNamePlaceholder")}
              />
              <p className="text-[11.5px] text-ink-3">{t("persona.assistantNameHint")}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span id="agent-language-label" className="text-xs text-ink-3">{t("labels.responseLanguage")}</span>
              <SelectPill
                value={responseLanguage}
                onValueChange={(v) => updateTenantDraft({ response_language: v })}
                options={LANGUAGES}
                aria-label={t("labels.responseLanguage")}
                className="self-start"
              />
              <p className="text-[11.5px] text-ink-3">{interpolate(t("advanced.helpResponseLanguage"), { name: displayName })}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="agent-role" className="text-xs text-ink-3">{t("persona.roleDescription")}</Label>
            <Textarea
              id="agent-role"
              rows={5}
              className="min-h-[120px] resize-y leading-relaxed"
              value={botRole}
              onChange={(e) =>
                updateTenantDraft({
                  chatbot_role: e.target.value,
                  bot_role: e.target.value,
                })
              }
              placeholder={t("persona.roleDescriptionPlaceholder")}
            />
            <p className="text-[11.5px] text-ink-3">{t("persona.roleDescriptionHint")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={handleGeneratePersona} disabled={generating}>
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {generating ? t("persona.generating") : t("persona.generateFromWebsite")}
            </Button>
            <p className="text-[11.5px] text-ink-3">{t("assistant.carattere.generateHint")}</p>
          </div>
        </div>
      )}

      {/* How it talks: tone chosen by example */}
      <section className="as-section" aria-labelledby="as-tone-title">
        <h2 id="as-tone-title" className="ark-lbl px-1">{t("assistant.carattere.howItTalks")}</h2>
        <div role="radiogroup" aria-labelledby="as-tone-title" className="as-grid4 as-tone-grid">
          {PERSONALITY_PRESETS.map((preset, index) => {
            const on = botTone === preset.tone && !isCustomTone;
            return (
              <button
                key={preset.key}
                ref={(el) => { toneRefs.current[index] = el; }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={index === checkedTone || (checkedTone < 0 && index === 0) ? 0 : -1}
                className="as-tone"
                onClick={() => handleToneSelect(preset.tone)}
                onKeyDown={(e) => onToneKey(e, index)}
              >
                <span className="as-tone-top">
                  <b>{t(`persona.${preset.key}`)}</b>
                  {on && <span className="as-chk"><Check aria-hidden="true" /></span>}
                </span>
                <p>"{t(`assistant.carattere.example.${preset.key}`)}"</p>
              </button>
            );
          })}
          <div className="as-tone as-tone-custom" data-on={isCustomTone || undefined}>
            <button
              ref={(el) => { toneRefs.current[PERSONALITY_PRESETS.length] = el; }}
              type="button"
              role="radio"
              aria-checked={isCustomTone}
              tabIndex={isCustomTone ? 0 : -1}
              className="as-tone-top text-left"
              onClick={selectCustomTone}
              onKeyDown={(e) => onToneKey(e, PERSONALITY_PRESETS.length)}
            >
              <b>{t("labels.chatbotToneCustom")}</b>
              {isCustomTone && <span className="as-chk"><Check aria-hidden="true" /></span>}
            </button>
            <p>{t("labels.chatbotToneCustomLabel")}</p>
            {isCustomTone && (
              <Input
                ref={customInputRef}
                value={customTone}
                onChange={(e) => handleCustomTone(e.target.value)}
                placeholder={t("assistant.carattere.customTonePlaceholder")}
                aria-label={t("labels.chatbotToneCustomLabel")}
                aria-describedby={!customTone.trim() ? `${identityId}-tone-hint` : undefined}
              />
            )}
            {isCustomTone && !customTone.trim() && (
              <p id={`${identityId}-tone-hint`} className="as-tone-hint" role="status">
                {botTone === "custom"
                  ? t("assistant.carattere.customToneEmpty")
                  : interpolate(t("assistant.carattere.customToneRequired"), { name: displayName })}
              </p>
            )}
          </div>
        </div>
      </section>

      {toolsSlot}

      {/* Special instructions */}
      <section className="as-section">
        <label htmlFor="agent-instructions" className="ark-lbl px-1">{t("persona.specialInstructions")}</label>
        <Textarea
          id="agent-instructions"
          value={customPrompt}
          onChange={(e) => updateTenantDraft({ custom_prompt: e.target.value })}
          placeholder={t("persona.specialInstructionsPlaceholder")}
          rows={4}
          className="resize-y bg-fill leading-relaxed"
        />
        <p className="px-1 text-[11.5px] text-ink-3">{t("persona.specialInstructionsHint")}</p>
      </section>

      {/* Starter questions: the same list the Widget editor edits (chat_config
          starterQuestions), which is where it is edited, next to the welcome it
          sits under and with its FAQ fallback in the live preview. Two editors
          used to disagree on the empty state ("0/6" here, "Prese dalle domande
          frequenti" there). */}
      <Group>
        <Row
          label={t("persona.startersTitle")}
          description={`${starterQuestions.length
            ? interpolate(t(starterQuestions.length === 1 ? "widget.editor.startersOne" : "widget.editor.startersMany"), { n: starterQuestions.length })
            : t(faqCount ? "widget.editor.startersFromFaq" : "widget.editor.startersDefault")} · ${interpolate(t("persona.startersWhere"), { section: t("nav.sections.widget") })}`}
        >
          <Button variant="secondary" onClick={() => navigate("widget/widget", { intent: "starters" })}>
            {interpolate(t("persona.startersEdit"), { section: t("nav.sections.widget") })}
          </Button>
        </Row>
      </Group>
    </div>
  );
}
