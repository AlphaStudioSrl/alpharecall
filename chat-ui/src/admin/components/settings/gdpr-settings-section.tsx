import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useSettings } from "@/admin/hooks/use-settings";
import { useCheckedField } from "@/admin/hooks/use-checked-field";
import { isWebUrl } from "@/admin/lib/validate";
import { apiFetch, saveErrorText } from "@/admin/lib/api";
import { interpolate, named } from "@/admin/lib/i18n";
import { assistantName } from "@/admin/components/assistant/shared";
import { useNavigate } from "@/admin/lib/nav-context";
import { getConfig } from "@/admin/lib/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, Check, Clock, Loader2 } from "@/components/icons";
import { PageHead, Group, Row, Toggle, SelectPill, Segmented } from "@/admin/components/shared/kit";
import "./impostazioni.css";

/* ------------------------------------------------------------------ */
/*  GdprSettingsSection                                                */
/* ------------------------------------------------------------------ */

const RETENTION_FIELDS = [
  { key: "retention_chat_messages_days", labelKey: "settings.gdpr.retentionChatMessages", fallback: "Chat messages" },
  { key: "retention_analytics_events_days", labelKey: "settings.gdpr.retentionAnalyticsEvents", fallback: "Analytics events" },
  { key: "retention_contact_submissions_days", labelKey: "settings.gdpr.retentionContactSubmissions", fallback: "Contact form submissions" },
  { key: "retention_email_leads_days", labelKey: "settings.gdpr.retentionEmailLeads", fallback: "Email leads" },
  { key: "retention_appointments_days", labelKey: "settings.gdpr.retentionAppointments", fallback: "Appointments" },
  { key: "retention_feedbacks_days", labelKey: "settings.gdpr.retentionFeedbacks", fallback: "Feedback" },
  // Files sent in chats (card 2y11k1s05mvp): kept 30 days unless changed; empty = no limit.
  { key: "retention_chat_attachments_days", labelKey: "settings.gdpr.retentionChatAttachments", fallback: "Attachments" },
] as const;

/** The API's default for an entry the settings never carried (the others have none). */
const RETENTION_DEFAULTS: Partial<Record<string, number>> = { retention_chat_attachments_days: 30 };

type RetentionKey = typeof RETENTION_FIELDS[number]["key"];

/**
 * Visitor conversations (messages and the files sent in them) are deleted after
 * 90 days at most, whatever is set here (app/conversation_retention.py): these two
 * fields accept 1 to that maximum, and empty means the maximum.
 */
export const CONVERSATION_RETENTION_DEFAULT_MAX = 90;
const CONVERSATION_KEYS: ReadonlySet<string> = new Set(["retention_chat_messages_days", "retention_chat_attachments_days"]);

export function retentionMaxFor(key: string, conversationMax: number = CONVERSATION_RETENTION_DEFAULT_MAX): number {
  return CONVERSATION_KEYS.has(key) ? conversationMax : 3650;
}

export function isValidRetentionDraftValue(raw: string, max: number = 3650): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return true;
  if (!/^\d+$/.test(trimmed)) return false;
  const value = Number(trimmed);
  return value >= 1 && value <= max;
}

export function buildRetentionPayload(
  draft: Partial<Record<RetentionKey, string>>
): Partial<Record<RetentionKey, number | null>> {
  const body: Partial<Record<RetentionKey, number | null>> = {};
  for (const { key } of RETENTION_FIELDS) {
    // An entry the draft never had is left as it is, never cleared.
    const raw = draft[key];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    body[key] = trimmed === "" ? null : Number(trimmed);
  }
  return body;
}

export function retentionDraftFromSettings(tenant: Record<string, unknown>): Record<RetentionKey, string> {
  const state = {} as Record<RetentionKey, string>;
  for (const { key } of RETENTION_FIELDS) {
    const v = tenant[key] === undefined ? RETENTION_DEFAULTS[key] : tenant[key];
    state[key] = v == null ? "" : String(v);
  }
  return state;
}

/** "365" → "12 mesi", "90" → "3 mesi", "45" → "45 giorni". */
function retentionSpan(t: (key: string) => string, days: number): string {
  if (days % 365 === 0) return interpolate(t(days === 365 ? "privacyPage.yearOne" : "privacyPage.years"), { n: days / 365 });
  if (days % 30 === 0) return interpolate(t(days === 30 ? "privacyPage.monthOne" : "privacyPage.months"), { n: days / 30 });
  return interpolate(t(days === 1 ? "privacyPage.dayOne" : "privacyPage.days"), { n: days });
}

