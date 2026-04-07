import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatMessage } from "@datonfly-assistant/chat-client/react";

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
    const isUser = message.role === "human";

    return (
        <Box
            sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", mb: 1 }}
            className={isUser ? "datonfly-message-human" : "datonfly-message-ai"}
        >
            <Paper
                elevation={1}
                sx={{
                    px: 2,
                    py: 1,
                    maxWidth: "75%",
                    bgcolor: isUser
                        ? (t) => {
                              const c = t.palette.primary.main;
                              const bg = t.palette.background.paper;
                              return t.palette.mode === "dark"
                                  ? `color-mix(in oklch, ${c} 25%, ${bg})`
                                  : `color-mix(in oklch, ${c} 20%, ${bg})`;
                          }
                        : "action.hover",
                    color: "text.primary",
                    borderRadius: 2,
                    "& p": { m: 0 },
                    "& pre": {
                        bgcolor: (t) => (t.palette.mode === "dark" ? "grey.900" : "grey.100"),
                        color: (t) => (t.palette.mode === "dark" ? "grey.100" : "grey.900"),
                        fontFamily: "monospace",
                        p: 1.5,
                        borderRadius: 1,
                        overflow: "auto",
                    },
                    "& code": {
                        fontSize: "0.875em",
                        fontFamily: "monospace",
                        px: "0.5em",
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
