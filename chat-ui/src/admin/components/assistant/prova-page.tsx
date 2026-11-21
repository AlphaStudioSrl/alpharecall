import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/admin/app-context";
import { getConfig } from "@/admin/lib/config";
import { formatNumber } from "@/admin/lib/format";
import { interpolate, named } from "@/admin/lib/i18n";
import { useMessageLimit } from "@/lib/message-limit";
import { useFrameLayout } from "@/admin/components/layout/frame-context";
import { useNavigate } from "@/admin/lib/nav-context";
import { PageHead, Tag, ProgressBar, Empty } from "@/admin/components/shared/kit";
import { Button } from "@/components/ui/button";
import { SafeMarkdown } from "@/components/safe-markdown";
import { RotateCcw, Sparkles, ShieldCheck, Wrench, LayoutGrid, Pencil, Loader2, AlertCircle, Lock, Headset, RefreshCw } from "@/components/icons";
import { assistantName, hostOf, pathOf, sourceKind } from "./shared";
import { askAssistant, ProvaError, type ProvaErrorKind, type ProvaReply } from "./prova-client";
import { ProvaComponentPreview, provaMarkdownComponents, widgetCard } from "./prova-components";

/** After this long without an answer the typing dots say that long answers take a while. */
const SLOW_HINT_MS = 15_000;

interface Turn {
  id: number;
  question: string;
  reply?: ProvaReply;
  error?: string;
  /** A failed turn that "Riprova" can resend: not when the plan is out of messages. */
  retryable?: boolean;
  /** Rate limited: "Riprova" waits until then (ms since epoch). */
  retryAt?: number;
  /** The error is fixed in the widget settings (Test mode without roles), or by reloading (expired nonce). */
  errorFix?: "widget" | "reload";
  /** What failed, for the trace: a 200 that could not be read did reach the assistant. */
  errorKind?: ProvaErrorKind | "network";
  /** The chat is with the team: no answer until an operator hands it back. */
  handoff?: { conversationId: string | null; chatStatus: string };
  pending?: boolean;
}

const TONE_KEYS = ["friendly", "professional", "creative"];

/**
 * Assistente > Prova: ask what a visitor would ask and see, beside each
 * answer, what the assistant used to write it. Answers come from the live
 * assistant through the visitor's own chat path; nothing here is simulated.
 */
