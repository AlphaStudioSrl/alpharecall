"use client";

import * as React from "react";
import { useState } from "react";
import { Search, ShoppingBag } from "lucide-react";
import {
  ClarifyPrompt,
  EventCards,
  CouponResult,
  AppointmentSlots,
} from "@/components/generative-ui";
import { CardCarousel, type CarouselCard } from "@/components/generative-ui/card-carousel";
import { TableCard } from "@/components/generative-ui/table-card";
import { HandoffCard } from "@/components/generative-ui/handoff-card";
import { FeedbackReceipt } from "@/components/generative-ui/feedback-sheet";
import { InfoCard, type BusinessInfo } from "@/components/generative-ui/info-card";
import { GeoMap } from "@/components/tool-ui/geo-map";
import { MessageDraft, RequestDraft, type DraftField, type DraftSendOutcome } from "@/components/tool-ui/message-draft";
import { OrderSummary } from "@/components/tool-ui/order-summary";
import { QuestionFlow } from "@/components/tool-ui/question-flow";
import { Chart } from "@/components/tool-ui/chart";
import { StatsDisplay } from "@/components/tool-ui/stats-display";
import { ConsentCard, type ConsentRequiredComponent } from "@/components/consent-card";
import { widgetCopy } from "@/lib/widget-copy";
import { cardCopy, widgetNames } from "@/lib/card-copy";
import { sendRequestDraftDecision, type DraftDecisionResult } from "@/lib/request-draft-sender";
import { formatProductPrice, productLink } from "@/lib/product-format";
import "@/widget-cards.css";

type ToolComponent = {
  type?: string;
  tool?: string;
  title?: string;
  description?: string;
  status?: string;
  message?: string;
  items?: any[];
  fields?: any[];
};

type ToolPayload = {
  components?: unknown;
  tool_output?: unknown;
};

type Product = {
  id: string;
  title: string;
  description: string;
  price: string;
  /** The store's currency for price ("EUR"), when the source sent one. */
  currency: string;
  image: string;
  url: string;
  badge: string;
  ctaLabel: string;
};

type FormField = {
  id: string;
  type: "text" | "textarea" | "email" | "tel" | "number" | "select";
  label: string;
  placeholder?: string;
  required?: boolean;
  description?: string;
  options?: string[];
  autoComplete?: string;
};

export interface GenerativeToolRendererParams {
  toolName?: string | null;
  result?: unknown;
  onSendMessage: (message: string) => void;
  /** The newest answer in the thread, just streamed: pickers may open their sheet by themselves. */
  isLatest?: boolean;
}

const DEFAULT_MAX_PRODUCTS = 12;
const CHECKOUT_COMPONENT_TYPES = new Set(["fast_checkout", "checkout_form"]);
const PRODUCT_COMPONENT_TYPES = new Set(["product_list", "product_carousel", "product_suggestions", "products"]);
// English subjects the backend generates for its own records, never the visitor's words.
const GENERATED_SUBJECT = /^((quote|callback) request from|richiesta di (preventivo|richiamata) da)\b/i;

const isRecord = (value: unknown): value is Record<string, any> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const asArray = (value: unknown): any[] => {
  return Array.isArray(value) ? value : [];
};

const toText = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
};

const hasToolPrefix = (tool: string, prefix: string) => {
  return tool === prefix || tool.startsWith(`${prefix}_`);
};

const isEcommerceTool = (tool: string) => {
  return (
    hasToolPrefix(tool, "product_search") ||
    tool.includes("product") ||
    tool.includes("checkout")
  );
};

const isCheckoutComponentType = (type: string) => {
  return CHECKOUT_COMPONENT_TYPES.has(type) || type.includes("checkout");
};

export const extractToolNarrative = (result: unknown, toolName?: string | null) => {
  if (!isRecord(result)) return "";
  const components = asArray(result.components).filter(isRecord) as ToolComponent[];
  const toolOutput = isRecord(result.tool_output) ? result.tool_output : null;
  const tool = toText(toolName).trim().toLowerCase();

  for (const component of components) {
    const candidate = toText(component.message).trim();
    if (candidate) return candidate;
  }

  const outputMessage = toText(toolOutput?.message || toolOutput?.response || toolOutput?.summary).trim();
  if (outputMessage) return outputMessage;

  for (const component of components) {
    const description = toText(component.description).trim();
    if (description) return description;
  }

  if (tool === "product_search") {
    return widgetCopy().foundProducts;
  }
  if (hasToolPrefix(tool, "email_lead")) {
    return widgetCopy().savedContact;
  }
  if (hasToolPrefix(tool, "appointment")) {
    return widgetCopy().updatedAppointment;
  }
  if (tool === "escalate") {
    return widgetCopy().escalated;
  }

  return "";
};

