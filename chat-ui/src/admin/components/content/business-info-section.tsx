import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MapPin, Phone, Mail, Loader2, Copy } from "@/components/icons";
import { useApp } from "@/admin/app-context";
import { useSettings } from "@/admin/hooks/use-settings";
import { InlineSelect } from "@/admin/components/shared/inline-select";
import { PageHead, Status } from "@/admin/components/shared/kit";
import { FALLBACK_TIMEZONE, getLocale, resetTimezoneCache } from "@/admin/lib/datetime";
import { timezoneOptions } from "@/admin/lib/timezones";
import { getConfig } from "@/admin/lib/config";
import { interpolate, named } from "@/admin/lib/i18n";
import { useUnsavedChanges } from "@/admin/lib/leave-guard";
import { assistantName } from "@/admin/components/assistant/shared";
import { isEmail, isPhone, publicLinkProblem } from "@/admin/lib/validate";

/**
 * Assistente > Dati attività: address, hours, contacts and social links.
 *
 * Structured content used by the business_info tool, saved independently
 * from site ingestion and the agent's persona. The left card shows the facts
 * the way a visitor gets them in chat; every value is edited in place on the
 * right and nothing is saved until "Salva".
 */

const WEEKDAY_KEYS = [
  { key: "mon", i18n: "conversions.monday", fallback: "Monday" },
  { key: "tue", i18n: "conversions.tuesday", fallback: "Tuesday" },
  { key: "wed", i18n: "conversions.wednesday", fallback: "Wednesday" },
  { key: "thu", i18n: "conversions.thursday", fallback: "Thursday" },
  { key: "fri", i18n: "conversions.friday", fallback: "Friday" },
  { key: "sat", i18n: "conversions.saturday", fallback: "Saturday" },
  { key: "sun", i18n: "conversions.sunday", fallback: "Sunday" },
];

