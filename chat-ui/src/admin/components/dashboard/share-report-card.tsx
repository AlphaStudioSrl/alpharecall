import { useEffect, useState } from "react";
import { InlineSelect } from "@/admin/components/shared/inline-select";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  Trash2,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { Segmented } from "@/admin/components/shared/kit";
import {
  useReportShare,
  type CreateReportSharePayload,
} from "@/admin/hooks/use-report-share";

const PERIODS = [7, 30, 90] as const;
const EXPIRIES = [7, 30, 90, 0] as const;

/** `period` is the page's selected period: the dialog opens on it. */
export function ShareReportCard({ period = 30 }: { period?: 7 | 30 | 90 }) {
  const { t, settings, currentUser } = useApp();
  const tenantLanguage = String(settings.tenant_settings?.response_language || "").toLowerCase().startsWith("en") ? "en" : "it";
  const { status, saving, error, create, revoke } = useReportShare();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [days, setDays] = useState<7 | 30 | 90>(period);
  const [expires, setExpires] = useState<0 | 7 | 30 | 90>(30);
  const [reportLanguage, setReportLanguage] = useState<"it" | "en">(tenantLanguage);
  const [clientName, setClientName] = useState(settings.tenant_domain || "");
  const [preparedBy, setPreparedBy] = useState(currentUser.name || "");

  useEffect(() => {
    // The period follows the page, not the last link: only the other choices are kept.
    if (!status.active) return;
    setReportLanguage(status.language === "en" ? "en" : "it");
    if (status.expires_in_days === 0 || status.expires_in_days === 7 || status.expires_in_days === 90) {
      setExpires(status.expires_in_days);
    } else {
      setExpires(30);
    }
    if (status.client_name) setClientName(status.client_name);
    if (status.prepared_by) setPreparedBy(status.prepared_by);
  }, [status]);

  useEffect(() => {
    if (!status.active) setReportLanguage(tenantLanguage);
  }, [tenantLanguage, status.active]);

  const openDialog = () => {
    setDays(period);
    setOpen(true);
  };

  const submit = async () => {
    const payload: CreateReportSharePayload = {
      days,
      expires_in_days: expires,
      language: reportLanguage,
      client_name: clientName.trim() || settings.tenant_domain,
      prepared_by: preparedBy.trim(),
    };
    try {
      await create(payload);
      toast.success(t("shareReport.created"));
    } catch {
      toast.error(t("shareReport.createFailed"));
    }
  };

  const copyLink = async () => {
    if (!status.url) return;
    try {
      await navigator.clipboard.writeText(status.url);
      setCopied(true);
      toast.success(t("shareReport.copied"));
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t("shareReport.copyFailed"));
    }
  };

  const revokeLink = async () => {
    if (!window.confirm(t("shareReport.revokeConfirm"))) return;
    try {
      await revoke();
      toast.success(t("shareReport.revoked"));
    } catch {
      toast.error(t("shareReport.revokeFailed"));
    }
  };

  const openReport = (print = false) => {
    if (!status.url) return;
    const url = print ? `${status.url}${status.url.includes("?") ? "&" : "?"}print=1` : status.url;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <Button type="button" variant="secondary" onClick={openDialog} className="h-8 shrink-0 px-3 text-[12.5px]">
        <Download className="size-4" />
        {t("shareReport.share")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg overflow-x-hidden overflow-y-auto p-5 sm:p-6">
          <DialogHeader className="min-w-0 pr-8">
            <DialogTitle className="text-xl text-foreground">{t("shareReport.dialogTitle")}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">{t("shareReport.dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="mt-3 min-w-0 space-y-5">
            <div className="min-w-0">
              <p className="mb-2.5 text-sm font-semibold text-foreground">{t("shareReport.period")}</p>
              <Segmented
                aria-label={t("shareReport.period")}
                value={String(days) as "7" | "30" | "90"}
                onValueChange={(value) => setDays(Number(value) as 7 | 30 | 90)}
                options={PERIODS.map((period) => ({ value: String(period) as "7" | "30" | "90", label: `${period} ${t("shareReport.days")}` }))}
              />
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <div className="min-w-0 space-y-2 text-sm font-semibold text-foreground">
                <span>{t("shareReport.language")}</span>
                <InlineSelect
                  value={reportLanguage}
                  onChange={(value) => setReportLanguage(value === "en" ? "en" : "it")}
                  options={[
                    { value: "it", label: "Italiano" },
                    { value: "en", label: "English" },
                  ]}
                  className="h-11 rounded-lg font-medium"
                />
              </div>
              <div className="min-w-0 space-y-2 text-sm font-semibold text-foreground">
                <span>{t("shareReport.expiry")}</span>
                <InlineSelect
                  value={String(expires)}
                  onChange={(value) => setExpires(Number(value) as 0 | 7 | 30 | 90)}
                  options={EXPIRIES.map((value) => ({
                    value: String(value),
                    label: value === 0 ? t("shareReport.noExpiry") : `${value} ${t("shareReport.days")}`,
                  }))}
                  className="h-11 rounded-lg font-medium"
                />
              </div>
            </div>

            {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}

            {status.active && status.url && (
              <div className="ark-on-fill min-w-0 rounded-[14px] bg-card p-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Lock className="size-4 text-primary" />{t("shareReport.secureLink")}</p>
                {status.period_days ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {interpolate(t("shareReport.linkPeriod"), { days: String(status.period_days) })}
                  </p>
                ) : null}
                <div className="mt-2 flex min-w-0 items-center gap-2 rounded-[10px] bg-background p-1.5 pl-3">
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={status.url}>{status.url}</p>
                  <Button type="button" size="icon" variant="ghost" onClick={copyLink} className="shrink-0" aria-label={t("shareReport.copyLink")}>
                    {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Button type="button" size="sm" variant="outline" onClick={() => openReport(false)} className="min-w-0"><ExternalLink className="size-4" />{t("shareReport.open")}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => openReport(true)} className="min-w-0"><Download className="size-4" />PDF</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={revokeLink} disabled={saving} className="col-span-2 min-w-0 text-destructive hover:text-destructive sm:col-span-1"><Trash2 className="size-4" />{t("shareReport.revoke")}</Button>
                </div>
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <Button type="button" onClick={submit} disabled={saving} className="h-11 w-full text-sm font-semibold">
                {saving ? <Loader2 className="size-4 animate-spin" /> : status.active ? <RefreshCw className="size-4" /> : <ExternalLink className="size-4" />}
                {saving ? t("shareReport.generating") : status.active ? t("shareReport.regenerate") : t("shareReport.createLink")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t("shareReport.snapshotNote")}</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
