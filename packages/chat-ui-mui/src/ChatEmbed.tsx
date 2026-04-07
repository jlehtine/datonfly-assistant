import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useEffect, type ComponentType, type ReactElement } from "react";
import type { Components } from "react-markdown";

import {
    ChatClientContext,
    useChatClient,
    useChatConnection,
    useMessages,
} from "@datonfly-assistant/chat-client/react";
import type { Thread, ThreadUpdatedEvent } from "@datonfly-assistant/core";

import { Composer, type ComposerInputProps } from "./Composer.js";
import { EditableTitle } from "./EditableTitle.js";
import type { InputTool } from "./InputTool.js";
import { MessageList } from "./MessageList.js";

/** Configuration options passed to {@link ChatEmbed}. */
export interface ChatEmbedConfig {
    /** Server base URL. */
    url: string;
    /** ID of the thread to open, or `undefined` to let `onBeforeSend` provide it lazily. */
    threadId?: string | undefined;
    /**
     * Optional path prefix prepended to all endpoint paths.
     * @see ChatClientConfig.basePath
     */
    basePath?: string | undefined;
    /** Optional async callback invoked before each send; must resolve to the thread ID to use. */
    onBeforeSend?: (() => Promise<string>) | undefined;
    /** Override the default plain-text input with a custom component. */
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
    /** Optional input tools (e.g. emoji picker) to attach to the composer. */
    inputTools?: InputTool[] | undefined;
    /** Maximum number of visible rows in the composer textarea before it scrolls. */
    maxRows?: number | undefined;
    /**
     * Optional custom element renderers for message markdown.
     * Pass `highlightComponents` from `@datonfly-assistant/chat-ui-mui/highlight`
     * to enable syntax highlighting for code blocks in completed messages.
     */
    messageComponents?: Components | undefined;
    /**
     * When provided, the thread title is shown at the top of the chat view on desktop.
     */
    thread?: Thread | undefined;
    /**
     * Optional callback to open the thread list drawer (used on narrow viewports).
     */
    onOpenThreadList?: (() => void) | undefined;
    /**
     * Optional callback invoked when the user edits the thread title inline.
     */
    onRenameThread?: ((title: string) => void) | undefined;
    /**
     * Optional callback invoked when the server pushes a thread-updated event
     * (e.g. after auto-generating a title).
     */
    onThreadUpdated?: ((event: ThreadUpdatedEvent) => void) | undefined;
}

/** Props for the {@link ChatEmbed} component. */
export interface ChatEmbedProps {
    /** Chat configuration object. */
    config: ChatEmbedConfig;
}

/**
 * Self-contained chat widget that manages its own WebSocket connection.
 *
 * Renders a message list and a composer inside a flex column that fills its
 * parent's height. Wrap the parent in a fixed-height container.
 */
export function ChatEmbed({ config }: ChatEmbedProps): ReactElement {
    const { client, connected } = useChatConnection({
        url: config.url,
        basePath: config.basePath,
    });
    const threadId = config.threadId ?? null;

    return (
        <ChatClientContext.Provider value={client}>
            <ChatInner
                threadId={threadId}
                connected={connected}
                onBeforeSend={config.onBeforeSend}
                inputComponent={config.inputComponent}
                inputTools={config.inputTools}
                maxRows={config.maxRows}
                messageComponents={config.messageComponents}
                thread={config.thread}
                onOpenThreadList={config.onOpenThreadList}
                onRenameThread={config.onRenameThread}
                onThreadUpdated={config.onThreadUpdated}
            />
        </ChatClientContext.Provider>
    );
}

interface ChatInnerProps {
    threadId: string | null;
    connected: boolean;
    onBeforeSend?: (() => Promise<string>) | undefined;
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
    inputTools?: InputTool[] | undefined;
    maxRows?: number | undefined;
    messageComponents?: Components | undefined;
    thread?: Thread | undefined;
    onOpenThreadList?: (() => void) | undefined;
    onRenameThread?: ((title: string) => void) | undefined;
    onThreadUpdated?: ((event: ThreadUpdatedEvent) => void) | undefined;
}

function ChatInner({
    threadId,
    connected,
    onBeforeSend,
    inputComponent,
    inputTools,
    maxRows,
    messageComponents,
    thread,
    onOpenThreadList,
    onRenameThread,
    onThreadUpdated,
}: ChatInnerProps): ReactElement {
    const client = useChatClient();

    useEffect(() => {
        if (!onThreadUpdated) return;
        const handler = (event: ThreadUpdatedEvent): void => {
            onThreadUpdated(event);
        };
        client.on("thread-updated", handler);
        return () => {
            client.off("thread-updated", handler);
        };
    }, [client, onThreadUpdated]);

    const { messages, sendMessage, isStreaming, error, clearError, isLoadingHistory, hasMore, loadMore } = useMessages(
        threadId,
        onBeforeSend,
    );

    const isNarrow = useMediaQuery("(max-width:640px)");

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {(thread && !isNarrow) || onOpenThreadList ? (
                <Box
                    sx={{
                        px: 2,
                        py: 1,
                        borderBottom: 1,
                        borderColor: "divider",
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                    }}
                >
                    {onOpenThreadList && (
                        <IconButton
                            size="small"
                            aria-label="Open conversations"
                            onClick={onOpenThreadList}
                            edge="start"
                        >
                            <SvgIcon fontSize="small">
                                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
                            </SvgIcon>
                        </IconButton>
                    )}
                    {thread && onRenameThread ? (
                        <EditableTitle title={thread.title} onSave={onRenameThread} />
                    ) : thread ? (
                        <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
                            {thread.title}
                        </Typography>
                    ) : null}
                </Box>
            ) : null}
            {!connected && (
                <Typography variant="caption" sx={{ textAlign: "center", p: 1, color: "warning.main" }}>
                    Connecting...
                </Typography>
            )}
            {error && (
                <Alert severity="error" onClose={clearError} sx={{ mx: 2, mt: 1 }}>
                    {error}
                </Alert>
            )}
            <MessageList
                messages={messages}
                isStreaming={isStreaming}
                components={messageComponents}
                isLoadingHistory={isLoadingHistory}
                hasMore={hasMore}
                onLoadMore={loadMore}
            />
            <Composer
                key={threadId ?? "new"}
                onSend={sendMessage}
                disabled={!connected || isStreaming}
                inputComponent={inputComponent}
                inputTools={inputTools}
                maxRows={maxRows}
            />
        </Box>
    );
}
