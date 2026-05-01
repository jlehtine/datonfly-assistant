import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatMessage } from "@datonfly-assistant/chat-client/react";
import type { ContentPart } from "@datonfly-assistant/core";

/** Props for the {@link MessageBubble} component. */
export interface MessageBubbleProps {
    /** The message to render. */
    message: ChatMessage;
    /** `true` when the message was sent by the current user. Controls alignment. */
    isOwnMessage: boolean;
    /**
     * Optional custom element renderers forwarded to `react-markdown`.
     * Use this to enable syntax highlighting for code blocks by passing
     * `highlightComponents` imported from `@datonfly-assistant/chat-ui-mui/highlight`.
     * The components are only applied to completed (non-streaming) messages.
     */
    components?: Components | undefined;
}

/** Render a single content part. Unknown part types are silently skipped. */
function renderPart(part: ContentPart, index: number, streaming: boolean, components?: Components): ReactNode {
    if (part.type === "text") {
        return (
            <Markdown key={index} remarkPlugins={[remarkGfm]} components={streaming ? undefined : components}>
                {part.text}
            </Markdown>
        );
    }
    // tool-call, tool-result, opaque: no renderer yet — render nothing
    return null;
}

/**
 * Renders a single chat message as a styled bubble.
 *
 * Own messages are right-aligned with a primary-tinted background; other users'
 * and assistant messages are left-aligned. Other users' human messages show an
 * avatar and author name above the bubble.
 */
export function MessageBubble({ message, isOwnMessage, components }: MessageBubbleProps): ReactElement {
    const { t } = useTranslation();
    const alignRight = isOwnMessage;
    const authorName = !isOwnMessage && message.role === "human" ? message.authorName : null;

    return (
        <Box
            sx={{ display: "flex", justifyContent: alignRight ? "flex-end" : "flex-start", mb: 1 }}
            className={message.role === "human" ? "datonfly-message-human" : "datonfly-message-ai"}
            data-message-author={authorName ?? ""}
        >
            {authorName && (
                <Avatar
                    src={message.authorAvatarUrl ?? undefined}
                    sx={{ width: 28, height: 28, mr: 1, mt: 0.5, flexShrink: 0 }}
                >
                    {authorName.charAt(0).toUpperCase()}
                </Avatar>
            )}
            <Box sx={{ maxWidth: { xs: "85%", sm: "70%" } }}>
                {authorName && (
                    <Typography
                        className="datonfly-message-author-name"
                        variant="caption"
                        sx={{ ml: 0.5, color: "text.secondary" }}
                    >
                        {authorName}
                    </Typography>
                )}
                <Paper
                    elevation={1}
                    sx={{
                        px: 2,
                        py: 1,
                        bgcolor: alignRight
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
                        "& p + p": { mt: "1em" },
                        "& h1": { fontSize: "1.15rem", fontWeight: 700, mt: 1.5, mb: 0.5 },
                        "& h2": { fontSize: "1.05rem", fontWeight: 700, mt: 1.5, mb: 0.5 },
                        "& h3": { fontSize: "0.95rem", fontWeight: 600, mt: 1, mb: 0.5 },
                        "& h4, & h5, & h6": { fontSize: "0.875rem", fontWeight: 600, mt: 1, mb: 0.5 },
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
                        "& a": {
                            color: (t) =>
                                t.palette.mode === "dark" ? t.palette.primary.light : t.palette.primary.dark,
                            textDecorationColor: "inherit",
                        },
                    }}
                >
                    {message.parts.map((part, i) => renderPart(part, i, message.streaming, components))}
                    {message.streaming && (
                        <Typography
                            className="datonfly-message-streaming-indicator"
                            variant="caption"
                            sx={{ opacity: 0.6 }}
                        >
                            ●
                        </Typography>
                    )}
                    {message.interrupted && (
                        <Typography
                            variant="caption"
                            sx={{ display: "block", mt: 0.5, fontStyle: "italic", color: "text.disabled" }}
                        >
                            {t("responseInterrupted")}
                        </Typography>
                    )}
                </Paper>
            </Box>
        </Box>
    );
}
