import * as React from "react";

/**
 * AI Act art. 50(1): visitors must know they are talking to an AI system. The
 * notice is always rendered in the chat footer, also while a person of the team
 * is replying (the earlier answers stay AI-generated), and nothing a site owner
 * or an agency can configure removes it:
 *
 * - the text falls back to the built-in wording when the injected string is blank;
 * - the widget lives in the host page's DOM, so the site's theme CSS could still
 *   hide it with !important. The properties that hide text are pinned as inline
 *   !important declarations, which win over any stylesheet, !important included.
 */
export const AI_DISCLOSURE_DEFAULT = "Stai parlando con un assistente virtuale basato su intelligenza artificiale";
export const AI_DISCLOSURE_HUMAN_DEFAULT = "Le risposte dell'assistente virtuale sono generate con intelligenza artificiale";

type Pinned = Record<string, string>;

const TEXT_PINS: Pinned = {
  visibility: "visible",
  opacity: "1",
  position: "static",
  transform: "none",
  "clip-path": "none",
  filter: "none",
  "max-height": "none",
  "max-width": "none",
  "text-indent": "0",
  "letter-spacing": "normal",
  "background-color": "transparent",
  "text-shadow": "none",
  "-webkit-text-fill-color": "currentcolor",
  "font-size": "max(11px, calc(11px * var(--ar-font-scale, 1)))",
  "line-height": "1.5",
  color: "var(--ar-ink-3, #6b6b6b)",
};

/** On the notice itself. */
const NOTICE_PINS: Pinned = {
  ...TEXT_PINS,
  display: "inline",
  margin: "0",
  padding: "0",
  border: "0",
  width: "auto",
  height: "auto",
  overflow: "visible",
};

/** On the footer that holds it, plus `display` (flex in the chat, none in the FAQ view). */
export const LEGAL_FOOTER_PINS: Pinned = {
  ...TEXT_PINS,
  height: "auto",
  overflow: "visible",
  // The stylesheet's own spacing: custom CSS may set padding, margin and gap, which
  // could otherwise push the notice out of the panel.
  margin: "-2px 0 0",
  padding: "0 16px calc(12px + env(safe-area-inset-bottom))",
  gap: "0 6px",
};

/** Alpha of a computed CSS colour ("rgba(0, 0, 0, 0)" -> 0); 1 when it cannot tell. */
function colorAlpha(value: string): number {
  if (value === "transparent") return 0;
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean);
  return parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
}

/** Write the pins as inline !important declarations on every render that could have reset them. */
export function usePinnedStyle(ref: React.RefObject<HTMLElement | null>, pins: Pinned) {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    for (const [prop, value] of Object.entries(pins)) el.style.setProperty(prop, value, "important");
  });
}

export function aiDisclosureText(
  strings: { aiDisclosure?: string; aiDisclosureHuman?: string },
  humanHandling: boolean,
): string {
  const injected = humanHandling ? strings.aiDisclosureHuman : strings.aiDisclosure;
  const fallback = humanHandling ? AI_DISCLOSURE_HUMAN_DEFAULT : AI_DISCLOSURE_DEFAULT;
  return (injected || "").trim() || fallback;
}

export function AiDisclosure({
  strings,
  humanHandling = false,
}: {
  strings: { aiDisclosure?: string; aiDisclosureHuman?: string };
  humanHandling?: boolean;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  usePinnedStyle(ref, NOTICE_PINS);
  React.useLayoutEffect(() => {
    // The pinned colour reads --ar-ink-3, which the site's CSS could make transparent,
    // also later from a script: checked on render and every few seconds after.
    const check = () => {
      const el = ref.current;
      if (el && colorAlpha(getComputedStyle(el).color) < 0.5) el.style.setProperty("color", "#6b6b6b", "important");
    };
    check();
    const timer = window.setInterval(check, 3000);
    return () => window.clearInterval(timer);
  });
  return (
    <span ref={ref} className="ar-ai-disclosure" data-ai-disclosure="">
      {aiDisclosureText(strings, humanHandling)}
    </span>
  );
}

/** The chat footer: AI notice first, then whatever links the caller passes. */
export function LegalFooter({
  as = "footer",
  strings,
  humanHandling = false,
  hidden = false,
  children,
}: {
  as?: "footer" | "div";
  /** The FAQ view shows no chat, so no footer. */
  hidden?: boolean;
  strings: { aiDisclosure?: string; aiDisclosureHuman?: string };
  humanHandling?: boolean;
  children?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLElement>(null);
  usePinnedStyle(ref, { ...LEGAL_FOOTER_PINS, display: hidden ? "none" : "flex" });
  const Tag = as as "footer";
  return (
    <Tag ref={ref} className="ar-chat-legal">
      <AiDisclosure strings={strings} humanHandling={humanHandling} />
      {children}
    </Tag>
  );
}
