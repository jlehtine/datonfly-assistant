import { useEffect, useRef, useState } from "react";

import { ChatClient } from "@verbal-assistant/chat-client";

export function useChatConnection(url: string): { client: ChatClient; connected: boolean } {
    const clientRef = useRef<ChatClient | null>(null);
    const [connected, setConnected] = useState(false);

    clientRef.current ??= new ChatClient(url);
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
