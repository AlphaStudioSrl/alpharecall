import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useSettings } from "@/admin/hooks/use-settings";
import { apiFetch, errorText } from "@/admin/lib/api";
import { ApiRequestError } from "@/admin/lib/rate-limit";
import { parseEmailList } from "@/admin/lib/validate";
import { interpolate } from "@/admin/lib/i18n";
import { NavLink } from "@/admin/lib/nav-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Headset,
  CalendarDays,
  Star,
  ClipboardList,
  MessageSquareText,
  MessageSquare,
  MessageCircle,
  Mail,
  MoreHorizontal,
  Loader2,
  type LucideIcon,
} from "@/components/icons";
import { Info } from "lucide-react";
import { PageHead, Group, Row, Toggle, SelectPill, IconButton, type Tone } from "@/admin/components/shared/kit";
import { saveNotificationPreferences, useNotificationPreferences, type NotificationType } from "@/admin/lib/notification-preferences";
import "./impostazioni.css";

type EmailFlag = "email_notify_appointments" | "email_notify_submissions" | "email_notify_feedback";

/**
 * One rule per event. The dashboard bell is a personal preference (/ui-prefs);
 * the email channel is a tenant setting shared by the whole team.
 */
const RULES: { type: NotificationType; icon: LucideIcon; tone: Tone; email?: EmailFlag }[] = [
  { type: "escalation", icon: Headset, tone: "warn" },
  { type: "appointment", icon: CalendarDays, tone: "info", email: "email_notify_appointments" },
  { type: "lead", icon: Star, tone: "accent" },
  { type: "submission", icon: ClipboardList, tone: "violet", email: "email_notify_submissions" },
  { type: "feedback", icon: MessageSquareText, tone: "mute", email: "email_notify_feedback" },
  { type: "chat", icon: MessageSquare, tone: "mute" },
  { type: "message", icon: MessageCircle, tone: "mute" },
];

function splitEmails(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** The reason a recipients field cannot be saved, naming the entries that are not emails. */
function recipientsError(t: (key: string) => string, value: string): string | null {
  const { invalid } = parseEmailList(value);
  return invalid.length ? interpolate(t("validation.emailList"), { list: invalid.join(", ") }) : null;
}

function MoneySettingInput({
  id,
  cents,
  onCommit,
}: {
  id: string;
  cents: unknown;
  onCommit: (cents: number) => void;
}) {
  const normalized = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  const [value, setValue] = useState((normalized / 100).toFixed(2));

  useEffect(() => {
    setValue((normalized / 100).toFixed(2));
  }, [normalized]);

  return (
    <Input
      id={id}
      type="number"
      min="0"
      step="0.01"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        const units = Number.parseFloat(value);
        onCommit(Number.isFinite(units) ? Math.max(0, Math.round(units * 100)) : 0);
      }}
    />
  );
}

/**
 * Notifiche e avvisi: every alert as a sentence ("Quando arriva una richiesta
 * avvisa te nel pannello e info@ via email"). Channels are chips that switch
 * on and off; the switch on the right turns the whole rule on or off.
 */
