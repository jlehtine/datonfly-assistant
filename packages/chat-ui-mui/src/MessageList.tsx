import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";
import { useEffect, useRef, type ReactElement } from "react";
import type { Components } from "react-markdown";

import type { ChatMessage } from "@verbal-assistant/chat-hooks";

import { MessageBubble } from "./MessageBubble.js";

const bounce = keyframes`
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.6); }
    40% { opacity: 1; transform: scale(1); }
`;

function ThinkingBubble(): ReactElement {
    return (
        <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 1 }} aria-label="Assistant is thinking">
            <Box
                sx={{
                    display: "flex",
                    gap: 0.6,
                    alignItems: "center",
                    px: 2,
                    py: 1.5,
                    bgcolor: "action.hover",
                    borderRadius: 2,
                }}
            >
                {[0, 1, 2].map((i) => (
                    <Box
                        key={i}
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            bgcolor: "text.secondary",
                            animation: `${bounce} 1.4s ease-in-out ${String(i * 0.16)}s infinite`,
                        }}
                    />
                ))}
            </Box>
        </Box>
    );
}

/** Props for the {@link MessageList} component. */
export interface MessageListProps {
    /** Ordered list of messages to render. */
    messages: ChatMessage[];
    /** When `true`, a typing indicator is shown after the last message. */
    isStreaming?: boolean | undefined;
    /**
     * Optional custom element renderers forwarded to each {@link MessageBubble}.
     * Use this to enable syntax highlighting by passing `highlightComponents`
     * from `@verbal-assistant/chat-ui-mui/highlight`.
     */
    components?: Components | undefined;
}

/**
 * Scrollable list of {@link MessageBubble} components.
 *
 * Automatically scrolls to the bottom whenever the message list or streaming
 * state changes. Shows an animated thinking indicator while the assistant is
 * preparing its response.
 */
export function MessageList({ messages, isStreaming, components }: MessageListProps): ReactElement {
    const endRef = useRef<HTMLDivElement>(null);
    const lastMsg = messages[messages.length - 1];
    const showThinking = isStreaming === true && !lastMsg?.streaming;

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, showThinking]);

    return (
        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
            {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} components={components} />
            ))}
            {showThinking && <ThinkingBubble />}
            <div ref={endRef} />
        </Box>
    );
}
