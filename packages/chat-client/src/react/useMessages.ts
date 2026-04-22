import { useCallback, useEffect, useRef, useState } from "react";

import {
    ERROR_CODES,
    threadMessageListWireSchema,
    threadMessagesPath,
    type ErrorCode,
    type ErrorEvent,
    type MessageCompleteEvent,
    type MessageDeltaEvent,
    type MessageStatusEvent,
    type NewMessageEvent,
    type StatusCode,
    type ThreadMessage,
} from "@datonfly-assistant/core";

import { typedFetch } from "../fetch.js";
import { useChatClient, useCurrentUserId } from "./context.js";

/** Structured error exposed by {@link useMessages}. */
export interface ChatErrorInfo {
    /** Machine-readable error code. */
    code: ErrorCode;
    /** Human-readable English error message. */
    message: string;
}

/** Structured streaming status exposed by {@link useMessages}. */
export interface ChatStatusInfo {
    /** Machine-readable status code for i18n lookup. */
    code: StatusCode;
    /** Human-readable English status text (fallback). */
    text: string;
}

/** A single chat message held in local React state. */
export interface ChatMessage {
    /** Unique message identifier (client-generated for human messages, server-generated for AI). */
    id: string;
    /** Whether the message was sent by the user or the assistant. */
    role: "human" | "ai";
    /** Plain-text or Markdown message body. */
    text: string;
    /** `true` while the assistant is still streaming this message. */
    streaming: boolean;
    /** Timestamp when the message was created (only set for history-loaded messages). */
    createdAt?: Date | undefined;
    /** User ID of the message author, or `null` for AI messages. */
    authorId?: string | null | undefined;
    /** Display name of the message author. */
    authorName?: string | null | undefined;
    /** Avatar URL of the message author. */
    authorAvatarUrl?: string | null | undefined;
    /** `true` when the AI response was interrupted before completion. */
    interrupted?: boolean | undefined;
}

/** Options for {@link useMessages}. */
export interface UseMessagesOptions {
    /** Number of messages to fetch per history page. Defaults to 50. */
    historyPageSize?: number | undefined;
}

/** Return value of {@link useMessages}. */
export interface UseMessagesResult {
    /** Ordered list of messages in the current thread. */
    messages: ChatMessage[];
    /** Send a user message to the server. */
    sendMessage: (text: string) => void;
    /** `true` while the assistant is generating a response. */
    isStreaming: boolean;
    /** Transient status during streaming (e.g. code execution), or `null`. */
    streamingStatus: ChatStatusInfo | null;
    /** The most recent error, or `null` if there is none. */
    error: ChatErrorInfo | null;
    /** Dismiss the current error. */
    clearError: () => void;
    /** `true` while history is being fetched from the server. */
    isLoadingHistory: boolean;
    /** `true` when there are older messages available to load. */
    hasMore: boolean;
    /** Load the next page of older messages (scroll-up pagination). */
    loadMore: () => void;
}

/** Extract the plain-text body from a {@link ThreadMessage}. */
function extractText(msg: ThreadMessage): string {
    return msg.content
        .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n");
}

/** Convert a {@link ThreadMessage} from the REST API to a {@link ChatMessage}. */
function toChat(msg: ThreadMessage): ChatMessage | null {
    if (msg.role === "system") return null;
    const text = extractText(msg);
    const interrupted = msg.metadata ? msg.metadata.interrupted === true : false;
    return {
        id: msg.id,
        role: msg.role,
        text,
        streaming: false,
        createdAt: msg.createdAt,
        authorId: msg.authorId,
        authorName: msg.authorName,
        authorAvatarUrl: msg.authorAvatarUrl,
        interrupted: interrupted || undefined,
    };
}

/**
 * Subscribe to real-time chat messages for a thread and expose a send handler.
 *
 * When `options.url` is provided and a `threadId` is set, historical messages are
 * fetched from the REST API on thread change and when the user scrolls up ({@link UseMessagesResult.loadMore}).
 *
 * @param threadId - The thread to subscribe to, or `null` if the thread is not yet known.
 * @param onBeforeSend - Optional async callback invoked before each send; must resolve to the
 *   thread ID to use (useful when the thread needs to be created lazily).
 * @param options - Additional options for history loading.
 */
