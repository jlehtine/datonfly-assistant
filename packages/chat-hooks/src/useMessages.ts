import { useCallback, useEffect, useRef, useState } from "react";

import type { ErrorEvent, MessageCompleteEvent, MessageDeltaEvent, ThreadMessage } from "@datonfly-assistant/core";

import { useChatClient } from "./context.js";

/** A single chat message held in local React state. */
export interface ChatMessage {
    /** Unique client-side message identifier. */
    id: string;
    /** Whether the message was sent by the user or the assistant. */
    role: "human" | "ai";
    /** Plain-text or Markdown message body. */
    text: string;
    /** `true` while the assistant is still streaming this message. */
    streaming: boolean;
    /** Timestamp when the message was created (only set for history-loaded messages). */
    createdAt?: Date | undefined;
}

/** Options for {@link useMessages}. */
export interface UseMessagesOptions {
    /** REST server base URL used to load message history. */
    url?: string | undefined;
    /** Optional callback that returns a JWT for authentication. */
    getToken?: (() => string | null) | undefined;
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
    /** The most recent error message, or `null` if there is none. */
    error: string | null;
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
    const text = extractText(msg);
    return { id: msg.id, role: msg.role, text, streaming: false, createdAt: msg.createdAt };
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
    const { url, getToken, historyPageSize = 50 } = options;
    const client = useChatClient();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const streamingIdRef = useRef<string | null>(null);
    const resolvedThreadIdRef = useRef(threadId);
    // Tracks the createdAt of the oldest loaded message for scroll-up pagination
    const oldestCreatedAtRef = useRef<Date | null>(null);
    // Synchronous loading guard to prevent concurrent history fetches (state updates are async)
    const isLoadingHistoryRef = useRef(false);

    // Keep ref in sync when parent passes a new threadId
    useEffect(() => {
        resolvedThreadIdRef.current = threadId;
    }, [threadId]);

    const authHeaders = useCallback((): Record<string, string> => {
        const token = getToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [getToken]);

    /**
     * Fetch a page of history messages from the REST API.
     * Returns messages sorted oldest-first (as returned by loadMessages in the backend).
     */
    const fetchHistory = useCallback(
        async (tid: string, before?: Date): Promise<{ messages: ChatMessage[]; hasMore: boolean }> => {
            if (!url) return { messages: [], hasMore: false };
            const params = new URLSearchParams({ limit: String(historyPageSize) });
            if (before) params.set("before", before.toISOString());
            const res = await fetch(`${url}/threads/${tid}/messages?${params.toString()}`, {
                headers: authHeaders(),
            });
            if (!res.ok) throw new Error(`Failed to load history: ${res.statusText}`);
            const raw = (await res.json()) as (Omit<ThreadMessage, "createdAt"> & { createdAt: string })[];
            const parsed = raw.map((m) => ({ ...m, createdAt: new Date(m.createdAt) }));
            const chatMsgs = parsed.flatMap((m) => {
                const c = toChat(m);
                return c ? [c] : [];
            });
            // A full page indicates there are likely more messages to load before this batch.
            return { messages: chatMsgs, hasMore: raw.length === historyPageSize };
        },
        [url, historyPageSize, authHeaders],
    );

    // Reset and load history when threadId changes
    useEffect(() => {
        setMessages([]);
        setHasMore(false);
        oldestCreatedAtRef.current = null;
        isLoadingHistoryRef.current = false;
        streamingIdRef.current = null;
        setIsStreaming(false);

        if (!threadId || !url) return;

        isLoadingHistoryRef.current = true;
        setIsLoadingHistory(true);
        void (async () => {
            try {
                const result = await fetchHistory(threadId);
                setMessages(result.messages);
                setHasMore(result.hasMore);
                oldestCreatedAtRef.current = result.messages[0]?.createdAt ?? null;
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to load history");
            } finally {
                isLoadingHistoryRef.current = false;
                setIsLoadingHistory(false);
            }
        })();
    }, [threadId, url, fetchHistory]);

    // Keep a ref to the current messages so loadMore can access the oldest message's createdAt
    // without needing messages as a dependency.
    const messagesRef = useRef<ChatMessage[]>([]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const loadMore = useCallback(() => {
        const tid = resolvedThreadIdRef.current;
        // Use the synchronous ref guard to prevent concurrent fetches (React state updates are async)
        if (!tid || !url || isLoadingHistoryRef.current) return;

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
                setError(e instanceof Error ? e.message : "Failed to load more messages");
                isLoadingHistoryRef.current = false;
                setIsLoadingHistory(false);
            });
    }, [url, fetchHistory]);

    useEffect(() => {
        const handleDelta = (event: MessageDeltaEvent): void => {
            if (event.threadId !== resolvedThreadIdRef.current) return;

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

            setMessages((prev) =>
                prev.map((m) => (m.id === event.messageId ? { ...m, text: fullText, streaming: false } : m)),
            );
            streamingIdRef.current = null;
            setIsStreaming(false);
        };

        const handleError = (event: ErrorEvent): void => {
            setError(event.message);
            setIsStreaming(false);
            streamingIdRef.current = null;
        };

        client.on("message-delta", handleDelta);
        client.on("message-complete", handleComplete);
        client.on("error", handleError);

        return () => {
            client.off("message-delta", handleDelta);
            client.off("message-complete", handleComplete);
            client.off("error", handleError);
        };
    }, [client]);

    const sendMessage = useCallback(
        (text: string) => {
            const userMsg: ChatMessage = {
                id: crypto.randomUUID(),
                role: "human",
                text,
                streaming: false,
                createdAt: new Date(),
            };
            setMessages((prev) => [...prev, userMsg]);
            setIsStreaming(true);
            setError(null);

            void (async () => {
                try {
                    const tid = onBeforeSend ? await onBeforeSend() : resolvedThreadIdRef.current;
                    if (!tid) return;
                    resolvedThreadIdRef.current = tid;
                    client.sendMessage(tid, text);
                } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : "Failed to send message");
                    setIsStreaming(false);
                }
            })();
        },
        [client, onBeforeSend],
    );

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return { messages, sendMessage, isStreaming, error, clearError, isLoadingHistory, hasMore, loadMore };
}
