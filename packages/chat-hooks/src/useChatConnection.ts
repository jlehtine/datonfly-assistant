import { useEffect, useRef, useState } from "react";

import { ChatClient } from "@verbal-assistant/chat-client";

export interface UseChatConnectionConfig {
    url: string;
    getToken?: (() => string | null) | undefined;
}

export function useChatConnection(config: UseChatConnectionConfig): { client: ChatClient; connected: boolean } {
    const clientRef = useRef<ChatClient | null>(null);
    const [connected, setConnected] = useState(false);

    clientRef.current ??= new ChatClient({ url: config.url, getToken: config.getToken });
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
