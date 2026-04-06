import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { Server, type ServerOptions, type Socket } from "socket.io";

import type {
    AgentMessage,
    AuthUser,
    IAgentProvider,
    IPersistenceProvider,
    MessageCompleteEvent,
    MessageDeltaEvent,
    SendMessageEvent,
    ThreadUpdatedEvent,
} from "@datonfly-assistant/core";

import { threadMessagesToAgentMessages } from "./messages.js";
import { ThreadTitleGenerator, type GenerateTitleFn } from "./title-generator.js";

/** Callback that validates a raw JWT string and returns the authenticated user, or `null` on failure. */
export type ValidateTokenFn = (token: string) => AuthUser | null;

/** Configuration options for {@link ChatRealtimeServer}. */
export interface ChatRealtimeServerConfig {
    /** Chat agent that processes incoming messages and streams responses. */
    agent: IAgentProvider;
    /** CORS configuration forwarded to Socket.io. Omit to disable CORS headers. */
    cors?: { origin: string | string[] } | undefined;
    /** Token validation callback. When provided, unauthenticated connections are rejected. */
    validateToken?: ValidateTokenFn | undefined;
    /** Persistence provider for loading thread history and saving messages. */
    persistence: IPersistenceProvider;
    /**
     * Optional callback that generates a thread title from conversation messages.
     * When omitted, title auto-generation is disabled.
     */
    generateTitle?: GenerateTitleFn | undefined;
}

/**
 * Socket.io server that handles real-time chat for one or more threads.
 *
 * Attach it to an existing HTTP server via {@link attach}, then call
 * {@link close} during graceful shutdown.
 */
export class ChatRealtimeServer {
    private io: Server | null = null;
    private readonly agent: IAgentProvider;
    private readonly corsConfig: { origin: string | string[] } | undefined;
    private readonly validateToken: ValidateTokenFn | undefined;
    private readonly persistence: IPersistenceProvider;
    private titleGenerator: ThreadTitleGenerator | null = null;
    private readonly generateTitleFn: GenerateTitleFn | undefined;

    /** Create the server with the given configuration. Call {@link attach} to start accepting connections. */
    constructor(config: ChatRealtimeServerConfig) {
        this.agent = config.agent;
        this.corsConfig = config.cors;
        this.validateToken = config.validateToken;
        this.persistence = config.persistence;
        this.generateTitleFn = config.generateTitle;
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

        // Set up title generator if a generateTitle function is provided.
        if (this.generateTitleFn) {
            const io = this.io;
            this.titleGenerator = new ThreadTitleGenerator({
                persistence: this.persistence,
                generateTitle: this.generateTitleFn,
                onTitleUpdated: (threadId: string, title: string): void => {
                    const event: ThreadUpdatedEvent = {
                        event: "thread-updated",
                        threadId,
                        title,
                    };
                    io.emit("thread-updated", event);
                },
            });
        }
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
            role: "human",
            content,
            authorId: user?.id ?? null,
        });

        // Load full history and convert to AgentMessage[]
        const history = await this.persistence.loadMessages({ threadId });
        const messages: AgentMessage[] = threadMessagesToAgentMessages(history);

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
                role: "ai",
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

            // Fire-and-forget title generation.
            if (this.titleGenerator) {
                void this.titleGenerator.maybeGenerateTitle(threadId);
            }
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
