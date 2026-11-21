"use client";

import { getChatStrings } from "@/strings";
import * as React from "react";
import {
  GenerationStage,
  TamboStubProvider,
  TamboThreadInputProvider,
  type TamboThread,
  type TamboThreadMessage,
} from "@tambo-ai/react";
import type TamboAI from "@tambo-ai/typescript-sdk";
import { fetchWithProofOfWork } from "@/lib/pow-fetch";
import { NO_REPLY_ERROR } from "@/lib/reply-errors";
import { cancelTurn, newTurnId } from "@/lib/turn-cancel";
import { awaitsPerson, sendVisitorPresence } from "@/lib/visitor-presence";
import { createAttachmentClient, type AttachmentClient, type ChatAttachment } from "@/lib/chat-attachments";
import { parsePowChallenge, powHeader, solveProofOfWork, type PowChallenge } from "@/lib/proof-of-work";
import { operatorOf } from "@/lib/operator-name";
import { restEndpoint } from "@/lib/rest-url";

export type RuntimeConfig = {
  restBase: string;
  streamUrl: string;
  nonce?: string;
  chatSig?: string;
  chatTs?: string;
  conversationId?: number | null;
  setConversationId: (id: number | null) => void;
  setFollowups: (items: string[]) => void;
  visitorToken?: string | null;
  deviceId?: string | null;
  enableHumanPolling?: boolean;
  isOpen?: boolean;
  onFeedback?: (event: "send" | "reply") => void;
  beforeSend?: (text: string) => Promise<SendPermission> | SendPermission;
};

export type SendPermission = {
  allowed: boolean;
  visitorToken?: string | null;
  chatSig?: string;
  chatTs?: string;
};

type ContentPart = TamboAI.Beta.Threads.ChatCompletionContentPart;
type MessageRowsResponse = { messages?: any[]; status?: string; ai_enabled?: boolean } | any[];

type InflightRequest = {
  assistantMessageId: string;
  aiExpected: boolean;
  stoppedByHandoff?: boolean;
  controller: AbortController;
  toolMessageId: string | null;
  /** Sent with the question; Stop names it in /chat/cancel (lib/turn-cancel). */
  turnId: string;
  /** Characters of the answer on screen now: a stopped turn keeps only those. */
  shownChars: () => number;
};

export type RuntimeMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
  renderedComponent?: React.ReactNode;
  metadata?: Record<string, unknown>;
  toolName?: string | null;
  toolResult?: any;
  /** The visitor stopped this answer: what was drawn stays, marked "Interrotta". */
  cancelled?: boolean;
};

type ChatRuntimeContextValue = {
  messages: RuntimeMessage[];
  isRunning: boolean;
  statusMessage: string;
  humanHandling: boolean;
  /**
   * The thread's raw status from the backend: "open" (the AI answers),
   * "escalated" (the AI handed it to the team, nobody has replied yet),
   * "handoff" (the team owns it: an operator replied or took over, but also a
   * visitor writing into a closed thread), "closed"; null before the server says.
   */
  chatStatus: string | null;
  /** A person from the team has actually written in this thread. */
  humanJoined: boolean;
  setConversationStatus: (conversationId: number, status: string, handoffContact?: string | null) => void;
  handoffContact: string | null;
  awaitingPerson: boolean;
  error: string | null;
  sendMessage: (text: string, attachments?: ChatAttachment[]) => Promise<boolean>;
  attachmentClient: AttachmentClient;
  conversationKey: string;
  cancel: () => void;
  clearConversation: () => void;
  appendHumanMessage: (text: string, source?: { id?: number; created_at?: string; conversationId: number; attachments?: ChatAttachment[]; profile_name?: string }) => void;
};

const ChatRuntimeContext = React.createContext<ChatRuntimeContextValue | null>(null);

const LOCAL_PROJECT_ID = "alpharecall-local";
const STREAM_DISABLED_KEY = "alpharecall_stream_disabled";
const DEFAULT_TOOL_NAME = "tool";

const toolStatusMessage = (toolNames: string[]) => {
  const statuses = getChatStrings().toolStatuses || {};
  if (toolNames.length > 1) {
    return statuses.default || getChatStrings().thinking;
  }
  return statuses[toolNames[0]] || statuses.default || getChatStrings().thinking;
};

const nowISO = () => new Date().toISOString();

const randomId = (prefix: string) => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
};

const normalizeConversationId = (value: unknown): number | null => {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const threadIdForConversation = (conversationId: number) => `conversation:${conversationId}`;

const textPart = (text: string): ContentPart[] => [{ type: "text", text }];

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toolPayloadToContent = (payload: unknown): ContentPart[] => {
  if (payload == null) return [];
  if (typeof payload === "string") {
    return payload ? textPart(payload) : [];
  }
  return textPart(safeStringify(payload));
};

const extractText = (message?: TamboThreadMessage) => {
  if (!message || !Array.isArray(message.content)) return "";
  return message.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text || "")
    .join("");
};

const buildHistory = (messages: readonly TamboThreadMessage[]) => {
  return messages
    .filter((msg) => (msg.role === "user" || msg.role === "assistant") && !isSyntheticWelcome(msg))
    .map((msg) => ({ role: msg.role, content: extractText(msg) }))
    .filter((item) => item.content && item.content.trim())
    .slice(-12);
};

/** The tool behind the newest assistant message, if any. */
const lastAssistantTool = (messages?: Array<{ role?: string; toolCallRequest?: { toolName?: string } }>) => {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i -= 1) {
    if (messages![i].role === "assistant") return messages![i].toolCallRequest?.toolName;
  }
  return undefined;
};

const createThread = (threadId: string, conversationId: number | null): TamboThread => {
  const timestamp = nowISO();
  return {
    id: threadId,
    createdAt: timestamp,
    updatedAt: timestamp,
    projectId: LOCAL_PROJECT_ID,
    metadata: conversationId ? { conversation_id: conversationId } : {},
    generationStage: GenerationStage.IDLE,
    statusMessage: "",
    // Every thread opens with the tenant-configured welcome message so the
    // chat is never empty (see getWelcomeText / buildHistory exclusion).
    messages: [createWelcomeMessage(threadId)],
  };
};

const isRunningStage = (stage?: TamboThread["generationStage"] | GenerationStage) => {
  return (
    stage === GenerationStage.CHOOSING_COMPONENT ||
    stage === GenerationStage.FETCHING_CONTEXT ||
    stage === GenerationStage.HYDRATING_COMPONENT ||
    stage === GenerationStage.STREAMING_RESPONSE
  );
};

type MessageInit = {
  id?: string;
  threadId: string;
  role: TamboThreadMessage["role"];
  content: ContentPart[];
  createdAt?: string;
  metadata?: Record<string, unknown>;
  toolCallRequest?: TamboAI.ToolCallRequest;
  component?: TamboThreadMessage["component"];
  error?: string;
  parentMessageId?: string;
  isCancelled?: boolean;
};

const createMessage = ({
  id,
  threadId,
  role,
  content,
  createdAt,
  metadata,
  toolCallRequest,
  component,
  error,
  parentMessageId,
  isCancelled,
}: MessageInit): TamboThreadMessage => {
  return {
    id: id || randomId(role),
    threadId,
    role,
    content,
    componentState: {},
    createdAt: createdAt || nowISO(),
    ...(metadata ? { metadata } : {}),
    ...(toolCallRequest ? { toolCallRequest } : {}),
    ...(component ? { component } : {}),
    ...(error ? { error } : {}),
    ...(parentMessageId ? { parentMessageId } : {}),
    ...(isCancelled ? { isCancelled } : {}),
  };
};

