import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useSettings } from "@/admin/hooks/use-settings";
import { useCheckedField } from "@/admin/hooks/use-checked-field";
import { isEmail, webhookUrlProblem } from "@/admin/lib/validate";
import { apiFetch, saveErrorText } from "@/admin/lib/api";
import { interpolate } from "@/admin/lib/i18n";
import { useNavigate } from "@/admin/lib/nav-context";
import { useUnsavedChanges } from "@/admin/lib/leave-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Check, Loader2 } from "@/components/icons";
import { PageHead, Group, Row, Status, IconButton } from "@/admin/components/shared/kit";
import { WooCommerceRow } from "./woocommerce-row";
import "./impostazioni.css";

/**
 * A row that shows a value and turns into a field when its pencil is pressed.
 * Fatto and Enter save; the row shows the new value (and "Attivo") only once
 * the server has it. A value that fails `check`, or a save that fails, keeps
 * the field open with the reason; Escape goes back to the saved value.
 */
function EditableRow({
  id,
  label,
  value,
  empty,
  status,
  type,
  placeholder,
  help,
  check,
  onSave,
}: {
  id: string;
  label: string;
  value: string;
  empty: string;
  status?: ReactNode;
  type: "email" | "url";
  placeholder: string;
  help: string;
  check: (value: string) => string | null;
  onSave: (value: string) => Promise<unknown>;
}) {
  const { t } = useApp();
  const [editing, setEditing] = useState(false);
  const field = useCheckedField(value, check, onSave, (error) => saveErrorText(error, t("advancedPage.notSaved")));
  // Saved only on Fatto/Enter: leaving with typed text asks first.
  useUnsavedChanges({ unsaved: editing && field.draft.trim() !== value.trim(), pending: field.saving });
  const done = async () => {
    if (field.saving) return;
    if (await field.save()) setEditing(false);
  };
  if (editing) {
    return (
      <div className="ark-row ars-row-stack">
        <label htmlFor={id} className="ark-row-label">{label}</label>
        <div className="flex w-full items-center gap-2">
          <Input
            id={id}
            type={type}
            autoFocus
            {...field.inputProps}
            readOnly={field.saving}
            onKeyDown={(e) => {
              if (e.key === "Enter") void done();
              if (e.key === "Escape" && !field.saving) { field.reset(); setEditing(false); }
            }}
            placeholder={placeholder}
          />
          <IconButton icon={field.saving ? Loader2 : Check} label={t("notifRules.done")} disabled={field.saving} onClick={() => void done()} />
        </div>
        {field.visibleError
          ? <small id={field.errorId} className="ar-field-error" role="alert">{field.visibleError}</small>
          : <small className="ark-row-desc">{help}</small>}
      </div>
    );
  }
  return (
    <Row label={label} description={value || empty}>
      <div className="ars-ctl">
        {status}
        <IconButton icon={Pencil} size="sm" label={interpolate(t("advancedPage.edit"), { what: label })} onClick={() => setEditing(true)} />
      </div>
    </Row>
  );
}

/**
 * Avanzate: what only whoever runs the site or its integrations needs. Two
 * columns of groups; the destructive actions sit apart on a red-soft fill.
 */
export function AdvancedSection({ footer }: { footer?: ReactNode }) {
  const { t, setOnboardingStep, setOnboardingCompleted, resetTutorialSections, settings } = useApp();
  const { commitTenantSettings } = useSettings();
  const navigate = useNavigate();
  const [restarting, setRestarting] = useState(false);
  const tenant = (settings.tenant_settings || {}) as Record<string, unknown>;
  const escalationEmail = String(tenant.escalation_email ?? "");
  const escalationWebhook = String(tenant.escalation_webhook ?? "");

  const restartOnboarding = async () => {
    setRestarting(true);
    try {
      await apiFetch("/settings", {
        method: "POST",
        body: JSON.stringify({ onboarding_step: 1, onboarding_completed: false }),
      });
      setOnboardingStep(1);
      setOnboardingCompleted(false);
      toast.success(t("advanced.onboardingRestarted"));
    } catch {
      toast.error(t("toast.settingsFailed"));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="ars-page">
      <PageHead title={t("nav.leaves.impostazioni.avanzate")} subtitle={t("advancedPage.subtitle")} />

      <div className="ars-cols">
        <div className="ars-col">
          <Group label={t("advancedPage.handoffGroup")}>
            <EditableRow
              id="ar-escalation-email"
              label={t("labels.escalationEmail")}
              value={escalationEmail}
              empty={t("advancedPage.notSet")}
              type="email"
              placeholder={t("placeholders.escalationEmail")}
              help={t("advanced.helpEscalationEmail")}
              check={(v) => (!v.trim() || isEmail(v) ? null : t("validation.email"))}
              onSave={(v) => commitTenantSettings({ escalation_email: v })}
            />
            <EditableRow
              id="ar-escalation-webhook"
              label={t("labels.escalationWebhook")}
              value={escalationWebhook}
              empty={t("advancedPage.notSet")}
              status={escalationWebhook.trim() ? <Status tone="accent">{t("advancedPage.active")}</Status> : undefined}
              type="url"
              placeholder="https://hooks.example.com/..."
              help={t("advanced.helpEscalationWebhook")}
              check={(v) => {
                const problem = v.trim() ? webhookUrlProblem(v) : null;
                return problem === "private" ? t("validation.webhookPrivate") : problem ? t("validation.webhookFormat") : null;
              }}
              onSave={(v) => commitTenantSettings({ escalation_webhook: v })}
            />
          </Group>

          <Group label={t("advancedPage.integrationsGroup")}>
            <Row label="Google Calendar" description={t("advancedPage.calendarDesc")}>
              <Button variant="secondary" onClick={() => navigate("assistente/carattere")}>{t("privacyPage.open")}</Button>
            </Row>
            <WooCommerceRow />
          </Group>
        </div>

        <div className="ars-col">
          <Group label={t("advancedPage.guidesGroup")}>
            <div data-tour="replay-tutorial">
              <Row label={t("advancedPage.replayTitle")} description={t("tutorial.replayDesc")}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    // Clears all seen sections: the settings tour restarts right
                    // away (TutorialManager reacts), the others on next visit.
                    resetTutorialSections();
                    toast.success(t("tutorial.replayReset"));
                  }}
                >
                  {t("tutorial.replayButton")}
                </Button>
              </Row>
            </div>
          </Group>

          <Group label={t("advancedPage.dangerGroup")} className="ars-danger">
            <Row label={t("advanced.restartOnboarding")} description={t("advancedPage.restartDesc")}>
              <Button variant="secondary" disabled={restarting} onClick={() => void restartOnboarding()}>
                {restarting ? t("common.saving") : t("advancedPage.restart")}
              </Button>
            </Row>
          </Group>
        </div>
      </div>

      {footer}
    </div>
  );
}
