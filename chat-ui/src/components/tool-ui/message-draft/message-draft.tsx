"use client";

import * as React from "react";
import type { MessageDraftProps } from "./schema";
import { RequestDraft, type DraftField } from "./request-draft";
import { cardCopy } from "@/lib/card-copy";
import { widgetCopy } from "@/lib/widget-copy";

type DraftState = "review" | "sending" | "sent" | "cancelled";
type DraftOutcome = MessageDraftProps["outcome"];

export function resolveStateFromOutcome(outcome: DraftOutcome): DraftState {
  if (outcome === "sent") return "sent";
  if (outcome === "cancelled") return "cancelled";
  return "review";
}

export function resolveOutcomeTransition(
  previousOutcome: DraftOutcome,
  nextOutcome: DraftOutcome,
): DraftState | null {
  if (previousOutcome === nextOutcome) return null;
  return resolveStateFromOutcome(nextOutcome);
}

/** A generic email or Slack draft, shown as the same review card as a request. */
export function MessageDraft(props: MessageDraftProps) {
  const copy = cardCopy();
  const editable = !!props.onCorrection;
  const fields = React.useMemo<DraftField[]>(() => {
    if (props.channel === "email") {
      return [
        ...(props.from ? [{ id: "from", label: copy.draftFrom, value: props.from, readOnly: true }] : []),
        { id: "to", label: copy.draftTo, value: [...props.to, ...(props.cc || [])].join(", "), readOnly: true },
        { id: "subject", label: copy.draftSubject, value: props.subject, readOnly: !editable },
        { id: "body", label: copy.draftBody, value: props.body, multiline: true, readOnly: !editable },
      ];
    }
    const target = props.target.type === "channel" ? `#${props.target.name}` : widgetCopy().messageTo(props.target.name);
    return [
      { id: "to", label: copy.draftTo, value: target, readOnly: true },
      { id: "body", label: copy.draftBody, value: props.body, multiline: true, readOnly: !editable },
    ];
  }, [props, copy, editable]);

  return (
    <RequestDraft
      id={props.id}
      className={props.className}
      fields={fields}
      sendLabel={widgetCopy().send}
      outcome={props.outcome}
      undoGracePeriod={props.undoGracePeriod}
      onSend={async (changes) => {
        const lines = fields.filter((f) => changes[f.id]).map((f) => `${f.label}: ${changes[f.id]}`);
        if (lines.length) props.onCorrection?.(copy.draftCorrection(lines.join("\n")));
        await props.onSend?.();
      }}
      onUndo={props.onUndo}
      onCancel={props.onCancel}
    />
  );
}