/** Marks the synthetic tenant greeting seeded into every thread. */
const SYNTHETIC_WELCOME_KEY = "syntheticWelcome";

const isSyntheticWelcome = (message: TamboThreadMessage): boolean =>
  Boolean((message.metadata as Record<string, unknown> | undefined)?.[SYNTHETIC_WELCOME_KEY]);

/**
 * Tenant-configured initial chatbot message (chat_config.welcomeMessage),
 * falling back to the localized default greeting when unset.
 */
const getWelcomeText = (): string => {
  const cfg =
    (typeof window !== "undefined" && (window as any).AlphaRecallChat?.config) || {};
  const configured = typeof cfg.welcomeMessage === "string" ? cfg.welcomeMessage.trim() : "";
  if (configured) return configured;
  const strings = getChatStrings();
  return `${strings.greeting} ${strings.welcomeSubtitle}`.trim();
};

const createWelcomeMessage = (threadId: string): TamboThreadMessage =>
  createMessage({
    id: `welcome-${threadId}`,
    threadId,
    role: "assistant",
    content: textPart(getWelcomeText()),
    metadata: { [SYNTHETIC_WELCOME_KEY]: true },
  });

const toToolCallRequest = (toolName: string): TamboAI.ToolCallRequest => ({
  toolName,
  parameters: [],
});

const withAssistantToolCall = (
  message: TamboThreadMessage,
  toolName: string,
  phase: "loading" | "complete"
): TamboThreadMessage => {
  const toolCallRequest = toToolCallRequest(toolName || DEFAULT_TOOL_NAME);
  const prevComponent = message.component;
  return {
    ...message,
    toolCallRequest,
    component: {
      componentName: prevComponent?.componentName ?? null,
      componentState: prevComponent?.componentState ?? null,
      message: prevComponent?.message ?? "",
      props: prevComponent?.props ?? {},
      toolCallRequest,
      ...(phase === "loading"
        ? { statusMessage: prevComponent?.statusMessage ?? `Calling ${toolName}` }
        : {
            completionStatusMessage:
              prevComponent?.completionStatusMessage ?? `Called ${toolName}`,
          }),
    },
  };
};

const parseRows = (data: MessageRowsResponse): any[] => {
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as any)?.messages)) return (data as any).messages;
  return [];
};

const mapStoredRowToMessages = (row: any, threadId: string): TamboThreadMessage[] => {
  const createdAt = row?.created_at ? new Date(row.created_at).toISOString() : nowISO();
  const role: TamboThreadMessage["role"] = row?.role === "user" ? "user" : "assistant";

  const assistantMessage = createMessage({
    id: row?.id ? `${row.role === "human" ? "human" : "stored"}-${row.id}` : undefined,
    threadId,
    role,
    content: row?.content ? textPart(String(row.content)) : [],
    createdAt,
    metadata: {
      ...(row?.role === "human" ? { human: true, ...operatorOf(row) } : {}),
      attachments: row?.attachments || [],
      ...(Array.isArray(row?.sources) && row.sources.length ? { sources: row.sources } : {}),
      // The server id and the visitor's saved thumb drive the answer rating.
      // "rating" stays absent when the backend has no rating route.
      ...(row?.role === "assistant" && row?.id != null ? { message_id: row.id } : {}),
      ...(row?.role === "assistant" && row && "rating" in row ? { rating: row.rating ?? null } : {}),
    },
    // An answer the visitor stopped keeps its "Interrotta" mark after a reload.
    isCancelled: role === "assistant" && row?.stopped === true,
  });

  const hasTool = !!(row?.tool || row?.tool_output || row?.components);
  if (!hasTool || role !== "assistant") {
    return [assistantMessage];
  }

  const toolName = String(row?.tool || DEFAULT_TOOL_NAME);
  const assistantWithTool = withAssistantToolCall(assistantMessage, toolName, "complete");
  const toolPayload = {
    tool_output: row?.tool_output ?? null,
    components: row?.components ?? null,
  };
  const toolMessage = createMessage({
    id: row?.id ? `stored-tool-${row.id}` : undefined,
    threadId,
    role: "tool",
    content: toolPayloadToContent(toolPayload),
    createdAt,
  });

  return [assistantWithTool, toolMessage];
};

const getLatestCreatedAt = (rows: any[]) => {
  let latest: string | null = null;
  for (const row of rows) {
    if (!row?.created_at) continue;
    const value = String(row.created_at);
    if (!latest || value > latest) latest = value;
  }
  return latest;
};

const isAbortError = (error: unknown) => {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string };
  return err.name === "AbortError";
};

export const consumeSSE = async (
  stream: ReadableStream<Uint8Array>,
  onData: (data: string) => boolean | void
) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const processBuffer = () => {
    if (!buffer) return false;
    buffer = buffer.replace(/\r/g, "");
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const eventText of events) {
      const lines = eventText.split("\n");
      const dataLines: string[] = [];
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let value = line.slice(5);
        if (value.startsWith(" ")) value = value.slice(1);
        dataLines.push(value);
      }
      if (dataLines.length === 0) continue;
      const shouldStop = onData(dataLines.join("\n"));
      if (shouldStop) return true;
    }

    return false;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (processBuffer()) return;
    }

    buffer += decoder.decode();
    processBuffer();
  } finally {
    // A takeover/status frame (or DONE/PoW retry) can finish before the proxy
    // closes the body. Release the transport as well as the visible AI turn.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};

const filterStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
};

const parseToolResultFromContent = (content: TamboThreadMessage["content"]) => {
  if (!Array.isArray(content) || content.length === 0) return null;

  const text = content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text || "")
    .join("");
  const hasNonText = content.some((item) => item?.type !== "text");

  if (!hasNonText) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      // ignore parse failure and fall through to raw content
    }
  }

  return content;
};

export const useChatRuntime = () => {
  const context = React.useContext(ChatRuntimeContext);
  if (!context) {
    throw new Error("useChatRuntime must be used within a ChatRuntimeProvider");
  }
  return context;
};

