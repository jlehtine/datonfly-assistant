import { createContext, useContext } from "react";

import type { ChatClient } from "@verbal-assistant/chat-client";

export const ChatClientContext = createContext<ChatClient | null>(null);

export function useChatClient(): ChatClient {
    const client = useContext(ChatClientContext);
    if (!client) {
        throw new Error("useChatClient must be used within a ChatClientContext.Provider");
    }
    return client;
}
