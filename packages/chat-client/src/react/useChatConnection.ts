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
    /**
     * When `false`, the client is created but never connected — use when the
     * caller will supply an already-established connection instead. Defaults
     * to `true`. Kept as a flag rather than skipping the hook call so it can
     * still be called unconditionally.
     */
    enabled?: boolean | undefined;
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
    // Holds a pending, deferred disconnect (see below) so a same-tick
    // remount can cancel it instead of reconnecting.
    const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [connected, setConnected] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);
    const [features, setFeatures] = useState<ServerFeatures>({});

    clientRef.current ??= new ChatClient({
        url: config.url,
        basePath: config.basePath,
    });
    const client = clientRef.current;
    const enabled = config.enabled ?? true;

    useEffect(() => {
        if (!enabled) return;

        // React StrictMode runs this effect's cleanup and setup back to back
        // in dev, to surface non-symmetric effects. If the deferred disconnect
        // below is still pending, the socket never actually went down —
        // cancel it rather than reconnecting, so the rapid unmount/remount
        // can't leave two overlapping connections both joined to the same
        // thread room server-side.
        if (disconnectTimerRef.current !== null) {
            clearTimeout(disconnectTimerRef.current);
            disconnectTimerRef.current = null;
        }

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
            // Deferred: see the cancellation above.
            disconnectTimerRef.current = setTimeout(() => {
                disconnectTimerRef.current = null;
                client.disconnect();
            }, 0);
        };
    }, [client, enabled]);

    return { client, connected, userId, features };
}
