import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { Server, type ServerOptions, type Socket } from "socket.io";

import type {
    AuthUser,
    ContentPart,
    IChatAgent,
    IPersistenceProvider,
    MessageCompleteEvent,
    MessageDeltaEvent,
    SendMessageEvent,
    ThreadMessage,
} from "@verbal-assistant/core";

/** Callback that validates a raw JWT string and returns the authenticated user, or `null` on failure. */
export type ValidateTokenFn = (token: string) => AuthUser | null;

/** Configuration options for {@link ChatRealtimeServer}. */
export interface ChatRealtimeServerConfig {
    /** Chat agent that processes incoming messages and streams responses. */
    agent: IChatAgent;
    /** CORS configuration forwarded to Socket.io. Omit to disable CORS headers. */
    cors?: { origin: string | string[] } | undefined;
    /** Token validation callback. When provided, unauthenticated connections are rejected. */
    validateToken?: ValidateTokenFn | undefined;
    /** Persistence provider for loading thread history and saving messages. */
    persistence: IPersistenceProvider;
}

/**
 * Socket.io server that handles real-time chat for one or more threads.
 *
 * Attach it to an existing HTTP server via {@link attach}, then call
 * {@link close} during graceful shutdown.
 */
export class ChatRealtimeServer {
    private io: Server | null = null;
    private readonly agent: IChatAgent;
    private readonly corsConfig: { origin: string | string[] } | undefined;
    private readonly validateToken: ValidateTokenFn | undefined;
    private readonly persistence: IPersistenceProvider;

    /** Create the server with the given configuration. Call {@link attach} to start accepting connections. */
    constructor(config: ChatRealtimeServerConfig) {
        this.agent = config.agent;
        this.corsConfig = config.cors;
        this.validateToken = config.validateToken;
        this.persistence = config.persistence;
    }

    /** Attach the Socket.io server to an existing HTTP server and begin accepting connections. */
    attach(httpServer: HttpServer): void {
        const opts: ServerOptions = {} as ServerOptions;
        if (this.corsConfig) {
            opts.cors = this.corsConfig;
        }
        this.io = new Server(httpServer, opts);

        if (this.validateToken) {
            const validate = this.validateToken;
            this.io.use((socket, next) => {
                const token = socket.handshake.auth.token as string | undefined;
                if (!token) {
                    next(new Error("Authentication required"));
                    return;
                }
                const user = validate(token);
                if (!user) {
                    next(new Error("Invalid token"));
                    return;
                }
                (socket.data as { user: AuthUser }).user = user;
                next();
            });
        }

        this.io.on("connection", (socket) => {
            socket.on("send-message", (data: SendMessageEvent) => {
                void this.handleSendMessage(socket, data);
            });
        });
    }

    private async handleSendMessage(socket: Socket, data: SendMessageEvent): Promise<void> {
        const { threadId, content } = data;
        const messageId = randomUUID();
        const user = (socket.data as { user?: AuthUser | undefined }).user;
        const userId = user?.id ?? "anonymous";

        // Membership guard
        if (user) {
            const isMember = await this.persistence.isMember(threadId, user.id);
            if (!isMember) {
                socket.emit("error", { event: "error", message: "Not a member of this thread" });
                return;
            }
        }

        // Persist the user message
        await this.persistence.appendMessage({
            threadId,
            role: "user",
            content,
            authorId: user?.id ?? null,
        });

        // Load full history and convert to BaseMessage[]
        const history = await this.persistence.loadMessages({ threadId });
        const messages: BaseMessage[] = threadMessagesToBaseMessages(history);

        try {
            const stream = await this.agent.stream(messages, threadId, userId);
            let fullText = "";

            for await (const chunk of stream) {
                const delta = typeof chunk.content === "string" ? chunk.content : "";
                if (delta) {
                    fullText += delta;
                    const deltaEvent: MessageDeltaEvent = {
                        event: "message-delta",
                        threadId,
                        messageId,
                        delta,
                    };
                    socket.emit("message-delta", deltaEvent);
                }
            }

            // Persist assistant response
            await this.persistence.appendMessage({
                threadId,
                role: "assistant",
                content: [{ type: "text", text: fullText }],
                authorId: null,
            });

            const completeEvent: MessageCompleteEvent = {
                event: "message-complete",
                threadId,
                messageId,
                content: [{ type: "text", text: fullText }],
            };
            socket.emit("message-complete", completeEvent);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            socket.emit("error", { event: "error", message });
        }
    }

    /** Gracefully close all active connections and stop the Socket.io server. */
    async close(): Promise<void> {
        await this.io?.close();
    }
}

// ─── Helpers ───

function extractText(content: ContentPart[]): string {
    return content
        .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}

function formatTimestamp(date: Date): string {
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absOffset / 60);
    const offsetMins = absOffset % 60;
    return (
        `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}` +
        `${sign}${pad(offsetHours)}:${pad(offsetMins)}`
    );
}

const ONE_HOUR_MS = 60 * 60 * 1000;

function threadMessagesToBaseMessages(messages: ThreadMessage[]): BaseMessage[] {
    const result: BaseMessage[] = [];
    let lastTimestamp: Date | null = null;

    for (const msg of messages) {
        const messageTimestamp = msg.createdAt;
        if (lastTimestamp === null || messageTimestamp.getTime() - lastTimestamp.getTime() >= ONE_HOUR_MS) {
            result.push(new HumanMessage(`@ ${formatTimestamp(messageTimestamp)}`));
            lastTimestamp = messageTimestamp;
        }
        const text = extractText(msg.content);
        switch (msg.role) {
            case "user":
                result.push(new HumanMessage(text));
                break;
            case "assistant":
                result.push(new AIMessage(text));
                break;
            case "system":
                result.push(new SystemMessage(text));
                break;
        }
    }

    return result;
}
