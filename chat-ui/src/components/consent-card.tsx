"use client";

import * as React from "react";
import { getChatStrings } from "@/strings";
import { cn } from "@/lib/utils";
import { ShieldCheck } from "lucide-react";

type ConsentDecision = "accept" | "decline";
type ConsentState = "idle" | "submitting" | "accepted" | "declined" | "expired" | "error";

export interface ConsentRequiredComponent {
  type: "consent_required";
  tool: string;
  action_id: string;
  purpose: "contact_data" | "recruiting" | "property_inquiry" | "marketing";
  purpose_label: string;
  summary?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  privacy_notice_url?: string | null;
  policy_version?: string | null;
  title?: string;
  message?: string;
  /** Stored with the card when the visitor decided, so a reload shows the outcome. */
  consent_state?: "accepted" | "declined";
}

interface ConsentDecisionResult {
  ok: boolean;
  status: number;
}

interface ConsentDecisionDetail {
  action_id: string;
  decision: ConsentDecision;
  respond: (result: ConsentDecisionResult) => void;
}

interface ConsentCardProps {
  component: ConsentRequiredComponent;
  onSendMessage: (message: string) => void;
}

/** "Ricontattarti" reads "ricontattarti" inside a sentence; acronyms stay as written. */
const midSentence = (label: string) => (/^\p{Lu}\p{Ll}/u.test(label) ? label[0].toLocaleLowerCase() + label.slice(1) : label);

type DecidedState = Extract<ConsentState, "accepted" | "declined" | "expired">;
const decidedActions = new Map<string, DecidedState>();
// A retried tool call within one turn can render two cards for the same action
// id; a decision on either must settle both, not leave one with live buttons.
const DECIDED_EVENT = "alpharecall:consent-decided";
function announceDecided(actionId: string, state: DecidedState) {
  decidedActions.set(actionId, state);
  window.dispatchEvent(new CustomEvent(DECIDED_EVENT, { detail: { action_id: actionId, state } }));
}

const safePrivacyUrl = (value?: string | null): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
};

export function ConsentCard({ component, onSendMessage }: ConsentCardProps) {
  const strings = getChatStrings();
  const stored = component.consent_state === "accepted" || component.consent_state === "declined" ? component.consent_state : null;
  const initialState = decidedActions.get(component.action_id) || stored || "idle";
  const [state, setState] = React.useState<ConsentState>(initialState);
  const inFlightRef = React.useRef(false);
  const messageSentRef = React.useRef(false);
  const lastDecisionRef = React.useRef<ConsentDecision | null>(null);
  const statusRef = React.useRef<HTMLParagraphElement>(null);
  const titleId = React.useId();
  const privacyUrl = safePrivacyUrl(component.privacy_notice_url);
  const summaryRows = [
    [strings.consentFieldName, component.summary?.name],
    [strings.consentFieldEmail, component.summary?.email],
    [strings.consentFieldPhone, component.summary?.phone],
  ].filter((row): row is [string, string] => typeof row[1] === "string" && row[1].trim() !== "");

  // A card that mounts already decided (a reload) must not pull the focus.
  const mountedState = React.useRef(state);
  React.useEffect(() => {
    if (state === mountedState.current) return;
    if (state === "accepted" || state === "declined" || state === "expired") {
      statusRef.current?.focus();
    }
  }, [state]);

  React.useEffect(() => {
    const onDecided = (event: Event) => {
      const detail = (event as CustomEvent<{ action_id?: string; state?: DecidedState }>).detail;
      if (detail?.action_id === component.action_id && detail.state) setState(detail.state);
    };
    window.addEventListener(DECIDED_EVENT, onDecided);
    return () => window.removeEventListener(DECIDED_EVENT, onDecided);
  }, [component.action_id]);

  const submitDecision = React.useCallback((decision: ConsentDecision) => {
    if (inFlightRef.current || decidedActions.has(component.action_id)) return;
    inFlightRef.current = true;
    lastDecisionRef.current = decision;
    setState("submitting");
    let responded = false;

    const respond = (result: ConsentDecisionResult) => {
      if (responded) return;
      responded = true;
      inFlightRef.current = false;

      if (result.ok) {
        const finalState: DecidedState = decision === "accept" ? "accepted" : "declined";
        announceDecided(component.action_id, finalState);
        setState(finalState);
        if (!messageSentRef.current) {
          messageSentRef.current = true;
          onSendMessage(
            decision === "accept"
              ? strings.consentAcceptedMessage
              : strings.consentDeclinedMessage
          );
        }
        return;
      }

      if (result.status === 404 || result.status === 409) {
        announceDecided(component.action_id, "expired");
        setState("expired");
        return;
      }
      setState("error");
    };

    window.dispatchEvent(new CustomEvent<ConsentDecisionDetail>("alpharecall:consent-decision", {
      detail: {
        action_id: component.action_id,
        decision,
        respond,
      },
    }));
  }, [component.action_id, onSendMessage, strings.consentAcceptedMessage, strings.consentDeclinedMessage]);

  const statusText = state === "accepted"
    ? strings.consentCardAccepted
    : state === "declined"
      ? strings.consentCardDeclined
      : state === "expired"
        ? strings.consentCardExpired
        : state === "error"
          ? strings.consentCardError
          : null;

  return (
    <section
      role="group"
      aria-labelledby={titleId}
      aria-busy={state === "submitting"}
      className="ar-card ar-consent-card"
    >
      <div className="ar-card-head">
        <ShieldCheck aria-hidden="true" className="ar-card-icon" />
        <div className="ar-card-heading">
          <h3 id={titleId} className="ar-card-title">
            {component.title || strings.consentCardTitle}
          </h3>
          <p className="ar-card-sub">
            {strings.consentCardBody.replace("{purpose}", midSentence(component.purpose_label))}
          </p>
        </div>
      </div>

      {summaryRows.length > 0 ? (
        <div className="ar-consent-summary">
          <p className="ar-consent-summary-title">{strings.consentCardSummaryTitle}</p>
          <dl className="ar-fields">
            {summaryRows.map(([label, value]) => (
              <div key={label} className="ar-field ar-field--static">
                <dt className="ar-field-label">{label}</dt>
                <dd className="ar-field-value">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {privacyUrl ? (
        <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="ar-card-link">
          {strings.consentCardPrivacy}
        </a>
      ) : null}

      {statusText ? (
        <div className="ar-consent-status" data-state={state}>
          <p ref={statusRef} tabIndex={-1} aria-live="polite" className="ar-consent-status-text">
            {statusText}
          </p>
          {state === "error" ? (
            <button
              type="button"
              onClick={() => lastDecisionRef.current && submitDecision(lastDecisionRef.current)}
              className="ar-btn ar-btn--secondary"
            >
              {strings.consentCardRetry}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="ar-btn-row">
          <button
            type="button"
            disabled={state === "submitting"}
            onClick={() => submitDecision("decline")}
            className={cn("ar-btn ar-btn--secondary", state === "submitting" && "is-busy")}
          >
            {strings.consentCardDecline}
          </button>
          <button
            type="button"
            disabled={state === "submitting"}
            onClick={() => submitDecision("accept")}
            className={cn("ar-btn ar-btn--primary", state === "submitting" && "is-busy")}
          >
            {strings.consentCardAccept}
          </button>
        </div>
      )}
    </section>
  );
}