const SOCIAL_PLATFORMS = [
  { key: "facebook", label: "Facebook", placeholder: "https://facebook.com/..." },
  { key: "instagram", label: "Instagram", placeholder: "https://instagram.com/..." },
  { key: "twitter", label: "X / Twitter", placeholder: "https://x.com/..." },
  { key: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/..." },
  { key: "youtube", label: "YouTube", placeholder: "https://youtube.com/..." },
  { key: "tiktok", label: "TikTok", placeholder: "https://tiktok.com/..." },
];

/* ─── Hours: free text ("9:00-13:00, 15:00-19:00") read as ranges ─── */

type Range = [number, number];

/** Minutes-from-midnight ranges in an hours string; [] when it is not a time range. */
export function parseHours(text: string): Range[] {
  const ranges: Range[] = [];
  const re = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|alle|a|to)\s*(\d{1,2})(?:[:.](\d{2}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = Number(m[1]) * 60 + Number(m[2] || 0);
    let end = Number(m[3]) * 60 + Number(m[4] || 0);
    if (end === 0) end = 24 * 60;
    if (start < 24 * 60 && end <= 24 * 60 && end > start) ranges.push([start, end]);
  }
  return ranges;
}

const hhmm = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

/** Day key and minutes of "now" in the business timezone. */
function nowIn(timezone: string): { day: string; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
    return { day: get("weekday").slice(0, 3).toLowerCase(), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  } catch {
    return null;
  }
}

/** A quiet, decorative street map behind the business pin (no real tiles). */
function MapSketch({ label }: { label: string }) {
  return (
    <div className="as-map" aria-hidden="true">
      <svg viewBox="0 0 330 120" preserveAspectRatio="none">
        <path d="M0 70 L120 40 L330 90" stroke="var(--ar-panel)" strokeWidth="10" fill="none" />
        <path d="M60 0 L150 120" stroke="var(--ar-panel)" strokeWidth="7" fill="none" />
        <path d="M230 0 L270 120" stroke="var(--ar-panel)" strokeWidth="4" fill="none" opacity="0.7" />
      </svg>
      {label && <span className="as-map-pin">{label}</span>}
    </div>
  );
}

/**
 * The tenant-settings patch for the form's values. Hours and social links go
 * as the whole object, every key present and "" for a cleared one: the
 * server replaces what it holds with it, so emptying a field clears it.
 */
export function businessPayload(values: {
  address: string;
  phone: string;
  email: string;
  mapUrl: string;
  timezone: string;
  hours: Record<string, string>;
  social: Record<string, string>;
}) {
  const whole = (keys: { key: string }[], map: Record<string, string>) =>
    keys.reduce((acc, { key }) => ({ ...acc, [key]: (map[key] || "").trim() }), {} as Record<string, string>);
  return {
    business_address: values.address.trim(),
    business_phone: values.phone.trim(),
    business_email: values.email.trim(),
    business_hours: whole(WEEKDAY_KEYS, values.hours),
    business_social_links: whole(SOCIAL_PLATFORMS, values.social),
    business_map_url: values.mapUrl.trim(),
    timezone: values.timezone,
  };
}

/** Input ids in page order, for focusing the first wrong one. */
const FIELD_ORDER = ["business-phone", "business-email", "business-map", ...SOCIAL_PLATFORMS.map((p) => `business-social-${p.key}`)];

/**
 * The reasons the form cannot be saved, by input id: the same rules as
 * Impostazioni > Avanzate (lib/validate.ts). Empty fields always pass.
 */
export function businessFieldErrors(
  values: { phone: string; email: string; mapUrl: string; social: Record<string, string> },
  t: (key: string) => string
): Record<string, string> {
  const errors: Record<string, string> = {};
  const link = (value: string) => {
    if (!value.trim()) return null;
    const problem = publicLinkProblem(value);
    return problem === "private" ? t("validation.webhookPrivate") : problem ? t("validation.webhookFormat") : null;
  };
  if (values.phone.trim() && !isPhone(values.phone)) errors["business-phone"] = t("validation.phone");
  if (values.email.trim() && !isEmail(values.email)) errors["business-email"] = t("validation.email");
  const map = link(values.mapUrl);
  if (map) errors["business-map"] = map;
  for (const platform of SOCIAL_PLATFORMS) {
    const problem = link(values.social[platform.key] || "");
    if (problem) errors[`business-social-${platform.key}`] = problem;
  }
  return errors;
}

export function BusinessInfoSection({ routed = false }: { routed?: boolean } = {}) {
  const { t, settings } = useApp();
  const { saveTenantSettings, saving, error } = useSettings();

  const ts = (settings.tenant_settings || {}) as Record<string, any>;
  const [address, setAddress] = useState(ts.business_address || "");
  const [phone, setPhone] = useState(ts.business_phone || "");
  const [email, setEmail] = useState(ts.business_email || "");
  const [mapUrl, setMapUrl] = useState(ts.business_map_url || "");
  const [timezone, setTimezone] = useState<string>(
    ts.timezone || FALLBACK_TIMEZONE
  );

  // Live preview of the chosen zone, so picking one is self-evidently right.
  const nowInTimezone = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(getLocale(), {
        timeZone: timezone,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date());
    } catch {
      return "";
    }
  }, [timezone]);

  const initHours = ts.business_hours || {};
  const [hoursMap, setHoursMap] = useState<Record<string, string>>(
    WEEKDAY_KEYS.reduce((acc, d) => ({ ...acc, [d.key]: (initHours[d.key] as string) || "" }), {} as Record<string, string>)
  );
  const updateDay = (key: string, val: string) => setHoursMap((prev) => ({ ...prev, [key]: val }));
  const copyMonday = () => setHoursMap((prev) => WEEKDAY_KEYS.reduce((acc, d) => ({ ...acc, [d.key]: prev.mon }), {} as Record<string, string>));

  const initSocial = ts.business_social_links || {};
  const [socialMap, setSocialMap] = useState<Record<string, string>>(
    SOCIAL_PLATFORMS.reduce((acc, p: { key: string }) => ({ ...acc, [p.key]: (initSocial[p.key] as string) || "" }), {} as Record<string, string>)
  );
  const updateSocial = (key: string, val: string) => setSocialMap((prev) => ({ ...prev, [key]: val }));

  // What a save would send. Comparing it with the last saved one tells
  // whether there are unsaved changes (the save bar only floats then).
  const payload = useMemo(() => businessPayload({ address, phone, email, mapUrl, timezone, hours: hoursMap, social: socialMap }),
    [address, phone, email, hoursMap, socialMap, mapUrl, timezone]);
  const snapshot = JSON.stringify(payload);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot;
  // Leaving with edits not saved asks first (top bar, menu, reload).
  useUnsavedChanges({ unsaved: dirty });

  // What cannot be saved, by input id. A field shows its reason once it was
  // left, or after a save was tried; the server refuses the same values.
  const fieldErrors = useMemo(
    () => businessFieldErrors({ phone, email, mapUrl, social: socialMap }, t),
    [phone, email, mapUrl, socialMap, t]
  );
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const invalidCount = Object.keys(fieldErrors).length;
  const errorFor = (id: string) => (attempted || touched.has(id) ? fieldErrors[id] : undefined);
  const checked = (id: string) => {
    const message = errorFor(id);
    return {
      onBlur: () => setTouched((prev) => (prev.has(id) ? prev : new Set(prev).add(id))),
      "aria-invalid": message ? true : undefined,
      "aria-describedby": message ? `${id}-error` : undefined,
    } as const;
  };
  const fieldError = (id: string) => {
    const message = errorFor(id);
    return message ? <small id={`${id}-error`} className="ar-field-error">{message}</small> : null;
  };

  const handleSave = useCallback(async () => {
    const invalid = Object.keys(fieldErrors);
    if (invalid.length) {
      setAttempted(true);
      // The first wrong field in page order, so the owner lands on it.
      const first = FIELD_ORDER.find((id) => invalid.includes(id));
      if (first) document.getElementById(first)?.focus();
      return;
    }
    const saved = await saveTenantSettings(payload, t("conversions.businessSaved") || "Business info saved.");
    // Formatters memoise the zone; drop it so the dashboard re-renders in the
    // one that was just saved instead of waiting for a reload.
    if (saved) {
      setSavedSnapshot(JSON.stringify(payload));
      // Date formatters read the boot config, while the editor reads React
      // state. Keep the persisted timezone in both until the next page load.
      const config = getConfig();
      if (config?.settings?.tenant_settings) config.settings.tenant_settings.timezone = timezone;
      resetTimezoneCache();
    }
  }, [payload, timezone, saveTenantSettings, t, fieldErrors]);

  /* ─── What the visitor's card shows, from the draft ─── */
  const profile = (settings.business_profile || {}) as Record<string, unknown>;
  const businessName = String(profile.name || profile.business_name || getConfig()?.siteName || settings.tenant_domain || "").trim();
  const name = assistantName(settings, t("assistant.common.fallbackName"));
  const parsed = useMemo(() => {
    const out: Record<string, Range[]> = {};
    for (const d of WEEKDAY_KEYS) out[d.key] = parseHours(hoursMap[d.key] || "");
    return out;
  }, [hoursMap]);
  // The week's span sets the scale of the bars, so a 9-19 day fills most of it.
  const span = useMemo(() => {
    const all = Object.values(parsed).flat();
    if (!all.length) return [8 * 60, 20 * 60] as Range;
    return [Math.min(...all.map((r) => r[0])), Math.max(...all.map((r) => r[1]))] as Range;
  }, [parsed]);

  const openState = useMemo(() => {
    const now = nowIn(timezone);
    if (!now) return null;
    const todayText = (hoursMap[now.day] || "").trim();
    const today = parsed[now.day] || [];
    if (!todayText) return { tone: "mute" as const, label: t("assistant.dati.closedToday"), detail: "" };
    if (!today.length) return { tone: "mute" as const, label: t("assistant.dati.today"), detail: todayText };
    const current = today.find(([s, e]) => now.minutes >= s && now.minutes < e);
    if (current) return { tone: "accent" as const, label: t("assistant.dati.openNow"), detail: interpolate(t("assistant.dati.closesAt"), { time: hhmm(current[1]) }) };
    const next = today.find(([s]) => s > now.minutes);
    return {
      tone: "mute" as const,
      label: t("assistant.dati.closedNow"),
      detail: next ? interpolate(t("assistant.dati.opensAt"), { time: hhmm(next[0]) }) : "",
    };
  }, [timezone, hoursMap, parsed, t]);

  const focusField = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    el?.focus();
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };

  const directions = mapUrl.trim() || address.trim();

  return (
    <form id="as-business-form" className="as-page" noValidate onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
      {routed && (
        <PageHead
          title={t("nav.leaves.assistente.dati")}
          subtitle={interpolate(t("assistant.dati.subtitle"), { name, business: businessName || t("assistant.dati.theBusiness") })}
        />
      )}
      <fieldset disabled={saving} className="as-dati min-w-0">
        {/* The business card as the visitor gets it in chat */}
        <aside className="as-card-preview" aria-label={t("assistant.dati.previewLabel")}>
          <MapSketch label={businessName} />
          <div className="flex flex-col gap-0.5">
            <span className="as-card-name px-1">{businessName || t("assistant.dati.theBusiness")}</span>
            <button type="button" className="as-card-line as-muted" onClick={() => focusField("business-address")}>
              {address.trim() || <span className="as-faint">{t("assistant.dati.addAddress")}</span>}
            </button>
          </div>
          {openState && (
            <button type="button" className="as-card-line flex flex-wrap items-center gap-x-2" onClick={() => focusField("business-hours-mon")}>
              <Status tone={openState.tone}>{openState.label}</Status>
              {openState.detail && <span className="as-faint">· {openState.detail}</span>}
            </button>
          )}
          {(phone.trim() || email.trim()) && (
            <div className="flex flex-col">
              {phone.trim() && <button type="button" className="as-card-line as-small" onClick={() => focusField("business-phone")}>{phone.trim()}</button>}
              {email.trim() && <button type="button" className="as-card-line as-small" onClick={() => focusField("business-email")}>{email.trim()}</button>}
            </div>
          )}
          <div className="as-card-actions" aria-hidden="true">
            <span data-off={phone.trim() ? undefined : ""}><Phone />{t("assistant.dati.call")}</span>
            <span data-off={directions ? undefined : ""}><MapPin />{t("assistant.dati.directions")}</span>
          </div>
          <p className="as-faint px-1 text-xs leading-relaxed">{t("assistant.dati.previewHint")}</p>
        </aside>

        <div className="flex min-w-0 flex-col gap-7">
          {/* Hours as a visual week, each day edited in place */}
          <section className="as-section" aria-labelledby="as-hours-title">
            <div className="as-section-head">
              <h2 id="as-hours-title" className="as-section-title">{t("conversions.businessHours")}</h2>
              <span className="as-spacer" />
              <Button type="button" variant="ghost" size="sm" onClick={copyMonday} disabled={!hoursMap.mon.trim()}>
                <Copy className="size-3.5" />
                {t("assistant.dati.copyMonday")}
              </Button>
            </div>
            <div className="as-hours">
              {WEEKDAY_KEYS.map((day) => {
                const ranges = parsed[day.key];
                const width = span[1] - span[0] || 1;
                return (
                  <div key={day.key} className="as-hour">
                    <Label htmlFor={`business-hours-${day.key}`}>{t(day.i18n) || day.fallback}</Label>
                    <div className="as-hour-bar" aria-hidden="true">
                      {ranges.map(([s, e], i) => (
                        <i key={i} style={{ left: `${((s - span[0]) / width) * 100}%`, width: `${((e - s) / width) * 100}%` }} />
                      ))}
                    </div>
                    <Input
                      id={`business-hours-${day.key}`}
                      aria-describedby="business-hours-hint"
                      value={hoursMap[day.key]}
                      onChange={(e) => updateDay(day.key, e.target.value)}
                      placeholder={t("conversions.closed") || "Closed"}
                    />
                  </div>
                );
              })}
            </div>
            <p id="business-hours-hint" className="as-faint px-1 text-xs">
              {t("conversions.hoursHint") || "Leave blank for closed days. Use any format."}
            </p>
            {/* Sits with the hours because it is what they are stated in, and
                it is also the clock the assistant resolves "domani" against. */}
            <div className="as-field-card mt-1">
              <span id="as-tz-label" className="as-field-label">{t("settings.timezone")}</span>
              <InlineSelect
                ariaLabel={t("settings.timezone")}
                value={timezone}
                onChange={setTimezone}
                options={timezoneOptions(timezone)}
                className="max-w-sm"
              />
              <p className="as-faint text-[11.5px]">
                {t("settings.timezoneNow").replace("{time}", nowInTimezone)} · {named(t, "settings.timezoneHint", assistantName(settings, ""))}
              </p>
            </div>
          </section>

          {/* Contacts and place */}
          <section className="as-section" aria-labelledby="as-contacts-title">
            <h2 id="as-contacts-title" className="as-section-title">{t("conversions.contactDetails") || "Contact Details"}</h2>
            <div className="as-grid2">
              <div className="as-field-card" style={{ gridColumn: "1 / -1" }}>
                <Label htmlFor="business-address" className="as-field-label flex items-center gap-1.5"><MapPin className="size-3.5" />{t("conversions.address") || "Address"}</Label>
                <Input
                  id="business-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t("placeholders.businessAddress")}
                />
              </div>
              <div className="as-field-card">
                <Label htmlFor="business-phone" className="as-field-label flex items-center gap-1.5"><Phone className="size-3.5" />{t("conversions.phone") || "Phone"}</Label>
                <Input
                  id="business-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("placeholders.businessPhone")}
                  {...checked("business-phone")}
                />
                {fieldError("business-phone")}
              </div>
              <div className="as-field-card">
                <Label htmlFor="business-email" className="as-field-label flex items-center gap-1.5"><Mail className="size-3.5" />{t("conversions.email") || "Email"}</Label>
                <Input
                  id="business-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("placeholders.businessEmail")}
                  type="email"
                  {...checked("business-email")}
                />
                {fieldError("business-email")}
              </div>
              <div className="as-field-card" style={{ gridColumn: "1 / -1" }}>
                <Label htmlFor="business-map" className="as-field-label">{t("conversions.mapUrl") || "Google Maps URL"}</Label>
                <Input id="business-map" type="url" value={mapUrl} onChange={(e) => setMapUrl(e.target.value)} placeholder="https://maps.google.com/..." {...checked("business-map")} />
                {fieldError("business-map")}
              </div>
            </div>
          </section>

          {/* Social links */}
          <section className="as-section" aria-labelledby="as-social-title">
            <h2 id="as-social-title" className="as-section-title">{t("conversions.socialLinks") || "Social Links"}</h2>
            <div className="as-grid2">
              {SOCIAL_PLATFORMS.map((platform) => (
                <div key={platform.key} className="as-field-card">
                  <Label htmlFor={`business-social-${platform.key}`} className="as-field-label">{platform.label}</Label>
                  <Input
                    id={`business-social-${platform.key}`}
                    type="url"
                    value={socialMap[platform.key]}
                    onChange={(e) => updateSocial(platform.key, e.target.value)}
                    placeholder={platform.placeholder}
                    {...checked(`business-social-${platform.key}`)}
                  />
                  {fieldError(`business-social-${platform.key}`)}
                </div>
              ))}
            </div>
          </section>

          {/* In the flow while nothing changed; floats at the bottom with unsaved changes. */}
          <div className="as-savebar" data-dirty={dirty || undefined}>
            {attempted && invalidCount > 0 ? (
              <p role="alert" className="mr-auto text-sm text-tone-red">{t("validation.fixFields")}</p>
            ) : error ? (
              <p role="alert" className="mr-auto text-sm text-tone-red">{t("toast.settingsFailed")} {error}</p>
            ) : null}
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {saving ? (t("common.saving") || "Saving...") : (t("conversions.saveBusinessInfo") || "Save Business Info")}
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