export function ProvaPage() {
  useFrameLayout({ fill: true });
  const { t, settings, licenseTier } = useApp();
  // Fixing an answer writes an FAQ entry, which needs a plan with FAQs.
  const canWriteFaq = licenseTier === "business" || licenseTier === "enterprise";
  const navigate = useNavigate();
  const name = assistantName(settings, t("assistant.common.fallbackName"));
  const configuredName = assistantName(settings, "");
  const tenant = (settings.tenant_settings || {}) as Record<string, unknown>;
  const chat = (settings.chat_config || {}) as Record<string, unknown>;
  const tone = String(tenant.chatbot_tone || "");
  const toneLabel = TONE_KEYS.includes(tone) ? t(`persona.${tone}`) : tone && tone !== "custom" ? tone : "";
  const starters = (Array.isArray(chat.starterQuestions) ? chat.starterQuestions : Array.isArray(chat.starter_questions) ? chat.starter_questions : []) as string[];
  const config = getConfig();
  // The widget switched off in Widget settings: the site sets no chat session,
  // so there is nothing to test against until it is back on.
  const widgetOff = chat.enabled === false;
  const unavailable = config.chatAvailable === false || widgetOff;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const limit = useMessageLimit(draft);
  const conversationRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const busy = turns.some((turn) => turn.pending);
  const current = turns.find((turn) => turn.id === selected) ?? null;
  const lastTurn = turns[turns.length - 1];
  // Re-render when a rate-limited "Riprova" may go again.
  const [, setTick] = useState(0);
  const waitUntil = lastTurn?.retryAt ?? 0;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy]);
  useEffect(() => {
    const left = waitUntil - Date.now();
    if (left <= 0) return;
    const timer = window.setTimeout(() => setTick((n) => n + 1), left + 50);
    return () => window.clearTimeout(timer);
  }, [waitUntil]);

  /**
   * What failed and what to do, in the owner's words. The server's own text
   * (an English API detail, a provider error with its request id) is never
   * shown: the status and the proxy's code say which case it is.
   */
  function errorMessage(error: unknown): string {
    if (error instanceof ProvaError) {
      if (isRoleGate(error)) return t("assistant.prova.errorRoles");
      if (error.kind === "expired") return t("assistant.prova.errorExpired");
      if (error.kind === "session" || error.kind === "visitor") return t("assistant.prova.errorSession");
      if (error.kind === "quota") return t("assistant.prova.errorQuota");
      if (error.kind === "rate") return rateText(t, error.retryAfterMs);
      if (error.kind === "blocked") return rateText(t, error.retryAfterMs, "errorBlocked");
      if (error.kind === "challenge") return t("assistant.prova.errorChallenge");
      if (error.kind === "timeout") return interpolate(t("assistant.prova.errorTimeout"), { name });
      if (error.kind === "empty") return interpolate(t("assistant.prova.errorEmpty"), { name });
      if (error.kind === "unreadable") return interpolate(t("assistant.prova.errorUnreadable"), { name });
      return interpolate(t("assistant.prova.errorChat"), { name });
    }
    return t("assistant.prova.errorNetwork");
  }

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy || unavailable) return;
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question, pending: true }]);
    setSelected(id);
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "";
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply = await askAssistant(question, conversationRef.current, controller.signal);
      conversationRef.current = reply.conversationId;
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, reply, pending: false } : turn)));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ProvaError && error.kind === "handoff") {
        // Not a failure: the question is in the thread, the team has the chat.
        const handoff = error.handoff ?? { conversationId: conversationRef.current, chatStatus: "handoff" };
        if (handoff.conversationId) conversationRef.current = handoff.conversationId;
        setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, handoff, pending: false } : turn)));
        return;
      }
      if (!(error instanceof ProvaError)) console.warn("AlphaRecall: the Prova request failed", error);
      const errorKind = error instanceof ProvaError ? error.kind : "network";
      const errorFix = error instanceof ProvaError && isRoleGate(error) ? "widget" : errorKind === "expired" ? "reload" : undefined;
      // Not resendable when the plan is out of messages, the widget settings
      // block the test or the page must be reloaded first.
      const retryable = !errorFix && errorKind !== "quota";
      const retryAt = error instanceof ProvaError && (error.kind === "rate" || error.kind === "blocked") ? Date.now() + (error.retryAfterMs ?? RATE_FALLBACK_MS) : undefined;
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, error: errorMessage(error), errorKind, errorFix, retryable, retryAt, pending: false } : turn)));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  /** "Riprova" on the last turn when it failed: ask the same question again, replacing it. */
  function retry(turn: Turn) {
    if (busy || (turn.retryAt ?? 0) > Date.now()) return;
    setTurns((prev) => prev.filter((item) => item.id !== turn.id));
    void send(turn.question);
  }

  function restart() {
    abortRef.current?.abort();
    abortRef.current = null;
    conversationRef.current = null;
    setTurns([]);
    setSelected(null);
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <div className="as-prova">
      <PageHead
        title={interpolate(t("assistant.prova.title"), { name })}
        subtitle={t("assistant.prova.subtitle")}
        actions={
          <Button variant="secondary" onClick={restart} disabled={turns.length === 0}>
            <RotateCcw className="size-4" />
            {t("assistant.prova.restart")}
          </Button>
        }
      />

      {unavailable ? (
        <Empty
          icon={Lock}
          title={t(widgetOff ? "assistant.prova.widgetOffTitle" : "assistant.prova.unavailableTitle")}
          description={widgetOff ? named(t, "assistant.prova.widgetOffBody", configuredName) : config.chatUnavailableReason || named(t, "assistant.prova.unavailableBody", configuredName)}
          action={
            widgetOff ? (
              <Button variant="secondary" onClick={() => navigate("widget/widget")}>
                {t("assistant.prova.openWidget")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="as-prova-cols">
            {/* What the visitor sees */}
            <section className="as-prova-col" aria-labelledby="as-prova-chat" ref={listRef}>
              <div className="as-prova-col-head">
                <b id="as-prova-chat">{t("assistant.prova.visitorView")}</b>
                {toneLabel && <Tag>{toneLabel}</Tag>}
              </div>
              {turns.length === 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="text-[13px] text-ink-2">{interpolate(t("assistant.prova.emptyBody"), { name })}</p>
                  {starters.length > 0 && (
                    <div className="as-suggestions" aria-label={t("assistant.prova.suggestions")} role="group">
                      {starters.map((q) => (
                        <button key={q} type="button" className="as-suggestion" onClick={() => void send(q)}>
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <ol className="as-msgs" aria-live="polite" aria-label={t("assistant.prova.conversation")}>
                  {turns.map((turn) => (
                    <li key={turn.id} className="contents">
                      <div className="as-v">{turn.question}</div>
                      {turn.handoff ? (
                        // The team has the chat: a state of the conversation,
                        // not a failure, so no Riprova (it would get the same).
                        <div className="as-sys" data-tone="handoff" role="status">
                          <Headset aria-hidden="true" />
                          <div className="as-sys-body">
                            <span className="sr-only">{named(t, "assistant.prova.errorTitle", configuredName)}</span>
                            <p>{named(t, turn.handoff.chatStatus === "closed" ? "assistant.prova.handoffClosed" : "assistant.prova.handoff", configuredName)}</p>
                            {turn.id === lastTurn?.id && (
                              <div className="flex flex-wrap gap-2">
                                <Button variant="secondary" size="sm" onClick={restart}>
                                  <RotateCcw className="size-3.5" />
                                  {t("assistant.prova.restart")}
                                </Button>
                                {turn.handoff.conversationId && (
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => navigate("inbox/conversazioni", { params: { thread: String(turn.handoff!.conversationId) } })}
                                  >
                                    {t("assistant.prova.openInInbox")}
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : turn.error ? (
                        // A failed request is the system talking, not the
                        // assistant: no assistant mark, no "what it used".
                        <div className="as-sys" role="alert">
                          <AlertCircle aria-hidden="true" />
                          <div className="as-sys-body">
                            <span className="sr-only">{named(t, "assistant.prova.errorTitle", configuredName)}</span>
                            <p>{turn.error}</p>
                            {turn.errorFix === "reload" && (
                              <Button variant="secondary" size="sm" className="self-start" onClick={() => window.location.reload()}>
                                <RefreshCw className="size-3.5" />
                                {t("assistant.prova.reload")}
                              </Button>
                            )}
                            {turn.errorFix === "widget" && (
                              <Button variant="secondary" size="sm" className="self-start" onClick={() => navigate("widget/widget")}>
                                {t("assistant.prova.openWidget")}
                              </Button>
                            )}
                            {turn.retryable && turn.id === lastTurn?.id && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="self-start"
                                disabled={busy || (turn.retryAt ?? 0) > Date.now()}
                                onClick={() => retry(turn)}
                              >
                                <RotateCcw className="size-3.5" />
                                {t("assistant.prova.retry")}
                              </Button>
                            )}
                          </div>
                        </div>
                      ) : turn.pending ? (
                        <PendingAnswer name={name} />
                      ) : (
                        // A click anywhere on the answer selects it; the button is the keyboard path.
                        <div
                          className="as-ai"
                          data-selectable=""
                          data-selected={selected === turn.id ? "" : undefined}
                          onClick={(e) => {
                            if (!(e.target as HTMLElement).closest("a, button")) setSelected(turn.id);
                          }}
                        >
                          <span className="as-ai-mark"><Sparkles aria-hidden="true" /></span>
                          <div className="as-ai-body">
                            {turn.reply?.output.trim() && (
                              <div className="as-ai-text as-md">
                                <SafeMarkdown components={provaMarkdownComponents}>{turn.reply.output}</SafeMarkdown>
                              </div>
                            )}
                            {turn.reply && <AnswerComponents reply={turn.reply} />}
                            <button
                              type="button"
                              className="as-ai-pick"
                              aria-pressed={selected === turn.id}
                              aria-controls="as-prova-trace-body"
                              aria-label={interpolate(t("assistant.prova.selectAnswer"), { name })}
                              onClick={() => setSelected(turn.id)}
                            >
                              {t("assistant.prova.showTrace")}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {/* What the assistant used */}
            <section className="as-prova-col" aria-labelledby="as-prova-trace">
              <div className="as-prova-col-head">
                <b id="as-prova-trace">{t("assistant.prova.traceTitle")}</b>
              </div>
              <div id="as-prova-trace-body" aria-live="polite">
                <Trace
                  turn={current}
                  name={name}
                  canWriteFaq={canWriteFaq}
                  onUnlock={() => navigate("impostazioni/piano")}
                  // Only the question: the FAQ page links it to the open gap
                  // with the same words, if there is one, and says nothing
                  // otherwise (card 092b3547byr8).
                  onFix={(q) => navigate("assistente/faq", { intent: "add-faq", params: { q } })}
                />
              </div>
            </section>
          </div>

          <div className="as-composer-wrap">
          <form
            className="as-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // Grow with the text up to the CSS max-height.
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              onPaste={limit.onPaste}
              placeholder={t("assistant.prova.placeholder")}
              aria-label={t("assistant.prova.placeholder")}
              aria-describedby={[busy && draft.trim() ? "as-prova-wait" : "", limit.showCount || limit.cut ? "as-prova-limit" : ""].filter(Boolean).join(" ") || undefined}
              // The visitor widget's limit too (CHAT_MESSAGE_MAX): Prova sends what a visitor could.
              maxLength={limit.max}
            />
            <Button type="submit" disabled={!draft.trim() || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("assistant.prova.send")}
            </Button>
          </form>
          {/* Empty (and so without height) until the text nears the limit; always there, so it is announced. */}
          <div id="as-prova-limit" className="as-composer-limit" aria-live="polite">
            {limit.cut && <span>{interpolate(t("assistant.prova.truncated"), { max: limit.max })}</span>}
            {limit.showCount && <small className="as-num" data-full={limit.count >= limit.max ? "" : undefined}>{limit.count}/{limit.max}</small>}
          </div>
          </div>
          {/* The next question can be typed meanwhile; Enter must not look like it did nothing. */}
          {busy && draft.trim() && (
            <p id="as-prova-wait" className="as-note" role="status">
              {interpolate(t("assistant.prova.waitForAnswer"), { name })}
            </p>
          )}
          <div className="as-note">
            <ShieldCheck aria-hidden="true" />
            <p>{t("assistant.prova.disclosure")}</p>
          </div>
        </>
      )}
    </div>
  );
}

function Trace({
  turn,
  name,
  canWriteFaq,
  onFix,
  onUnlock,
}: {
  turn: Turn | null;
  name: string;
  canWriteFaq: boolean;
  onFix: (question: string) => void;
  onUnlock: () => void;
}) {
  const { t, settings } = useApp();
  const configuredName = assistantName(settings, "");

  const citations = useMemo(() => {
    const list = [...(turn?.reply?.citations || [])].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
    // One row per page: several chunks of the same page read as one source.
    const seen = new Set<string>();
    return list.filter((c) => {
      const key = String(c.url || c.source_id || c.title || "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [turn]);

  if (!turn) {
    return <p className="text-[13px] text-ink-3">{interpolate(t("assistant.prova.traceEmpty"), { name })}</p>;
  }
  if (turn.pending) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-ink-3" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <p>{interpolate(t("assistant.prova.thinking"), { name })}</p>
      </div>
    );
  }
  if (turn.handoff) {
    return <p className="text-[13px] text-ink-3">{named(t, "assistant.prova.traceHandoff", configuredName)}</p>;
  }
  if (turn.error || !turn.reply) {
    // The notice itself sits in the conversation; saying it twice reads as two
    // failures. An empty JSON answer came from the API, so the question
    // arrived. A 200 that could not be read may be a cache, CDN or firewall
    // page that never reached WordPress: claim neither way. A test chat the
    // anti-abuse control would not open never sent the question: say that,
    // not that the assistant missed it (card 3ntateg1vxw2).
    const key = turn.errorKind === "empty"
      ? "assistant.prova.traceUnread"
      : turn.errorKind === "unreadable"
        ? "assistant.prova.traceUnreadable"
        : turn.errorKind === "blocked" || turn.errorKind === "challenge"
          ? "assistant.prova.traceBlocked"
          : turn.errorKind === "session" || turn.errorKind === "visitor"
            ? "assistant.prova.traceNoSession"
            // Sent, and then no answer in time, a server error or a dropped
            // connection: whether it arrived is not known, so no claim.
            : turn.errorKind === "timeout" || turn.errorKind === "chat" || turn.errorKind === "network"
              ? "assistant.prova.traceNoAnswer"
              : "assistant.prova.traceError";
    return <p className="text-[13px] text-ink-3">{named(t, key, configuredName)}</p>;
  }

  const reply = turn.reply;
  const top = citations.reduce((m, c) => Math.max(m, Number(c.score ?? 0)), 0);
  const tokens = reply.usage?.total_tokens;
  // "12,7 s" and "15.950" in Italian, like every other number in the admin.
  const seconds = formatNumber(reply.ms / 1000);

  return (
    <div className="as-trace">
      <div className="as-trace-stats">
        <div className="as-trace-stat">
          <b>{seconds} s</b>
          <small>{t("assistant.prova.statTime")}</small>
        </div>
        <div className="as-trace-stat">
          <b>{citations.length}</b>
          <small>{t("assistant.prova.statSources")}</small>
        </div>
        <div className="as-trace-stat">
          <b>{typeof tokens === "number" ? formatNumber(tokens) : t("assistant.prova.na")}</b>
          <small>{t("assistant.prova.statTokens")}</small>
        </div>
      </div>

      <div className="as-trace-block">
        <h3 className="ark-lbl">{t("assistant.prova.usedSources")}</h3>
        {citations.length === 0 ? (
          <p className="text-[12.5px] text-ink-3">{t("assistant.prova.noSources")}</p>
        ) : (
          citations.map((c, i) => {
            const label = c.title || (c.url ? pathOf(c.url) : c.source_id) || t("assistant.prova.untitled");
            const detail = citationDetail(t, c);
            const relative = top > 0 ? (Number(c.score ?? 0) / top) * 100 : 0;
            const body = (
              <>
                <span>
                  <b>{label}</b>
                  {detail && <small>{detail}</small>}
                </span>
                <ProgressBar
                  value={relative}
                  tone="accent"
                  label={interpolate(t("assistant.prova.relevance"), { score: Number(c.score ?? 0).toFixed(2) })}
                />
              </>
            );
            return c.url && /^https?:/i.test(c.url) ? (
              <a key={`${c.url}-${i}`} className="as-trace-src" href={c.url} target="_blank" rel="noreferrer">
                {body}
              </a>
            ) : (
              <div key={`${c.source_id}-${i}`} className="as-trace-src">
                {body}
              </div>
            );
          })
        )}
      </div>

      {(reply.tool || reply.components.length > 0) && (
        <div className="as-trace-block">
          <h3 className="ark-lbl">{t("assistant.prova.actions")}</h3>
          {reply.tool && (
            <div className="as-trace-tool">
              <Wrench aria-hidden="true" />
              <span>
                <b>{toolLabel(t, reply.tool)}</b>
                {reply.toolRounds != null && reply.toolRounds > 1 && (
                  <small>{interpolate(t("assistant.prova.toolRounds"), { n: reply.toolRounds })}</small>
                )}
              </span>
            </div>
          )}
          {reply.components.length > 0 && (
            <div className="as-trace-tool">
              <LayoutGrid aria-hidden="true" />
              <span>
                <b>{t("assistant.prova.componentsTitle")}</b>
                <small>{componentList(t, reply.components)}</small>
              </span>
            </div>
          )}
        </div>
      )}

      {reply.model && (
        <p className="text-[11.5px] text-ink-3">
          {interpolate(t("assistant.prova.model"), { model: reply.model })}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-[12.5px] text-ink-2">{t(canWriteFaq ? "assistant.prova.fixHint" : "assistant.prova.fixLocked")}</p>
        {canWriteFaq ? (
          <Button variant="secondary" size="sm" className="self-start" onClick={() => onFix(turn.question)}>
            <Pencil className="size-3.5" />
            {t("assistant.prova.fix")}
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="self-start" onClick={onUnlock}>
            {t("assistant.gaps.unlock")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Where a source comes from, as Contenuti names it: the page's address, or
 * "File" for an uploaded PDF and "Testo" for a text written by hand.
 */
export function citationDetail(t: (key: string) => string, c: { url?: string | null; source_id?: string | null }): string {
  if (!c.url && !c.source_id) return "";
  if (c.url && /^https?:/i.test(c.url)) return `${hostOf(c.url)}${pathOf(c.url)}`;
  const kind = sourceKind({ source_url: c.url ?? "", source_id: c.source_id ?? "" });
  return t(kind === "file" ? "assistant.contenuti.typeFile" : "assistant.contenuti.typeText");
}

/** A 429 without a usable Retry-After: "Riprova" waits this long. */
const RATE_FALLBACK_MS = 10_000;

/**
 * "Troppe richieste in poco tempo: riprova tra 30 secondi." `family` picks the
 * copy: errorRate for the chat's own limit, errorBlocked for the anti-abuse
 * control refusing to open a test chat ("Troppe prove ravvicinate...").
 */
export function rateText(t: (key: string) => string, retryAfterMs: number | null, family: "errorRate" | "errorBlocked" = "errorRate"): string {
  const key = `assistant.prova.${family}`;
  if (!retryAfterMs) return t(`${key}Soon`);
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (seconds === 1) return t(`${key}One`);
  if (seconds < 90) return interpolate(t(key), { n: seconds });
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return interpolate(t(`${key}Minutes`), { n: minutes });
  return interpolate(t(`${key}Hours`), { n: Math.ceil(minutes / 60) });
}

/** The typing dots; after a while they also say that a long answer takes time. */
function PendingAnswer({ name }: { name: string }) {
  const { t } = useApp();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="as-ai" role="status">
      <span className="as-ai-mark"><Sparkles aria-hidden="true" /></span>
      <div className="as-ai-body">
        <span className="as-typing" aria-label={interpolate(t("assistant.prova.thinking"), { name })}>
          <i /><i /><i />
        </span>
        {slow && <span className="as-note">{t("assistant.prova.slowHint")}</span>}
      </div>
    </div>
  );
}

/**
 * The card the visitor sees under the answer: a table, a chart or numbers are
 * drawn as the widget draws them. Interactive cards (a booking, a form) are
 * only named, and said to be in the widget alone.
 */
function AnswerComponents({ reply }: { reply: ProvaReply }) {
  const { t } = useApp();
  // The widget shows one card per answer, so this is the only one to show or name.
  const card = useMemo(() => widgetCard(reply.componentData), [reply]);
  if (!card) return null;
  return (
    <>
      {card.drawable ? (
        <ProvaComponentPreview component={card.component} />
      ) : (
        <span className="as-note">
          <LayoutGrid aria-hidden="true" />
          {interpolate(t("assistant.prova.componentsShown"), { list: componentList(t, [String(card.component.type ?? "")]) })}
        </span>
      )}
    </>
  );
}

/** The tool's name as the Carattere page shows it, or its key when unknown. */
function toolLabel(t: (key: string) => string, tool: string): string {
  const key = `assistant.tools.${tool}.label`;
  const label = t(key);
  return label && label !== key ? label : tool;
}

/** Test mode with no role selected: the plugin refuses the chat signature. */
function isRoleGate(error: ProvaError): boolean {
  // Both plugin messages ("...only to selected WordPress roles." from
  // /chat-signature, "...only available to some WordPress roles." from the
  // REST check); a 403 for any other reason gets the generic copy.
  return error.status === 403 && /\bWordPress roles\b/i.test(error.message);
}

/** Widget component types the API emits, grouped by what the visitor sees. */
const COMPONENT_KINDS: Record<string, string> = {
  data_table: "table",
  table: "table",
  chart: "chart",
  bar_chart: "chart",
  line_chart: "chart",
  area_chart: "chart",
  geo_map: "map",
  map: "map",
  locations: "map",
  clarify: "choices",
  option_list: "choices",
  select: "choices",
  question_flow: "questionFlow",
  appointment_slots: "appointment",
  appointment: "appointment",
  event_list: "events",
  message_draft: "draft",
  draft: "draft",
  order_summary: "order",
  cart: "order",
  stats: "stats",
  stats_display: "stats",
  product_list: "products",
  product_carousel: "products",
  product_suggestions: "products",
  products: "products",
  tool_status: "status",
  consent_required: "consent",
  contact_form: "contactForm",
  faq_list: "faq",
};

/**
 * "una tabella, una mappa": the visitor-facing names of the elements, once
 * each. An unknown type reads as a generic element, never its internal id.
 */
export function componentList(t: (key: string) => string, types: string[]): string {
  const labels = types.map((type) => {
    // "DataTable", "data-table" and "data_table" are the same element.
    const id = type.trim().replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase();
    return t(`assistant.prova.componentTypes.${Object.prototype.hasOwnProperty.call(COMPONENT_KINDS, id) ? COMPONENT_KINDS[id] : "other"}`);
  });
  return [...new Set(labels)].join(", ");
}
