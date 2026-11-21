import { useEffect, useRef } from "react";
import { ChevronDown, CreditCard, ExternalLink, Search } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/admin/app-context";
import { useNav, NavLink } from "@/admin/lib/nav-context";
import { interpolate, plural } from "@/admin/lib/i18n";
import { loadPlanUsage, usePlanUsage } from "@/admin/lib/plan-usage";
import { getConfig } from "@/admin/lib/config";
import { NotificationBell } from "./notification-bell";
import { BackgroundJobsIndicator } from "./background-jobs-indicator";
import { UserMenu } from "./user-menu";
import { openCommandPalette, paletteShortcutLabel } from "./frame-events";
import { fadeAttrs, useCenterCurrent, useScrollEdges } from "@/admin/components/shared/scroll-row";

/** The site's display name: WordPress title, then the business name, then the host. */
export function workspaceName(settings: { business_profile?: Record<string, unknown> }): string {
  const config = getConfig();
  const fromWp = (config?.siteName || "").trim();
  if (fromWp) return fromWp;
  const business = String(settings.business_profile?.business_name || "").trim();
  if (business) return business;
  try {
    return new URL(config?.siteUrl || "").hostname.replace(/^www\./, "");
  } catch {
    return "AlphaRecall";
  }
}

function WorkspaceMenu() {
  const { t, settings, isAdmin } = useApp();
  const { navigate } = useNav();
  const name = workspaceName(settings);
  const siteUrl = getConfig()?.siteUrl;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ar-ws" aria-label={`${t("nav.shell.workspace")}: ${name}`}>
          <span className="ar-ws-mark" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
          <span className="ar-ws-name">{name}</span>
          <ChevronDown aria-hidden="true" className="ar-ws-chevron" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="ar-menu w-56">
        {siteUrl && (
          <DropdownMenuItem asChild>
            <a href={siteUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              {t("nav.shell.visitSite")}
            </a>
          </DropdownMenuItem>
        )}
        {isAdmin && (
          <DropdownMenuItem onSelect={() => navigate("impostazioni/piano")}>
            <CreditCard aria-hidden="true" />
            {t("nav.shell.plan")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Oggi (/dashboard) and Impostazioni > Piano load the usage themselves and
 * publish it (lib/plan-usage.ts): there the chip waits for them and asks
 * /quota only if they did not. Every other section asks at once.
 */
const PUBLISHING_SECTIONS = new Set(["oggi", "impostazioni"]);
const PLAN_USAGE_FALLBACK_MS = 4000;
/** The `ar-ws` column width from which frame.css shows the numbers (keep in step with it). */
export const PLAN_NUMBERS_MIN_PX = 168;

/** "Piano {plan}" split around the name, so frame.css can drop the word "Piano" ("{plan} plan" in English). */
export function planLabelParts(template: string): [string, string] {
  const at = template.indexOf("{plan}");
  if (at < 0) return ["", ""];
  return [template.slice(0, at), template.slice(at + "{plan}".length)];
}

/**
 * The plan section in the top bar (cards crv7dc6toxav, jz1amohoh4xi): "Piano
 * Business" with the messages used against the allowance and a meter, a link
 * to Impostazioni > Piano. The name comes with the page (licenseTier); the
 * usage from whatever already loaded it (see lib/plan-usage.ts). frame.css
 * stacks the numbers under the name where the column is not wide enough for
 * one line, then drops the meter, the numbers and the word "Piano", then the
 * chip, so it never overflows the bar.
 */
export function PlanChip() {
  const { t, licenseTier, lang } = useApp();
  const { route } = useNav();
  const usage = usePlanUsage();
  const ref = useRef<HTMLAnchorElement>(null);
  const firstSection = useRef(route.section);

  useEffect(() => {
    // Not when the column has no room for the numbers (see
    // PLAN_NUMBERS_MIN_PX): no request for nothing.
    const load = () => {
      if ((ref.current?.parentElement?.clientWidth ?? 0) >= PLAN_NUMBERS_MIN_PX) void loadPlanUsage();
    };
    if (!PUBLISHING_SECTIONS.has(firstSection.current)) {
      load();
      return;
    }
    const timer = window.setTimeout(load, PLAN_USAGE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // The tier the usage was counted against when known (what Oggi's usage
  // line names too), else the one the page came with.
  const tier = usage?.tier && t(`plans.${usage.tier}`) !== `plans.${usage.tier}` ? usage.tier : licenseTier;
  const plan = t(`plans.${tier}`);
  // "Prova gratuita" is not a "Piano Prova gratuita".
  const [before, after] = tier === "free" ? ["", ""] : planLabelParts(t("nav.shell.planLabel"));
  const num = new Intl.NumberFormat(lang === "en" ? "en-GB" : "it-IT", { useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
  const ratio = usage ? usage.used / usage.allowance : 0;
  const tone = ratio >= 1 ? "red" : ratio >= 0.8 ? "warn" : undefined;
  const of = usage
    ? interpolate(t(usage.lifetime ? "nav.shell.planUsageTrial" : "nav.shell.planUsageMonth"), {
        used: num.format(usage.used),
        n: num.format(usage.allowance),
      })
    : "";
  const label = `${before}${plan}${after}`;
  return (
    <NavLink
      ref={ref}
      to="impostazioni/piano"
      className="ar-plan"
      data-tone={tone}
      aria-label={label + (of ? `, ${of}` : "")}
      title={of || undefined}
    >
      <CreditCard aria-hidden="true" />
      <span className="ar-plan-name" aria-hidden="true">
        {before && <span className="ar-plan-word">{before}</span>}
        <b>{plan}</b>
        {after && <span className="ar-plan-word">{after}</span>}
      </span>
      {usage && (
        <span className="ar-plan-use" aria-hidden="true">
          <span className="ar-plan-meter"><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></span>
          <span className="ar-plan-num">{num.format(usage.used)}/{num.format(usage.allowance)}</span>
        </span>
      )}
    </NavLink>
  );
}

/**
 * The top bar (x-top): workspace on the left, the seven sections centred,
 * search, background jobs, notifications and the account on the right. On
 * a narrow frame the sections drop to a second, horizontally scrolling row
 * whose cut-off edge fades, so a phone shows there are more sections to
 * swipe to (Statistiche and Impostazioni were off screen at 390px).
 */
export function TopBar({ inboxCount }: { inboxCount: number | null }) {
  const { t, isAdmin } = useApp();
  const { sections, route } = useNav();
  const { ref: tabsRef, el: tabs, edges } = useScrollEdges<HTMLElement>();

  // On the scrolling phone row keep the open section in view.
  useCenterCurrent(tabs, route.section);

  const shortcut = paletteShortcutLabel();

  return (
    <div className="ar-top">
      <div className="ar-top-ws">
        <WorkspaceMenu />
        {isAdmin && <PlanChip />}
      </div>
      <nav ref={tabsRef} className="ar-top-tabs scrollbar-none" aria-label={t("nav.shell.sectionsLabel")} {...fadeAttrs(edges)}>
        {sections.map((s) => {
          const on = s.id === route.section;
          const showCount = s.id === "inbox" && !!inboxCount;
          return (
            <NavLink
              key={s.id}
              to={s.id}
              className="ar-top-tab"
              aria-current={on ? "page" : undefined}
              data-tour={s.anchor}
              aria-label={showCount ? `${t(s.labelKey)}, ${plural(t, "nav.shell.inboxWaitingOne", "nav.shell.inboxWaiting", inboxCount!)}` : undefined}
            >
              {t(s.labelKey)}
              {showCount && <em aria-hidden="true">{inboxCount! > 99 ? "99+" : inboxCount}</em>}
            </NavLink>
          );
        })}
      </nav>
      <div className="ar-top-rt">
        <button
          type="button"
          className="ar-find"
          onClick={(event) => openCommandPalette(event.currentTarget)}
          aria-keyshortcuts="Control+K Meta+K"
          aria-label={t("nav.shell.search")}
        >
          <Search aria-hidden="true" />
          <span className="ar-find-label">{t("nav.shell.search")}</span>
          <kbd aria-hidden="true">{shortcut}</kbd>
        </button>
        <BackgroundJobsIndicator />
        <NotificationBell />
        <UserMenu />
      </div>
    </div>
  );
}
