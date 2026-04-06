import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { OnGatewayInit, OnGatewayConnection } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";

import type {
    AgentMessage,
    IAgentProvider,
    IPersistenceProvider,
    MessageCompleteEvent,
    MessageDeltaEvent,
    SendMessageEvent,
    ThreadUpdatedEvent,
    User,
    UserIdentity,
} from "@datonfly-assistant/core";

import { WS_PATH, chatRequestSchema } from "@datonfly-assistant/core";

import { AGENT_PROVIDER, GENERATE_TITLE_FN, PERSISTENCE_PROVIDER, VALIDATE_TOKEN_FN } from "./constants.js";
import { threadMessagesToAgentMessages } from "./messages.js";
import { ThreadTitleGenerator, type GenerateTitleFn } from "./title-generator.js";

/** Callback that validates a raw token string and returns the user identity, or `null` on failure. */
export type ValidateTokenFn = (token: string) => UserIdentity | null;

/**
 * NestJS WebSocket gateway that provides real-time chat over Socket.io.
 *
 * Authentication: the optional {@link ValidateTokenFn} is called during the
 * Socket.io handshake to obtain a {@link UserIdentity}.  The identity is then
 * resolved to a full {@link User} record via the persistence provider and
 * stored in `socket.data.user`.
 */
@WebSocketGateway({ path: WS_PATH })
@Injectable()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
    @WebSocketServer()
    private readonly server!: Server;

    private titleGenerator: ThreadTitleGenerator | null = null;

    constructor(
        @Inject(AGENT_PROVIDER) private readonly agent: IAgentProvider,
        @Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider,
        @Optional() @Inject(VALIDATE_TOKEN_FN) private readonly validateToken: ValidateTokenFn | null,
        @Optional() @Inject(GENERATE_TITLE_FN) private readonly generateTitleFn: GenerateTitleFn | null,
    ) {}

    afterInit(_server: Server): void {
        const server = this.server;
        // Socket.io authentication middleware
        if (this.validateToken) {
            const validate = this.validateToken;
            const persistence = this.persistence;

            server.use((socket: Socket, next) => {
                const token = socket.handshake.auth.token as string | undefined;
                if (!token) {
                    next(new Error("Authentication required"));
                    return;
                }
                const identity = validate(token);
                if (!identity) {
                    next(new Error("Invalid token"));
                    return;
                }

                // Resolve identity → User record
                void persistence
                    .upsertUser({
                        id: randomUUID(),
                        email: identity.email,
                        name: identity.name,
                        avatarUrl: identity.avatarUrl,
                        lastLoginAt: new Date(),
                    })
                    .then((user) => {
                        (socket.data as { user: User }).user = user;
                        next();
                    })
                    .catch((err: unknown) => {
                        next(new Error(err instanceof Error ? err.message : "User resolution failed"));
                    });
            });
        }

        // Set up title generator
        if (this.generateTitleFn) {
            this.titleGenerator = new ThreadTitleGenerator({
                persistence: this.persistence,
                generateTitle: this.generateTitleFn,
                onTitleUpdated: (threadId: string, title: string): void => {
                    const event: ThreadUpdatedEvent = {
                        event: "thread-updated",
                        threadId,
                        title,
                    };
                    server.emit("thread-updated", event);
                },
            });
        }
    }

    handleConnection(socket: Socket): void {
        socket.on("send-message", (data: SendMessageEvent) => {
            void this.handleSendMessage(socket, data);
        });
    }

    private async handleSendMessage(socket: Socket, data: SendMessageEvent): Promise<void> {
        const parsed = chatRequestSchema.safeParse(data);
        if (!parsed.success) {
            const errorMessage = parsed.error.issues[0]?.message ?? "Invalid message";
            socket.emit("error", { event: "error", message: errorMessage });
            return;
        }

        const { threadId, content } = parsed.data;
        const messageId = randomUUID();
        const user = (socket.data as { user?: User | undefined }).user;
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
}
