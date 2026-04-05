import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { HumanMessage } from "@langchain/core/messages";
import { Server, type ServerOptions, type Socket } from "socket.io";

import type {
    AuthUser,
    ContentPart,
    IChatAgent,
    MessageCompleteEvent,
    MessageDeltaEvent,
    SendMessageEvent,
} from "@verbal-assistant/core";

export type ValidateTokenFn = (token: string) => AuthUser | null;

export interface ChatRealtimeServerConfig {
    agent: IChatAgent;
    cors?: { origin: string | string[] } | undefined;
    validateToken?: ValidateTokenFn | undefined;
}

export class ChatRealtimeServer {
    private io: Server | null = null;
    private readonly agent: IChatAgent;
    private readonly corsConfig: { origin: string | string[] } | undefined;
    private readonly validateToken: ValidateTokenFn | undefined;

    constructor(config: ChatRealtimeServerConfig) {
        this.agent = config.agent;
        this.corsConfig = config.cors;
        this.validateToken = config.validateToken;
    }

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

        const textContent = content
            .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join("\n");

        const messages = [new HumanMessage(textContent)];

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

    async close(): Promise<void> {
        await this.io?.close();
    }
}
