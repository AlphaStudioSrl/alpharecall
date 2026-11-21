import { useEffect, useId, useState } from "react";
import { useApp } from "@/admin/app-context";
import { apiFetch } from "@/admin/lib/api";
import { cn } from "@/admin/lib/utils";
import { LabelWithHelp } from "@/admin/components/shared/help-tooltip";
import { Toggle } from "@/admin/components/shared/kit";

type WordPressRole = { slug: string; name: string };

export function WidgetVisibilityControls({ chat, onChange }: {
  chat: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { t } = useApp();
  const switchId = useId();
  const descriptionId = useId();
  const mode = String(chat.displayMode ?? "production");
  const selected = Array.isArray(chat.demoRoles) ? chat.demoRoles as string[] : ["administrator"];
  const [roles, setRoles] = useState<WordPressRole[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (mode !== "demo") return;
    let active = true;
    setFailed(false);
    void apiFetch<WordPressRole[]>("/wp-roles?include_administrator=1", { cache: "no-store" })
      .then((result) => {
        if (!Array.isArray(result)) throw new Error("Invalid roles response");
        if (active) setRoles(result);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [mode, attempt]);

  // Two rows for a kit Group: who sees the widget, then (in test mode) the roles.
  return (
    <>
      <div className="ark-row we-visibility" role="group" aria-label={t("widget.visibility")}>
        <span className="ark-row-text">
          <span className="ark-row-label">{t("widget.visibility")}</span>
          <small id={descriptionId} className="ark-row-desc">{t(mode === "demo" ? "widget.demoHelp" : "widget.productionHelp")}</small>
        </span>
        <div className="we-visibility-switch">
          <LabelWithHelp help={t("widget.productionHelp")}>
            <span className={cn(mode === "production" ? "font-medium text-ink" : "text-ink-2")}>
              {t("widget.modeProduction")}
            </span>
          </LabelWithHelp>
          <Toggle
            id={switchId}
            checked={mode === "demo"}
            onCheckedChange={(demo) => onChange({ displayMode: demo ? "demo" : "production" })}
            aria-label={t("widget.modeDemo")}
            aria-describedby={descriptionId}
          />
          <LabelWithHelp help={t("widget.demoHelp")}>
            <label htmlFor={switchId} className={cn("cursor-pointer", mode === "demo" ? "font-medium text-ink" : "text-ink-2")}>
              {t("widget.modeDemo")}
            </label>
          </LabelWithHelp>
        </div>
      </div>
      {mode === "demo" && (
        <fieldset className="ark-row we-row-stack">
          <legend className="ark-row-label we-legend">{t("widget.demoRoles")}</legend>
          <small className="ark-row-desc">{t("widget.demoRolesHelp")}</small>
          {failed ? (
            <div role="alert" className="text-sm text-ink-2">
              {t("widget.rolesFailed")}{" "}
              <button type="button" className="underline text-ink" onClick={() => setAttempt((n) => n + 1)}>{t("widget.rolesRetry")}</button>
            </div>
          ) : roles === null ? <p role="status" className="text-sm text-ink-2">{t("widget.rolesLoading")}</p> : (
            <div className="we-checks">
              {roles.map((role) => (
                <label key={role.slug} className="we-check">
                  <input type="checkbox" className="size-4" checked={selected.includes(role.slug)}
                    onChange={(event) => onChange({ demoRoles: event.target.checked ? [...selected, role.slug] : selected.filter((slug) => slug !== role.slug) })} />
                  <span className="min-w-0 break-words">{role.name}</span>
                </label>
              ))}
            </div>
          )}
          {selected.length === 0 && <p role="status" className="text-sm text-ink">{t("widget.demoNoRoles")}</p>}
        </fieldset>
      )}
    </>
  );
}
