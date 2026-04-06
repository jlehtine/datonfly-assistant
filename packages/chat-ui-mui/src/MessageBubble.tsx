import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatMessage } from "@datonfly-assistant/chat-hooks";

/** Props for the {@link MessageBubble} component. */
export interface MessageBubbleProps {
    /** The message to render. */
    message: ChatMessage;
    /**
     * Optional custom element renderers forwarded to `react-markdown`.
     * Use this to enable syntax highlighting for code blocks by passing
     * `highlightComponents` imported from `@datonfly-assistant/chat-ui-mui/highlight`.
     * The components are only applied to completed (non-streaming) messages.
     */
    components?: Components | undefined;
}

/**
 * Renders a single chat message as a styled bubble.
 *
 * User messages are right-aligned with a primary background; assistant
 * messages are left-aligned. Markdown content is rendered via `react-markdown`.
 */
export function MessageBubble({ message, components }: MessageBubbleProps): ReactElement {
    const isUser = message.role === "user";

    return (
        <Box
            sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", mb: 1 }}
            data-role={message.role}
        >
            <Paper
                elevation={1}
                sx={{
                    px: 2,
                    py: 1,
                    maxWidth: "75%",
                    bgcolor: isUser ? "primary.main" : "action.hover",
                    color: isUser ? "primary.contrastText" : "text.primary",
                    borderRadius: 2,
                    "& p": { m: 0 },
                    "& pre": {
                        bgcolor: isUser ? "rgba(0,0,0,0.2)" : "grey.900",
                        color: isUser ? "primary.contrastText" : "grey.100",
                        p: 1.5,
                        borderRadius: 1,
                        overflow: "auto",
                    },
                    "& code": {
                        fontSize: "0.875em",
                        bgcolor: isUser ? "rgba(0,0,0,0.15)" : undefined,
                        borderRadius: 0.5,
                        px: isUser ? 0.5 : undefined,
                    },
                    "& pre code": {
                        bgcolor: "transparent",
                        p: 0,
                    },
                }}
            >
                <Markdown remarkPlugins={[remarkGfm]} components={message.streaming ? undefined : components}>
                    {message.text}
                </Markdown>
                {message.streaming && (
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                        ●
                    </Typography>
                )}
            </Paper>
        </Box>
    );
}
