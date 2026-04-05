import { io, type Socket } from "socket.io-client";

import type { ErrorEvent, MessageCompleteEvent, MessageDeltaEvent, SendMessageEvent } from "@verbal-assistant/core";

/** Map of event names to their handler signatures for {@link ChatClient}. */
export interface ChatClientEventMap {
    /** Fired when the server streams a partial assistant response. */
    "message-delta": (event: MessageDeltaEvent) => void;
    /** Fired when the server finishes streaming an assistant response. */
    "message-complete": (event: MessageCompleteEvent) => void;
    /** Fired when the server reports an error. */
    error: (event: ErrorEvent) => void;
    /** Fired when the WebSocket connection is established. */
    connect: () => void;
    /** Fired when the WebSocket connection is closed. */
    disconnect: () => void;
}

/** Configuration options for {@link ChatClient}. */
export interface ChatClientConfig {
    /** WebSocket server URL (e.g. `"http://localhost:3000"`). */
    url: string;
    /** Optional callback that returns a JWT for authentication, or `null` to connect anonymously. */
    getToken?: (() => string | null) | undefined;
}

/**
 * WebSocket client for the Verbal Assistant real-time chat server.
 *
 * Manages the Socket.io connection, exposes typed event subscriptions,
 * and provides a {@link sendMessage} method to submit user messages.
 */
export class ChatClient {
    private readonly socket: Socket;

    /** Create a new client. The socket is not connected until {@link connect} is called. */
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

    /** Open the WebSocket connection. No-op if already connected. */
    connect(): void {
        if (!this.socket.connected) {
            this.socket.connect();
        }
    }

    /** Close the WebSocket connection. */
    disconnect(): void {
        this.socket.disconnect();
    }

    /** `true` when the WebSocket connection is open and authenticated. */
    get connected(): boolean {
        return this.socket.connected;
    }

    /** Emit a `send-message` event to the server for the given thread. */
    sendMessage(threadId: string, text: string): void {
        const event: SendMessageEvent = {
            event: "send-message",
            threadId,
            content: [{ type: "text", text }],
        };
        this.socket.emit("send-message", event);
    }

    /** Subscribe to a typed client event. */
    on<K extends keyof ChatClientEventMap>(event: K, handler: ChatClientEventMap[K]): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        this.socket.on(event, handler as any);
    }

    /** Unsubscribe from a typed client event. */
    off<K extends keyof ChatClientEventMap>(event: K, handler: ChatClientEventMap[K]): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
        this.socket.off(event, handler as any);
    }
}
