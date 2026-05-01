import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";
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
    // thinking, tool-call, tool-result, opaque: handled elsewhere or not rendered yet
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
    const thinkingParts = useMemo(
        () =>
            message.parts.filter(
                (part): part is Extract<ContentPart, { type: "thinking" }> => part.type === "thinking",
            ),
        [message.parts],
    );
    // Keep the initial default collapse mode stable for this message bubble:
    // - history-loaded messages start collapsed
    // - live-streamed messages start expanded
    const [defaultThinkingCollapsed] = useState(() => !message.streaming);
    const [collapsedOverrides, setCollapsedOverrides] = useState<Record<number, boolean>>({});

    const toggleThinkingPart = (index: number): void => {
        setCollapsedOverrides((prev) => ({
            ...prev,
            [index]: !(prev[index] ?? defaultThinkingCollapsed),
        }));
    };

    const isThinkingCollapsed = (index: number): boolean => collapsedOverrides[index] ?? defaultThinkingCollapsed;

    const getPreviewLine = (text: string): string => {
        const firstNonEmpty = text
            .trimStart()
            .split(/\r?\n/)
            .find((line) => line.trim().length > 0);
        return firstNonEmpty ?? text.trimStart();
    };

    const getExpandedThinkingText = (text: string): string => text.trimStart();

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
                    {message.role === "ai" &&
                        thinkingParts
                            .filter((part) => part.text.trim().length > 0)
                            .map((part, index) => {
                                const collapsed = isThinkingCollapsed(index);
                                return (
                                    <Box
                                        key={`${message.id}-thinking-${String(index)}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => {
                                            toggleThinkingPart(index);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                toggleThinkingPart(index);
                                            }
                                        }}
                                        sx={{
                                            mb: 1,
                                            px: 1,
                                            py: 0.75,
                                            borderRadius: 1,
                                            border: "1px solid",
                                            borderColor: "divider",
                                            bgcolor: (t) => (t.palette.mode === "dark" ? "grey.900" : "grey.100"),
                                            cursor: "pointer",
                                            transition: "background-color 120ms ease",
                                            "&:hover": {
                                                bgcolor: (t) =>
                                                    t.palette.mode === "dark" ? "rgba(255,255,255,0.08)" : "grey.200",
                                            },
                                        }}
                                    >
                                        {collapsed ? (
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    color: "text.secondary",
                                                    fontSize: "0.8rem",
                                                    lineHeight: 1.5,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                }}
                                            >
                                                {getPreviewLine(part.text)}
                                            </Typography>
                                        ) : (
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    whiteSpace: "pre-wrap",
                                                    color: "text.secondary",
                                                    fontSize: "0.8rem",
                                                    lineHeight: 1.5,
                                                }}
                                            >
                                                {getExpandedThinkingText(part.text)}
                                            </Typography>
                                        )}
                                    </Box>
                                );
                            })}
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
