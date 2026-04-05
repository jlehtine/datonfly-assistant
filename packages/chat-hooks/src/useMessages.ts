import { useCallback, useEffect, useRef, useState } from "react";

import type { ErrorEvent, MessageCompleteEvent, MessageDeltaEvent } from "@verbal-assistant/core";

import { useChatClient } from "./context.js";

/** A single chat message held in local React state. */
export interface ChatMessage {
    /** Unique client-side message identifier. */
    id: string;
    /** Whether the message was sent by the user or the assistant. */
    role: "user" | "assistant";
    /** Plain-text or Markdown message body. */
    text: string;
    /** `true` while the assistant is still streaming this message. */
    streaming: boolean;
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
}

/**
 * Subscribe to real-time chat messages for a thread and expose a send handler.
 *
 * @param threadId - The thread to subscribe to, or `null` if the thread is not yet known.
 * @param onBeforeSend - Optional async callback invoked before each send; must resolve to the
 *   thread ID to use (useful when the thread needs to be created lazily).
 */
export function useMessages(threadId: string | null, onBeforeSend?: () => Promise<string>): UseMessagesResult {
    const client = useChatClient();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const streamingIdRef = useRef<string | null>(null);
    const resolvedThreadIdRef = useRef(threadId);

    // Keep ref in sync when parent passes a new threadId
    useEffect(() => {
        resolvedThreadIdRef.current = threadId;
    }, [threadId]);

    useEffect(() => {
        const handleDelta = (event: MessageDeltaEvent): void => {
            if (event.threadId !== resolvedThreadIdRef.current) return;

            if (streamingIdRef.current !== event.messageId) {
                streamingIdRef.current = event.messageId;
                setMessages((prev) => [
                    ...prev,
                    { id: event.messageId, role: "assistant", text: event.delta, streaming: true },
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
                role: "user",
                text,
                streaming: false,
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

    return { messages, sendMessage, isStreaming, error, clearError };
}
