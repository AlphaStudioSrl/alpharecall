import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/admin/lib/utils";
import { ArrowRight, Loader2, ExternalLink, CheckCircle2, AlertCircle } from "@/components/icons";
import { useApp } from "@/admin/app-context";
import { apiFetch } from "@/admin/lib/api";
import { publishPlanUsage } from "@/admin/lib/plan-usage";
import { formatDate } from "@/admin/lib/format";
import { interpolate, plural } from "@/admin/lib/i18n";
import { toast } from "sonner";
import { PageHead, Tag, Group, Row } from "@/admin/components/shared/kit";
import { pricingQuotaCopy } from "./pricing-copy";
import "../settings/impostazioni.css";

function isSafeUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password &&
      (!parsed.port || parsed.port === "443") &&
      (parsed.hostname === "polar.sh" || parsed.hostname.endsWith(".polar.sh"));
  } catch {
    return false;
  }
}

type PricingPlan = {
  name: string;
  tier: string;
  tagline: string;
  price: string;
  priceNote?: string;
  period: string;
  highlight?: string;
  features: string[];
  recommended: boolean;
};

type BillingPlan = {
  tier: string;
  product_id?: string;
  price: number;
  price_cents?: number;
  currency: string;
  messages: number;
  available: boolean;
  billing_interval?: string | null;
};

type BillingPlansResponse = {
  plans: BillingPlan[];
  polar_configured: boolean;
  environment?: string;
};

type CheckoutResponse = {
  id: string;
  url: string;
};

type PortalResponse = {
  url: string;
};

type Subscription = {
  tier: string;
  // Newer backends resolve expired/future licenses before exposing this tier.
  effective_tier?: string;
  status: string;
  billing_interval?: string | null;
  has_subscription?: boolean;
  has_customer?: boolean;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  trial_end: string | null;
  trial_expired: boolean;
  polar_configured: boolean;
  environment?: string;
  dispute_hold?: boolean;
  /** A failed renewal still covered by the grace days (POLAR_PAYMENT_GRACE_DAYS): when the plan is lost. */
  payment_failed?: boolean;
  payment_grace_until?: string | null;
  pending_update?: { plan: string; billing_interval: string; applies_at: string } | null;
};

type OrderRow = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  refunded_amount?: number;
  refunded_tax_amount?: number;
};

const TIER_ORDER = ["free", "pro", "business", "enterprise"];

