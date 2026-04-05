import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";

import { ChatClientContext, useChatConnection, useMessages } from "@verbal-assistant/chat-hooks";

import { Composer } from "./Composer.js";
import { MessageList } from "./MessageList.js";

export interface ChatEmbedConfig {
    url: string;
    threadId?: string | undefined;
    getToken?: (() => string | null) | undefined;
}

export interface ChatEmbedProps {
    config: ChatEmbedConfig;
}

const DEFAULT_THREAD_ID = "default";

export function ChatEmbed({ config }: ChatEmbedProps): ReactElement {
    const { client, connected } = useChatConnection({ url: config.url, getToken: config.getToken });
    const threadId = config.threadId ?? DEFAULT_THREAD_ID;

    return (
        <ChatClientContext.Provider value={client}>
            <ChatInner threadId={threadId} connected={connected} />
        </ChatClientContext.Provider>
    );
}

interface ChatInnerProps {
    threadId: string;
    connected: boolean;
}

function ChatInner({ threadId, connected }: ChatInnerProps): ReactElement {
    const { messages, sendMessage, isStreaming, error, clearError } = useMessages(threadId);

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
            <MessageList messages={messages} />
            <Composer onSend={sendMessage} disabled={!connected || isStreaming} />
        </Box>
    );
}
