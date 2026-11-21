"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Tool, ToolContent } from "@/components/ai-elements/tool";
import { sanitizeHref } from "@/components/tool-ui/shared/media/sanitize-href";

type ToolComponent = {
  type?: string;
  tool?: string;
  title?: string;
  description?: string;
  status?: string;
  lines?: { label?: string; value?: string }[];
  message?: string;
  items?: any[];
  query?: string;
};

type SendMessage = (message: string, action: string, payload?: any, toolOverride?: string) => void;
type ValidationKind = "none" | "email" | "phone" | "url";

const EMAIL_REGEX = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const PHONE_REGEX = /^\+?[0-9()\-.\s]{7,20}$/;
const URL_REGEX = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i;

export interface ToolResultFallbackProps {
  toolName?: string | null;
  result?: any;
  onSendMessage: (message: string) => void;
}

const logAnalytics = async (tool: string, action: string, payload?: any) => {
  try {
    const chat = (window as any).AlphaRecallChat || {};
    const restBase = String(chat.restUrl || "").replace(/\/$/, "");
    if (!restBase) return;
    await fetch(`${restBase}/analytics`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": chat.nonce || "",
        ...(chat.chatSig ? { "X-AlphaRecall-Signature": chat.chatSig } : {}),
        ...(chat.chatTs ? { "X-AlphaRecall-Timestamp": chat.chatTs } : {}),
        ...(chat.deviceId ? { "X-AlphaRecall-Device-Id": chat.deviceId } : {}),
      },
      body: JSON.stringify({
        kind: "tool_use",
        data: { tool, action, payload },
      }),
    });
  } catch (err) {
    // ignore
  }
};

const extractLineValue = (lines: ToolComponent["lines"], label: string) => {
  const match = (lines || []).find((line) => (line.label || "").toLowerCase() === label.toLowerCase());
  return match?.value || "";
};

const ActionButton = ({ label, onClick }: { label: string; onClick: () => void }) => {
  return (
    <Button type="button" variant="outline" size="sm" className="ar-ai-tool-action-btn" onClick={onClick}>
      {label}
    </Button>
  );
};

const ActionInput = ({
  label,
  placeholder,
  validationKind = "none",
  onSubmit,
}: {
  label: string;
  placeholder: string;
  validationKind?: ValidationKind;
  onSubmit: (value: string) => void;
}) => {
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const validate = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return "This field is required.";
    if (validationKind === "email" && !EMAIL_REGEX.test(trimmed)) {
      return "Enter a valid email address.";
    }
    if (validationKind === "phone" && !PHONE_REGEX.test(trimmed)) {
      return "Enter a valid phone number.";
    }
    if (validationKind === "url" && !URL_REGEX.test(trimmed)) {
      return "Enter a valid URL.";
    }
    return null;
  };

  const inputType: React.HTMLInputTypeAttribute =
    validationKind === "email" ? "email" : validationKind === "phone" ? "tel" : validationKind === "url" ? "url" : "text";

  return (
    <form
      className="ar-ai-tool-action-input"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        const nextError = validate(trimmed);
        if (nextError) {
          setError(nextError);
          return;
        }
        onSubmit(trimmed);
        setValue("");
        setError(null);
      }}
    >
      <input
        type={inputType}
        className="ar-ai-tool-input-field"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        placeholder={placeholder}
        aria-invalid={error ? "true" : undefined}
      />
      <Button type="submit" size="sm" className="ar-ai-tool-action-btn">
        {label}
      </Button>
      {error ? <div className="text-xs text-destructive mt-1">{error}</div> : null}
    </form>
  );
};

const ToolNote = ({ note }: { note?: string }) => {
  if (!note) return null;
  return <div className="ar-ai-tool-note">{note}</div>;
};

