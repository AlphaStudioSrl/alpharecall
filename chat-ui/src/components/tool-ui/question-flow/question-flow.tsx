"use client";

import * as React from "react";
import { Check, ChevronLeft, CircleCheck, ListChecks } from "lucide-react";
import type {
  QuestionFlowProps,
  QuestionFlowReceiptProps,
  QuestionFlowUpfrontProps,
  QuestionFlowOption,
} from "./schema";
import { ChatSheet } from "@/components/chat/sheet";
import { cardCopy, widgetNames } from "@/lib/card-copy";
import { moveRadioFocus, radioTabIndex } from "@/components/generative-ui/radio-keys";

type Step = {
  id: string;
  title: string;
  description?: string;
  options: QuestionFlowOption[];
  selectionMode: "single" | "multi";
};

type Answer = { question: string; value: string };

const OTHER = /^(altro|altra|altri|other|something else)\b/i;
const autoOpened = new Set<string>();

export function getQuestionFlowStepIds(id: string, stepKey: string) {
  const safeId = encodeURIComponent(id).replace(/%/g, "_");
  const safeStepKey = encodeURIComponent(stepKey).replace(/%/g, "_");
  return {
    titleId: `${safeId}-${safeStepKey}-title`,
    descriptionId: `${safeId}-${safeStepKey}-description`,
  };
}

const focusComposer = () => {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>(".ar-chat-composer textarea")?.focus({ preventScroll: true });
  });
};

