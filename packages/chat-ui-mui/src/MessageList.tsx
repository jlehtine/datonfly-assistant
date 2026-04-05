import Box from "@mui/material/Box";
import { useEffect, useRef, type ReactElement } from "react";

import type { ChatMessage } from "@verbal-assistant/chat-hooks";

import { MessageBubble } from "./MessageBubble.js";

export interface MessageListProps {
    messages: ChatMessage[];
}

export function MessageList({ messages }: MessageListProps): ReactElement {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    return (
        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
            {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={endRef} />
        </Box>
    );
}
