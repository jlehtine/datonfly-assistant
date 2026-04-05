import { io, type Socket } from "socket.io-client";

import type { ErrorEvent, MessageCompleteEvent, MessageDeltaEvent, SendMessageEvent } from "@verbal-assistant/core";

export interface ChatClientEventMap {
    "message-delta": (event: MessageDeltaEvent) => void;
    "message-complete": (event: MessageCompleteEvent) => void;
    error: (event: ErrorEvent) => void;
    connect: () => void;
    disconnect: () => void;
}

export interface ChatClientConfig {
    url: string;
    getToken?: (() => string | null) | undefined;
}

export class ChatClient {
    private readonly socket: Socket;

    constructor(config: ChatClientConfig) {
        const opts: Parameters<typeof io>[1] = {
            transports: ["websocket", "polling"],
            autoConnect: false,
        };

        if (config.getToken) {
            const getToken = config.getToken;
            opts.auth = (cb: (data: Record<string, unknown>) => void) => {
                const token = getToken();
                cb(token ? { token } : {});
            };
        }

        this.socket = io(config.url, opts);
    }

    connect(): void {
        if (!this.socket.connected) {
            this.socket.connect();
        }
    }

    disconnect(): void {
        this.socket.disconnect();
    }

    get connected(): boolean {
        return this.socket.connected;
    }

    sendMessage(threadId: string, text: string): void {
        const event: SendMessageEvent = {
            event: "send-message",
            threadId,
            content: [{ type: "text", text }],
        };
        this.socket.emit("send-message", event);
    }

    on<K extends keyof ChatClientEventMap>(event: K, handler: ChatClientEventMap[K]): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        this.socket.on(event, handler as any);
    }

    off<K extends keyof ChatClientEventMap>(event: K, handler: ChatClientEventMap[K]): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        this.socket.off(event, handler as any);
    }
}
