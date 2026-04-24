import { useEffect, useRef, useState } from "react";

import type { ServerFeatures, WelcomeEvent } from "@datonfly-assistant/core";

import { ChatClient } from "../client.js";

/** Configuration options for {@link useChatConnection}. */
export interface UseChatConnectionConfig {
    /** Server base URL (e.g. `"http://localhost:3000"`). */
    url: string;
    /**
     * Optional path prefix prepended to all endpoint paths.
     * @see {@link ChatClientConfig.basePath}
     */
    basePath?: string | undefined;
}

/**
 * Create and manage a {@link ChatClient} connection for the component lifetime.
 *
 * Creates the client on first render, connects immediately, and disconnects on unmount.
 *
 * @returns An object containing the stable `client` instance, a reactive `connected` flag,
 *   and the resolved `userId` (set after the server emits the `welcome` event).
 */
export function useChatConnection(config: UseChatConnectionConfig): {
    client: ChatClient;
    connected: boolean;
    userId: string | null;
    features: ServerFeatures;
} {
    const clientRef = useRef<ChatClient | null>(null);
    const [connected, setConnected] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [features, setFeatures] = useState<ServerFeatures>({});

    clientRef.current ??= new ChatClient({
        url: config.url,
        basePath: config.basePath,
    });
    const client = clientRef.current;

    useEffect(() => {
        const onConnect = (): void => {
            setConnected(true);
        };
        const onDisconnect = (): void => {
            setConnected(false);
            setUserId(null);
            setFeatures({});
        };
        const onWelcome = (event: WelcomeEvent): void => {
            setUserId(event.userId);
            setFeatures(event.features ?? {});
        };

        client.connect();
        client.on("connect", onConnect);
        client.on("disconnect", onDisconnect);
        client.on("welcome", onWelcome);

        return () => {
            client.off("connect", onConnect);
            client.off("disconnect", onDisconnect);
            client.off("welcome", onWelcome);
            client.disconnect();
        };
    }, [client]);

    return { client, connected, userId, features };
}