const slug = (value: string, fallback: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32);
  return normalized || fallback;
};

/** The first product image (Store API `images`), thumbnail size when given. */
const firstImage = (value: unknown) => {
  for (const image of asArray(value)) {
    if (typeof image === "string" && image) return image;
    if (isRecord(image)) {
      const src = toText(image.thumbnail) || toText(image.src) || toText(image.url);
      if (src) return src;
    }
  }
  return "";
};

/** A store blurb without its HTML ("<p>Tre modalit&agrave;...</p>"). */
const plainText = (value: string) => {
  if (!/[<&]/.test(value)) return value;
  if (typeof DOMParser === "undefined") return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const doc = new DOMParser().parseFromString(value, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
};

const normalizeProduct = (item: unknown): Product => {
  const source = isRecord(item) ? item : {};
  return {
    id: toText(source.id) || toText(source.product_id) || "",
    title: toText(source.title) || toText(source.name) || toText(source.id) || widgetCopy().product,
    description: plainText(toText(source.description) || toText(source.summary) || toText(source.short_description)),
    price: toText(source.price) || toText(source.price_text) || toText(source.amount),
    currency: toText(source.currency) || toText(source.currency_code),
    image: toText(source.image) || toText(source.thumbnail) || firstImage(source.images),
    // A product result links its page on the store (`permalink`).
    url: toText(source.url) || toText(source.link) || toText(source.permalink),
    badge: toText(source.badge),
    ctaLabel: toText(source.cta_label) || toText(source.cta),
  };
};

const normalizeProductItems = (components: ToolComponent[], toolOutput: Record<string, any> | null) => {
  for (const component of components) {
    const type = toText(component.type).trim().toLowerCase();
    if (!PRODUCT_COMPONENT_TYPES.has(type)) continue;
    if (Array.isArray(component.items) && component.items.length > 0) {
      return component.items.slice(0, DEFAULT_MAX_PRODUCTS).map(normalizeProduct);
    }
  }

  if (toolOutput) {
    const fromProducts = asArray(toolOutput.products);
    if (fromProducts.length > 0) {
      return fromProducts.slice(0, DEFAULT_MAX_PRODUCTS).map(normalizeProduct);
    }
    const fromResults = asArray(toolOutput.results);
    if (fromResults.length > 0) {
      return fromResults.slice(0, DEFAULT_MAX_PRODUCTS).map(normalizeProduct);
    }
  }

  return [] as Product[];
};

const normalizeFormFields = (value: unknown): FormField[] => {
  return asArray(value)
    .map((raw, idx): FormField | null => {
      if (!isRecord(raw)) return null;
      const label = toText(raw.label || raw.name || raw.id || `Field ${idx + 1}`).trim();
      if (!label) return null;
      const sourceType = toText(raw.type || "text").toLowerCase();
      const id = slug(toText(raw.id) || label, `field-${idx + 1}`);

      const field: FormField = {
        id,
        type:
          sourceType === "textarea" ||
          sourceType === "email" ||
          sourceType === "tel" ||
          sourceType === "number" ||
          sourceType === "select"
            ? (sourceType as FormField["type"])
            : "text",
        label,
      };

      const placeholder = toText(raw.placeholder || raw.hint || "").trim();
      if (placeholder) field.placeholder = placeholder;
      if (typeof raw.required === "boolean") field.required = raw.required;
      const description = toText(raw.description || "").trim();
      if (description) field.description = description;
      const options = asArray(raw.options).map((item) => toText(item)).filter(Boolean);
      if (options.length > 0 && field.type === "select") {
        field.options = options;
      }
      const submitAutocomplete = toText(raw.autoComplete || raw.autocomplete).trim();
      if (submitAutocomplete) field.autoComplete = submitAutocomplete;

      return field;
    })
    .filter((field): field is FormField => Boolean(field));
};

const toToolComponents = (payload: ToolPayload | null): ToolComponent[] => {
  if (!payload) return [];
  return asArray(payload.components).filter(isRecord) as ToolComponent[];
};

const resolveTool = (toolName: string | null | undefined, components: ToolComponent[]) => {
  const fromProps = toText(toolName).trim();
  if (fromProps) return fromProps;
  for (const component of components) {
    const candidate = toText(component.tool).trim();
    if (candidate) return candidate;
  }
  return "tool";
};

const composeFastCheckoutMessage = (values: Record<string, string>) => {
  const entries = Object.entries(values)
    .map(([key, value]) => [key, toText(value).trim()] as const)
    .filter(([, value]) => Boolean(value));

  if (entries.length === 0) return null;

  if (entries.length === 1 && entries[0][0].toLowerCase() === "query") {
    return widgetCopy().searchFor(entries[0][1]);
  }

  const lines = entries.map(([key, value]) => `${key}: ${value}`);
  return widgetCopy().checkoutWith(lines.join("\n- "));
};

/** A short form on the card fill (product search refinement, quick checkout). */
function CardForm({ title, description, fields, submitText, icon, onSubmit }: {
  title?: string;
  description?: string;
  fields: FormField[];
  submitText: string;
  icon?: React.ReactNode;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const baseId = React.useId();
  return (
    <form
      className="ar-card ar-form-card"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
        setSent(true);
      }}
    >
      {title || description ? (
        <div className="ar-card-head">
          {icon}
          <div className="ar-card-heading">
            {title ? <h3 className="ar-card-title">{title}</h3> : null}
            {description ? <p className="ar-card-sub">{description}</p> : null}
          </div>
        </div>
      ) : null}
      {fields.map((field) => {
        const id = `${baseId}-${field.id}`;
        const common = {
          id,
          name: field.id,
          required: field.required,
          placeholder: field.placeholder,
          autoComplete: field.autoComplete,
          value: values[field.id] || "",
          onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
            setValues((v) => ({ ...v, [field.id]: event.target.value })),
        };
        return (
          <label key={field.id} className="ar-field" htmlFor={id}>
            <span className="ar-field-label">{field.label}</span>
            {field.type === "textarea" ? (
              <textarea rows={3} {...common} />
            ) : field.type === "select" ? (
              <select {...common}>
                <option value="" />
                {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            ) : (
              <input type={field.type} {...common} />
            )}
            {field.description ? <small className="ar-field-hint">{field.description}</small> : null}
          </label>
        );
      })}
      <button type="submit" className="ar-btn ar-btn--primary" disabled={sent && fields.length > 1}>{submitText}</button>
    </form>
  );
}

/** The products a search or a booking engine returned, as swipeable cards. */
function productCards(items: Product[]): CarouselCard[] {
  const copy = cardCopy();
  return items.map((p, i) => {
    const price = formatProductPrice(p.price, p.currency);
    const link = productLink(p.url);
    const label = p.ctaLabel && p.ctaLabel.length <= 18 ? p.ctaLabel : copy.open;
    return {
      id: `${p.id || i}-${p.title}`,
      title: p.title,
      sub: p.description || undefined,
      price: price || undefined,
      image: /^https?:\/\//i.test(p.image) ? p.image : undefined,
      badge: p.badge || undefined,
      // The whole card opens the product page; the chip says so. The link's
      // name starts with the chip's visible text ("Vedi ...") so a voice
      // command that reads the chip still finds the link (WCAG 2.5.3).
      action: link ? { label } : undefined,
      link: link
        ? { href: link.href, sameSite: link.sameSite, ariaLabel: [`${label} ${p.title}`, price].filter(Boolean).join(", ") }
        : undefined,
    };
  });
}

/** A request that already went out (after the consent card): only its outcome. */
function SentRequest({ tool, repeated }: { tool: string; repeated: boolean }) {
  const copy = cardCopy();
  const uid = React.useId();
  return (
    <RequestDraft
      id={`sent-${tool}-${uid}`}
      fields={[]}
      sendLabel=""
      outcome="sent"
      sentTitle={repeated ? copy.draftAlreadySent : copy.draftSent}
      showSentTime={!repeated}
    />
  );
}

/** Why a confirm failed, in the visitor's words; final when retrying cannot help. */
function draftFailure(result: Extract<DraftDecisionResult, { ok: false }>): { error: string; final?: boolean } {
  const copy = cardCopy();
  if (result.status === 409) return { error: copy.draftReplaced, final: true };
  if (result.status === 404) return { error: copy.draftMissing, final: true };
  if (result.status === 403) return { error: copy.draftSessionExpired };
  if (result.status === 400 || result.status === 422) return { error: copy.draftInvalid };
  return { error: copy.draftSendError };
}

/**
 * Contact, quote and call-back requests: the visitor reviews what goes to the
 * business and confirms with one tap. With a draft id the tap is what stores
 * and sends the request, corrections typed in the card included; nothing
 * reaches the business before it. Older cards (no draft id) were stored when
 * the assistant called the tool: their corrections go back to the assistant.
 */
function ConfirmableRequest({ tool, data, draft, onSendMessage }: {
  tool: string;
  data: Record<string, any>;
  draft?: { id: string; state: string; confirmedAt: string | null; repeated: boolean };
  onSendMessage: (message: string) => void;
}) {
  const copy = cardCopy();
  // A correction brings a second card for the same tool: ids must not repeat.
  const uid = React.useId();
  const subject = toText(data.subject).trim();
  const body = toText(data.body).trim();
  const fields: DraftField[] = [
    { id: "name", label: copy.draftName, value: toText(data.name).trim() },
    { id: "phone", label: copy.draftPhone, value: toText(data.phone).trim(), inputType: "tel" },
    { id: "email", label: copy.draftEmail, value: toText(data.email).trim(), inputType: "email" },
    ...(subject && !GENERATED_SUBJECT.test(subject) ? [{ id: "subject", label: copy.draftSubject, value: subject }] : []),
    { id: "body", label: copy.draftBody, value: body, multiline: true },
  ];
  const business = widgetNames().business;
  if (draft) {
    // A cancelled draft, or one a newer card replaced, is gone after a reload too.
    if (draft.state === "cancelled" || draft.state === "superseded") return null;
    const sent = draft.state === "confirmed";
    return (
      <RequestDraft
        id={`draft-${tool}-${uid}`}
        fields={fields}
        sendLabel={copy.draftSend(business.length <= 22 ? business : "")}
        consentLine={copy.draftConsent}
        outcome={sent ? "sent" : undefined}
        sentAt={draft.confirmedAt}
        sentTitle={sent && draft.repeated ? copy.draftAlreadySent : undefined}
        showSentTime={!(sent && draft.repeated)}
        onSend={async (changes): Promise<DraftSendOutcome> => {
          const result = await sendRequestDraftDecision(draft.id, "confirm", changes);
          if ("status" in result) return draftFailure(result);
          if (result.state !== "confirmed") return { error: copy.draftReplaced, final: true };
          return { sentAt: result.confirmedAt, repeated: result.deduped };
        }}
        onCancel={() => void sendRequestDraftDecision(draft.id, "cancel")}
      />
    );
  }
  return (
    <RequestDraft
      id={`draft-${tool}-${uid}`}
      fields={fields}
      sendLabel={copy.draftSend(business.length <= 22 ? business : "")}
      consentLine={copy.draftConsent}
      onSend={(changes) => {
        const lines = fields
          .filter((f) => f.id in changes && changes[f.id])
          .map((f) => `${f.label}: ${changes[f.id]}`);
        if (lines.length) onSendMessage(copy.draftCorrection(lines.join("\n")));
      }}
    />
  );
}

const infoFromLines = (component: Record<string, any>): BusinessInfo => {
  const info: BusinessInfo = {};
  for (const line of asArray(component.lines)) {
    const label = toText(line?.label).toLowerCase();
    const value = toText(line?.value).trim();
    if (!value) continue;
    if (label === "address" || label === "indirizzo") info.address = value;
    else if (label === "phone" || label === "telefono") info.phone = value;
    else if (label === "email") info.email = value;
    else if (label === "hours" || label === "orari") info.hours = value;
    else if (label === "map" || label === "mappa") info.map_url = value;
  }
  // The status card also carries the structured fields (per-day hours, timezone): prefer them.
  for (const key of ["address", "phone", "email", "map_url", "timezone"] as const) {
    if (toText(component[key]).trim()) (info as Record<string, unknown>)[key] = toText(component[key]).trim();
  }
  if (isRecord(component.hours)) info.hours = component.hours as BusinessInfo["hours"];
  return info;
};

function businessInfoCard(info: Record<string, any>) {
  const place = String(info.name || widgetNames().business || cardCopy().infoPlace);
  if (info.lat && info.lng && Number.isFinite(Number(info.lat)) && Number.isFinite(Number(info.lng))) {
    return (
      <GeoMap
        id="geo-business_info"
        title={place}
        markers={[{
          id: "main",
          lat: Number(info.lat),
          lng: Number(info.lng),
          label: place,
          description: String(info.address || ""),
        }]}
        address={info.address ? String(info.address) : undefined}
        phone={info.phone ? String(info.phone) : undefined}
        hours={isRecord(info.hours) ? info.hours : undefined}
        timezone={info.timezone ? String(info.timezone) : undefined}
        mapUrl={info.map_url || info.mapUrl ? String(info.map_url || info.mapUrl) : undefined}
      />
    );
  }
  return <InfoCard info={info as BusinessInfo} />;
}

function ErrorFallback() {
  return <p className="ar-note ar-note--start">{cardCopy().toolError}</p>;
}

export function buildGenerativeToolComponent({
  toolName,
  result,
  onSendMessage,
  isLatest = false,
}: GenerativeToolRendererParams): React.ReactNode | null {
  try {
  const payload = isRecord(result) ? (result as ToolPayload) : null;
  if (!payload) return null;

  const components = toToolComponents(payload);
  const toolOutput = isRecord(payload.tool_output) ? payload.tool_output : null;
  const tool = resolveTool(toolName, components).toLowerCase().replace(/-/g, "_");

  // One card per answer: the visitor's pending step (consent, then a request
  // to confirm) wins over a table or chart the same answer also carried,
  // otherwise the request could never be sent.
  const pending = (c: ToolComponent) =>
    toText(c.type).trim().toLowerCase() === "consent_required" ? 0 : toText((c as Record<string, any>).draft_id) ? 1 : 2;
  // Among drafts the newest wins: a later call in the same answer replaced the earlier one.
  const ordered = components
    .map((component, index) => ({ component, index }))
    .sort((a, b) => pending(a.component) - pending(b.component)
      || (pending(a.component) === 1 ? b.index - a.index : a.index - b.index))
    .map(({ component }) => component);

  // ── Generative UI: component-type routing ──
  for (const component of ordered) {
    const type = toText(component.type).trim().toLowerCase();

    if (type === "consent_required") {
      return (
        <ConsentCard
          component={component as ConsentRequiredComponent}
          onSendMessage={onSendMessage}
        />
      );
    }
    if (type === "clarify" || type === "question_flow") {
      const opts = asArray(component.items || (component as any).options);
      if (opts.length) {
        return (
          <QuestionFlow
            id={`qf-${tool}`}
            step={1}
            title={toText((component as any).question || component.message || component.title) || widgetCopy().chooseOption}
            options={opts.map((o: any, i: number) => ({ id: `opt-${i}`, label: typeof o === "string" ? o : toText(o.label || o) }))}
            autoOpen={isLatest}
            onAnswer={onSendMessage}
          />
        );
      }
    }
    if (type === "appointment_slots") {
      return <AppointmentSlots component={component as any} onSendMessage={onSendMessage} autoOpen={isLatest} />;
    }
    if (type === "event_list") {
      return <EventCards component={component as any} onSendMessage={onSendMessage} />;
    }
    if (type === "geo_map" || type === "map" || type === "locations") {
      // business_info names an unnamed place "Location" / "Our Location" in English.
      const place = widgetNames().business || cardCopy().infoPlace;
      const local = (value: unknown) => (/^(our )?location$/i.test(toText(value).trim()) ? place : value);
      const markers = asArray((component as any).markers).map((m) => (isRecord(m) ? { ...m, label: local(m.label) } : m));
      return <GeoMap {...(component as any)} title={local((component as any).title)} markers={markers} />;
    }
    if (type === "message_draft" || type === "draft") {
      return <MessageDraft {...(component as any)} onCorrection={onSendMessage} />;
    }
    if (type === "order_summary" || type === "cart") {
      return <OrderSummary {...(component as any)} />;
    }
    if (type === "data_table" || type === "table") {
      const rows = asArray((component as any).data);
      // Empty generated tables are renderer metadata, not useful chat content.
      // Continue so a later component or the narrative can represent the result.
      if (rows.length === 0) continue;
      // A store search that found products shows them as product cards (link
      // to the product page, store currency) below, not as the table the
      // model may have written from the same results: that table has no links.
      if (isEcommerceTool(tool) && normalizeProductItems(components, toolOutput).length > 0) continue;
      return <TableCard component={{ ...(component as any), data: rows }} onSendMessage={onSendMessage} />;
    }
    if (type === "chart" || type === "bar_chart" || type === "line_chart" || type === "area_chart") {
      // Chart component's `type` prop is "bar"|"line", different from the routing type
      const chartType = (component as any).chart_type || (type === "bar_chart" ? "bar" : type === "line_chart" ? "line" : "bar");
      return <Chart {...(component as any)} type={chartType} />;
    }
    if (type === "stats" || type === "stats_display") {
      const language = String((typeof window !== "undefined" && (window as any).AlphaRecallChat?.language) || "it");
      return <StatsDisplay locale={language.startsWith("it") ? "it-IT" : language} {...(component as any)} />;
    }
    if (PRODUCT_COMPONENT_TYPES.has(type) && !isEcommerceTool(tool)) {
      // Booking engines (restaurant tables, rooms) send their options as a product list.
      const items = asArray(component.items).slice(0, DEFAULT_MAX_PRODUCTS).map(normalizeProduct);
      if (items.length) return <CardCarousel items={productCards(items)} label={toText(component.title) || undefined} />;
    }
    if (type === "tool_status" && toText(component.tool).toLowerCase() === "coupon_check") {
      return <CouponResult component={component as any} />;
    }
    // tool_status for known tools → render via tool-name routing using toolOutput data
    if (type === "tool_status") {
      const ctool = toText(component.tool).toLowerCase().replace(/-/g, "_");
      const cData = component as Record<string, any>;
      if (toText(cData.status).toLowerCase() === "error") return null;
      // contact/quote/callback → review card (user confirms before "sending")
      if (ctool === "contact_form" || ctool === "quote_request" || ctool === "callback_request") {
        // Merge component data (always present) with toolOutput (may be null)
        const tOut = (toolOutput || {}) as Record<string, any>;
        const draftId = toText(cData.draft_id).trim();
        if (draftId) {
          return (
            <ConfirmableRequest
              tool={ctool}
              onSendMessage={onSendMessage}
              draft={{
                id: draftId,
                state: toText(cData.draft_state).trim() || "draft",
                confirmedAt: toText(cData.confirmed_at).trim() || null,
                repeated: !!cData.deduped,
              }}
              data={{
                name: cData.name || "",
                email: cData.email || "",
                phone: cData.phone || "",
                subject: cData.subject || "",
                body: cData.body || "",
              }}
            />
          );
        }
        const email = tOut.email || cData.email || "";
        // After a consent gate the request has already gone out and the
        // status carries no contact data: show what happened, not a draft.
        const status = toText(cData.status).toLowerCase();
        if (!email && (status === "submitted" || status === "saved" || toolOutput?.submission_id != null)) {
          const repeated = !!toolOutput?.deduped || /gia|già|already/i.test(toText(cData.title));
          return <SentRequest tool={ctool} repeated={repeated} />;
        }
        if (email) {
          return (
            <ConfirmableRequest
              tool={ctool}
              onSendMessage={onSendMessage}
              data={{
                name: tOut.name || cData.name || "",
                email,
                phone: tOut.phone || cData.phone || "",
                subject: tOut.subject || cData.subject || "",
                body: tOut.message || tOut.service_description || tOut.reason || cData.body || tOut.summary || tOut.response || "",
              }}
            />
          );
        }
      }
      if (ctool === "feedback") {
        return <FeedbackReceipt component={cData} />;
      }
      if (ctool === "escalate") {
        return <HandoffCard component={cData} onSendMessage={onSendMessage} live={isLatest} />;
      }
      if (ctool === "business_info") {
        // "Mostrameli in una tabella": the table the model built (display) from
        // these details is what the visitor asked for; it renders below.
        if (ordered.some((c) => ["data_table", "table"].includes(toText(c.type).trim().toLowerCase()) && asArray((c as any).data).length > 0)) continue;
        const info = { ...(isRecord(toolOutput?.info) ? toolOutput.info : {}), ...infoFromLines(cData) };
        return businessInfoCard(info);
      }
      // Other tool_status types (appointment, email_lead, etc.) → no component, just text
      return null;
    }
  }

  const out = toolOutput as Record<string, any> | null;

  if (tool === "event_list" || tool === "event-list") {
    const events = asArray(out?.events).filter(isRecord);
    if (events.length > 0) {
      return <EventCards component={{ events: events as any }} onSendMessage={onSendMessage} />;
    }
    return null;
  }
  if (tool === "clarify") {
    const opts = asArray(out?.options);
    if (opts.length) {
      return (
        <QuestionFlow
          id="qf-clarify"
          step={1}
          title={toText(out?.question || out?.message) || widgetCopy().chooseOption}
          options={opts.map((o: any, i: number) => ({ id: `opt-${i}`, label: String(o) }))}
          autoOpen={isLatest}
          onAnswer={onSendMessage}
        />
      );
    }
    return <ClarifyPrompt component={(out || {}) as any} onSendMessage={onSendMessage} />;
  }
  if (tool === "coupon_check") {
    return <CouponResult component={(out || {}) as any} />;
  }

  // Business info → map card when the profile has coordinates, details card otherwise
  if (tool === "business_info" || tool === "business-info") {
    const info = out?.info || out;
    if (isRecord(info)) return businessInfoCard(info);
  }

  // Contact form / Quote / Callback → review card
  if (tool === "contact_form" || tool === "quote_request" || tool === "callback_request") {
    const email = out?.email || "";
    if (email) {
      return (
        <ConfirmableRequest
          tool={tool}
          onSendMessage={onSendMessage}
          data={{
            name: out?.name || "",
            email,
            phone: out?.phone || "",
            subject: out?.subject || "",
            body: out?.message || out?.summary || out?.response || out?.service_description || out?.reason || "",
          }}
        />
      );
    }
  }

  if (tool === "escalate" && out && toText(out.status).toLowerCase() !== "error" && !out.error) {
    return <HandoffCard component={{ status: out.status, channel: out.channel }} onSendMessage={onSendMessage} live={isLatest} />;
  }

  // Tools that don't need a rich component — agent's text response is sufficient:
  // appointment, email_lead, feedback, newsletter_subscribe, faq_search
  // These return null so only the AI text shows (no component card).

  if (!isEcommerceTool(tool)) {
    return null;
  }

  const productItems = normalizeProductItems(components, toolOutput);
  const blocks: React.ReactNode[] = [];

  if (productItems.length > 0) {
    blocks.push(
      <CardCarousel key="tool-product-search" items={productCards(productItems)} label={widgetCopy().productResults} />,
      <CardForm
        key="tool-product-refine"
        icon={<Search aria-hidden="true" className="ar-card-icon" />}
        title={widgetCopy().refineSearch}
        fields={[{ id: "query", type: "text", label: widgetCopy().search, placeholder: toText(toolOutput?.query) || widgetCopy().searchAnother }]}
        submitText={widgetCopy().search}
        onSubmit={(values) => {
          const query = toText(values.query).trim();
          if (!query) return;
          onSendMessage(widgetCopy().searchFor(query));
        }}
      />,
    );
  }

  components.forEach((component, idx) => {
    const type = toText(component.type).trim().toLowerCase();
    if (!type || !isCheckoutComponentType(type)) return;
    const fields = normalizeFormFields(component.fields);
    if (fields.length === 0) return;

    blocks.push(
      <CardForm
        key={`fast-checkout-${idx}`}
        icon={<ShoppingBag aria-hidden="true" className="ar-card-icon" />}
        title={toText(component.title) || widgetCopy().quickCheckout}
        description={toText(component.description) || widgetCopy().quickCheckoutHint}
        fields={fields}
        submitText={toText((component as any).submitText || (component as any).submit_text) || widgetCopy().continue}
        onSubmit={(values) => {
          const message = composeFastCheckoutMessage(values);
          if (!message) return;
          onSendMessage(message);
        }}
      />,
    );
  });

  if (blocks.length === 0) return null;

  return <>{blocks}</>;
  } catch (err) {
    if (typeof console !== "undefined") console.warn("GenUI render error:", err);
    return <ErrorFallback />;
  }
}
