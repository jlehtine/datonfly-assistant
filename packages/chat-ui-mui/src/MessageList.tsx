import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { keyframes } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, type ReactElement } from "react";
import type { Components } from "react-markdown";

import { useCurrentUserId, type ChatMessage } from "@datonfly-assistant/chat-client/react";

import { formatTimestamp, formatTimestampFull, shouldShowTimestamp } from "./formatTimestamp.js";
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

function TimestampDivider({ date }: { date: Date }): ReactElement {
    const label = formatTimestamp(date);
    const fullLabel = formatTimestampFull(date);
    return (
        <Tooltip title={fullLabel}>
            <Typography
                variant="caption"
                aria-label={fullLabel}
                sx={{ display: "block", textAlign: "center", my: 1, color: "text.disabled", cursor: "default" }}
            >
                {label}
            </Typography>
        </Tooltip>
    );
}

/** Pixel threshold from the top of the scroll container that triggers loading more messages. */
const LOAD_MORE_SCROLL_THRESHOLD = 80;

/** Props for the {@link MessageList} component. */
export interface MessageListProps {
    /** Ordered list of messages to render. */
    messages: ChatMessage[];
    /** When `true`, a typing indicator is shown after the last message. */
    isStreaming?: boolean | undefined;
    /**
     * Optional custom element renderers forwarded to each {@link MessageBubble}.
     * Use this to enable syntax highlighting by passing `highlightComponents`
     * from `@datonfly-assistant/chat-ui-mui/highlight`.
     */
    components?: Components | undefined;
    /** When `true`, a loading spinner is shown at the top while older messages are being fetched. */
    isLoadingHistory?: boolean | undefined;
    /** When `true`, a "load more" trigger is active at the top of the list. */
    hasMore?: boolean | undefined;
    /** Called when the user scrolls near the top and older messages should be loaded. */
    onLoadMore?: (() => void) | undefined;
}

/**
 * Scrollable list of {@link MessageBubble} components.
 *
 * Automatically scrolls to the bottom whenever the message list or streaming
 * state changes. Shows an animated thinking indicator while the assistant is
 * preparing its response.
 *
 * When `hasMore` is `true`, detects scroll-to-top and calls `onLoadMore`.
 */
export function MessageList({
    messages,
    isStreaming,
    components,
    isLoadingHistory,
    hasMore,
    onLoadMore,
}: MessageListProps): ReactElement {
    const endRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const currentUserId = useCurrentUserId();
    const lastMsg = messages[messages.length - 1];
    const showThinking = isStreaming === true && !lastMsg?.streaming;
    const prevLengthRef = useRef(messages.length);
    const wasStreamingRef = useRef(false);

    // Scroll to bottom on new messages or streaming state change
    useEffect(() => {
        const prevLen = prevLengthRef.current;
        const didAppend = messages.length > prevLen;
        prevLengthRef.current = messages.length;

        const streamingJustEnded = wasStreamingRef.current && !lastMsg?.streaming;
        wasStreamingRef.current = !!lastMsg?.streaming;

        // Auto-scroll when messages are appended, during streaming content updates,
        // when the thinking indicator is shown, or when streaming just completed
        // (the bubble may resize when syntax highlighting kicks in) — but NOT when
        // old messages are prepended at the top via history loading.
        if (didAppend || showThinking || lastMsg?.streaming || streamingJustEnded) {
            endRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, showThinking, lastMsg?.streaming]);

    // Detect scroll-to-top and trigger load more
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !hasMore || !onLoadMore) return;

        const handleScroll = (): void => {
            if (!isLoadingHistory && el.scrollTop < LOAD_MORE_SCROLL_THRESHOLD) {
                onLoadMore();
            }
        };

        el.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", handleScroll);
        };
    }, [hasMore, onLoadMore, isLoadingHistory]);

    return (
        <Box ref={scrollRef} className="datonfly-message-list" sx={{ flex: 1, overflow: "auto", p: 2 }}>
            {isLoadingHistory && (
                <Box sx={{ display: "flex", justifyContent: "center", pb: 1 }}>
                    <CircularProgress size={20} />
                </Box>
            )}
            {messages.flatMap((msg, i) => {
                const prev = i > 0 ? messages[i - 1] : undefined;
                const elements: ReactElement[] = [];
                if (msg.createdAt && shouldShowTimestamp(prev?.createdAt, msg.createdAt)) {
                    elements.push(<TimestampDivider key={`ts-${msg.id}`} date={msg.createdAt} />);
                }
                elements.push(
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        isOwnMessage={msg.authorId != null && msg.authorId === currentUserId}
                        components={components}
                    />,
                );
                return elements;
            })}
            {showThinking && <ThinkingBubble />}
            <Box ref={endRef} className="datonfly-message-list-end" />
        </Box>
    );
}
