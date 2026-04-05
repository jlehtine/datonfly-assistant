import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { HumanMessage } from "@langchain/core/messages";
import { Server, type ServerOptions, type Socket } from "socket.io";

import type {
    ContentPart,
    IChatAgent,
    MessageCompleteEvent,
    MessageDeltaEvent,
    SendMessageEvent,
} from "@verbal-assistant/core";

export interface ChatRealtimeServerConfig {
    agent: IChatAgent;
    cors?: { origin: string | string[] } | undefined;
}

export class ChatRealtimeServer {
    private io: Server | null = null;
    private readonly agent: IChatAgent;
    private readonly corsConfig: { origin: string | string[] } | undefined;

    constructor(config: ChatRealtimeServerConfig) {
        this.agent = config.agent;
        this.corsConfig = config.cors;
    }

    attach(httpServer: HttpServer): void {
        const opts: ServerOptions = {} as ServerOptions;
        if (this.corsConfig) {
            opts.cors = this.corsConfig;
        }
        this.io = new Server(httpServer, opts);

        this.io.on("connection", (socket) => {
            socket.on("send-message", (data: SendMessageEvent) => {
                void this.handleSendMessage(socket, data);
            });
        });
    }

    private async handleSendMessage(socket: Socket, data: SendMessageEvent): Promise<void> {
        const { threadId, content } = data;
        const messageId = randomUUID();

        const textContent = content
            .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
            .map((part) => part.text)
            .join("\n");

        const messages = [new HumanMessage(textContent)];

        try {
            const stream = await this.agent.stream(messages, threadId, "anonymous");
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
