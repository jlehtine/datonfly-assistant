import { createContext, useContext } from "react";

import type { ChatClient } from "@verbal-assistant/chat-client";

/** React context that provides a shared {@link ChatClient} instance to descendant components. */
export const ChatClientContext = createContext<ChatClient | null>(null);

/**
 * Return the {@link ChatClient} from the nearest {@link ChatClientContext}.
 *
 * @throws {Error} When called outside a `ChatClientContext.Provider`.
 */
export function useChatClient(): ChatClient {
    const client = useContext(ChatClientContext);
    if (!client) {
        throw new Error("useChatClient must be used within a ChatClientContext.Provider");
    }
    return client;
}
