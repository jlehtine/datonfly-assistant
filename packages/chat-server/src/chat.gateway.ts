import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { OnGatewayInit, OnGatewayConnection } from "@nestjs/websockets";
import { parse as parseCookie } from "cookie";
import type { Server, Socket } from "socket.io";

import type {
    AgentMessage,
    IAgentProvider,
    IPersistenceProvider,
    InviteMemberEvent,
    MemberJoinedEvent,
    MessageCompleteEvent,
    MessageDeltaEvent,
    SendMessageEvent,
    Thread,
    ThreadCreatedEvent,
    ThreadUpdatedEvent,
    User,
    UserIdentity,
} from "@datonfly-assistant/core";

import { WS_PATH, chatRequestSchema, inviteMemberRequestSchema } from "@datonfly-assistant/core";

import { AuditLogger } from "./audit-logger.js";
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
        private readonly auditLogger: AuditLogger,
    ) {}

    afterInit(_server: Server): void {
        const server = this.server;
        // Socket.io authentication middleware
        if (this.validateToken) {
            const validate = this.validateToken;
            const persistence = this.persistence;

            const auditLogger = this.auditLogger;
            server.use((socket: Socket, next) => {
                // Extract token: prefer cookie, fall back to auth payload
                const cookieHeader = socket.handshake.headers.cookie;
                const cookies = cookieHeader ? parseCookie(cookieHeader) : {};
                const token = cookies.dfa_token ?? (socket.handshake.auth.token as string | undefined);
                if (!token) {
                    auditLogger.audit("error", "auth.rejected", { error: "Authentication required" });
                    next(new Error("Authentication required"));
                    return;
                }
                const identity = validate(token);
                if (!identity) {
                    auditLogger.audit("error", "auth.rejected", { error: "Invalid token" });
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
                auditLogger: this.auditLogger,
                onTitleUpdated: (threadId: string, title: string, titleManuallySet: boolean): void => {
                    const event: ThreadUpdatedEvent = {
                        event: "thread-updated",
                        threadId,
                        title,
                        titleManuallySet,
                    };
                    void this.emitToThreadMembers(threadId, "thread-updated", event);
                },
            });
        }
    }

    handleConnection(socket: Socket): void {
        socket.on("send-message", (data: SendMessageEvent) => {
            void this.handleSendMessage(socket, data);
        });
        socket.on("invite-member", (data: InviteMemberEvent) => {
            void this.handleInviteMember(socket, data);
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
        this.auditLogger.audit("info", "message.send", { userId, threadId, messageId });

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
            this.auditLogger.audit("info", "agent.complete", { userId, threadId, messageId });

            // Fire-and-forget title generation.
            if (this.titleGenerator) {
                void this.titleGenerator.maybeGenerateTitle(threadId);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown error";
            socket.emit("error", { event: "error", message });
            this.auditLogger.audit("error", "agent.error", { userId, threadId, messageId, error: message });
        }
    }

    private async handleInviteMember(socket: Socket, data: InviteMemberEvent): Promise<void> {
        const parsed = inviteMemberRequestSchema.safeParse({ email: data.email });
        if (!parsed.success) {
            const errorMessage = parsed.error.issues[0]?.message ?? "Invalid invite request";
            socket.emit("error", { event: "error", message: errorMessage });
            return;
        }

        const { email } = parsed.data;
        const threadId = data.threadId;
        const user = (socket.data as { user?: User | undefined }).user;

        if (!threadId || !user) {
            socket.emit("error", { event: "error", message: "Invalid invite request" });
            return;
        }

        // Sender must be a member of the thread
        const senderIsMember = await this.persistence.isMember(threadId, user.id);
        if (!senderIsMember) {
            socket.emit("error", { event: "error", message: "Not a member of this thread" });
            return;
        }

        // Look up the invited user by email
        const invitedUser = await this.persistence.findUserByEmail(email);
        if (!invitedUser) {
            socket.emit("error", { event: "error", message: "User not found" });
            return;
        }

        // Check if already a member
        const alreadyMember = await this.persistence.isMember(threadId, invitedUser.id);
        if (alreadyMember) {
            socket.emit("error", { event: "error", message: "User is already a member of this thread" });
            return;
        }

        await this.persistence.addMember(threadId, invitedUser.id, "member");
        this.auditLogger.audit("info", "member.invite", {
            userId: user.id,
            threadId,
            invitedUserId: invitedUser.id,
        });

        const event: MemberJoinedEvent = {
            event: "member-joined",
            threadId,
            userId: invitedUser.id,
            role: "member",
        };
        void this.emitToThreadMembers(threadId, "member-joined", event);
    }

    /** Broadcast a thread-created event to connected clients that are members of the thread. */
    notifyThreadCreated(thread: Thread): void {
        const event: ThreadCreatedEvent = {
            event: "thread-created",
            thread: {
                id: thread.id,
                title: thread.title,
                createdAt: thread.createdAt.toISOString(),
                updatedAt: thread.updatedAt.toISOString(),
                archivedAt: thread.archivedAt?.toISOString() ?? null,
                memoryEnabled: thread.memoryEnabled,
                titleGeneratedAt: thread.titleGeneratedAt?.toISOString() ?? null,
                titleManuallySet: thread.titleManuallySet,
            },
        };
        void this.emitToThreadMembers(thread.id, "thread-created", event);
    }

    /**
     * Emit an event only to connected sockets whose authenticated user is a
     * member of the given thread.
     */
    private async emitToThreadMembers(threadId: string, eventName: string, payload: unknown): Promise<void> {
        const members = await this.persistence.listMembers(threadId);
        const memberUserIds = new Set(members.map((m) => m.userId));

        const sockets = await this.server.fetchSockets();
        for (const socket of sockets) {
            const user = (socket.data as { user?: User | undefined }).user;
            if (user && memberUserIds.has(user.id)) {
                socket.emit(eventName, payload);
            }
        }
    }
}
