import { useCallback, useEffect, useRef, useState } from "react";

import {
    ERROR_CODES,
    threadMessageListWireSchema,
    threadMessagesPath,
    type AttachmentContentPart,
    type ContentPart,
    type ErrorCode,
    type ErrorEvent,
    type MessageCompleteEvent,
    type MessageStatusEvent,
    type NewMessageEvent,
    type PartDeltaEvent,
    type StatusCode,
    type ThreadMessage,
} from "@datonfly-assistant/core";

import { ChatError, typedFetch } from "../fetch.js";
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
    /** Ordered content parts of the message. */
    parts: ContentPart[];
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
    /** Send a user message to the server, optionally with context-input attachments. */
    sendMessage: (text: string, attachments?: AttachmentContentPart[]) => void;
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

/** Convert a {@link ThreadMessage} from the REST API to a {@link ChatMessage}. */
function toChat(msg: ThreadMessage): ChatMessage | null {
    if (msg.role === "system") return null;
    const interrupted = msg.metadata ? msg.metadata.interrupted === true : false;
    return {
        id: msg.id,
        role: msg.role,
        parts: msg.content,
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
    // Message IDs whose message-complete has already been handled, so a
    // straggling part-delta that arrives afterward (the two travel over
    // different emit paths server-side) is dropped instead of being mistaken
    // for the start of a new message.
    const completedMessageIdsRef = useRef(new Set());
    const resolvedThreadIdRef = useRef(threadId);
    const previousThreadIdRef = useRef(threadId);
    // Tracks the createdAt of the oldest loaded message for scroll-up pagination
    const oldestCreatedAtRef = useRef<Date | null>(null);
    // Synchronous loading guard to prevent concurrent history fetches (state updates are async)
    const isLoadingHistoryRef = useRef(false);
    // Flag set synchronously in sendMessage to signal that the upcoming
    // threadId null→value transition should NOT reset isStreaming. Stays set
    // until that transition consumes it: it can land after the first deltas,
    // so clearing it any earlier would let the reset through.
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
        const previousThreadId = previousThreadIdRef.current;
        previousThreadIdRef.current = threadId;

        // Lazily-created thread for a send already in flight (null → new id).
        // Local state is the only copy of this conversation: the optimistic
        // message, plus any deltas already streaming in. The server has no
        // history worth loading yet, so resetting and re-fetching here only
        // races the stream — an overwrite that lands after the first deltas
        // discards the reply, and nothing arrives later to rebuild it.
        // pendingSendRef is set synchronously in sendMessage. It is cleared
        // below, but only on the null→id transition, which never happens on a
        // mount — so StrictMode's remount cannot consume it early.
        if (pendingSendRef.current && previousThreadId == null && threadId != null) {
            // Consumed: leaving it set would make a later null→id transition
            // (opening a thread from the new-conversation view) skip its
            // history fetch too, leaving that thread rendered empty.
            pendingSendRef.current = false;
            setHasMore(false);
            oldestCreatedAtRef.current = null;
            isLoadingHistoryRef.current = false;
            return;
        }

        setMessages([]);
        setHasMore(false);
        oldestCreatedAtRef.current = null;
        isLoadingHistoryRef.current = false;
        streamingIdRef.current = null;
        completedMessageIdsRef.current.clear();
        setIsStreaming(false);
        setStreamingStatus(null);

        if (!threadId) return;

        isLoadingHistoryRef.current = true;
        setIsLoadingHistory(true);
        void (async () => {
            try {
                const result = await fetchHistory(threadId);
                setMessages((prev) => {
                    // Anything already in local state that the fetched snapshot
                    // does not contain arrived while the request was in flight
                    // (streamed over the websocket, filtered to this thread by
                    // the handlers above). Overwriting outright would discard a
                    // live reply — only observable when the response arrives as
                    // fast as the REST round trip.
                    const fetched = new Set(result.messages.map((message) => message.id));
                    const newer = prev.filter((message) => !fetched.has(message.id));
                    return [...result.messages, ...newer];
                });
                setHasMore(result.hasMore);
                oldestCreatedAtRef.current = result.messages[0]?.createdAt ?? null;
            } catch (e: unknown) {
                console.error("[useMessages] Failed to load history:", e);
                const code = e instanceof ChatError && e.code ? e.code : ERROR_CODES.client_error;
                setError({ code, message: e instanceof ChatError ? e.message : "Failed to load history" });
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
                const code = e instanceof ChatError && e.code ? e.code : ERROR_CODES.client_error;
                setError({ code, message: e instanceof ChatError ? e.message : "Failed to load more messages" });
                isLoadingHistoryRef.current = false;
                setIsLoadingHistory(false);
            });
    }, [fetchHistory]);

    useEffect(() => {
        const handleDelta = (event: PartDeltaEvent): void => {
            if (event.threadId !== resolvedThreadIdRef.current) return;
            // A straggler for a message that already completed — drop it rather
            // than reopening it as a new streaming message.
            if (completedMessageIdsRef.current.has(event.messageId)) return;
            // Clear tool-status indicator as soon as actual text arrives
            setStreamingStatus(null);

            const incomingPart: Extract<ContentPart, { type: "text" | "thinking" }> =
                event.type === "thinking"
                    ? { type: "thinking", text: event.delta }
                    : { type: "text", text: event.delta };

            if (streamingIdRef.current !== event.messageId) {
                streamingIdRef.current = event.messageId;
                const initialParts: ContentPart[] = [];
                for (let i = 0; i < event.partIndex; i++) {
                    initialParts.push({ type: "thinking", text: "" });
                }
                initialParts.push(incomingPart);
                setMessages((prev) => [
                    ...prev,
                    {
                        id: event.messageId,
                        role: "ai",
                        parts: initialParts,
                        streaming: true,
                        createdAt: new Date(),
                    },
                ]);
            } else {
                setMessages((prev) =>
                    prev.map((m) => {
                        if (m.id !== event.messageId) return m;

                        const nextParts = [...m.parts];
                        const existingPart = nextParts[event.partIndex];
                        if (existingPart?.type === event.type) {
                            nextParts[event.partIndex] = {
                                ...existingPart,
                                text: existingPart.text + event.delta,
                            };
                            return { ...m, parts: nextParts };
                        }

                        if (event.partIndex < nextParts.length) {
                            nextParts[event.partIndex] = incomingPart;
                        } else {
                            nextParts.push(incomingPart);
                        }
                        return { ...m, parts: nextParts };
                    }),
                );
            }
        };

        const handleComplete = (event: MessageCompleteEvent): void => {
            if (event.threadId !== resolvedThreadIdRef.current) return;

            const parts = event.content;

            setMessages((prev) => {
                const existingIndex = prev.findIndex((m) => m.id === event.messageId);
                if (existingIndex >= 0) {
                    return prev.map((m) =>
                        m.id === event.messageId
                            ? { ...m, parts, streaming: false, interrupted: event.interrupted }
                            : m,
                    );
                }

                return [
                    ...prev,
                    {
                        id: event.messageId,
                        role: "ai",
                        parts,
                        streaming: false,
                        createdAt: new Date(),
                        interrupted: event.interrupted,
                    },
                ];
            });
            streamingIdRef.current = null;
            completedMessageIdsRef.current.add(event.messageId);
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

            setMessages((prev) => {
                // Deduplicate: the sender's tab already has this message via optimistic insert.
                if (prev.some((m) => m.id === event.messageId)) return prev;
                return [
                    ...prev,
                    {
                        id: event.messageId,
                        role,
                        parts: event.content,
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

        client.on("part-delta", handleDelta);
        client.on("message-complete", handleComplete);
        client.on("message-status", handleStatus);
        client.on("new-message", handleNewMessage);
        client.on("error", handleError);

        return () => {
            client.off("part-delta", handleDelta);
            client.off("message-complete", handleComplete);
            client.off("message-status", handleStatus);
            client.off("new-message", handleNewMessage);
            client.off("error", handleError);
        };
    }, [client]);

    const sendMessage = useCallback(
        (text: string, attachments: AttachmentContentPart[] = []) => {
            const messageId = crypto.randomUUID();
            const parts: ContentPart[] = [];
            if (text.length > 0 || attachments.length === 0) {
                parts.push({ type: "text", text });
            }
            parts.push(...attachments);
            const userMsg: ChatMessage = {
                id: messageId,
                role: "human",
                parts,
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
                    client.sendMessage(tid, messageId, text, attachments);
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