export function ChatRuntimeProvider({ children, config }: { children: React.ReactNode; config: RuntimeConfig }) {
  const configRef = React.useRef(config);
  configRef.current = config;

  const initialConversationId = normalizeConversationId(config.conversationId);
  const initialThreadIdRef = React.useRef<string>(
    initialConversationId ? threadIdForConversation(initialConversationId) : randomId("thread")
  );

  const [threadMap, setThreadMapState] = React.useState<Record<string, TamboThread>>(() => {
    const threadId = initialThreadIdRef.current;
    return {
      [threadId]: createThread(threadId, initialConversationId),
    };
  });
  const threadMapRef = React.useRef(threadMap);

  const setThreadMap = React.useCallback(
    (
      updater:
        | Record<string, TamboThread>
        | ((prev: Record<string, TamboThread>) => Record<string, TamboThread>)
    ) => {
      setThreadMapState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        threadMapRef.current = next;
        return next;
      });
    },
    []
  );

  const [currentThreadId, setCurrentThreadIdState] = React.useState<string>(initialThreadIdRef.current);
  const currentThreadIdRef = React.useRef(currentThreadId);

  const setCurrentThreadId = React.useCallback((threadId: string) => {
    currentThreadIdRef.current = threadId;
    setCurrentThreadIdState(threadId);
  }, []);

  const conversationByThreadRef = React.useRef<Record<string, number | null>>({
    [initialThreadIdRef.current]: initialConversationId,
  });
  const inflightRef = React.useRef<Record<string, InflightRequest>>({});

  const loadedConversationIdsRef = React.useRef<Set<number>>(new Set());
  const pollingLastSeenRef = React.useRef<Record<string, string | null>>({});
  const seenHumanMessagesRef = React.useRef<Record<string, Set<string>>>({});

  const authHeaders = React.useCallback((cfg: RuntimeConfig) => {
    return {
      "X-WP-Nonce": cfg.nonce || "",
      ...(cfg.chatSig ? { "X-AlphaRecall-Signature": cfg.chatSig } : {}),
      ...(cfg.chatTs ? { "X-AlphaRecall-Timestamp": cfg.chatTs } : {}),
      ...(cfg.visitorToken ? { "X-Visitor-Token": cfg.visitorToken } : {}),
      ...(cfg.deviceId ? { "X-AlphaRecall-Device-Id": cfg.deviceId } : {}),
    };
  }, []);

  const attachmentClient = React.useMemo(() => createAttachmentClient(async (suffix, init) => {
    if (init.method === "POST") {
      const permission = configRef.current.beforeSend ? await configRef.current.beforeSend("") : { allowed: true };
      if (!permission.allowed || init.signal?.aborted) throw new Error("Upload cancelled");
      configRef.current = { ...configRef.current,
        ...(permission.visitorToken ? { visitorToken: permission.visitorToken } : {}),
        ...(permission.chatSig ? { chatSig: permission.chatSig } : {}),
        ...(permission.chatTs ? { chatTs: permission.chatTs } : {}),
      };
    }
    const cfg = configRef.current;
    if (!cfg.visitorToken) throw new Error("Visitor identification required");
    return fetchWithProofOfWork(restEndpoint(cfg.restBase, `/chat-attachments${suffix}`), {
      ...init, headers: authHeaders(cfg), credentials: "same-origin",
    });
  }), [authHeaders]);

  const updateThread = React.useCallback(
    (threadId: string, updater: (thread: TamboThread) => TamboThread) => {
      setThreadMap((prev) => {
        const base =
          prev[threadId] || createThread(threadId, conversationByThreadRef.current[threadId] ?? null);
        const updated = updater(base);
        const nextThread: TamboThread = {
          ...updated,
          updatedAt: nowISO(),
        };
        return {
          ...prev,
          [threadId]: nextThread,
        };
      });
    },
    [setThreadMap]
  );

  const setThreadStage = React.useCallback(
    (threadId: string, generationStage: GenerationStage, statusMessage = "") => {
      updateThread(threadId, (thread) => ({
        ...thread,
        generationStage,
        statusMessage,
      }));
    },
    [updateThread]
  );

  const appendMessage = React.useCallback(
    (threadId: string, message: TamboThreadMessage) => {
      updateThread(threadId, (thread) => ({
        ...thread,
        messages: [...thread.messages, message],
      }));
    },
    [updateThread]
  );

  const upsertMessageById = React.useCallback(
    (
      threadId: string,
      messageId: string,
      factory: (existing?: TamboThreadMessage) => TamboThreadMessage
    ) => {
      updateThread(threadId, (thread) => {
        const index = thread.messages.findIndex((item) => item.id === messageId);
        if (index === -1) {
          return {
            ...thread,
            messages: [...thread.messages, factory(undefined)],
          };
        }
        const nextMessages = thread.messages.slice();
        nextMessages[index] = factory(nextMessages[index]);
        return {
          ...thread,
          messages: nextMessages,
        };
      });
    },
    [updateThread]
  );

  const findThreadByConversationId = React.useCallback((conversationId: number) => {
    const entries = Object.entries(conversationByThreadRef.current);
    const match = entries.find(([, id]) => id === conversationId);
    return match?.[0] || null;
  }, []);

  // The embedded widget also has an app-level human-message poller. Both
  // polling paths consume the same server-owned state, including empty polls.
  const setConversationStatus = React.useCallback((conversationId: number, status: string, handoffContact?: string | null) => {
    if (!["open", "handoff", "escalated", "closed"].includes(status)) return;
    const threadId = findThreadByConversationId(conversationId);
    if (!threadId) return;
    const inflight = inflightRef.current[threadId];
    const stop = status !== "open" && inflight?.aiExpected;
    if (stop) {
      inflight.stoppedByHandoff = true;
      inflight.controller.abort();
      if (threadId === currentThreadIdRef.current) configRef.current.setFollowups([]);
    }
    updateThread(threadId, (thread) => ({
      ...thread, metadata: { ...thread.metadata, chat_status: status, ...(handoffContact !== undefined ? { handoff_contact: handoffContact } : {}) },
      ...(stop ? {
        generationStage: GenerationStage.IDLE, statusMessage: "",
        messages: thread.messages.filter(message => message.id !== inflight.assistantMessageId && message.id !== inflight.toolMessageId),
      } : {}),
    }));
  }, [findThreadByConversationId, updateThread]);

  const ensureThread = React.useCallback(
    (threadId: string, conversationId: number | null) => {
      if (!threadMapRef.current[threadId]) {
        setThreadMap((prev) => ({
          ...prev,
          [threadId]: createThread(threadId, conversationId),
        }));
      }
      if (!(threadId in conversationByThreadRef.current)) {
        conversationByThreadRef.current[threadId] = conversationId;
      }
    },
    [setThreadMap]
  );

  const setConversationForThread = React.useCallback(
    (threadId: string, conversationId: number) => {
      conversationByThreadRef.current[threadId] = conversationId;
      // The active thread already owns the optimistic user/assistant messages.
      // Mark this conversation as hydrated before publishing its ID to config;
      // otherwise the config effect reloads partial server history mid-stream,
      // removes the empty assistant placeholder, and briefly hides the shimmer.
      loadedConversationIdsRef.current.add(conversationId);
      configRef.current.setConversationId(conversationId);
      updateThread(threadId, (thread) => ({
        ...thread,
        metadata: {
          ...(thread.metadata || {}),
          conversation_id: conversationId,
        },
      }));
    },
    [updateThread]
  );

  const fetchStoredMessages = React.useCallback(
    async (conversationId: number, after?: string | null) => {
      const query = after ? `?after=${encodeURIComponent(after)}` : "";
      const response = await fetch(
        restEndpoint(configRef.current.restBase, `/chat-threads/${conversationId}/messages${query}`),
        {
          headers: authHeaders(configRef.current),
        }
      );
      if (!response.ok) {
        // 403/404 means this thread no longer belongs to the visitor (stale/abandoned):
        // surface it so the poller can stop instead of spamming forever.
        const forbidden = response.status === 403 || response.status === 404;
        return { rows: [] as any[], latest: after || null, forbidden };
      }
      const data = (await response.json()) as MessageRowsResponse;
      const rows = parseRows(data);
      return { rows, latest: getLatestCreatedAt(rows), forbidden: false,
        status: !Array.isArray(data) ? data.status : undefined };
    },
    [authHeaders]
  );

  const loadConversationHistory = React.useCallback(
    async (threadId: string, conversationId: number) => {
      try {
        const { rows, latest, status } = await fetchStoredMessages(conversationId);
        const mapped = rows.flatMap((row) => mapStoredRowToMessages(row, threadId));

        updateThread(threadId, (thread) => ({
          ...thread,
          // Keep the synthetic greeting as bubble #1 when restoring history.
          messages: [createWelcomeMessage(threadId), ...mapped],
          generationStage: GenerationStage.IDLE,
          statusMessage: "",
          metadata: { ...thread.metadata, chat_status: status },
        }));

        pollingLastSeenRef.current[threadId] = latest;
        const seen = new Set<string>();
        rows.forEach((row) => {
          if (row?.role !== "human") return;
          const dedupeKey = String(row?.id ?? `${row?.created_at || ""}:${row?.content || ""}`);
          seen.add(dedupeKey);
        });
        seenHumanMessagesRef.current[threadId] = seen;
      } catch {
        // ignore history fetch errors
      }
    },
    [fetchStoredMessages, updateThread]
  );

  const switchCurrentThread = React.useCallback(
    (threadId: string, fetchThread = true) => {
      const knownConversationId = conversationByThreadRef.current[threadId] ?? null;
      ensureThread(threadId, knownConversationId);
      setCurrentThreadId(threadId);
      configRef.current.setFollowups([]);

      if (knownConversationId) {
        configRef.current.setConversationId(knownConversationId);
        if (fetchThread && !loadedConversationIdsRef.current.has(knownConversationId)) {
          loadedConversationIdsRef.current.add(knownConversationId);
          void loadConversationHistory(threadId, knownConversationId);
        }
      } else {
        configRef.current.setConversationId(null);
      }
    },
    [ensureThread, loadConversationHistory, setCurrentThreadId]
  );

  const startNewThread = React.useCallback(() => {
    const threadId = randomId("thread");
    conversationByThreadRef.current[threadId] = null;
    setThreadMap((prev) => ({
      ...prev,
      [threadId]: createThread(threadId, null),
    }));
    setCurrentThreadId(threadId);
    configRef.current.setConversationId(null);
    configRef.current.setFollowups([]);
  }, [setThreadMap, setCurrentThreadId]);

  const updateThreadName = React.useCallback(
    (name: string, threadId?: string) => {
      const targetThreadId = threadId || currentThreadIdRef.current;
      if (!targetThreadId) return;
      updateThread(targetThreadId, (thread) => ({
        ...thread,
        name,
      }));
    },
    [updateThread]
  );

  const generateThreadName = React.useCallback(
    async (threadId?: string) => {
      const targetThreadId = threadId || currentThreadIdRef.current;
      if (!targetThreadId) {
        throw new Error("No active thread");
      }
      const targetThread =
        threadMapRef.current[targetThreadId] ||
        createThread(targetThreadId, conversationByThreadRef.current[targetThreadId] ?? null);

      const firstUserMessage = targetThread.messages.find((msg) => msg.role === "user");
      const fallback = `Thread ${targetThreadId.slice(-8)}`;
      const generated = extractText(firstUserMessage).trim().slice(0, 48) || fallback;

      updateThreadName(generated, targetThreadId);

      const updatedThread = threadMapRef.current[targetThreadId] || targetThread;
      return {
        id: updatedThread.id,
        createdAt: updatedThread.createdAt,
        updatedAt: updatedThread.updatedAt,
        projectId: updatedThread.projectId,
        metadata: updatedThread.metadata,
        generationStage: updatedThread.generationStage,
        name: updatedThread.name,
        statusMessage: updatedThread.statusMessage,
      } as TamboAI.Beta.Thread;
    },
    [updateThreadName]
  );

  const addThreadMessage = React.useCallback(
    async (message: TamboThreadMessage) => {
      const targetThreadId = message.threadId || currentThreadIdRef.current;
      if (!targetThreadId) return [];

      ensureThread(targetThreadId, conversationByThreadRef.current[targetThreadId] ?? null);

      const normalized: TamboThreadMessage = {
        ...message,
        id: message.id || randomId(message.role),
        threadId: targetThreadId,
        createdAt: message.createdAt || nowISO(),
        componentState: message.componentState || {},
      };

      appendMessage(targetThreadId, normalized);
      return threadMapRef.current[targetThreadId]?.messages ?? [];
    },
    [appendMessage, ensureThread]
  );

  const updateThreadMessage = React.useCallback(
    async (id: string, messagePatch: Partial<TamboThreadMessage> & { threadId: string }) => {
      const targetThreadId = messagePatch.threadId || currentThreadIdRef.current;
      if (!targetThreadId) return;

      upsertMessageById(targetThreadId, id, (existing) => ({
        ...(existing ||
          createMessage({
            id,
            threadId: targetThreadId,
            role: messagePatch.role || "assistant",
            content: messagePatch.content || [],
            createdAt: messagePatch.createdAt || nowISO(),
          })),
        ...messagePatch,
        id,
        threadId: targetThreadId,
        componentState: {
          ...(existing?.componentState || {}),
          ...(messagePatch.componentState || {}),
        },
      }));
    },
    [upsertMessageById]
  );

  const cancel = React.useCallback(async (threadId?: string) => {
    const targetThreadId = threadId || currentThreadIdRef.current;
    if (!targetThreadId) return;

    const inflight = inflightRef.current[targetThreadId];
    if (inflight) {
      inflight.controller.abort();
      // The proxy would let the API finish, save and count the answer.
      void cancelTurn({
        restBase: configRef.current.restBase,
        headers: authHeaders(configRef.current),
        turnId: inflight.turnId,
        shownChars: inflight.shownChars(),
      });
      upsertMessageById(targetThreadId, inflight.assistantMessageId, (existing) => ({
        ...(existing ||
          createMessage({
            id: inflight.assistantMessageId,
            threadId: targetThreadId,
            role: "assistant",
            content: [],
          })),
        isCancelled: true,
      }));
    }

    setThreadStage(targetThreadId, GenerationStage.CANCELLED, "Cancelled");
  }, [authHeaders, setThreadStage, upsertMessageById]);

  const sendThreadMessage = React.useCallback(
    async (
      message: string,
      options?: {
        threadId?: string;
        streamResponse?: boolean;
        contextKey?: string;
        forceToolChoice?: string;
        additionalContext?: Record<string, any>;
        content?: ContentPart[];
        attachments?: ChatAttachment[];
      }
    ) => {
      const targetThreadId = options?.threadId || currentThreadIdRef.current;
      if (!targetThreadId) {
        throw new Error("No active thread");
      }

      if (targetThreadId !== currentThreadIdRef.current) {
        setCurrentThreadId(targetThreadId);
      }

      const knownConversationId =
        conversationByThreadRef.current[targetThreadId] ||
        normalizeConversationId(configRef.current.conversationId);
      ensureThread(targetThreadId, knownConversationId);
      const existingMessages = threadMapRef.current[targetThreadId]?.messages || [];

      const userMessage = createMessage({
        threadId: targetThreadId,
        role: "user",
        metadata: { attachments: options?.attachments || [] },
        content:
          Array.isArray(options?.content) && options?.content.length > 0
            ? options.content
            : textPart(message),
      });
      appendMessage(targetThreadId, userMessage);

      const assistantMessageId = randomId("assistant");
      appendMessage(
        targetThreadId,
        createMessage({
          id: assistantMessageId,
          threadId: targetThreadId,
          role: "assistant",
          content: [],
        })
      );

      setThreadStage(targetThreadId, GenerationStage.STREAMING_RESPONSE, getChatStrings().thinking);
      configRef.current.setFollowups([]);

      const history = buildHistory([...existingMessages, userMessage]);
      const payload: any = {
        workflow: "chat",
        input: { text: message },
        history,
        attachment_ids: (options?.attachments || []).map(file => file.id),
      };
      if (knownConversationId) {
        payload.conversation_id = knownConversationId;
      }
      if (configRef.current.visitorToken) {
        payload.visitor_token = configRef.current.visitorToken;
      }
      const turnId = newTurnId();
      payload.turn_id = turnId;

      const controller = new AbortController();
      const inflight: InflightRequest = {
        assistantMessageId,
        aiExpected: !["handoff", "escalated", "closed"].includes(String(threadMapRef.current[targetThreadId]?.metadata?.chat_status || "")),
        controller,
        toolMessageId: null,
        turnId,
        shownChars: () => replyText.length,
      };
      inflightRef.current[targetThreadId] = inflight;

      configRef.current.onFeedback?.("send");
      let replyText = "";
      let replyFailed = false;
      let hasToolReply = false;
      const setAssistantText = (text: string) => {
        if (inflight.stoppedByHandoff) return;
        replyText = text;
        upsertMessageById(targetThreadId, assistantMessageId, (existing) => {
          const base =
            existing ||
            createMessage({
              id: assistantMessageId,
              threadId: targetThreadId,
              role: "assistant",
              content: [],
            });
          return {
            ...base,
            content: text ? textPart(text) : [],
          };
        });
      };

      // Optional "sources" frames (human-readable names of what the answer
      // used) render as chips under the answer; no frame, no chips.
      const setAssistantSources = (items: unknown) => {
        if (!Array.isArray(items) || items.length === 0 || inflight.stoppedByHandoff) return;
        upsertMessageById(targetThreadId, assistantMessageId, (existing) => {
          const base =
            existing ||
            createMessage({
              id: assistantMessageId,
              threadId: targetThreadId,
              role: "assistant",
              content: [],
            });
          return { ...base, metadata: { ...(base.metadata || {}), sources: items } };
        });
      };

      const setAssistantMessageId = (messageId: unknown) => {
        if ((typeof messageId !== "number" && typeof messageId !== "string") || messageId === "" || inflight.stoppedByHandoff) return;
        upsertMessageById(targetThreadId, assistantMessageId, (existing) => {
          const base =
            existing ||
            createMessage({
              id: assistantMessageId,
              threadId: targetThreadId,
              role: "assistant",
              content: [],
            });
          return { ...base, metadata: { ...(base.metadata || {}), message_id: messageId } };
        });
      };

      const setAssistantToolCall = (toolName: string, phase: "loading" | "complete") => {
        upsertMessageById(targetThreadId, assistantMessageId, (existing) => {
          const base =
            existing ||
            createMessage({
              id: assistantMessageId,
              threadId: targetThreadId,
              role: "assistant",
              content: [],
            });
          return withAssistantToolCall(base, toolName, phase);
        });
        // A new hand-off starts its card over; the server clears its side in the same turn.
        if (toolName === "escalate" && phase === "complete") {
          updateThread(targetThreadId, (thread) => ({ ...thread, metadata: { ...thread.metadata, handoff_contact: null } }));
        }
      };

      const upsertToolMessage = (payloadValue: unknown) => {
        hasToolReply = true;
        const inflight = inflightRef.current[targetThreadId];
        if (!inflight) return;
        if (!inflight.toolMessageId) {
          inflight.toolMessageId = randomId("tool");
        }
        const toolMessageId = inflight.toolMessageId;

        upsertMessageById(targetThreadId, toolMessageId, (existing) => {
          const base =
            existing ||
            createMessage({
              id: toolMessageId,
              threadId: targetThreadId,
              role: "tool",
              content: [],
            });
          return {
            ...base,
            role: "tool",
            content: toolPayloadToContent(payloadValue),
          };
        });
      };

      const finalizeAndReadAssistant = (stage: GenerationStage) => {
        if (stage === GenerationStage.IDLE && !controller.signal.aborted && !replyFailed && (replyText.trim() || hasToolReply)) {
          configRef.current.onFeedback?.("reply");
        }
        if (inflightRef.current[targetThreadId] === inflight) setThreadStage(targetThreadId, stage, "");
        const finalMessage = threadMapRef.current[targetThreadId]?.messages.find(
          (msg) => msg.id === assistantMessageId
        );
        return (
          finalMessage ||
          createMessage({
            id: assistantMessageId,
            threadId: targetThreadId,
            role: "assistant",
            content: [],
          })
        );
      };

      try {
        const streamDisabled =
          typeof window !== "undefined" && window.sessionStorage
            ? window.sessionStorage.getItem(STREAM_DISABLED_KEY) === "1"
            : false;

        let streamHandled = false;
        let fullText = "";
        let toolName: string | null = null;
        let toolPayload: unknown = null;
        // A frame only the inference API sends (conversation_id, thinking,
        // [DONE]...): the question reached the backend and is stored there.
        let streamReachedBackend = false;
        // The stream ended the turn on purpose (team took the chat over).
        let streamSettled = false;

        const canStream =
          !streamDisabled &&
          Boolean(configRef.current.streamUrl) &&
          typeof window !== "undefined" &&
          typeof window.ReadableStream !== "undefined";

        if (canStream) {
          try {
            let solvedPowHeader = "";
            for (let attempt = 0; attempt < 2; attempt += 1) {
              let capturedChallenge: PowChallenge | null = null;
              const streamRes = await fetch(configRef.current.streamUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "text/event-stream",
                  ...authHeaders(configRef.current),
                  ...(solvedPowHeader ? { "X-AlphaRecall-PoW": solvedPowHeader } : {}),
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
              });

              if (streamRes.ok && streamRes.body) {
                streamHandled = true;
                streamReachedBackend = false;
                await consumeSSE(streamRes.body, (rawData) => {
                  if (controller.signal.aborted) return true;
                  if (!rawData) return false;
                  if (rawData === "[DONE]") {
                    streamReachedBackend = true;
                    return true;
                  }

                  try {
                    const parsed = JSON.parse(rawData);
                    if (parsed && typeof parsed === "object" && parsed.code !== "pow_required") {
                      streamReachedBackend = true;
                    }

                    if (parsed?.event === "conversation_id") {
                      const nextConversationId = normalizeConversationId(parsed?.conversation_id);
                      if (nextConversationId) {
                        setConversationForThread(targetThreadId, nextConversationId);
                      }
                      return false;
                    }

                    if (parsed?.event === "chat_status") {
                      streamSettled = true;
                      fullText = "";
                      replyText = "";
                      hasToolReply = false;
                      configRef.current.setFollowups([]);
                      updateThread(targetThreadId, (thread) => ({
                        ...thread,
                        metadata: { ...thread.metadata, chat_status: parsed.status },
                        messages: thread.messages.filter((item) => item.id !== assistantMessageId && item.id !== inflight.toolMessageId),
                      }));
                      return true;
                    }

                    if (parsed?.event === "followups") {
                      configRef.current.setFollowups(filterStringArray(parsed?.items));
                      return false;
                    }

                    if (parsed?.event === "sources") {
                      setAssistantSources(parsed?.items);
                      return false;
                    }

                    if (parsed?.event === "message") {
                      setAssistantMessageId(parsed?.message_id);
                      return false;
                    }

                    if (parsed?.event === "tool_start") {
                      toolName = String(parsed?.tool || toolName || DEFAULT_TOOL_NAME);
                      const toolNames = Array.isArray(parsed?.tools)
                        ? parsed.tools.map(String).filter(Boolean)
                        : [toolName];
                      setThreadStage(
                        targetThreadId,
                        GenerationStage.STREAMING_RESPONSE,
                        toolStatusMessage(toolNames)
                      );
                      setAssistantToolCall(toolName, "loading");
                      return false;
                    }

                    if (parsed?.event === "thinking") {
                      setThreadStage(
                        targetThreadId,
                        GenerationStage.STREAMING_RESPONSE,
                        getChatStrings().thinking
                      );
                      return false;
                    }

                    if (parsed?.event === "components") {
                      toolName = String(parsed?.tool || toolName || DEFAULT_TOOL_NAME);
                      // Accumulate components across multiple tool rounds
                      const prevComponents = Array.isArray((toolPayload as Record<string, unknown>)?.components)
                        ? (toolPayload as Record<string, unknown>).components as unknown[]
                        : [];
                      const newComponents = Array.isArray(parsed?.components) ? parsed.components : [];
                      toolPayload = {
                        tool_output: parsed?.tool_output ?? (toolPayload as Record<string, unknown>)?.tool_output ?? null,
                        components: [...prevComponents, ...newComponents],
                      };
                      setAssistantToolCall(toolName, "complete");
                      upsertToolMessage(toolPayload);
                      return false;
                    }

                    if (parsed?.event === "tool_output") {
                      toolName = String(parsed?.tool || toolName || DEFAULT_TOOL_NAME);
                      toolPayload = {
                        tool_output: parsed?.tool_output ?? (toolPayload as Record<string, unknown>)?.tool_output ?? null,
                        components: (toolPayload as Record<string, unknown>)?.components ?? null,
                      };
                      setAssistantToolCall(toolName, "complete");
                      upsertToolMessage(toolPayload);
                      return false;
                    }

                    if (parsed?.code === "pow_required") {
                      const challenge = parsePowChallenge(parsed);
                      if (challenge) {
                        capturedChallenge = challenge;
                        return true;
                      }
                    }

                    if (typeof parsed?.error === "string") {
                      replyFailed = true;
                      // The PHP proxy sends a `code` with a message already
                      // written for the visitor (plan gate, rate limit, outage):
                      // show it plain. Uncoded errors keep the "Errore:" prefix.
                      const errMsg = typeof parsed?.code === "string"
                        ? parsed.error
                        : `${getChatStrings().errorPrefix} ${parsed.error}`;
                      fullText += errMsg;
                      setAssistantText(fullText);
                      return false;
                    }

                    if (typeof parsed?.delta === "string") {
                      fullText += parsed.delta;
                      const trimmed = fullText.trimStart();
                      // Suppress tool call JSON: if text starts with { buffer it
                      // until we know it's not a tool call (>400 chars without "tool")
                      if (trimmed.startsWith("{")) {
                        if (trimmed.includes('"tool"')) {
                          return false; // Confirmed tool call, never show
                        }
                        if (trimmed.length < 400) {
                          return false; // Still buffering, might be tool JSON
                        }
                      }
                      // Suppress embedded tool JSON mid-text
                      const toolJsonIdx = fullText.indexOf('{"tool"');
                      if (toolJsonIdx >= 0) {
                        const cleanText = fullText.substring(0, toolJsonIdx).trim();
                        if (cleanText) setAssistantText(cleanText);
                        return false;
                      }
                      setAssistantText(fullText);
                      return false;
                    }
                  } catch {
                    // Ignore non-JSON SSE data (keepalives, malformed events)
                    if (import.meta.env.DEV) console.warn("SSE parse error:", rawData);
                  }

                  return false;
                });

                if (capturedChallenge) {
                  if (attempt === 0) {
                    setThreadStage(
                      targetThreadId,
                      GenerationStage.STREAMING_RESPONSE,
                      getChatStrings().securityCheck
                    );
                    try {
                      const nonce = await solveProofOfWork(capturedChallenge, { signal: controller.signal });
                      solvedPowHeader = powHeader(capturedChallenge, nonce);
                      streamHandled = false;
                      continue;
                    } catch (error) {
                      // A visitor who stops the turn while the proof is being
                      // computed gets the normal abort path, not a failure text.
                      if (isAbortError(error)) {
                        throw error;
                      }
                      replyFailed = true;
                  setAssistantText(getChatStrings().securityCheckFailed);
                      streamHandled = true;
                      break;
                    }
                  }
                  replyFailed = true;
                  setAssistantText(getChatStrings().securityCheckFailed);
                  streamHandled = true;
                  break;
                }

                if (fullText) setAssistantText(fullText);
              } else if (
                streamRes.status >= 400 &&
                typeof window !== "undefined" &&
                window.sessionStorage
              ) {
                window.sessionStorage.setItem(STREAM_DISABLED_KEY, "1");
              }
              break;
            }
          } catch (error) {
            if (isAbortError(error)) {
              throw error;
            }
            // Continue to non-stream fallback
          }

          // A 200 that carried no answer: an empty body, or WordPress's own
          // "0" / "-1" (the AJAX action is missing or a security or cache
          // plugin filtered it), or a stream cut before any token or final
          // event. Nothing on screen would tell the visitor the question went
          // unanswered.
          if (
            streamHandled &&
            !streamSettled &&
            !replyFailed &&
            !hasToolReply &&
            !replyText.trim() &&
            !controller.signal.aborted &&
            !inflight.stoppedByHandoff
          ) {
            // The backend has the question stored once it sent a frame; asking
            // /chat again would store it twice, so the visitor gets Riprova.
            if (streamReachedBackend) throw new Error(NO_REPLY_ERROR);
            // Nothing from the backend at all: the proxy never relayed the
            // stream. Use /chat, as for a 5xx, and skip the stream this session.
            streamHandled = false;
            if (typeof window !== "undefined" && window.sessionStorage) {
              window.sessionStorage.setItem(STREAM_DISABLED_KEY, "1");
            }
          }
        }

        if (!streamHandled) {
          if (inflight.stoppedByHandoff) return finalizeAndReadAssistant(GenerationStage.IDLE);
          const fallbackRes = await fetchWithProofOfWork(`${configRef.current.restBase}/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders(configRef.current),
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          }, {
            onChallenge: () => setThreadStage(
              targetThreadId,
              GenerationStage.STREAMING_RESPONSE,
              getChatStrings().securityCheck
            ),
          });

          if (!fallbackRes.ok) {
            if (fallbackRes.status === 428) {
              throw new Error(getChatStrings().securityCheckFailed);
            }
            // Sending too fast is a short wait, not a lost connection. A 429
            // for the plan's message quota reads as a failed reply.
            if (fallbackRes.status === 429) {
              const limit = await fallbackRes.json().catch(() => null);
              throw new Error(limit?.code === "quota_exceeded" ? "Chat reply failed (429)" : getChatStrings().rateLimitError);
            }
            // A 5xx (often an HTML page from a proxy in front of the site)
            // reached the server but got no answer: say so, not "connection lost".
            // A slow answer cut by the proxy (504) or a CDN (Cloudflare 524)
            // is the same failed reply, with Riprova.
            throw new Error(`${fallbackRes.status >= 500 ? "Chat reply failed" : "Chat request failed"} (${fallbackRes.status})`);
          }

          // A 200 that is not JSON (a cache or security page) is a missing
          // answer too, never a raw "Unexpected token <" for the visitor.
          const data = await fallbackRes.json().catch(() => {
            throw new Error("Chat reply failed (invalid response)");
          });
          if (inflight.stoppedByHandoff) return finalizeAndReadAssistant(GenerationStage.IDLE);
          const nextConversationId = normalizeConversationId(data?.conversation_id);
          if (nextConversationId) {
            setConversationForThread(targetThreadId, nextConversationId);
          }

          if (data?.handoff || data?.cancelled) {
            updateThread(targetThreadId, (thread) => ({
              ...thread, metadata: { ...thread.metadata, chat_status: data.status },
              messages: thread.messages.filter((item) => item.id !== assistantMessageId),
            }));
            return finalizeAndReadAssistant(GenerationStage.IDLE);
          }

          if (Array.isArray(data?.followups)) {
            configRef.current.setFollowups(filterStringArray(data.followups));
          }

          const messageText = String(data?.output || data?.message || "");
          const fallbackToolName = data?.tool ? String(data.tool) : null;
          // A 200 with no text, no tool and no hand-off (an empty body, "0")
          // is an unanswered question, not an empty bubble.
          if (!messageText.trim() && !fallbackToolName) throw new Error(NO_REPLY_ERROR);
          setAssistantText(messageText);
          setAssistantSources(data?.sources);
          setAssistantMessageId(data?.message_id);

          if (fallbackToolName) {
            const fallbackToolPayload = {
              tool_output: data?.tool_output ?? null,
              components: data?.components ?? null,
            };
            setAssistantToolCall(fallbackToolName, "complete");
            upsertToolMessage(fallbackToolPayload);
          }
        }

        return finalizeAndReadAssistant(GenerationStage.IDLE);
      } catch (error) {
        if (inflight.stoppedByHandoff) return finalizeAndReadAssistant(GenerationStage.IDLE);
        if (isAbortError(error) || controller.signal.aborted) {
          upsertMessageById(targetThreadId, assistantMessageId, (existing) => ({
            ...(existing ||
              createMessage({
                id: assistantMessageId,
                threadId: targetThreadId,
                role: "assistant",
                content: [],
              })),
            isCancelled: true,
          }));
          return finalizeAndReadAssistant(GenerationStage.CANCELLED);
        }

        const errorMessage = error instanceof Error ? error.message : "Request failed";
        upsertMessageById(targetThreadId, assistantMessageId, (existing) => ({
          ...(existing ||
            createMessage({
              id: assistantMessageId,
              threadId: targetThreadId,
              role: "assistant",
              content: [],
            })),
          error: errorMessage,
        }));
        setThreadStage(targetThreadId, GenerationStage.ERROR, errorMessage);
        throw error;
      } finally {
        if (inflightRef.current[targetThreadId] === inflight) delete inflightRef.current[targetThreadId];
      }
    },
    [
      appendMessage,
      authHeaders,
      ensureThread,
      setConversationForThread,
      setCurrentThreadId,
      setThreadStage,
      upsertMessageById,
    ]
  );

  React.useEffect(() => {
    const externalConversationId = normalizeConversationId(config.conversationId);
    if (!externalConversationId || !config.visitorToken) return;

    let targetThreadId = findThreadByConversationId(externalConversationId);
    if (!targetThreadId) {
      targetThreadId = threadIdForConversation(externalConversationId);
      conversationByThreadRef.current[targetThreadId] = externalConversationId;
      ensureThread(targetThreadId, externalConversationId);
    }

    if (targetThreadId !== currentThreadIdRef.current) {
      setCurrentThreadId(targetThreadId);
    }

    if (!loadedConversationIdsRef.current.has(externalConversationId)) {
      loadedConversationIdsRef.current.add(externalConversationId);
      void loadConversationHistory(targetThreadId, externalConversationId);
    }
  }, [
    config.conversationId,
    config.visitorToken,
    ensureThread,
    findThreadByConversationId,
    loadConversationHistory,
    setCurrentThreadId,
  ]);

  React.useEffect(() => {
    if (!config.enableHumanPolling) return;
    if (config.isOpen === false) return;

    const threadId = currentThreadIdRef.current;
    if (!threadId) return;

    const conversationId =
      conversationByThreadRef.current[threadId] || normalizeConversationId(configRef.current.conversationId);
    if (!conversationId) return;

    let cancelled = false;
    let running = false;
    let timer: number | null = null;
    let idlePolls = 0;

    const schedule = (delayMs: number) => {
      if (cancelled) return;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        if (cancelled) return;
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (cancelled || running) return;
      const visibilityState =
        typeof document.visibilityState === "string" ? document.visibilityState : "visible";
      if (visibilityState !== "visible") {
        schedule(12000);
        return;
      }

      running = true;
      try {
        const after = pollingLastSeenRef.current[threadId] || null;
        const { rows, latest, forbidden, status } = await fetchStoredMessages(conversationId, after);
        if (cancelled) return;
        if (forbidden) {
          // Stale/abandoned thread: stop this poller (the finally won't reschedule
          // once cancelled). A thread switch re-runs the effect with a fresh poller.
          cancelled = true;
          return;
        }

        if (status) {
          setConversationStatus(conversationId, status);
        }

        let humanCount = 0;
        let seenSet = seenHumanMessagesRef.current[threadId];
        if (!seenSet) {
          seenSet = new Set<string>();
          seenHumanMessagesRef.current[threadId] = seenSet;
        }

        rows.forEach((row) => {
          if (row?.role !== "human") return;

          const dedupeKey = String(row?.id ?? `${row?.created_at || ""}:${row?.content || ""}`);
          if (seenSet.has(dedupeKey)) return;
          seenSet.add(dedupeKey);

          if (seenSet.size > 512) {
            const trimmed = Array.from(seenSet).slice(-256);
            seenHumanMessagesRef.current[threadId] = new Set(trimmed);
            seenSet = seenHumanMessagesRef.current[threadId];
          }

          humanCount += 1;
          appendMessage(
            threadId,
            createMessage({
              id: row?.id ? `human-${row.id}` : undefined,
              threadId,
              role: "assistant",
              content: row?.content ? textPart(String(row.content)) : [],
              createdAt: row?.created_at ? new Date(row.created_at).toISOString() : nowISO(),
              metadata: { human: true, ...operatorOf(row), attachments: row?.attachments || [] },
            })
          );
        });

        if (latest) {
          pollingLastSeenRef.current[threadId] = latest;
        }

        if (humanCount > 0) configRef.current.onFeedback?.("reply");
        idlePolls = humanCount > 0 ? 0 : Math.min(idlePolls + 1, 8);
      } catch (err) {
        if (import.meta.env.DEV) console.warn("Runtime polling error:", err);
      } finally {
        running = false;
        if (cancelled) return;
        schedule(idlePolls >= 3 ? 8000 : 4000);
      }
    };

    const onVisibilityChange = () => {
      if (cancelled || running) return;
      const visibilityState =
        typeof document.visibilityState === "string" ? document.visibilityState : "visible";
      if (visibilityState === "visible") {
        idlePolls = 0;
        schedule(150);
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    schedule(0);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
    // currentThreadId + conversationId are in deps so the poller re-targets the
    // active thread on reset/switch (cleanup cancels the old one) instead of
    // polling a stale thread forever.
  }, [appendMessage, setConversationStatus, config.enableHumanPolling, config.isOpen, fetchStoredMessages, currentThreadId, config.conversationId]);

  const currentThread =
    threadMap[currentThreadId] ||
    createThread(currentThreadId, conversationByThreadRef.current[currentThreadId] ?? null);

  const runtimeMessages = React.useMemo<RuntimeMessage[]>(() => {
    const items: RuntimeMessage[] = [];
    const messages = currentThread.messages || [];

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.role !== "user" && message.role !== "assistant") {
        continue;
      }

      const runtimeMessage: RuntimeMessage = {
        id: message.id,
        role: message.role === "user" ? "user" : "assistant",
        text: extractText(message),
        createdAt: message.createdAt,
        renderedComponent: message.renderedComponent,
        metadata:
          message.metadata && typeof message.metadata === "object"
            ? (message.metadata as Record<string, unknown>)
            : undefined,
        ...((message as { isCancelled?: boolean }).isCancelled ? { cancelled: true } : {}),
      };

      if (message.role === "assistant" && message.toolCallRequest) {
        runtimeMessage.toolName = message.toolCallRequest.toolName || DEFAULT_TOOL_NAME;
        for (let j = i + 1; j < messages.length; j += 1) {
          const next = messages[j];
          if (next.role === "tool") {
            runtimeMessage.toolResult = parseToolResultFromContent(next.content);
            break;
          }
          if (next.role === "assistant" && next.toolCallRequest) {
            break;
          }
        }
      }

      items.push(runtimeMessage);
    }

    return items;
  }, [currentThread.messages]);

  const isRunning = React.useMemo(() => {
    const stage = currentThread.generationStage;
    return isRunningStage(stage);
  }, [currentThread.generationStage]);

  const runtimeError = React.useMemo(() => {
    if (currentThread.generationStage === GenerationStage.ERROR && currentThread.statusMessage) {
      return currentThread.statusMessage;
    }
    // Only the newest turn can carry the alert: once a later question was sent
    // (a Riprova or a new message) or a later reply arrived, the failed turn
    // above it is history and must not keep offering Riprova.
    for (let i = currentThread.messages.length - 1; i >= 0; i -= 1) {
      const message = currentThread.messages[i];
      if (message.role === "assistant") return message.error || null;
      if (message.role === "user") return null;
    }
    return null;
  }, [currentThread.generationStage, currentThread.messages, currentThread.statusMessage]);

  const sendMessage = React.useCallback(
    async (text: string, attachments?: ChatAttachment[]) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const permission = configRef.current.beforeSend
        ? await configRef.current.beforeSend(trimmed)
        : { allowed: true };
      if (!permission.allowed) return false;
      if (permission.visitorToken || permission.chatSig || permission.chatTs) {
        // Registration and the first send happen within the same awaited user
        // action. Make fresh ownership and anti-abuse capabilities available
        // immediately instead of waiting for the next provider config render.
        configRef.current = {
          ...configRef.current,
          ...(permission.visitorToken ? { visitorToken: permission.visitorToken } : {}),
          ...(permission.chatSig ? { chatSig: permission.chatSig } : {}),
          ...(permission.chatTs ? { chatTs: permission.chatTs } : {}),
        };
      }
      const request = sendThreadMessage(trimmed, {
        threadId: currentThreadIdRef.current,
        streamResponse: true,
        attachments,
      });
      // Acceptance and response completion are separate phases. The composer
      // clears as soon as the request starts while the runtime continues
      // streaming and exposes failures through its existing error state.
      void request.catch(() => undefined);
      return true;
    },
    [sendThreadMessage]
  );

  const cancelCurrent = React.useCallback(() => {
    void cancel(currentThreadIdRef.current);
  }, [cancel]);

  const clearConversation = React.useCallback(() => {
    // This chat may be waiting for a person: tell them nobody is there any more.
    const leaving = conversationByThreadRef.current[currentThreadIdRef.current];
    const left = threadMapRef.current[currentThreadIdRef.current];
    if (leaving && awaitsPerson(left?.metadata?.chat_status, lastAssistantTool(left?.messages))) {
      void sendVisitorPresence({
        restBase: configRef.current.restBase,
        headers: authHeaders(configRef.current),
        conversationId: leaving,
        state: "new_chat",
      });
    }
    Object.values(inflightRef.current).forEach((inflight) => {
      inflight.controller.abort();
      void cancelTurn({
        restBase: configRef.current.restBase,
        headers: authHeaders(configRef.current),
        turnId: inflight.turnId,
        shownChars: inflight.shownChars(),
      });
    });
    inflightRef.current = {};

    const threadId = randomId("thread");
    conversationByThreadRef.current = {
      [threadId]: null,
    };
    loadedConversationIdsRef.current.clear();
    pollingLastSeenRef.current = {};
    seenHumanMessagesRef.current = {};

    setThreadMap({
      [threadId]: createThread(threadId, null),
    });
    setCurrentThreadId(threadId);
    configRef.current.setConversationId(null);
    configRef.current.setFollowups([]);
  }, [authHeaders, setCurrentThreadId, setThreadMap]);

  const appendHumanMessage = React.useCallback(
    (text: string, source?: { id?: number; created_at?: string; conversationId: number; attachments?: ChatAttachment[]; profile_name?: string }) => {
      const threadId = source ? findThreadByConversationId(source.conversationId) : currentThreadIdRef.current;
      if (!threadId) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const id = source?.id ? `human-${source.id}` : undefined;
      const incoming = createMessage({
        id, createdAt: source?.created_at, threadId, role: "assistant",
        content: textPart(trimmed), metadata: { human: true, ...operatorOf(source), attachments: source?.attachments || [] },
      });
      updateThread(threadId, (thread) => id && thread.messages.some(message => message.id === id)
        ? thread : { ...thread, messages: [...thread.messages, incoming] });
    },
    [updateThread, findThreadByConversationId]
  );

  const chatRuntimeValue = React.useMemo<ChatRuntimeContextValue>(
    () => ({
      messages: runtimeMessages,
      isRunning,
      statusMessage: currentThread.statusMessage || getChatStrings().thinking,
      humanHandling: ["handoff", "escalated", "closed"].includes(String(currentThread.metadata?.chat_status || "")),
      chatStatus: currentThread.metadata?.chat_status ? String(currentThread.metadata.chat_status) : null,
      handoffContact: currentThread.metadata?.handoff_contact ? String(currentThread.metadata.handoff_contact) : null,
      awaitingPerson: awaitsPerson(currentThread.metadata?.chat_status, lastAssistantTool(currentThread.messages)),
      humanJoined: runtimeMessages.some((message) => message.metadata?.human === true),
      setConversationStatus,
      error: runtimeError,
      sendMessage,
      attachmentClient,
      conversationKey: currentThread.id,
      cancel: cancelCurrent,
      clearConversation,
      appendHumanMessage,
    }),
    [appendHumanMessage, attachmentClient, cancelCurrent, clearConversation, currentThread.id, currentThread.statusMessage, currentThread.metadata?.chat_status, currentThread.metadata?.handoff_contact, currentThread.messages, isRunning, runtimeError, runtimeMessages, sendMessage, setConversationStatus]
  );

  const threads = React.useMemo(() => {
    const items = Object.values(threadMap).sort((a, b) => {
      const left = a.updatedAt || a.createdAt;
      const right = b.updatedAt || b.createdAt;
      return left > right ? -1 : left < right ? 1 : 0;
    });
    return {
      items,
      total: items.length,
      count: items.length,
    };
  }, [threadMap]);

  return (
    <ChatRuntimeContext.Provider value={chatRuntimeValue}>
      <TamboStubProvider
        thread={currentThread}
        threads={threads}
        switchCurrentThread={switchCurrentThread}
        startNewThread={startNewThread}
        updateThreadName={updateThreadName}
        generateThreadName={generateThreadName}
        addThreadMessage={addThreadMessage}
        updateThreadMessage={updateThreadMessage}
        sendThreadMessage={sendThreadMessage}
        cancel={cancel}
        streaming
      >
        <TamboThreadInputProvider>{children}</TamboThreadInputProvider>
      </TamboStubProvider>
    </ChatRuntimeContext.Provider>
  );
}