const pickNote = (...candidates: Array<string | undefined | null>) => {
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const normalizeProductItem = (item: any) => {
  if (!item || typeof item !== "object") return {};
  return {
    title: item.title || item.name || item.id || "Item",
    description: item.description || item.summary || "",
    price: item.price || item.price_text || item.amount || "",
    image: item.image || item.thumbnail || "",
    url: item.url || item.link || "",
    rating: item.rating || item.stars || "",
    cta_label: item.cta_label || item.cta || "View",
  };
};

const ProductCard = ({ item }: { item: any }) => {
  const normalized = normalizeProductItem(item);
  return (
    <div className="ar-chat-product-card">
      {normalized.image ? <img src={normalized.image} alt={normalized.title} /> : null}
      <div className="space-y-1">
        <div className="text-sm font-semibold">{normalized.title}</div>
        {normalized.description ? <div className="text-xs text-muted-foreground">{normalized.description}</div> : null}
      </div>
      <div className="ar-chat-product-meta">
        <span>{normalized.price}</span>
        <span>{normalized.rating ? `${normalized.rating}★` : ""}</span>
      </div>
      {sanitizeHref(normalized.url) ? (
        <a
          href={sanitizeHref(normalized.url)}
          target="_blank"
          rel="noreferrer"
          onClick={() => logAnalytics("product_search", "cta_click", normalized.url)}
        >
          {normalized.cta_label}
        </a>
      ) : null}
    </div>
  );
};

const ToolActions = ({
  tool,
  component,
  toolOutput,
  sendMessage,
}: {
  tool: string;
  component: ToolComponent;
  toolOutput: any;
  sendMessage: SendMessage;
}) => {
  const normalized = tool.toLowerCase();
  const send = (message: string, action: string, payload?: any) => sendMessage(message, action, payload, tool);
  const timeslot =
    toolOutput?.timeslot || extractLineValue(component.lines, "Timeslot") || extractLineValue(component.lines, "Time");
  const email = toolOutput?.email || extractLineValue(component.lines, "Email");
  const query = toolOutput?.query || component.query || "";

  if (normalized === "product_search") {
    return (
      <div className="ar-ai-tool-actions">
        <ActionInput
          label="Search"
          placeholder="Refine your search"
          onSubmit={(value) => send(`Search for ${value}`, "refine_search", { query: value })}
        />
        <ActionButton
          label="Show more"
          onClick={() => send(query ? `Show more results for ${query}` : "Show more results", "show_more", { query })}
        />
      </div>
    );
  }

  if (normalized.startsWith("appointment")) {
    return (
      <div className="ar-ai-tool-actions">
        <ActionButton
          label="Confirm"
          onClick={() =>
            send(timeslot ? `Confirm the appointment for ${timeslot}` : "Confirm the appointment", "confirm", {
              timeslot,
            })
          }
        />
        <ActionInput
          label="Reschedule"
          placeholder="New time or date"
          onSubmit={(value) => send(`Reschedule the appointment to ${value}`, "reschedule", { timeslot: value })}
        />
        <ActionButton
          label="Cancel"
          onClick={() =>
            send(timeslot ? `Cancel the appointment for ${timeslot}` : "Cancel the appointment", "cancel", { timeslot })
          }
        />
      </div>
    );
  }

  if (normalized.startsWith("email_lead")) {
    return (
      <div className="ar-ai-tool-actions">
        <ActionInput
          label="Update"
          placeholder="New email address"
          validationKind="email"
          onSubmit={(value) => send(`Update my email to ${value}`, "update_email", { email: value })}
        />
        <ActionButton
          label="Unsubscribe"
          onClick={() => send(email ? `Unsubscribe ${email}` : "Unsubscribe this email", "unsubscribe", { email })}
        />
      </div>
    );
  }

  if (normalized === "escalate") {
    return (
      <div className="ar-ai-tool-actions">
        <ActionInput
          label="Add details"
          placeholder="Add more context"
          onSubmit={(value) => send(`Additional details: ${value}`, "add_details", { details: value })}
        />
        <ActionButton label="Close" onClick={() => send("No further action needed.", "close")} />
      </div>
    );
  }

  return (
    <div className="ar-ai-tool-actions">
      <ActionButton label="Retry" onClick={() => send(`Please retry ${tool}`, "retry")} />
    </div>
  );
};

const renderToolStatus = (component: ToolComponent, toolName: string, toolOutput: any, sendMessage: SendMessage) => {
  const lines = Array.isArray(component?.lines) ? component.lines : [];
  const tool = component?.tool || toolName || "tool";
  const note = pickNote(component?.message, toolOutput?.message, toolOutput?.response, toolOutput?.summary);
  const description = component?.description || toolOutput?.status || "";
  const resolvedNote = note || description;
  const resolvedDescription = resolvedNote === description ? "" : description;
  const deduped = Boolean(toolOutput?.deduped) || ["saved", "duplicate"].includes(String(component?.status || ""));
  const dedupeLabel =
    tool.includes("appointment") ? "Already requested" : tool.includes("email_lead") ? "Already on list" : "Duplicate";

  return (
    <Tool>
      <ToolContent>
        {deduped ? <span className="ar-ai-tool-badge">{dedupeLabel}</span> : null}
        <ToolNote note={resolvedNote} />
        {resolvedDescription ? <div className="ar-ai-tool-subtle">{resolvedDescription}</div> : null}
        {lines.length ? (
          <div className="ar-ai-tool-lines">
            {lines.map((line, idx) => (
              <div key={idx} className="ar-ai-tool-line">
                {line.label ? <span className="ar-ai-tool-line-label">{line.label}</span> : null}
                {line.value ? <span className="ar-ai-tool-line-value">{line.value}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        <ToolActions tool={tool} component={component} toolOutput={toolOutput} sendMessage={sendMessage} />
      </ToolContent>
    </Tool>
  );
};

const renderProductList = (component: ToolComponent, toolName: string, toolOutput: any, sendMessage: SendMessage) => {
  const items = Array.isArray(component?.items)
    ? component.items
    : Array.isArray(toolOutput?.products)
      ? toolOutput.products
      : Array.isArray(toolOutput?.results)
        ? toolOutput.results
        : [];
  const tool = component?.tool || toolName || "product_search";
  const note = pickNote(component?.message, toolOutput?.message, toolOutput?.response, toolOutput?.summary);
  const description = component?.description || toolOutput?.status || "";
  const resolvedNote = note || description;
  const resolvedDescription = resolvedNote === description ? "" : description;

  return (
    <Tool className="ar-ai-tool-product">
      <ToolContent>
        <ToolNote note={resolvedNote} />
        {resolvedDescription ? <div className="ar-ai-tool-subtle">{resolvedDescription}</div> : null}
        {items.length ? (
          <div className="ar-chat-product-grid">
            {items.map((item: any, idx: number) => (
              <ProductCard key={idx} item={item} />
            ))}
          </div>
        ) : (
          <div className="ar-ai-tool-empty">Nessun risultato.</div>
        )}
        <ToolActions tool={tool} component={component} toolOutput={toolOutput} sendMessage={sendMessage} />
      </ToolContent>
    </Tool>
  );
};

const renderComponent = (component: ToolComponent, toolName: string, toolOutput: any, sendMessage: SendMessage) => {
  if (!component || !component.type) return null;
  if (component.type === "tool_status") {
    return renderToolStatus(component, toolName, toolOutput, sendMessage);
  }
  if (component.type === "product_list") {
    return renderProductList(component, toolName, toolOutput, sendMessage);
  }

  const note = pickNote(
    component?.message,
    toolOutput?.message,
    toolOutput?.response,
    toolOutput?.summary,
    component?.description,
    toolOutput?.status,
  );
  const description = component?.description || toolOutput?.status || "";
  const resolvedNote = note || description;
  const resolvedDescription = resolvedNote === description ? "" : description;

  return (
    <Tool>
      <ToolContent>
        <ToolNote note={resolvedNote} />
        {resolvedDescription ? <div className="ar-ai-tool-subtle">{resolvedDescription}</div> : null}
        {Array.isArray(component?.lines) && component.lines.length ? (
          <div className="ar-ai-tool-lines">
            {component.lines.map((line, idx) => (
              <div key={idx} className="ar-ai-tool-line">
                {line.label ? <span className="ar-ai-tool-line-label">{line.label}</span> : null}
                {line.value ? <span className="ar-ai-tool-line-value">{line.value}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
        <ToolActions tool={component.tool || toolName} component={component} toolOutput={toolOutput} sendMessage={sendMessage} />
      </ToolContent>
    </Tool>
  );
};

export function ToolResultFallback({ toolName, result, onSendMessage }: ToolResultFallbackProps) {
  const sendMessage = (message: string, action: string, payload?: any, toolOverride?: string) => {
    logAnalytics(toolOverride || toolName || "tool", action, payload);
    onSendMessage(message);
  };

  const components = Array.isArray(result?.components) ? result.components : [];
  const hasComponents = components.length > 0;
  const toolOutput = result?.tool_output || null;

  const fallbackComponent: ToolComponent | null = toolOutput
    ? {
        type: toolOutput?.products || toolOutput?.results ? "product_list" : "tool_status",
        title: toolName || "Tool result",
        items: toolOutput?.products || toolOutput?.results || [],
        description: toolOutput?.status || "",
        tool: toolName || undefined,
      }
    : {
        type: "tool_status",
        title: `Used tool: ${toolName || "tool"}`,
        tool: toolName || undefined,
      };

  const rendered = hasComponents
    ? components.map((component, idx) => (
        <React.Fragment key={idx}>{renderComponent(component, toolName || "", toolOutput, sendMessage)}</React.Fragment>
      ))
    : fallbackComponent
      ? renderComponent(fallbackComponent, toolName || "", toolOutput, sendMessage)
      : null;

  return <div className="ar-ai-tool-stack mt-2">{rendered}</div>;
}
