import { createContext, useContext } from "react";

import type { ChatClient } from "../client.js";

/** React context that provides a shared {@link ChatClient} instance to descendant components. */
export const ChatClientContext = createContext<ChatClient | null>(null);

/**
 * React context that provides the authenticated user's ID to descendant components.
 *
 * Used by hooks like `useMessages` to tag optimistic inserts with `authorId`
 * and by UI components to distinguish own messages from others'.
 */
export const CurrentUserIdContext = createContext<string | null>(null);

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

/**
 * Return the current authenticated user's ID, or `null` if not set.
 *
 * Reads from the nearest {@link CurrentUserIdContext}.
 */
export function useCurrentUserId(): string | null {
    return useContext(CurrentUserIdContext);
}