type CheckItem = { key: string; ok: boolean; title: string; detail: string; fix?: { label: string; target: string } };

/**
 * Privacy e dati: a short automatic checklist ("Quasi a posto: 3 su 4") with
 * a fix button per gap, then every privacy setting as rows.
 */
export function GdprSettingsSection() {
  const { t, settings, updateSettings } = useApp();
  // A switch whose save failed goes back to the stored value (card o6zjpvqxb2zl).
  const { updateTenantDraft, commitTenantSettings } = useSettings({ revertOnFailure: true });
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  const tenant = (settings.tenant_settings || {}) as Record<string, unknown>;
  const chatbotName = String(tenant.chatbot_name || "").trim() || t("notifRules.assistant");
  const configuredName = assistantName(settings, "");

  // Privacy notice fields
  const privacyNoticeUrl = String(tenant.privacy_notice_url ?? "");
  const privacyPolicyVersion = String(tenant.privacy_policy_version ?? "");
  const autoRegisterWpUsers = tenant.auto_register_wp_users == null
    ? true
    : Boolean(tenant.auto_register_wp_users);
  const requireVisitorInfo = Boolean(tenant.require_visitor_info);
  const botShieldMode = tenant.bot_shield_mode === "off" || tenant.bot_shield_mode === "strict"
    ? tenant.bot_shield_mode
    : "standard";

  // Map provider
  // CARTO was replaced by the self-hosted Protomaps archive; the widget reads a
  // stored "carto" as "protomaps", so the select does too.
  const storedMapProvider = String(tenant.map_tile_provider ?? "protomaps");
  const mapTileProvider = storedMapProvider === "carto" ? "protomaps" : storedMapProvider;

  // The whole archive (app/data_export.py), for WordPress administrators only.
  const dataExportUrl = (() => { try { return getConfig()?.dataExportUrl || ""; } catch { return ""; } })();
  const retentionEnabled = tenant.retention_enabled !== false;
  const conversationMax = Number(tenant.conversation_retention_max_days) > 0
    ? Number(tenant.conversation_retention_max_days)
    : CONVERSATION_RETENTION_DEFAULT_MAX;
  const validFor = (key: RetentionKey, raw: string) => isValidRetentionDraftValue(raw, retentionMaxFor(key, conversationMax));

  // Only an http(s) page is saved: the widget links to it from the consent
  // card. Both fields save on Enter or when left, and keep the typed text
  // with the reason when the save fails; the checklist reads stored values.
  const notSaved = (error: unknown) => saveErrorText(error, t("advancedPage.notSaved"));
  const privacyUrl = useCheckedField(
    privacyNoticeUrl,
    (value) => (!value.trim() || isWebUrl(value) ? null : t("validation.webUrl")),
    (value) => commitTenantSettings({ privacy_notice_url: value || null }),
    notSaved,
  );
  const policyVersion = useCheckedField(
    privacyPolicyVersion,
    () => null,
    (value) => commitTenantSettings({ privacy_policy_version: value || null }),
    notSaved,
  );
  const saveOnEnter = (field: { save: () => Promise<boolean> }) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") void field.save();
  };

  // Retention inputs use local state — writes go to the dedicated /tenant-retention
  // endpoint (not through updateTenantDraft which strips these fields).
  const [retentionDraft, setRetentionDraft] = useState<Record<RetentionKey, string>>(
    () => retentionDraftFromSettings(tenant)
  );
  const [savedRetention, setSavedRetention] = useState<Record<RetentionKey, string>>(
    () => retentionDraftFromSettings(tenant)
  );
  const [retentionSaving, setRetentionSaving] = useState(false);
  const invalidRetentionKeys = RETENTION_FIELDS
    .filter(({ key }) => !validFor(key, retentionDraft[key]))
    .map(({ key }) => key);
  const hasInvalidRetention = invalidRetentionKeys.length > 0;
  const retentionDirty = RETENTION_FIELDS.some(({ key }) => retentionDraft[key].trim() !== savedRetention[key].trim());

  const handleRetentionInput = useCallback((key: RetentionKey, raw: string) => {
    setRetentionDraft((prev) => ({ ...prev, [key]: raw }));
  }, []);

  const saveRetention = useCallback(async () => {
    // The reason is already under the fields (role="alert"); a toast per
    // press stacked copies of it. Send the owner to the field instead.
    const firstInvalid = RETENTION_FIELDS.find(({ key }) => !validFor(key, retentionDraft[key]));
    if (firstInvalid) {
      rootRef.current?.querySelector<HTMLInputElement>(`#ar-retention-${firstInvalid.key}`)?.focus();
      return;
    }
    const body = buildRetentionPayload(retentionDraft);
    setRetentionSaving(true);
    try {
      const saved = await apiFetch<Record<string, unknown>>("/tenant-retention", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const next = retentionDraftFromSettings({ ...body, ...(saved || {}) });
      setRetentionDraft(next);
      setSavedRetention(next);
      updateSettings({ tenant_settings: { ...settings.tenant_settings, ...body, ...(saved || {}) } });
      toast.success(t("toast.settingsSaved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("toast.settingsFailed"));
    } finally {
      setRetentionSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retentionDraft, t, settings.tenant_settings, updateSettings, conversationMax]);

  /** Scrolls a field into view and focuses it (the checklist's fix buttons). */
  const focusField = (id: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`#${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus({ preventScroll: true });
  };

  // Empty means the platform maximum: chats are never kept without a limit.
  const chatDays = Math.min(Number(savedRetention.retention_chat_messages_days || conversationMax), conversationMax);
  const noticeHost = privacyNoticeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const checks: CheckItem[] = [
    {
      key: "consent",
      ok: true,
      title: t("privacyPage.checkConsent"),
      detail: interpolate(t(requireVisitorInfo ? "privacyPage.checkConsentPreChat" : "privacyPage.checkConsentJit"), { name: chatbotName }),
    },
    privacyNoticeUrl.trim()
      ? { key: "notice", ok: true, title: t("privacyPage.checkNotice"), detail: noticeHost }
      : { key: "notice", ok: false, title: t("privacyPage.checkNoticeMissing"), detail: t("privacyPage.checkNoticeMissingDetail"), fix: { label: t("privacyPage.add"), target: "ar-privacy-url" } },
    privacyPolicyVersion.trim()
      ? { key: "version", ok: true, title: t("privacyPage.checkVersion"), detail: interpolate(t("privacyPage.checkVersionDetail"), { version: privacyPolicyVersion }) }
      : { key: "version", ok: false, title: t("privacyPage.checkVersionMissing"), detail: t("privacyPage.checkVersionMissingDetail"), fix: { label: t("privacyPage.add"), target: "ar-privacy-version" } },
    chatDays > 0 && retentionEnabled
      ? { key: "retention", ok: true, title: t("privacyPage.checkRetention"), detail: interpolate(t("privacyPage.checkRetentionDetail"), { span: retentionSpan(t, chatDays) }) }
      : chatDays > 0
      ? { key: "retention", ok: false, title: t("privacyPage.checkRetention"), detail: t("settings.gdpr.retentionDisabledWarning") }
      : { key: "retention", ok: false, title: t("privacyPage.checkRetentionMissing"), detail: t("privacyPage.checkRetentionMissingDetail"), fix: { label: t("privacyPage.set"), target: "ar-retention-retention_chat_messages_days" } },
  ];
  const done = checks.filter((c) => c.ok).length;
  const headline = interpolate(
    t(done === checks.length ? "privacyPage.allSet" : done >= checks.length - 1 ? "privacyPage.almost" : "privacyPage.todo"),
    { done, total: checks.length },
  );

  const consentOptions = [
    { value: "just_in_time" as const, label: t("settings.consentModeJit") },
    { value: "pre_chat" as const, label: t("settings.consentModePreChat") },
  ];
  const botOptions = [
    { value: "standard" as const, label: t("settings.botShieldStandard"), description: t("settings.botShieldStandardDescription") },
    { value: "strict" as const, label: t("settings.botShieldStrict"), description: t("settings.botShieldStrictDescription") },
    { value: "off" as const, label: t("settings.botShieldOff"), description: t("settings.botShieldOffDescription") },
  ];

  return (
    <div className="ars-page" ref={rootRef}>
      <PageHead
        title={t("nav.leaves.impostazioni.privacy")}
        subtitle={interpolate(t("privacyPage.subtitle"), { name: chatbotName })}
      />

      <section className="ars-check" aria-labelledby="ar-privacy-check" data-tour="settings-privacy-check">
        <div className="ars-check-head">
          <h2 id="ar-privacy-check">{headline}</h2>
          <span className="ars-faint">{t("privacyPage.disclaimer")}</span>
        </div>
        <ul className="contents" role="list">
          {checks.map((item) => (
            <li key={item.key} className="ars-check-item" data-ok={item.ok || undefined}>
              {item.ok
                ? <Check className="ars-check-mark ark-c-accent" role="img" aria-label={t("privacyPage.ok")} />
                : <Clock className="ars-check-mark ark-c-warn" role="img" aria-label={t("privacyPage.missing")} />}
              <div className="ars-check-text">
                <b>{item.title}</b>
                <span>{item.detail}</span>
              </div>
              {item.fix && (
                <Button size="sm" onClick={() => focusField(item.fix!.target)}>{item.fix.label}</Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Group label={t("privacyPage.consentGroup")}>
        <Row
          label={t("settings.consentModeTitle")}
          description={requireVisitorInfo ? t("settings.consentModePreChatDescription") : named(t, "settings.consentModeJitDescription", configuredName)}
        >
          <Segmented
            aria-label={t("settings.consentModeTitle")}
            size="sm"
            value={requireVisitorInfo ? "pre_chat" : "just_in_time"}
            onValueChange={(v) => updateTenantDraft({ require_visitor_info: v === "pre_chat" })}
            options={consentOptions}
          />
        </Row>
        <Row label={t("settings.gdpr.privacyNoticeUrl")} description={t("settings.gdpr.privacyNoticeUrlHelp")} htmlFor="ar-privacy-url">
          <span className="ars-field ars-checked">
            <Input
              id="ar-privacy-url"
              type="url"
              {...privacyUrl.inputProps}
              onBlur={() => { privacyUrl.inputProps.onBlur(); void privacyUrl.save(); }}
              onKeyDown={saveOnEnter(privacyUrl)}
              placeholder="https://example.com/privacy"
            />
            {privacyUrl.visibleError && <span id={privacyUrl.errorId} className="ar-field-error" role="alert">{privacyUrl.visibleError}</span>}
          </span>
        </Row>
        <Row label={t("settings.gdpr.privacyPolicyVersion")} description={t("settings.gdpr.privacyPolicyVersionHelp")} htmlFor="ar-privacy-version">
          <span className="ars-checked ars-checked-sm">
            <Input
              id="ar-privacy-version"
              type="text"
              className="ars-field-sm"
              {...policyVersion.inputProps}
              onBlur={() => void policyVersion.save()}
              onKeyDown={saveOnEnter(policyVersion)}
              placeholder="v1.0"
            />
            {policyVersion.visibleError && <span id={policyVersion.errorId} className="ar-field-error" role="alert">{policyVersion.visibleError}</span>}
          </span>
        </Row>
        <Row label={t("settings.gdpr.autoRegisterWpUsers")} description={t("settings.gdpr.autoRegisterWpUsersHelp")} htmlFor="ar-auto-register">
          <Toggle
            id="ar-auto-register"
            checked={autoRegisterWpUsers}
            onCheckedChange={(v) => updateTenantDraft({ auto_register_wp_users: v })}
          />
        </Row>
      </Group>

      <Group
        label={t("privacyPage.retentionGroup")}
        action={
          <Button size="sm" onClick={() => void saveRetention()} disabled={retentionSaving || !retentionDirty}>
            {retentionSaving && <Loader2 className="size-3.5 animate-spin" />}
            {t("settings.gdpr.retentionSave")}
          </Button>
        }
      >
        {!retentionEnabled && (
          <div className="ars-alert ars-alert-warn" role="note">
            <AlertCircle aria-hidden="true" />
            <span>{t("settings.gdpr.retentionDisabledWarning")}</span>
          </div>
        )}
        {RETENTION_FIELDS.map(({ key, labelKey }) => {
          const invalid = invalidRetentionKeys.includes(key);
          const days = Number(retentionDraft[key]);
          const max = retentionMaxFor(key, conversationMax);
          const capped = max < 3650;
          return (
            <Row
              key={key}
              label={t(labelKey)}
              htmlFor={`ar-retention-${key}`}
              description={retentionDraft[key].trim() && !invalid && days > 0
                ? retentionSpan(t, days)
                : capped
                  ? interpolate(t("settings.gdpr.retentionConversationEmpty"), { span: retentionSpan(t, max) })
                  : t("settings.gdpr.retentionPlaceholder")}
            >
              <span className="ars-days">
                <Input
                  id={`ar-retention-${key}`}
                  type="number"
                  min={1}
                  max={max}
                  className="ars-field-sm"
                  value={retentionDraft[key]}
                  onChange={(e) => handleRetentionInput(key, e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void saveRetention(); }}
                  placeholder={capped ? String(max) : t("privacyPage.forever")}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? "retention-validation-error" : undefined}
                />
                {/* An empty field reads "Per sempre": no unit after it ("Per sempre giorni"). */}
                <span style={retentionDraft[key].trim() || capped ? undefined : { visibility: "hidden" }} aria-hidden={retentionDraft[key].trim() || capped ? undefined : true}>
                  {t(Number(retentionDraft[key]) === 1 ? "privacyPage.dayUnit" : "privacyPage.daysUnit")}
                </span>
              </span>
            </Row>
          );
        })}
        {hasInvalidRetention && (
          <p id="retention-validation-error" role="alert" className="ars-error">
            {invalidRetentionKeys.some((key) => retentionMaxFor(key, conversationMax) < 3650)
              ? interpolate(t("settings.gdpr.retentionConversationInvalid"), { max: conversationMax })
              : t("settings.gdpr.retentionInvalid")}
          </p>
        )}
        <p className="ars-role-empty">{t("settings.gdpr.retentionHelp")}</p>
        <p className="ars-role-empty" id="ar-retention-attachments-note">{t("settings.gdpr.retentionAttachmentsNote")}</p>
      </Group>

      <Group label={t("privacyPage.securityGroup")}>
        {/* Each mode trades privacy for protection differently, so all three
            descriptions stay readable before picking. Native radios: one tab
            stop, arrows move and select. */}
        <div className="ark-row ars-row-stack">
          <span id="ar-bot-shield-label" className="ark-row-label">{t("settings.botShieldTitle")}</span>
          <div role="radiogroup" aria-labelledby="ar-bot-shield-label" className="ars-choices">
            {botOptions.map((option) => (
              <label key={option.value} className="ars-choice">
                <input
                  type="radio"
                  name="ar-bot-shield-mode"
                  value={option.value}
                  checked={botShieldMode === option.value}
                  onChange={() => updateTenantDraft({ bot_shield_mode: option.value })}
                  aria-describedby={`ar-bot-shield-${option.value}`}
                />
                <span>
                  <b>{option.label}</b>
                  <small id={`ar-bot-shield-${option.value}`}>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </div>
        <Row label={t("settings.gdpr.mapTileProvider")} description={t("settings.gdpr.mapTileProviderHelp")}>
          <SelectPill
            aria-label={t("settings.gdpr.mapTileProvider")}
            value={mapTileProvider}
            onValueChange={(v) => updateTenantDraft({ map_tile_provider: v })}
            options={[
              { value: "protomaps", label: t("settings.gdpr.mapProviderProtomaps") },
              { value: "osm_selfhost", label: t("settings.gdpr.mapProviderOsmSelfhost") },
              { value: "none", label: t("settings.gdpr.mapProviderNone") },
            ]}
          />
        </Row>
      </Group>

      {dataExportUrl ? (
        <Group label={t("privacyPage.accountDataGroup")}>
          <Row label={t("privacyPage.exportAllTitle")} description={t("privacyPage.exportAllDesc")}>
            <Button variant="secondary" asChild>
              <a href={dataExportUrl} download>{t("privacyPage.exportAll")}</a>
            </Button>
          </Row>
        </Group>
      ) : null}

      <Group label={t("privacyPage.rightsGroup")}>
        <Row label={t("privacyPage.rightsTitle")} description={t("privacyPage.rightsDesc")}>
          <Button variant="secondary" onClick={() => navigate("inbox/contatti")}>{t("privacyPage.open")}</Button>
        </Row>
      </Group>
    </div>
  );
}