export function NotificationsSection() {
  const { t, settings, updateSettings } = useApp();
  // An e-mail switch or report value whose save failed goes back to the
  // stored one (card o6zjpvqxb2zl); the panel switches already do.
  const { updateTenantDraft } = useSettings({ revertOnFailure: true });
  const preferences = useNotificationPreferences();
  const [savingPrefs, setSavingPrefs] = useState(false);

  const tenant = (settings.tenant_settings || {}) as Record<string, unknown>;
  const chatbotName = String(tenant.chatbot_name || "").trim() || t("notifRules.assistant");

  const notificationEmails = String(tenant.notification_emails ?? "");
  const escalationEmail = String(tenant.escalation_email ?? "");
  const escalationWebhook = String(tenant.escalation_webhook ?? "");
  const appointmentAlerts = Boolean(tenant.appointment_alerts_enabled);
  const weeklyReportEnabled = Boolean(tenant.weekly_report_enabled);
  const configuredWeeklyRecipients = String(tenant.weekly_report_recipients ?? "");
  const weeklyReportCurrency = String(tenant.weekly_report_currency ?? "EUR");
  const [weeklyRecipients, setWeeklyRecipients] = useState(configuredWeeklyRecipients);
  const [sendingWeeklyTest, setSendingWeeklyTest] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [recipientsDraft, setRecipientsDraft] = useState(notificationEmails);
  const [recipientsChecked, setRecipientsChecked] = useState(false);
  const [recipientsSaving, setRecipientsSaving] = useState(false);
  const [recipientsFailed, setRecipientsFailed] = useState<string | null>(null);
  const recipientsInvalid = recipientsError(t, recipientsDraft);
  const [weeklyChecked, setWeeklyChecked] = useState(false);
  const weeklyInvalid = recipientsError(t, weeklyRecipients);
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    setWeeklyRecipients(configuredWeeklyRecipients);
  }, [configuredWeeklyRecipients]);

  async function setPanel(type: NotificationType, enabled: boolean) {
    setSavingPrefs(true);
    try {
      await saveNotificationPreferences({ [type]: enabled });
      toast.success(t("toast.settingsSaved"));
    } catch {
      toast.error(t("toast.settingsFailed"));
    } finally {
      setSavingPrefs(false);
    }
  }

  async function setRule(type: NotificationType, email: EmailFlag | undefined, enabled: boolean) {
    if (email) updateTenantDraft({ [email]: enabled });
    if (preferences[type] !== enabled) await setPanel(type, enabled);
  }

  async function sendWeeklyTest() {
    setSendingWeeklyTest(true);
    try {
      const saved = await apiFetch<Record<string, unknown>>("/tenant-settings", {
        method: "POST",
        body: JSON.stringify({ weekly_report_recipients: weeklyRecipients }),
      });
      updateSettings({ tenant_settings: saved });
      await apiFetch("/weekly-report/test", { method: "POST" });
      toast.success(t("settings.weeklyReportTestSent"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("settings.weeklyReportTestFailed"));
    } finally {
      setSendingWeeklyTest(false);
    }
  }

  /** Saves the weekly recipients when they changed; false (and the reason shown) when they cannot be. */
  const commitWeeklyRecipients = () => {
    if (weeklyInvalid) {
      setWeeklyChecked(true);
      return false;
    }
    const clean = parseEmailList(weeklyRecipients).emails.join(", ");
    if (clean !== splitEmails(configuredWeeklyRecipients).join(", ")) updateTenantDraft({ weekly_report_recipients: clean });
    return true;
  };

  /**
   * Saved right away, not through the autosave: the dialog closes only once
   * the server has the new list, and the rules keep showing the old one
   * until then. A refusal keeps the dialog open with the reason.
   */
  async function saveRecipients() {
    setRecipientsChecked(true);
    setRecipientsFailed(null);
    if (recipientsInvalid) return;
    const clean = parseEmailList(recipientsDraft).emails.join(", ");
    setRecipientsSaving(true);
    try {
      const saved = await apiFetch<Record<string, unknown>>("/tenant-settings", {
        method: "POST",
        body: JSON.stringify({ notification_emails: clean }),
      });
      // Only this field: a full copy would overwrite edits still waiting in the autosave.
      updateSettings({ tenant_settings: { ...settings.tenant_settings, notification_emails: String(saved?.notification_emails ?? clean) } });
      toast.success(t("toast.settingsSaved"));
      setRecipientsOpen(false);
    } catch (error) {
      // A 400 is the plugin naming the address it refused (in the admin's language).
      const reason = error instanceof ApiRequestError && error.status === 400 ? error.message : "";
      setRecipientsFailed(reason ? `${t("notifRules.recipientsSaveFailed")} ${reason}` : errorText(error, t("notifRules.recipientsSaveFailed")));
    } finally {
      setRecipientsSaving(false);
    }
  }

  const emails = splitEmails(notificationEmails);
  const recipientsLabel = emails.length === 0
    ? t("notifRules.siteAdmin")
    : emails.length === 1
    ? emails[0]
    : `${emails[0]} +${emails.length - 1}`;
  const weeklyList = splitEmails(configuredWeeklyRecipients);

  const openRecipients = () => {
    setRecipientsDraft(notificationEmails);
    setRecipientsChecked(false);
    setRecipientsFailed(null);
    setRecipientsOpen(true);
  };

  return (
    <div className="ars-page">
      <PageHead
        title={t("nav.leaves.impostazioni.notifiche")}
        subtitle={t("notifRules.subtitle")}
        actions={
          <Button variant="secondary" onClick={openRecipients}>
            <Mail className="size-4" />
            {t("notifRules.recipientsButton")}
          </Button>
        }
      />

      <div className="ars-rules" aria-busy={savingPrefs || undefined}>
        {RULES.map(({ type, icon: Icon, tone, email }) => {
          const panelOn = preferences[type];
          const emailOn = email ? Boolean(tenant[email]) : false;
          const on = panelOn || emailOn;
          const name = t(`notifications.${type}`);
          return (
            <div key={type} className="ars-rule" data-off={on ? undefined : ""} data-rule={type}>
              <Icon className={`ars-rule-icon ark-c-${tone}`} aria-hidden="true" />
              <p className="ars-rule-text">
                <span>{t("notifRules.when")}</span>
                <span className="ars-chip">{interpolate(t(`notifRules.events.${type}`), { name: chatbotName })}</span>
                <span>{t("notifRules.notify")}</span>
                <span className="ars-chip">{t("notifRules.you")}</span>
                <button
                  type="button"
                  className="ars-chip"
                  aria-pressed={panelOn}
                  disabled={savingPrefs}
                  aria-label={interpolate(t("notifRules.panelFor"), { event: name })}
                  onClick={() => void setPanel(type, !panelOn)}
                >
                  {t("notifRules.inPanel")}
                </button>
                {email && (
                  <>
                    <span>{t("notifRules.and")}</span>
                    <button type="button" className="ars-chip" onClick={openRecipients} title={notificationEmails || undefined}>
                      {recipientsLabel}
                    </button>
                    <button
                      type="button"
                      className="ars-chip"
                      aria-pressed={emailOn}
                      aria-label={interpolate(t("notifRules.emailFor"), { event: name })}
                      onClick={() => updateTenantDraft({ [email]: !emailOn })}
                    >
                      {t("notifRules.byEmail")}
                    </button>
                  </>
                )}
                {type === "escalation" && (
                  <NavLink to="impostazioni/avanzate" className="ars-rule-link">
                    {escalationEmail || escalationWebhook
                      ? interpolate(t("notifRules.escalationAlso"), { target: escalationEmail || t("notifRules.webhook") })
                      : t("notifRules.escalationSetup")}
                  </NavLink>
                )}
              </p>
              <div className="ars-rule-end">
                <Toggle
                  checked={on}
                  disabled={savingPrefs}
                  aria-label={name}
                  onCheckedChange={(v) => void setRule(type, email, v)}
                />
                {email ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton icon={MoreHorizontal} size="sm" label={interpolate(t("notifRules.moreFor"), { event: name })} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={openRecipients}>
                        <Mail className="size-4" />
                        {t("notifRules.editRecipients")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span style={{ width: 28 }} aria-hidden="true" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="ars-note"><Info aria-hidden="true" />{t("notifRules.scopeNote")}</p>

      <Group label={t("notifRules.reportsGroup")}>
        <Row
          label={t("settings.weeklyReportTitle")}
          htmlFor="ar-weekly-report"
          description={weeklyList.length
            ? interpolate(t("notifRules.weeklyTo"), { to: weeklyList.length === 1 ? weeklyList[0] : `${weeklyList[0]} +${weeklyList.length - 1}` })
            : t("notifRules.weeklyNeedsRecipients")}
        >
          <div className="ars-ctl">
            <Button variant="secondary" size="sm" onClick={() => setReportOpen(true)}>{t("notifRules.configure")}</Button>
            <Toggle
              id="ar-weekly-report"
              checked={weeklyReportEnabled}
              disabled={!weeklyReportEnabled && !weeklyRecipients.trim()}
              onCheckedChange={(v) => updateTenantDraft({ weekly_report_enabled: v })}
            />
          </div>
        </Row>
        <Row label={t("labels.appointmentAlerts")} description={t("labels.appointmentAlertsHint")} htmlFor="ar-appointment-alerts">
          <Toggle
            id="ar-appointment-alerts"
            checked={appointmentAlerts}
            onCheckedChange={(v) => updateTenantDraft({ appointment_alerts_enabled: v })}
          />
        </Row>
      </Group>

      {/* Email recipients (tenant-wide) */}
      <Dialog open={recipientsOpen} onOpenChange={(open) => { if (!recipientsSaving) setRecipientsOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("notifRules.recipientsTitle")}</DialogTitle>
            <DialogDescription>{t("settings.notificationEmailsHelp")}</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-2"
            id="ar-notification-emails-form"
            onSubmit={(event) => { event.preventDefault(); void saveRecipients(); }}
          >
            <Label htmlFor="ar-notification-emails">{t("settings.notificationEmails")}</Label>
            <Input
              id="ar-notification-emails"
              type="text"
              value={recipientsDraft}
              onChange={(e) => { setRecipientsDraft(e.target.value); setRecipientsFailed(null); }}
              onBlur={() => setRecipientsChecked(true)}
              placeholder={t("settings.notificationEmailsPlaceholder")}
              aria-invalid={recipientsChecked && recipientsInvalid ? true : undefined}
              aria-describedby={recipientsChecked && recipientsInvalid ? "ar-notification-emails-error" : undefined}
            />
            {recipientsChecked && recipientsInvalid && (
              <p id="ar-notification-emails-error" className="ar-field-error" role="alert">{recipientsInvalid}</p>
            )}
            {recipientsFailed && <p className="ar-field-error" role="alert">{recipientsFailed}</p>}
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRecipientsOpen(false)} disabled={recipientsSaving}>{t("common.cancel")}</Button>
            <Button type="submit" form="ar-notification-emails-form" disabled={recipientsSaving}>
              {recipientsSaving && <Loader2 className="size-4 animate-spin" />}
              {t("common.saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Weekly value report */}
      <Dialog
        open={reportOpen}
        onOpenChange={(open) => {
          // Closing (Escape, X, outside) saves a valid list and drops one that
          // cannot be saved, back to the stored recipients; Fatto keeps the
          // dialog open with the reason instead.
          if (!open && !commitWeeklyRecipients()) setWeeklyRecipients(configuredWeeklyRecipients);
          setWeeklyChecked(false);
          setReportOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.weeklyReportTitle")}</DialogTitle>
            <DialogDescription>{t("settings.weeklyReportDesc")} {t("settings.weeklyReportSchedule")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ar-weekly-recipients">{t("settings.weeklyReportRecipients")}</Label>
              <Input
                id="ar-weekly-recipients"
                type="text"
                value={weeklyRecipients}
                onChange={(event) => setWeeklyRecipients(event.target.value)}
                onBlur={commitWeeklyRecipients}
                placeholder={t("settings.notificationEmailsPlaceholder")}
                aria-invalid={weeklyChecked && weeklyInvalid ? true : undefined}
                aria-describedby={weeklyChecked && weeklyInvalid ? "ar-weekly-recipients-error" : undefined}
              />
              {weeklyChecked && weeklyInvalid
                ? <p id="ar-weekly-recipients-error" className="ar-field-error" role="alert">{weeklyInvalid}</p>
                : <p className="text-xs text-muted-foreground">{t("settings.weeklyReportRecipientsHelp")}</p>}
            </div>
            <div className="grid gap-1">
              <p className="text-sm font-medium">{t("settings.weeklyReportAssumptions")}</p>
              <p className="text-xs text-muted-foreground">{t("settings.weeklyReportAssumptionsHelp")}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="ar-weekly-currency">{t("settings.weeklyReportCurrency")}</Label>
                <SelectPill
                  id="ar-weekly-currency"
                  value={weeklyReportCurrency}
                  onValueChange={(value) => updateTenantDraft({ weekly_report_currency: value })}
                  options={[
                    { value: "EUR", label: "EUR (€)" },
                    { value: "USD", label: "USD ($)" },
                    { value: "GBP", label: "GBP (£)" },
                  ]}
                  className="w-full justify-between"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ar-weekly-lead">{t("settings.weeklyReportLeadValue")}</Label>
                <MoneySettingInput
                  id="ar-weekly-lead"
                  cents={tenant.weekly_report_lead_value_cents}
                  onCommit={(value) => updateTenantDraft({ weekly_report_lead_value_cents: value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ar-weekly-appointment">{t("settings.weeklyReportAppointmentValue")}</Label>
                <MoneySettingInput
                  id="ar-weekly-appointment"
                  cents={tenant.weekly_report_appointment_value_cents}
                  onCommit={(value) => updateTenantDraft({ weekly_report_appointment_value_cents: value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ar-weekly-registration">{t("settings.weeklyReportRegistrationValue")}</Label>
                <MoneySettingInput
                  id="ar-weekly-registration"
                  cents={tenant.weekly_report_registration_value_cents}
                  onCommit={(value) => updateTenantDraft({ weekly_report_registration_value_cents: value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ar-weekly-hourly">{t("settings.weeklyReportHourlyCost")}</Label>
                <MoneySettingInput
                  id="ar-weekly-hourly"
                  cents={tenant.weekly_report_hourly_cost_cents}
                  onCommit={(value) => updateTenantDraft({ weekly_report_hourly_cost_cents: value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="ar-weekly-minutes">{t("settings.weeklyReportMinutesSaved")}</Label>
                <Input
                  id="ar-weekly-minutes"
                  type="number"
                  min="0"
                  max="120"
                  step="1"
                  value={Number(tenant.weekly_report_minutes_saved_per_conversation ?? 0)}
                  onChange={(event) => updateTenantDraft({
                    weekly_report_minutes_saved_per_conversation: Math.max(0, Math.min(120, Number(event.target.value) || 0)),
                  })}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="secondary"
              disabled={!weeklyRecipients.trim() || !!weeklyInvalid || sendingWeeklyTest}
              onClick={() => void sendWeeklyTest()}
            >
              {sendingWeeklyTest && <Loader2 className="size-4 animate-spin" />}
              {t("settings.weeklyReportSendTest")}
            </Button>
            <Button
              onClick={() => {
                if (commitWeeklyRecipients()) setReportOpen(false);
              }}
            >
              {t("notifRules.done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
