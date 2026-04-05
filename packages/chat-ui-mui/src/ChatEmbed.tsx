import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ComponentType, ReactElement } from "react";
import type { Components } from "react-markdown";

import { ChatClientContext, useChatConnection, useMessages } from "@verbal-assistant/chat-hooks";

import { Composer, type ComposerInputProps } from "./Composer.js";
import type { InputTool } from "./InputTool.js";
import { MessageList } from "./MessageList.js";

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
}

function ChatInner({
    threadId,
    connected,
    onBeforeSend,
    inputComponent,
    inputTools,
    maxRows,
    messageComponents,
}: ChatInnerProps): ReactElement {
    const { messages, sendMessage, isStreaming, error, clearError } = useMessages(threadId, onBeforeSend);

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
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
            <MessageList messages={messages} isStreaming={isStreaming} components={messageComponents} />
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