export function UpgradePage() {
  const { upgradeUrl, t, lang, settings: appSettings, licenseTier, refreshLicenseTier } = useApp();
  const quotaCopy = pricingQuotaCopy[lang];

  const [polarConfigured, setPolarConfigured] = useState(false);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [showBillingSuccess, setShowBillingSuccess] = useState(false);

  // Subscription + orders state
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loadingSub, setLoadingSub] = useState(true);
  const [subError, setSubError] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [changePlanLoading, setChangePlanLoading] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const initializedInterval = useRef(false);
  const billingStateVersion = useRef(0);
  const checkoutRequests = useRef<Record<string, string>>({});
  const [confirmPlan, setConfirmPlan] = useState<string | null>(null);
  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [checkoutNotice, setCheckoutNotice] = useState(false);
  const requestScope = `${window.location.pathname}:${appSettings?.tenant_id || "site"}`;
  const operationId = useCallback((kind: string, plan: string, interval: string, clear = false) => {
    const key = `ar-billing:${requestScope}:${kind}:${plan}:${interval}`;
    if (clear) {
      delete checkoutRequests.current[key];
      try { sessionStorage.removeItem(key); } catch { /* unavailable storage */ }
      return "";
    }
    if (!checkoutRequests.current[key]) {
      try { checkoutRequests.current[key] = sessionStorage.getItem(key) || ""; } catch { /* use memory */ }
      checkoutRequests.current[key] ||= crypto.randomUUID();
      try { sessionStorage.setItem(key, checkoutRequests.current[key]); } catch { /* use memory */ }
    }
    return checkoutRequests.current[key];
  }, [requestScope]);

  // Fallback form state (when Polar is not configured)
  const [showForm, setShowForm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("");
  const [form, setForm] = useState({ company: "", name: "", email: "", phone: "", notes: "" });
  const [sending, setSending] = useState(false);

  // A redirect is not payment proof. Ask the backend to verify checkout ownership
  // and canonical subscription state before showing a successful purchase.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkoutId = params.get("checkout_id");
    if (params.get("billing") !== "success" || !checkoutId) return;
    let stopped = false;
    setConfirmingCheckout(true);
    void (async () => {
      try {
        for (let attempt = 0; attempt < 10 && !stopped; attempt++) {
          const result = await apiFetch<{ confirmed: boolean; status: string; subscription: Subscription }>("/billing/checkout-status", {
            method: "POST", body: JSON.stringify({ checkout_id: checkoutId }),
          });
          if (stopped) return;
          if (result.confirmed) {
            billingStateVersion.current++;
            setSub(result.subscription);
            setShowBillingSuccess(true);
            toast.success(t("billing.success"));
            const url = new URL(window.location.href);
            url.searchParams.delete("billing");
            url.searchParams.delete("checkout_id");
            window.history.replaceState(window.history.state, "", url.toString());
            return;
          }
          if (result.status === "expired") break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        if (!stopped) setCheckoutNotice(true);
      } catch {
        if (!stopped) setCheckoutNotice(true);
      } finally {
        if (!stopped) setConfirmingCheckout(false);
      }
    })();
    return () => { stopped = true; };
  }, [t]);

  const fetchSub = useCallback(async () => {
    const version = billingStateVersion.current;
    setLoadingSub(true);
    setSubError(false);
    try {
      let fresh = await apiFetch<Subscription>("/billing/subscription", { cache: "no-store" });
      if (fresh.effective_tier == null) {
        // Legacy billing returns the latest raw license (even if it has expired
        // or starts in the future). Quota uses the backend's effective_license
        // resolver, so its tier/trial state is authoritative for those servers.
        const quota = await apiFetch<{ license_tier: string; trial_expired: boolean }>("/quota");
        fresh = { ...fresh, effective_tier: quota.license_tier, trial_expired: quota.trial_expired };
      }
      if (!fresh.effective_tier || !TIER_ORDER.includes(fresh.effective_tier)) throw new Error("Invalid subscription tier");
      if (version !== billingStateVersion.current) return;
      setSub(fresh);
      if (!initializedInterval.current && (fresh.billing_interval === "month" || fresh.billing_interval === "year")) {
        initializedInterval.current = true;
        setBillingInterval(fresh.billing_interval);
      }
    } catch {
      if (version === billingStateVersion.current) {
        setSub(null);
        setSubError(true);
      }
    } finally {
      setLoadingSub(false);
    }
  }, []);

  // Fetch billing plans, subscription and orders on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<BillingPlansResponse>("/billing/plans");
        if (cancelled) return;
        setPolarConfigured(data.polar_configured);
        setBillingPlans(data.plans || []);
      } catch (err) {
        // Polar endpoints not available - fall back to contact form
        if (import.meta.env.DEV) console.warn("Billing plans fetch error:", err);
        if (!cancelled) setPolarConfigured(false);
      } finally {
        if (!cancelled) setLoadingPlans(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    fetchSub();
    apiFetch<{ orders: OrderRow[] }>("/billing/orders").then((r) => setOrders(r.orders || [])).catch(() => {});
  }, [fetchSub]);

  // The other sections gate features on the app-wide plan (licenseTier, which
  // WordPress caches for an hour and the app checks every few minutes). When
  // billing reports another plan (a confirmed checkout, a plan change, or a
  // webhook since the last check), refresh that copy too, once per plan seen.
  const syncedTier = useRef<string | null>(null);
  useEffect(() => {
    const tier = sub?.effective_tier;
    if (!tier || tier === licenseTier || syncedTier.current === tier) return;
    syncedTier.current = tier;
    // A failed or stale refresh is retried the next time billing reloads.
    void refreshLicenseTier?.().then((fresh) => { if (fresh !== tier) syncedTier.current = null; });
    // `sub` (not just its tier) so every billing reload can retry.
  }, [sub, licenseTier, refreshLicenseTier]);

  const handleCheckout = useCallback(async (tier: string) => {
    setCheckoutLoading(tier);
    try {
      // Build success URL from current admin page
      const successUrl = new URL(window.location.href);
      successUrl.searchParams.set("billing", "success");
      successUrl.searchParams.set("checkout_id", "{CHECKOUT_ID}");

      const data = await apiFetch<CheckoutResponse>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({
          plan: tier,
          billing_interval: billingInterval,
          request_id: operationId("checkout", tier, billingInterval),
          success_url: successUrl.toString(),
        }),
      });

      if (isSafeUrl(data.url)) {
        operationId("checkout", tier, billingInterval, true);
        window.location.href = data.url;
      } else {
        toast.error(t("billing.checkoutError"));
      }
    } catch (error) {
      if (error instanceof Error && "status" in error && [400, 402, 403, 422].includes(Number(error.status))) {
        operationId("checkout", tier, billingInterval, true);
      }
      toast.error(error instanceof Error ? error.message : t("billing.checkoutError"));
    } finally {
      setCheckoutLoading(null);
    }
  }, [t, billingInterval, operationId]);

  const handlePortal = useCallback(async () => {
    setPortalLoading(true);
    try {
      const data = await apiFetch<PortalResponse>("/billing/portal", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (isSafeUrl(data.url)) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      } else {
        toast.error(t("billing.portalError"));
      }
    } catch {
      toast.error(t("billing.portalError"));
    } finally {
      setPortalLoading(false);
    }
  }, [t]);

  const changePlan = async (plan: string, interval = billingInterval) => {
    setChangePlanLoading(plan);
    try {
      const res = await apiFetch<{ mode: string; url?: string }>("/billing/change-plan", {
        method: "POST",
        body: JSON.stringify({ plan, billing_interval: interval, request_id: operationId("change-plan", plan, interval) }),
      });
      if (res.mode === "checkout") {
        if (!isSafeUrl(res.url)) throw new Error("Invalid checkout URL");
        window.location.href = res.url;
        return;
      }
      toast.success(t(res.mode === "scheduled" ? "billing.planScheduled" : "billing.planChanged"));
      operationId("change-plan", plan, interval, true);
      setConfirmPlan(null);
      await fetchSub();
    } catch (error) {
      if (error instanceof Error && "status" in error && [400, 402, 403, 422].includes(Number(error.status))) {
        operationId("change-plan", plan, interval, true);
      }
      toast.error(error instanceof Error ? error.message : t("billing.changeError"));
    } finally {
      setChangePlanLoading(null);
    }
  };

  const handleReactivate = async () => {
    setReactivateLoading(true);
    try {
      await apiFetch("/billing/reactivate", { method: "POST" });
      toast.success(t("billing.reactivated"));
      await fetchSub();
    } catch {
      toast.error(t("billing.changeError"));
    } finally {
      setReactivateLoading(false);
    }
  };

  const handleCancelConfirm = async () => {
    setCancelLoading(true);
    try {
      await apiFetch("/billing/cancel", { method: "POST" });
      toast.success(t("billing.cancelSubscription"));
      setCancelDialogOpen(false);
      await fetchSub();
    } catch {
      toast.error(t("billing.changeError"));
    } finally {
      setCancelLoading(false);
    }
  };

  const handleUpgradeClick = (tier: string, planName: string) => {
    // The one-time trial is not a selectable downgrade product. Subscription
    // cancellation remains in the current plan's management controls.
    if (tier === "free") return;
    if (polarConfigured) {
      // All three paid plans (pro=Base, business=Performance, enterprise=Business) are purchasable
      if (hasSubscription) {
        setConfirmPlan(tier);
      } else {
        handleCheckout(tier);
      }
    } else {
      // Fallback: show contact form when Polar is not configured
      setSelectedPlan(planName);
      setShowForm(true);
    }
  };

  const handleSubmit = async () => {
    setSending(true);
    try {
      await apiFetch("/upgrade-request", {
        method: "POST",
        body: JSON.stringify({ ...form, plan: selectedPlan }),
      });
      toast.success(t("plans.upgradeSent"));
      setShowForm(false);
    } catch {
      window.open(upgradeUrl, "_blank");
      toast.info(t("toast.upgradeRedirected"));
    } finally {
      setSending(false);
    }
  };

  // Never derive entitlement from the WP settings' cached plan. A backend
  // effective tier also takes precedence over the raw license's status/tier.
  const activeTier = sub?.effective_tier ?? null;
  const activeTierIndex = activeTier ? TIER_ORDER.indexOf(activeTier) : -1;
  const isFreeTier = activeTier === "free";
  // Legacy responses predate the explicit flags. A paid billing period was
  // their subscription signal; an explicit backend false always wins.
  const hasSubscription = Boolean(sub && (sub.has_subscription ??
    (activeTier !== "free" && Boolean(sub.current_period_end))));
  const hasCustomer = Boolean(sub && (sub.has_customer ?? hasSubscription));
  // Polar closed the subscription after the failed payment and the grace days
  // still run: the current plan can be bought again to keep it.
  const dunningEnded = Boolean(sub?.payment_grace_until) && !hasSubscription;
  const canCancel = hasSubscription && ["active", "trialing", "past_due"].includes(sub?.status || "") && Boolean(sub?.polar_configured);
  const frequencyLabel = (interval?: string | null) => {
    if (interval === "month" || interval === "monthly") return t("billing.monthly");
    if (interval === "year" || interval === "yearly") return t("billing.yearly");
    return "";
  };
  const currentFrequency = frequencyLabel(sub?.billing_interval);

  const plans: PricingPlan[] = [
    {
      name: t("plans.free"),
      tier: "free",
      tagline: t("plans.freeTagline"),
      price: "€0",
      period: "",
      features: [quotaCopy.free.messages, t("plans.freeFeat4"), quotaCopy.free.pages, quotaCopy.free.pdf, t("plans.freeFeat2"), t("plans.freeFeat3")],
      recommended: false,
    },
    {
      name: t("plans.pro"),
      tier: "pro",
      tagline: t("plans.proTagline"),
      price: "€59",
      period: t("billing.perMonth"),
      features: [quotaCopy.pro.messages, quotaCopy.pro.pages, t("plans.baseFeat6"), quotaCopy.pro.pdf, t("plans.baseFeat2")],
      recommended: false,
    },
    {
      name: t("plans.business"),
      tier: "business",
      tagline: t("plans.businessTagline"),
      price: "€129",
      period: t("billing.perMonth"),
      features: [quotaCopy.business.messages, quotaCopy.business.pages, quotaCopy.business.pdf, t("plans.performanceFeat2"), t("plans.performanceFeat5")],
      recommended: true,
    },
    {
      name: t("plans.enterprise"),
      tier: "enterprise",
      tagline: t("plans.enterpriseTagline"),
      price: "€289",
      period: t("billing.perMonth"),
      features: [quotaCopy.enterprise.messages, quotaCopy.enterprise.pages, t("plans.businessFeat4"), t("plans.businessFeat3"), t("plans.businessFeat2"), quotaCopy.enterprise.pdf],
      recommended: false,
    },
  ];

  // Override prices from billing API if available (prefer price_cents; fall back to legacy price field)
  if (billingPlans.length > 0) {
    for (const plan of plans) {
      const bp = billingPlans.find((b) => b.tier === plan.tier && (b.billing_interval || "month") === billingInterval);
      if (bp) {
        const cents = bp.price_cents ?? bp.price;
        if (cents > 0) {
          const symbol = bp.currency === "eur" ? "€" : bp.currency === "usd" ? "$" : bp.currency.toUpperCase() + " ";
          plan.price = `${symbol}${Math.round(cents / 100)}`;
        }
        if (["year", "yearly"].includes(bp.billing_interval || "")) plan.period = t("billing.perYear");
      }
    }
  }

  // Trial days remaining
  const trialDays = sub?.tier === activeTier && sub?.trial_end && !sub.trial_expired
    ? Math.ceil((new Date(sub.trial_end).getTime() - Date.now()) / 86400000)
    : 0;
  const trialDaysRemaining = trialDays > 0 ? trialDays : null;


  // Usage meter: the messages counted against the plan (GET /quota).
  const [quota, setQuota] = useState<QuotaUsage | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<QuotaUsage>("/quota", { cache: "no-store" })
      .then((q) => {
        publishPlanUsage(q);
        if (!cancelled && typeof q?.monthly_allowance === "number") setQuota(q);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [showAllFeatures, setShowAllFeatures] = useState(false);

  const locale = lang === "en" ? "en-GB" : "it-IT";
  const longDate = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(date);
  };
  const headSubtitle = loadingSub
    ? t("messages.loading")
    : [
        activeTier ? t(`plans.${activeTier}`) : null,
        trialDaysRemaining !== null
          ? plural(t, "planPage.trialDaysOne", "planPage.trialDays", trialDaysRemaining, { days: trialDaysRemaining })
          : sub?.cancel_at_period_end && sub.current_period_end
          ? interpolate(t("planPage.endsOn"), { date: longDate(sub.current_period_end) })
          : hasSubscription && sub?.current_period_end && !sub.payment_grace_until  // the renewal just failed
          ? interpolate(t("planPage.renewsOn"), { date: longDate(sub.current_period_end) })
          : null,
      ].filter(Boolean).join(" · ");
  const lastOrder = orders[0];
  const isAnyLoading = checkoutLoading !== null || changePlanLoading !== null || cancelLoading || reactivateLoading;

  return (
    <div className="ars-page">
      <PageHead title={t("nav.leaves.impostazioni.piano")} subtitle={headSubtitle} actions={sub?.environment === "sandbox" ? <Tag tone="warn">{t("billing.sandbox")}</Tag> : undefined} />

      {(confirmingCheckout || checkoutNotice) && (
        <p role="status" className="ars-alert">
          {confirmingCheckout && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          <span>{t("billing.confirmingCheckout")}</span>
        </p>
      )}
      {sub?.dispute_hold && <p role="alert" className="ars-alert ars-alert-red"><AlertCircle aria-hidden="true" /><span>{t("billing.disputeHold")}</span></p>}
      {sub?.payment_grace_until ? (
        // Card xqi3gshxl61e: the plan stays for the grace days after a failed
        // renewal; say until when, and open the portal to change the card.
        <div role="alert" className="ars-alert ars-alert-warn" data-testid="payment-grace">
          <AlertCircle aria-hidden="true" />
          <div className="ars-alert-body">
            <p>{interpolate(t(sub.status === "past_due" ? "billing.paymentGrace" : "billing.paymentGraceEnded"), { date: longDate(sub.payment_grace_until) })}</p>
            {sub.status === "past_due" && sub.polar_configured && (
              <div>
                <Button variant="secondary" size="sm" onClick={() => void handlePortal()} disabled={portalLoading}>
                  {portalLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ExternalLink className="size-3.5" aria-hidden="true" />}
                  {t("billing.updatePaymentMethod")}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : sub?.status === "past_due" && <p role="alert" className="ars-alert ars-alert-warn"><AlertCircle aria-hidden="true" /><span>{t("billing.pastDue")}</span></p>}
      {sub?.pending_update && (
        <div role="status" className="ars-alert">
          <div className="ars-alert-body">
            <p>{t("billing.pendingPlan")
              .replace("{plan}", t(`plans.${sub.pending_update.plan}`)).replace("{date}", formatDate(sub.pending_update.applies_at))}</p>
            <div>
              <Button variant="secondary" size="sm" disabled={!!changePlanLoading || !!sub.cancel_at_period_end || !!sub.dispute_hold}
                onClick={() => activeTier && void changePlan(activeTier, sub.billing_interval === "year" ? "year" : "month")}>{t("billing.keepCurrentPlan")}</Button>
            </div>
          </div>
        </div>
      )}
      {showBillingSuccess && (
        <div className="ars-alert ars-alert-ok">
          <CheckCircle2 aria-hidden="true" />
          <span>{t("billing.success")}</span>
        </div>
      )}
      {subError && (
        <div role="alert" className="ars-alert">
          <AlertCircle aria-hidden="true" />
          <div className="ars-alert-body">
            <p>{t("billing.subscriptionLoadError")}</p>
            <div><Button variant="secondary" size="sm" onClick={() => void fetchSub()}>{t("billing.retry")}</Button></div>
          </div>
        </div>
      )}

      {quota ? (
        <UsageMeter quota={quota} trialEnd={sub?.trial_end ?? null} locale={locale} />
      ) : loadingSub ? (
        <div className="ars-skel" style={{ height: 116, borderRadius: 20 }} aria-hidden="true" />
      ) : null}

      <section className="ark-group" aria-labelledby="ar-plans-title" data-tour="upgrade-plans">
        <div className="ars-plans-head">
          <h2 id="ar-plans-title" className="ark-lbl">{t("planPage.plans")}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="ars-rule-link" aria-expanded={showAllFeatures} onClick={() => setShowAllFeatures((v) => !v)}>
              {showAllFeatures ? t("planPage.fewerFeatures") : t("planPage.allFeatures")}
            </button>
            <div className="ars-interval" role="group" aria-label={t("billing.frequency")}>
              {(["month", "year"] as const).map((interval) => (
                <button key={interval} type="button" aria-pressed={billingInterval === interval} onClick={() => setBillingInterval(interval)}>
                  {t(interval === "month" ? "billing.monthly" : "billing.yearly")}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="ark-rows ark-on-fill">
          {plans.map((plan) => {
            const isCurrentTier = activeTier === plan.tier;
            const isCurrentPurchase = isCurrentTier && !dunningEnded && (plan.tier === "free" || !sub?.billing_interval || sub.billing_interval === billingInterval);
            const isLoading = checkoutLoading === plan.tier || changePlanLoading === plan.tier;
            const planTierIndex = TIER_ORDER.indexOf(plan.tier);
            const isUpgrade = activeTier !== null && planTierIndex > activeTierIndex;
            const isDowngrade = activeTier !== null && planTierIndex < activeTierIndex;
            const trialRedeemed = plan.tier === "free" && sub !== null && (sub.trial_expired || activeTier !== "free");
            const billingPlan = billingPlans.find((entry) => entry.tier === plan.tier && (entry.billing_interval || "month") === billingInterval);
            const unavailable = polarConfigured && plan.tier !== "free" && !billingPlan?.available;
            const currentLabel = [t("plans.currentPlan"), plan.tier !== "free" && currentFrequency].filter(Boolean).join(" · ");
            // The catalogue price is not necessarily this customer's price. In
            // particular, never label a yearly subscription with a monthly price.
            const showCataloguePrice = plan.tier === "free" || Boolean(billingPlan) ||
              (!polarConfigured && billingInterval === "month");
            // Only promote the recommended plan when it is actually an upgrade
            // for this tenant: pushing "Più Popolare" with the page's primary
            // CTA at someone it would downgrade steers them the wrong way
            // (card kv0vi3acqmvz).
            const isFeatured = plan.recommended && isUpgrade;
            const ctaLabel = trialRedeemed
              ? t("billing.trialRedeemed")
              : isCurrentTier && dunningEnded
              ? t("plans.resubscribe").replace("{plan}", plan.name)
              : isCurrentPurchase
              ? currentLabel
              : plan.tier === "free"
              ? t("plans.free")
              : isDowngrade
              ? t("plans.downgradeTo").replace("{plan}", plan.name)
              : (t("plans.switchTo") || "Passa a {plan}").replace("{plan}", plan.name);
            const ctaDisabled = isCurrentPurchase || isAnyLoading || loadingPlans || loadingSub || subError || unavailable || confirmingCheckout ||
              !!sub?.dispute_hold || (hasSubscription && (!!sub?.cancel_at_period_end || !["active", "trialing"].includes(sub?.status || ""))) ||
              plan.tier === "free";
            const quiet = isCurrentPurchase || trialRedeemed || plan.tier === "free";
            const features = showAllFeatures ? plan.features : plan.features.slice(0, 4);

            return (
              <div
                key={plan.tier}
                role="region"
                aria-label={plan.name}
                data-current-plan={isCurrentTier ? "true" : undefined}
                className="ars-plan"
              >
                <div className="ars-plan-text">
                  <div className="ars-plan-name">
                    {plan.name}
                    {isCurrentTier && <Tag>{t("planPage.current")}</Tag>}
                    {isFeatured && <Tag tone="accent">{t("plans.popular")}</Tag>}
                  </div>
                  <span className="ars-plan-feat">{features.join(" · ")}</span>
                  {isCurrentTier && sub && (
                    <>
                      {trialDaysRemaining !== null && trialDaysRemaining > 0 && (
                        <span className="ars-plan-state">{plural(t, "billing.trialBannerOne", "billing.trialBanner", trialDaysRemaining, { days: trialDaysRemaining })}</span>
                      )}
                      {isFreeTier && sub.trial_expired && <span className="ars-plan-state">{t(sub.has_customer && ["canceled", "unpaid"].includes(sub.status)
                        ? "billing.subscriptionEnded" : "billing.trialEnded")}</span>}
                      {canCancel && sub.cancel_at_period_end && (
                        <span className="ars-plan-state">{sub.current_period_end
                          ? t("billing.cancelPending").replace("{date}", formatDate(sub.current_period_end))
                          : t("billing.cancellationScheduled")}</span>
                      )}
                      {canCancel && !sub.cancel_at_period_end && !sub.payment_grace_until && sub.current_period_end && trialDaysRemaining === null && (
                        <span className="ars-plan-state">{t("billing.renewsOn").replace("{date}", formatDate(sub.current_period_end))}</span>
                      )}
                      {hasCustomer && sub.polar_configured && (
                        <span className="ars-plan-links">
                          <button type="button" onClick={() => void handlePortal()} disabled={portalLoading || loadingSub}>
                            {portalLoading ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ExternalLink aria-hidden="true" />}
                            {t("billing.manageSubscription")}
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>
                <span className="ars-plan-price">
                  {showCataloguePrice ? (
                    <>
                      <b>{plan.price}</b>
                      {plan.period && <span>{plan.period}</span>}
                    </>
                  ) : (
                    <b>{currentFrequency}</b>
                  )}
                </span>
                <div className="ars-plan-cta">
                  <Button
                    variant={isFeatured || (isCurrentTier && dunningEnded) ? "default" : "secondary"}
                    className={cn(quiet && "ars-plan-cta-quiet")}
                    aria-label={isCurrentPurchase && !trialRedeemed ? `${currentLabel}: ${plan.name}` : undefined}
                    disabled={ctaDisabled}
                    onClick={() => !isCurrentPurchase && handleUpgradeClick(plan.tier, plan.name)}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        {t("billing.redirecting")}
                      </>
                    ) : loadingSub ? (
                      <><Loader2 className="size-3.5 animate-spin" />{t("messages.loading")}</>
                    ) : isCurrentTier || trialRedeemed ? (
                      ctaLabel
                    ) : unavailable ? (
                      t("billing.planUnavailable")
                    ) : (
                      <>
                        {ctaLabel}
                        {plan.tier !== "free" && <ArrowRight className="size-3.5" />}
                      </>
                    )}
                  </Button>
                  {/* Ending the whole subscription is a button of its own on the current
                      plan: as a small grey link next to the features it went unnoticed. */}
                  {isCurrentTier && sub && canCancel && (sub.cancel_at_period_end ? (
                    <Button variant="secondary" className="ars-plan-cta-end" onClick={() => void handleReactivate()} disabled={isAnyLoading || loadingSub}>
                      {reactivateLoading && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                      {t("billing.reactivate")}
                    </Button>
                  ) : (
                    <Button variant="secondary" className="ars-plan-cta-end" onClick={() => setCancelDialogOpen(true)} disabled={isAnyLoading || loadingSub}>
                      {t("billing.cancelSubscription")}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <p className="ars-faint" style={{ paddingInline: 4 }}>{t("billing.taxExcluded")}</p>
      </section>

      {/* Contact form when online payments are not configured */}
      {showForm && (
        <section className="ark-box flex flex-col gap-4" aria-labelledby="ar-upgrade-form-title">
          <div className="flex flex-col gap-1">
            <h2 id="ar-upgrade-form-title" className="text-[15px] font-semibold">{t("plans.upgradeFormTitle").replace("{plan}", selectedPlan)}</h2>
            <p className="text-sm text-muted-foreground">{t("plans.upgradeFormSubtitle")}</p>
            {!polarConfigured && !loadingPlans && <p className="text-xs text-muted-foreground">{t("billing.polarNotConfigured")}</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ar-upgrade-company">{t("labels.upgradeCompany")}</Label>
              <Input id="ar-upgrade-company" value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} placeholder={t("placeholders.upgradeCompany")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ar-upgrade-name">{t("labels.upgradeName")}</Label>
              <Input id="ar-upgrade-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder={t("placeholders.upgradeName")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ar-upgrade-email">{t("labels.upgradeEmail")} *</Label>
              <Input id="ar-upgrade-email" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder={t("placeholders.upgradeEmail")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ar-upgrade-phone">{t("labels.upgradePhone")}</Label>
              <Input id="ar-upgrade-phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder={t("placeholders.upgradePhone")} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="ar-upgrade-notes">{t("plans.upgradeFormHint")}</Label>
              <Textarea id="ar-upgrade-notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={2} placeholder={t("plans.upgradeFormHintPlaceholder")} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => void handleSubmit()} disabled={sending || !form.email}>
              {sending ? t("plans.upgradeSending") : t("plans.upgradeSubmit")}
              {!sending && <ArrowRight className="size-3.5" />}
            </Button>
            <Button variant="ghost" onClick={() => setShowForm(false)}>{t("common.cancel")}</Button>
          </div>
        </section>
      )}

      {/* Payments (only when online billing is configured) */}
      {sub?.polar_configured && (
        <Group label={t("planPage.paymentsGroup")}>
          {hasCustomer && (
            <Row label={t("planPage.paymentMethod")} description={t("planPage.paymentMethodDesc")}>
              <Button variant="secondary" onClick={() => void handlePortal()} disabled={portalLoading || loadingSub}>
                {portalLoading && <Loader2 className="size-3.5 animate-spin" />}
                {t("planPage.change")}
              </Button>
            </Row>
          )}
          <Row
            label={t("billing.invoices")}
            description={lastOrder
              ? interpolate(t("planPage.lastPayment"), { date: longDate(lastOrder.created_at), amount: `${(lastOrder.amount / 100).toFixed(2)} ${lastOrder.currency.toUpperCase()}` })
              : t("billing.noInvoices")}
          />
          {orders.length > 0 && (
            <div className="ars-orders" role="table" aria-label={t("billing.invoices")}>
              <div className="sr-only" role="row">
                <span role="columnheader">{t("billing.invoiceDate")}</span>
                <span role="columnheader">{t("billing.invoiceAmount")}</span>
                <span role="columnheader">{t("billing.invoiceStatus")}</span>
              </div>
              {orders.map((order) => (
                <div key={order.id} className="ars-order" role="row">
                  <span role="cell" className="ars-muted">{formatDate(order.created_at)}</span>
                  <span role="cell" className="text-right tabular-nums">
                    {(order.amount / 100).toFixed(2)} {order.currency.toUpperCase()}
                    {!!order.refunded_amount && <p>{t("billing.refundedAmount")}: {(((order.refunded_amount || 0) + (order.refunded_tax_amount || 0)) / 100).toFixed(2)} {order.currency.toUpperCase()}</p>}
                  </span>
                  <span role="cell">
                    <Tag tone={order.status === "paid" || order.status === "succeeded" ? "accent" : "mute"}>
                      {["paid", "refunded", "partially_refunded", "pending", "void"].includes(order.status)
                        ? t(`billing.orderStatus.${order.status}`) : order.status}
                    </Tag>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Group>
      )}

      <Dialog open={confirmPlan !== null} onOpenChange={(open) => { if (!open && !changePlanLoading) setConfirmPlan(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("billing.confirmPlanTitle")}</DialogTitle>
            <DialogDescription>{t(confirmPlan && (TIER_ORDER.indexOf(confirmPlan) < activeTierIndex ||
              (sub?.billing_interval === "year" && billingInterval === "month")) ? "billing.confirmDowngrade" : "billing.confirmUpgrade")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmPlan(null)} disabled={!!changePlanLoading}>{t("common.cancel")}</Button>
            <Button onClick={() => confirmPlan && void changePlan(confirmPlan)} disabled={!!changePlanLoading}>{t("billing.confirmPlan")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Subscription Confirm Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("billing.cancelConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("billing.cancelConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCancelDialogOpen(false)} disabled={cancelLoading}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void handleCancelConfirm()} disabled={cancelLoading}>
              {cancelLoading && <Loader2 className="size-3.5 animate-spin" />}
              {t("billing.cancelConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type QuotaUsage = {
  license_tier?: string;
  monthly_allowance?: number;
  monthly_used?: number | null;
  trial_expired?: boolean;
  quota?: { message_period?: string };
};

/**
 * Messages used against the plan, with a projection to the end of the month
 * at the current pace. The paid allowance is a UTC calendar month
 * (app.main._monthly_window); the trial allowance is for life.
 */
function UsageMeter({ quota, trialEnd, locale }: { quota: QuotaUsage; trialEnd: string | null; locale: string }) {
  const { t } = useApp();
  const allowance = Math.max(0, quota.monthly_allowance || 0);
  const used = Math.max(0, quota.monthly_used || 0);
  const lifetime = quota.quota?.message_period === "lifetime" || quota.license_tier === "free";
  // Italian CLDR leaves 4-digit numbers ungrouped ("1284"); counts read better as "1.284".
  // Older engines coerce "always" to true, which is the previous behaviour.
  const num = new Intl.NumberFormat(locale, { useGrouping: "always" } as unknown as Intl.NumberFormatOptions);
  const day = (date: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  const longDay = (date: Date) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(date);
  const pct = (n: number) => (allowance > 0 ? Math.min(100, (n / allowance) * 100) : 0);

  let tag: { tone: "warn" | "red" | "mute" | "accent"; text: string } | null = null;
  let projectedPct = 0;
  let axis: [string, string] | null = null;

  if (lifetime) {
    if (quota.trial_expired || (allowance > 0 && used >= allowance)) tag = { tone: "red", text: t("planPage.trialOver") };
    else if (trialEnd) {
      const end = new Date(trialEnd);
      if (!Number.isNaN(end.getTime())) tag = { tone: "mute", text: interpolate(t("planPage.trialUntil"), { date: longDay(end) }) };
    }
  } else {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const dayMs = 86_400_000;
    const total = (end.getTime() - start.getTime()) / dayMs;
    const elapsed = Math.max(0.5, (now.getTime() - start.getTime()) / dayMs);
    const rate = used / elapsed;
    const projected = rate * total;
    axis = [day(start), day(end)];
    if (allowance > 0 && used >= allowance) {
      tag = { tone: "red", text: interpolate(t("planPage.usedUp"), { date: longDay(end) }) };
    } else if (allowance > 0 && rate > 0 && projected > allowance) {
      const runOut = new Date(start.getTime() + (allowance / rate) * dayMs);
      tag = { tone: "warn", text: interpolate(t("planPage.runsOut"), { date: longDay(runOut) }) };
      projectedPct = 100;
    } else if (used > 0) {
      tag = { tone: "mute", text: interpolate(t("planPage.onPace"), { n: num.format(Math.round(projected)) }) };
      projectedPct = pct(projected);
    }
  }
  const usedPct = pct(used);
  const full = allowance > 0 && used >= allowance;

  return (
    <section className="ars-usage" aria-label={t("planPage.usage")}>
      <div className="ars-usage-top">
        <span className="ark-big">{num.format(used)}</span>
        <span className="ars-muted">
          {interpolate(t(lifetime ? "planPage.ofTrial" : "planPage.ofMonth"), { n: num.format(allowance) })}
        </span>
        {tag && <Tag tone={tag.tone}>{tag.text}</Tag>}
      </div>
      <div
        className="ars-meter"
        role="progressbar"
        aria-label={t("planPage.usage")}
        aria-valuemin={0}
        aria-valuemax={allowance}
        aria-valuenow={Math.min(used, allowance)}
        aria-valuetext={interpolate(t(lifetime ? "planPage.ofTrial" : "planPage.ofMonth"), { n: num.format(allowance) }).replace(/^/, `${num.format(used)} `)}
      >
        {projectedPct > usedPct && <em style={{ left: `${usedPct}%`, width: `${projectedPct - usedPct}%` }} />}
        <i className={full ? "ars-meter-full" : undefined} style={{ width: `${usedPct}%` }} />
      </div>
      {axis && (
        <div className="ars-usage-axis">
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
        </div>
      )}
    </section>
  );
}
