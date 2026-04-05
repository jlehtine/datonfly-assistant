import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ComponentType, ReactElement } from "react";

import { ChatClientContext, useChatConnection, useMessages } from "@verbal-assistant/chat-hooks";

import { Composer, type ComposerInputProps } from "./Composer.js";
import { MessageList } from "./MessageList.js";

export interface ChatEmbedConfig {
    url: string;
    threadId?: string | undefined;
    getToken?: (() => string | null) | undefined;
    onBeforeSend?: (() => Promise<string>) | undefined;
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
}

export interface ChatEmbedProps {
    config: ChatEmbedConfig;
}

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
            />
        </ChatClientContext.Provider>
    );
}

interface ChatInnerProps {
    threadId: string | null;
    connected: boolean;
    onBeforeSend?: (() => Promise<string>) | undefined;
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
}

function ChatInner({ threadId, connected, onBeforeSend, inputComponent }: ChatInnerProps): ReactElement {
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
            <MessageList messages={messages} isStreaming={isStreaming} />
            <Composer onSend={sendMessage} disabled={!connected || isStreaming} inputComponent={inputComponent} />
        </Box>
    );
}
