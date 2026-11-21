import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { useSettings } from "@/admin/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/admin/lib/api";
import { usePoll } from "@/admin/lib/poll";
import { formatDate } from "@/admin/lib/format";
import { interpolate, plural } from "@/admin/lib/i18n";
import { Group, Row, Toggle } from "@/admin/components/shared/kit";
import { Tile } from "@/admin/components/assistant/shared";
import { GoogleCalendarAppointmentCard } from "./google-calendar-appointment-card";
import {
  Mail,
  Megaphone,
  ClipboardList,
  CalendarCheck,
  Building,
  Phone,
  Headset,
  HelpCircle,
  ShoppingBag,
  Tag,
  Package,
  ShoppingCart,
  CalendarDays,
  Ticket,
  Star,
  NotepadText,
  RefreshCw,
  Check,
  AlertCircle,
  Loader2,
} from "@/components/icons";
import type { LucideIcon } from "@/components/icons";

/* ------------------------------------------------------------------ */
/*  Tool group definitions                                             */
/* ------------------------------------------------------------------ */

interface ToolDef {
  key: string;
  icon: LucideIcon;
}

interface ToolGroup {
  key: string;
  tools: ToolDef[];
}

// Labels and descriptions live in i18n under assistant.tools.<key>.
const TOOL_GROUPS: ToolGroup[] = [
  {
    key: "contacts",
    tools: [
      { key: "email_lead", icon: Mail },
      { key: "newsletter_subscribe", icon: Megaphone },
      { key: "contact_form", icon: ClipboardList },
    ],
  },
  {
    key: "bookings",
    tools: [
      { key: "appointment", icon: CalendarCheck },
      { key: "callback_request", icon: Phone },
    ],
  },
  {
    key: "support",
    tools: [
      { key: "escalate", icon: Headset },
      { key: "faq_search", icon: HelpCircle },
      { key: "business_info", icon: Building },
    ],
  },
  {
    key: "shop",
    tools: [
      { key: "product_search", icon: ShoppingBag },
      { key: "coupon_check", icon: Tag },
      { key: "order_lookup", icon: Package },
      { key: "cart_link", icon: ShoppingCart },
    ],
  },
  {
    key: "events",
    tools: [
      { key: "event_list", icon: CalendarDays },
      { key: "event_register", icon: Ticket },
    ],
  },
  {
    key: "feedback",
    tools: [
      { key: "feedback", icon: Star },
      { key: "quote_request", icon: NotepadText },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Product Sync                                                       */
/* ------------------------------------------------------------------ */

interface SyncStatus {
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_product_count: number | null;
}

/** How long a product sync is watched before the poll gives up. */
const SYNC_WATCH_MS = 30 * 60 * 1000;

function ProductSyncButton({ t }: { t: (k: string) => string }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  /** Resolves with the error when the status could not be read (the poll backs off on it). */
  const fetchStatus = useCallback(async (init: RequestInit = { cache: "reload" }): Promise<unknown> => {
    try {
      // Polled every 3s while a product sync runs, so it must bypass the cache.
      const res = await apiFetch<SyncStatus>("/product-sync-status", init);
      setStatus(res);
      if (res.last_sync_status === "syncing") setSyncing(true);
      else setSyncing(false);
      return null;
    } catch (error) {
      return error;
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Poll while syncing: paused in a hidden tab, backing off on errors and
  // 429s, and given up after SYNC_WATCH_MS (a sync stuck on "syncing" must
  // not poll forever; the button comes back and the next visit reads again).
  const syncStarted = useRef(0);
  useEffect(() => { if (syncing) syncStarted.current = Date.now(); }, [syncing]);
  usePoll(async ({ init }) => {
    if (Date.now() - syncStarted.current > SYNC_WATCH_MS) {
      setSyncing(false);
      return;
    }
    const failed = await fetchStatus(init);
    if (failed) throw failed;
  }, { enabled: syncing, intervalMs: 3000, immediate: false, path: "/product-sync-status" });

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiFetch("/product-sync", { method: "POST" });
      await fetchStatus();
    } catch {
      setSyncing(false);
    }
  };

  const syncedAt = formatDate(status?.last_sync_at ?? "") || null;

  return (
    <div className="flex flex-wrap items-center gap-3 px-1" aria-live="polite">
      <Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
        {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        {syncing
          ? (t("settings.syncingProducts") || "Sincronizzazione...")
          : (t("settings.syncProducts") || "Sincronizza prodotti")}
      </Button>
      {status?.last_sync_status === "completed" && status.last_sync_product_count != null && (
        <span className="flex items-center gap-1.5 text-xs text-ink-2">
          <Check className="size-3.5 text-accent" aria-hidden="true" />
          <span>{status.last_sync_product_count} {t("settings.productsSynced") || "prodotti indicizzati"}</span>
          {syncedAt && <span className="text-ink-3">({syncedAt})</span>}
        </span>
      )}
      {status?.last_sync_status === "failed" && (
        <span className="flex items-center gap-1.5 text-xs text-tone-red">
          <AlertCircle className="size-3.5" aria-hidden="true" />
          <span>{t("settings.syncFailed") || "Sincronizzazione fallita"}</span>
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * What the assistant can do for visitors: one tile per tool, grouped, each
 * with its switch. A tool counts as enabled unless it is explicitly `false`.
 * Settings that configure a tool sit right under its group.
 */
export function ToolSettingsSection({ calendarRequest = 0 }: { calendarRequest?: number } = {}) {
  const { t, settings, lang } = useApp();
  const { updateTenantDraft } = useSettings();
  const calendarRef = useRef<HTMLDivElement>(null);

  const tenant = (settings.tenant_settings || {}) as Record<string, unknown>;
  const enabledTools = (tenant.enabled_tools || {}) as Record<string, boolean>;
  const followupsEnabled = Boolean(tenant.followups_enabled ?? true);
  const appointmentRequirePhone = Boolean(tenant.appointment_require_phone);

  const isOn = (key: string) => enabledTools[key] !== false;
  const total = TOOL_GROUPS.reduce((n, g) => n + g.tools.length, 0);
  const activeCount = TOOL_GROUPS.reduce((n, g) => n + g.tools.filter((tool) => isOn(tool.key)).length, 0);

  // "google-calendar" intent (Oggi > Collega Google Calendar): bring the
  // connection into view and focus its action once the card has loaded. The
  // card only exists while Appuntamenti is on; otherwise point at that switch.
  useEffect(() => {
    if (!calendarRequest) return;
    if (!isOn("appointment")) {
      const toggle = document.getElementById("ar-tool-appointment");
      toggle?.scrollIntoView({ block: "center", behavior: "smooth" });
      toggle?.focus({ preventScroll: true });
      toast(t("assistant.carattere.calendarNeedsAppointments"));
      return;
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      const box = calendarRef.current;
      const action = box?.querySelector<HTMLButtonElement>("button:not(:disabled)");
      if (box && (action || tries > 30)) {
        window.clearInterval(timer);
        box.scrollIntoView({ block: "center", behavior: "smooth" });
        action?.focus({ preventScroll: true });
      }
      tries += 1;
    }, 100);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarRequest]);

  function handleToggle(toolKey: string, newValue: boolean) {
    updateTenantDraft({
      enabled_tools: { ...enabledTools, [toolKey]: newValue },
    });
  }

  return (
    <section className="as-section" aria-labelledby="as-tools-title">
      <div className="as-section-head">
        <h2 id="as-tools-title" className="ark-lbl px-1">{t("assistant.carattere.toolsTitle")}</h2>
        <span className="as-spacer" />
        <span className="as-faint as-num text-xs">
          {plural(t, "assistant.carattere.toolsActiveOne", "assistant.carattere.toolsActive", activeCount, { total })}
        </span>
      </div>

      {TOOL_GROUPS.map((group) => (
        <div key={group.key} className="flex flex-col gap-2">
          <h3 className="as-subgroup-label">{t(`assistant.tools.group.${group.key}`)}</h3>
          <div className="as-grid4">
            {group.tools.map((tool) => {
              const on = isOn(tool.key);
              const id = `ar-tool-${tool.key}`;
              const label = t(`assistant.tools.${tool.key}.label`);
              return (
                <Tile
                  key={tool.key}
                  icon={tool.icon}
                  className="as-tool"
                  data-on={on || undefined}
                  status={
                    <Toggle id={id} checked={on} onCheckedChange={(v) => handleToggle(tool.key, v)} aria-label={label} />
                  }
                  title={<label htmlFor={id} className="cursor-pointer">{label}</label>}
                  sub={t(`assistant.tools.${tool.key}.desc`)}
                >
                  {/* Appointment behavior (moved from Advanced: it configures the appointment tool) */}
                  {tool.key === "appointment" && on && (
                    <span className="as-tool-extra">
                      <span className="as-tool-extra-row">
                        <label htmlFor="ar-appointment-phone">{t("labels.appointmentPhoneRequired")}</label>
                        <Toggle
                          id="ar-appointment-phone"
                          checked={appointmentRequirePhone}
                          onCheckedChange={(v) => updateTenantDraft({ appointment_require_phone: v })}
                        />
                      </span>
                    </span>
                  )}
                </Tile>
              );
            })}
          </div>
          {group.key === "bookings" && isOn("appointment") && (
            <div className="as-tool-wide" ref={calendarRef}>
              <GoogleCalendarAppointmentCard locale={lang === "en" ? "en" : "it"} />
            </div>
          )}
          {group.key === "shop" && isOn("product_search") && <ProductSyncButton t={t} />}
        </div>
      ))}

      <Group>
        <Row
          label={t("settings.followupSuggestions") || "Suggerimenti Follow-up"}
          description={t("settings.followupDesc")}
          htmlFor="ar-followups"
        >
          <Toggle
            id="ar-followups"
            checked={followupsEnabled}
            onCheckedChange={(v) => updateTenantDraft({ followups_enabled: v })}
          />
        </Row>
      </Group>
    </section>
  );
}
