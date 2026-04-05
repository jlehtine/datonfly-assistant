import { useCallback, useEffect, useRef, useState } from "react";

import type { ErrorEvent, MessageCompleteEvent, MessageDeltaEvent } from "@verbal-assistant/core";

import { useChatClient } from "./context.js";

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    text: string;
    streaming: boolean;
}

export interface UseMessagesResult {
    messages: ChatMessage[];
    sendMessage: (text: string) => void;
    isStreaming: boolean;
    error: string | null;
    clearError: () => void;
}

export function useMessages(threadId: string): UseMessagesResult {
    const client = useChatClient();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const streamingIdRef = useRef<string | null>(null);

    useEffect(() => {
        const handleDelta = (event: MessageDeltaEvent): void => {
            if (event.threadId !== threadId) return;

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
            if (event.threadId !== threadId) return;

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
    }, [client, threadId]);

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
            client.sendMessage(threadId, text);
        },
        [client, threadId],
    );

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return { messages, sendMessage, isStreaming, error, clearError };
}