export function useMessages(
    threadId: string | null,
    onBeforeSend?: () => Promise<string>,
    options: UseMessagesOptions = {},
): UseMessagesResult {
    const { historyPageSize = 50 } = options;
    const client = useChatClient();
    const currentUserId = useCurrentUserId();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingStatus, setStreamingStatus] = useState<ChatStatusInfo | null>(null);
    const [error, setError] = useState<ChatErrorInfo | null>(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const streamingIdRef = useRef<string | null>(null);
    const resolvedThreadIdRef = useRef(threadId);
    // Tracks the createdAt of the oldest loaded message for scroll-up pagination
    const oldestCreatedAtRef = useRef<Date | null>(null);
    // Synchronous loading guard to prevent concurrent history fetches (state updates are async)
    const isLoadingHistoryRef = useRef(false);
    // Flag set synchronously in sendMessage to signal that the upcoming
    // threadId null→value transition should NOT reset isStreaming.
    // Safe with React StrictMode because it is never mutated inside effects.
    const pendingSendRef = useRef(false);

    /**
     * Fetch a page of history messages from the REST API.
     * Returns messages sorted oldest-first (as returned by loadMessages in the backend).
     */
    const fetchHistory = useCallback(
        async (tid: string, before?: Date): Promise<{ messages: ChatMessage[]; hasMore: boolean }> => {
            const query: Record<string, string> = { limit: String(historyPageSize) };
            if (before) query.before = before.toISOString();
            const raw = await typedFetch(client, threadMessagesPath(tid), threadMessageListWireSchema, { query });
            const chatMsgs = raw.flatMap((m) => {
                const c = toChat(m);
                return c ? [c] : [];
            });
            // A full page indicates there are likely more messages to load before this batch.
            return { messages: chatMsgs, hasMore: raw.length === historyPageSize };
        },
        [client, historyPageSize],
    );

    // Keep ref in sync so event handlers always filter by the latest threadId.
    useEffect(() => {
        resolvedThreadIdRef.current = threadId;
    }, [threadId]);

    // Reset and load history when threadId changes
    useEffect(() => {
        setMessages([]);
        setHasMore(false);
        oldestCreatedAtRef.current = null;
        isLoadingHistoryRef.current = false;
        streamingIdRef.current = null;
        // When a send is pending and we're transitioning to a thread
        // (null → value, lazy-created thread), preserve isStreaming so the
        // thinking indicator stays visible.  pendingSendRef is set
        // synchronously in sendMessage and is never mutated inside effects,
        // so it works correctly with React StrictMode double-invocation.
        if (!pendingSendRef.current || threadId == null) {
            setIsStreaming(false);
            setStreamingStatus(null);
        }

        if (!threadId) return;

        isLoadingHistoryRef.current = true;
        setIsLoadingHistory(true);
        void (async () => {
            try {
                const result = await fetchHistory(threadId);
                setMessages(result.messages);
                setHasMore(result.hasMore);
                oldestCreatedAtRef.current = result.messages[0]?.createdAt ?? null;
            } catch (e: unknown) {
                console.error("[useMessages] Failed to load history:", e);
                setError({ code: ERROR_CODES.client_error, message: "Failed to load history" });
            } finally {
                isLoadingHistoryRef.current = false;
                setIsLoadingHistory(false);
            }
        })();
    }, [threadId, fetchHistory]);

    // Keep a ref to the current messages so loadMore can access the oldest message's createdAt
    // without needing messages as a dependency.
    const messagesRef = useRef<ChatMessage[]>([]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const loadMore = useCallback(() => {
        const tid = resolvedThreadIdRef.current;
        // Use the synchronous ref guard to prevent concurrent fetches (React state updates are async)
        if (!tid || isLoadingHistoryRef.current) return;

        // Use the explicitly tracked cursor; fall back to the oldest loaded message's createdAt
        // only if the cursor hasn't been set yet (e.g. on first loadMore call in an edge case).
        const cursor = oldestCreatedAtRef.current ?? messagesRef.current[0]?.createdAt;
        isLoadingHistoryRef.current = true;
        setIsLoadingHistory(true);
        void fetchHistory(tid, cursor)
            .then((result) => {
                setMessages((prev) => [...result.messages, ...prev]);
                setHasMore(result.hasMore);
                // Only update cursor if new messages were returned; preserve existing cursor otherwise
                if (result.messages[0]?.createdAt) {
                    oldestCreatedAtRef.current = result.messages[0].createdAt;
                }
                isLoadingHistoryRef.current = false;
                setIsLoadingHistory(false);
            })
            .catch((e: unknown) => {
                console.error("[useMessages] Failed to load more messages:", e);
                setError({ code: ERROR_CODES.client_error, message: "Failed to load more messages" });
                isLoadingHistoryRef.current = false;
                setIsLoadingHistory(false);
            });
    }, [fetchHistory]);

    useEffect(() => {
        const handleDelta = (event: MessageDeltaEvent): void => {
            if (event.threadId !== resolvedThreadIdRef.current) return;
            pendingSendRef.current = false;
            // Clear tool-status indicator as soon as actual text arrives
            setStreamingStatus(null);

            if (streamingIdRef.current !== event.messageId) {
                streamingIdRef.current = event.messageId;
                setMessages((prev) => [
                    ...prev,
                    {
                        id: event.messageId,
                        role: "ai",
                        text: event.delta,
                        streaming: true,
                        createdAt: new Date(),
                    },
                ]);
            } else {
                setMessages((prev) =>
                    prev.map((m) => (m.id === event.messageId ? { ...m, text: m.text + event.delta } : m)),
                );
            }
        };

        const handleComplete = (event: MessageCompleteEvent): void => {
            if (event.threadId !== resolvedThreadIdRef.current) return;

            const fullText = event.content
                .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
                .map((p) => p.text)
                .join("\n");

            setMessages((prev) => {
                const existingIndex = prev.findIndex((m) => m.id === event.messageId);
                if (existingIndex >= 0) {
                    return prev.map((m) =>
                        m.id === event.messageId
                            ? { ...m, text: fullText, streaming: false, interrupted: event.interrupted }
                            : m,
                    );
                }

                return [
                    ...prev,
                    {
                        id: event.messageId,
                        role: "ai",
                        text: fullText,
                        streaming: false,
                        createdAt: new Date(),
                        interrupted: event.interrupted,
                    },
                ];
            });
            streamingIdRef.current = null;
            pendingSendRef.current = false;
            setIsStreaming(false);
            setStreamingStatus(null);
        };

        const handleStatus = (event: MessageStatusEvent): void => {
            if (event.threadId !== resolvedThreadIdRef.current) return;
            setStreamingStatus({ code: event.status, text: event.statusText });
        };

        const handleNewMessage = (event: NewMessageEvent): void => {
            if (event.threadId !== resolvedThreadIdRef.current) return;
            if (event.role === "system") return;

            const role = event.role;
            const text = event.content
                .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
                .map((p) => p.text)
                .join("\n");

            setMessages((prev) => {
                // Deduplicate: the sender's tab already has this message via optimistic insert.
                if (prev.some((m) => m.id === event.messageId)) return prev;
                return [
                    ...prev,
                    {
                        id: event.messageId,
                        role,
                        text,
                        streaming: false,
                        createdAt: new Date(event.createdAt),
                        authorId: event.authorId,
                        authorName: event.authorName,
                        authorAvatarUrl: event.authorAvatarUrl,
                    },
                ];
            });
        };

        const handleError = (event: ErrorEvent): void => {
            setError({ code: event.code, message: event.message });
            setIsStreaming(false);
            setStreamingStatus(null);
            streamingIdRef.current = null;
            pendingSendRef.current = false;
        };

        client.on("message-delta", handleDelta);
        client.on("message-complete", handleComplete);
        client.on("message-status", handleStatus);
        client.on("new-message", handleNewMessage);
        client.on("error", handleError);

        return () => {
            client.off("message-delta", handleDelta);
            client.off("message-complete", handleComplete);
            client.off("message-status", handleStatus);
            client.off("new-message", handleNewMessage);
            client.off("error", handleError);
        };
    }, [client]);

    const sendMessage = useCallback(
        (text: string) => {
            const messageId = crypto.randomUUID();
            const userMsg: ChatMessage = {
                id: messageId,
                role: "human",
                text,
                streaming: false,
                createdAt: new Date(),
                authorId: currentUserId,
            };
            setMessages((prev) => [...prev, userMsg]);
            pendingSendRef.current = true;
            setIsStreaming(true);
            setError(null);

            void (async () => {
                try {
                    const tid = onBeforeSend ? await onBeforeSend() : resolvedThreadIdRef.current;
                    if (!tid) return;
                    resolvedThreadIdRef.current = tid;
                    client.sendMessage(tid, messageId, text);
                } catch (e: unknown) {
                    console.error("[useMessages] Failed to send message:", e);
                    setError({ code: ERROR_CODES.client_error, message: "Failed to send message" });
                    setIsStreaming(false);
                }
            })();
        },
        [client, currentUserId, onBeforeSend],
    );

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return {
        messages,
        sendMessage,
        isStreaming,
        streamingStatus,
        error,
        clearError,
        isLoadingHistory,
        hasMore,
        loadMore,
    };
}
