import { useEffect, useRef, useState } from "react";

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
 * @returns An object containing the stable `client` instance and a reactive `connected` flag.
 */
export function useChatConnection(config: UseChatConnectionConfig): { client: ChatClient; connected: boolean } {
    const clientRef = useRef<ChatClient | null>(null);
    const [connected, setConnected] = useState(false);

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
        };

        client.connect();
        client.on("connect", onConnect);
        client.on("disconnect", onDisconnect);

        return () => {
            client.off("connect", onConnect);
            client.off("disconnect", onDisconnect);
            client.disconnect();
        };
    }, [client]);

    return { client, connected };
}
