import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import SvgIcon from "@mui/material/SvgIcon";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { ComponentType, ReactElement } from "react";
import type { Components } from "react-markdown";

import { ChatClientContext, useChatConnection, useMessages } from "@verbal-assistant/chat-hooks";
import type { Thread } from "@verbal-assistant/core";

import { Composer, type ComposerInputProps } from "./Composer.js";
import type { InputTool } from "./InputTool.js";
import { MessageList } from "./MessageList.js";

/** Archive inbox icon (Material Design path). */
function ArchiveIcon(): ReactElement {
    return (
        <SvgIcon fontSize="small">
            <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.93 1H5.12z" />
        </SvgIcon>
    );
}

/** Unarchive icon (Material Design path). */
function UnarchiveIcon(): ReactElement {
    return (
        <SvgIcon fontSize="small">
            <path d="M20.55 5.22l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.22C3.17 5.57 3 6.01 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.49-.17-.93-.45-1.28zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.82-1h12l.93 1H5.12z" />
        </SvgIcon>
    );
}

/** Configuration options passed to {@link ChatEmbed}. */
export interface ChatEmbedConfig {
    /** WebSocket server URL. */
    url: string;
    /** ID of the thread to open, or `undefined` to let `onBeforeSend` provide it lazily. */
    threadId?: string | undefined;
    /** Optional callback that returns a JWT for authentication, or `null` to connect anonymously. */
    getToken?: (() => string | null) | undefined;
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
     * Pass `highlightComponents` from `@verbal-assistant/chat-ui-mui/highlight`
     * to enable syntax highlighting for code blocks in completed messages.
     */
    messageComponents?: Components | undefined;
    /**
     * When provided, an archive/unarchive icon is shown at the top of the chat view.
     * The `archivedAt` field indicates current archive status.
     */
    thread?: Thread | undefined;
    /** Called when the user clicks the archive/unarchive icon. */
    onArchiveToggle?: ((archived: boolean) => void) | undefined;
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
    const { client, connected } = useChatConnection({ url: config.url, getToken: config.getToken });
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
                url={config.url}
                getToken={config.getToken}
                thread={config.thread}
                onArchiveToggle={config.onArchiveToggle}
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
    url?: string | undefined;
    getToken?: (() => string | null) | undefined;
    thread?: Thread | undefined;
    onArchiveToggle?: ((archived: boolean) => void) | undefined;
}

function ChatInner({
    threadId,
    connected,
    onBeforeSend,
    inputComponent,
    inputTools,
    maxRows,
    messageComponents,
    url,
    getToken,
    thread,
    onArchiveToggle,
}: ChatInnerProps): ReactElement {
    const { messages, sendMessage, isStreaming, error, clearError, isLoadingHistory, hasMore, loadMore } = useMessages(
        threadId,
        onBeforeSend,
        { url, getToken },
    );

    const isArchived = !!thread?.archivedAt;

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {thread && onArchiveToggle && (
                <Box
                    sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        px: 1,
                        py: 0.5,
                        borderBottom: 1,
                        borderColor: "divider",
                    }}
                >
                    <Tooltip title={isArchived ? "Unarchive conversation" : "Archive conversation"}>
                        <IconButton
                            size="small"
                            onClick={() => {
                                onArchiveToggle(!isArchived);
                            }}
                            aria-label={isArchived ? "Unarchive conversation" : "Archive conversation"}
                        >
                            {isArchived ? <UnarchiveIcon /> : <ArchiveIcon />}
                        </IconButton>
                    </Tooltip>
                </Box>
            )}
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
                onSend={sendMessage}
                disabled={!connected || isStreaming}
                inputComponent={inputComponent}
                inputTools={inputTools}
                maxRows={maxRows}
            />
        </Box>
    );
}