function QuestionFlowReceipt({ id, choice, className }: QuestionFlowReceiptProps) {
  return (
    <section className={`ar-card ar-flow-card${className ? ` ${className}` : ""}`} data-slot="question-flow"
      data-tool-ui-id={id} data-receipt="true" role="status" aria-label={choice.title}>
      <div className="ar-card-head">
        <CircleCheck aria-hidden="true" className="ar-card-icon ar-card-icon--ok" />
        <div className="ar-card-heading"><h3 className="ar-card-title">{choice.title}</h3></div>
      </div>
      <dl className="ar-fields">
        {choice.summary.map((item, index) => (
          <div key={index} className="ar-field ar-field--static">
            <dt className="ar-field-label">{item.label}</dt>
            <dd className="ar-field-value">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function OptionRow({ option, checked, multi, tabIndex, onToggle, index }: {
  option: QuestionFlowOption;
  checked: boolean;
  multi: boolean;
  tabIndex: number;
  index: number;
  onToggle: () => void;
}) {
  return (
    <button type="button" role={multi ? "checkbox" : "radio"} aria-checked={checked} className="ar-option"
      data-index={index} tabIndex={multi ? 0 : tabIndex} disabled={option.disabled} onClick={onToggle}>
      {option.icon ? <span className="ar-option-icon" aria-hidden="true">{option.icon}</span> : null}
      <span className="ar-option-text">
        <b>{option.label}</b>
        {option.description ? <small>{option.description}</small> : null}
      </span>
      {checked ? <Check aria-hidden="true" className="ar-option-check" /> : null}
    </button>
  );
}

/**
 * Guided questions: a compact card in the thread opens a full-height step
 * sheet (progress, one question per screen, big targets). The thread keeps a
 * receipt of what the visitor answered.
 */
function QuestionFlowSteps(props: Exclude<QuestionFlowProps, QuestionFlowReceiptProps>) {
  const copy = cardCopy();
  const names = widgetNames();
  const steps = React.useMemo<Step[]>(() => {
    if ("steps" in props && props.steps) {
      return props.steps.map((s) => ({ ...s, selectionMode: s.selectionMode || "single" }));
    }
    const p = props as Extract<QuestionFlowProps, { step: number }>;
    return [{ id: `step-${p.step}`, title: p.title, description: p.description, options: p.options, selectionMode: p.selectionMode || "single" }];
  }, [props]);
  const progressiveStep = "step" in props && typeof props.step === "number" ? props.step : null;
  const total = progressiveStep ? Math.max(progressiveStep, steps.length) : steps.length;
  const offset = progressiveStep ? progressiveStep - 1 : 0;

  const [open, setOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const [selected, setSelected] = React.useState<Record<string, string[]>>(() =>
    "defaultValue" in props && props.defaultValue ? { [steps[0].id]: props.defaultValue } : {});
  const [other, setOther] = React.useState<Record<string, string>>({});
  const [answers, setAnswers] = React.useState<Answer[] | null>(null);
  const titleId = React.useId();
  const questionId = React.useId();
  const otherId = React.useId();
  const signature = `${props.id}:${steps.map((s) => s.title).join("|")}`;

  React.useEffect(() => {
    if (!props.autoOpen || autoOpened.has(signature)) return;
    autoOpened.add(signature);
    setOpen(true);
  }, [props.autoOpen, signature]);

  const step = steps[Math.min(index, steps.length - 1)];
  const chosen = selected[step.id] || [];
  const multi = step.selectionMode === "multi";
  const otherPicked = chosen.some((idv) => OTHER.test(step.options.find((o) => o.id === idv)?.label || ""));
  const otherText = (other[step.id] || "").trim();
  const ready = chosen.length > 0 && (!otherPicked || otherText.length > 0);
  const last = index >= steps.length - 1;
  const stepNumber = offset + index + 1;

  const toggle = (optionId: string) => {
    setSelected((current) => {
      const list = current[step.id] || [];
      if (!multi) return { ...current, [step.id]: [optionId] };
      return { ...current, [step.id]: list.includes(optionId) ? list.filter((x) => x !== optionId) : [...list, optionId] };
    });
  };

  const answerText = (s: Step) => {
    const ids = selected[s.id] || [];
    return ids
      .map((idv) => {
        const label = s.options.find((o) => o.id === idv)?.label || "";
        return OTHER.test(label) ? (other[s.id] || "").trim() || label : label;
      })
      .filter(Boolean)
      .join(", ");
  };

  const next = async () => {
    if (!ready) return;
    if (!last) {
      setIndex((i) => i + 1);
      return;
    }
    const result = steps.map((s) => ({ question: s.title, value: answerText(s) }));
    setAnswers(result);
    setOpen(false);
    if ("steps" in props && props.steps) {
      await (props as QuestionFlowUpfrontProps).onComplete?.(Object.fromEntries(steps.map((s) => [s.id, selected[s.id] || []])));
    } else {
      await (props as Extract<QuestionFlowProps, { step: number }>).onSelect?.(selected[step.id] || []);
    }
    props.onAnswer?.(result.length === 1 ? result[0].value : result.map((a) => `${a.question}: ${a.value}`).join("\n"));
  };

  const back = () => {
    if (index > 0) { setIndex((i) => i - 1); return; }
    if ("onBack" in props && props.onBack) props.onBack();
  };

  const skip = () => {
    setOpen(false);
    focusComposer();
  };

  if (answers) {
    return (
      <section className={`ar-card ar-flow-card${props.className ? ` ${props.className}` : ""}`} data-slot="question-flow"
        data-tool-ui-id={props.id} data-receipt="true" role="status">
        <div className="ar-card-head">
          <CircleCheck aria-hidden="true" className="ar-card-icon ar-card-icon--ok" />
          <div className="ar-card-heading">
            {answers.length === 1 ? (
              <>
                <h3 className="ar-card-title">{answers[0].value}</h3>
                <p className="ar-card-sub">{answers[0].question}</p>
              </>
            ) : (
              <h3 className="ar-card-title">{copy.flowAnswered}</h3>
            )}
          </div>
        </div>
        {answers.length > 1 ? (
          <dl className="ar-fields">
            {answers.map((a, i) => (
              <div key={i} className="ar-field ar-field--static">
                <dt className="ar-field-label">{a.question}</dt>
                <dd className="ar-field-value">{a.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>
    );
  }

  const single = steps.length === 1 && total === 1;
  const entryTitle = single ? steps[0].title : copy.flowTitle;
  const entrySub = single ? steps[0].description || copy.flowOneQuestion : copy.flowQuestions(total);
  const showBack = index > 0 || ("onBack" in props && !!props.onBack);

  return (
    <>
      <section className={`ar-card ar-flow-card${props.className ? ` ${props.className}` : ""}`} data-slot="question-flow"
        data-tool-ui-id={props.id} aria-label={entryTitle}>
        <div className="ar-card-head">
          <ListChecks aria-hidden="true" className="ar-card-icon" />
          <div className="ar-card-heading">
            <h3 className="ar-card-title">{entryTitle}</h3>
            <p className="ar-card-sub">{entrySub}</p>
          </div>
        </div>
        <button type="button" className="ar-btn ar-btn--primary" onClick={() => setOpen(true)}>{copy.flowStart}</button>
      </section>

      <ChatSheet open={open} onClose={() => setOpen(false)} labelledBy={questionId} closeLabel={copy.close} className="ar-sheet--full ar-flow-sheet">
        <div className="ar-flow-top">
          {showBack ? (
            <button type="button" className="ar-round-btn" aria-label={copy.flowBack} onClick={back}>
              <ChevronLeft aria-hidden="true" />
            </button>
          ) : <span className="ar-round-btn-space" aria-hidden="true" />}
          <div className="ar-flow-heading" id={titleId}>
            <b>{copy.flowTitle}</b>
            <small>{total > 1 ? copy.flowQuestionOf(stepNumber, total) : copy.flowOneQuestion}</small>
          </div>
          <span className="ar-round-btn-space" aria-hidden="true" />
        </div>
        {total > 1 ? (
          <div className="ar-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={stepNumber}
            aria-label={copy.flowQuestionOf(stepNumber, total)}>
            {Array.from({ length: total }, (_, i) => <i key={i} data-on={i < stepNumber ? "true" : undefined} />)}
          </div>
        ) : null}
        <div className="ar-flow-body" key={step.id}>
          <h3 id={questionId} className="ar-flow-question">{step.title}</h3>
          {step.description ? <p className="ar-sheet-text">{step.description}</p> : null}
          {multi ? <p className="ar-note ar-note--start">{copy.flowMulti}</p> : null}
          <div className="ar-options" role={multi ? "group" : "radiogroup"} aria-labelledby={questionId}
            onKeyDown={multi ? undefined : (event) => moveRadioFocus(event, (el) => {
              const option = step.options[Number(el.dataset.index)];
              if (option) toggle(option.id);
            })}>
            {step.options.map((option, i) => {
              const checked = chosen.includes(option.id);
              return (
                <OptionRow key={option.id} option={option} index={i} checked={checked} multi={multi}
                  tabIndex={radioTabIndex(checked, i, chosen.length > 0)} onToggle={() => toggle(option.id)} />
              );
            })}
          </div>
          {otherPicked ? (
            <label className="ar-field" htmlFor={otherId}>
              <span className="ar-field-label">{copy.flowOther}</span>
              <textarea id={otherId} rows={2} value={other[step.id] || ""} autoFocus
                onChange={(e) => setOther((v) => ({ ...v, [step.id]: e.target.value }))} />
            </label>
          ) : null}
        </div>
        <div className="ar-flow-actions">
          <button type="button" className="ar-btn ar-btn--primary ar-btn--xl" disabled={!ready} onClick={() => { void next(); }}>
            {last ? (total > 1 || steps.length > 1 ? copy.flowDone : copy.flowNext) : copy.flowNext}
          </button>
          <button type="button" className="ar-text-btn ar-text-btn--center" onClick={skip}>
            {names.assistant ? copy.flowSkip(names.assistant) : copy.flowSkipGeneric}
          </button>
        </div>
      </ChatSheet>
    </>
  );
}

export function QuestionFlow(props: QuestionFlowProps) {
  if ("choice" in props && props.choice) {
    return <QuestionFlowReceipt {...(props as QuestionFlowReceiptProps)} />;
  }
  return <QuestionFlowSteps {...(props as Exclude<QuestionFlowProps, QuestionFlowReceiptProps>)} />;
}
