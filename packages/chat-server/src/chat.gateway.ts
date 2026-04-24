import { randomUUID } from "node:crypto";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { OnGatewayInit, OnGatewayConnection } from "@nestjs/websockets";
import { parse as parseCookie } from "cookie";
import type { Server, Socket } from "socket.io";

import type {
    AgentMessage,
    AgentStreamChunk,
    AgentUsage,
    Citation,
    ContentPart,
    IAgentProvider,
    IPersistenceProvider,
    ISearchProvider,
    InviteMemberEvent,
    MemberJoinedEvent,
    MemberLeftEvent,
    MemberRoleChangedEvent,
    MessageCompleteEvent,
    MessageDeltaEvent,
    MessageStatusEvent,
    NewMessageEvent,
    OpaqueContentBlock,
    RemoveMemberEvent,
    SendMessageEvent,
    Thread,
    ThreadCreatedEvent,
    ThreadUpdatedEvent,
    UpdateMemberRoleEvent,
    User,
    UserIdentity,
} from "@datonfly-assistant/core";

import {
    ERROR_CODES,
    WS_PATH,
    chatRequestSchema,
    inviteMemberRequestSchema,
    removeMemberRequestSchema,
    updateMemberRoleRequestSchema,
} from "@datonfly-assistant/core";

import { AuditLogger } from "./audit-logger.js";
import { CompactionService } from "./compaction.js";
import {
    AGENT_PROVIDER,
    GENERATE_TITLE_FN,
    PERSISTENCE_PROVIDER,
    SEARCH_PROVIDER,
    VALIDATE_TOKEN_FN,
} from "./constants.js";
import { buildAuthorAliases, extractText, threadMessagesToAgentMessages } from "./messages.js";
import { ThreadRoomManager } from "./thread-room-manager.js";
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
/** State for a single active agent stream. */
interface ActiveStream {
    controller: AbortController;
    fullText: string;
    messageId: string;
    citations: Citation[];
    usage: AgentUsage | null;
    opaqueBlocks: OpaqueContentBlock[];
    hasTextSinceToolBoundary: boolean;
    pendingToolBoundaryBreak: boolean;
}

function toolBoundarySeparator(text: string): string {
    if (!text) return "";
    if (text.endsWith("\n\n")) return "";
    if (text.endsWith("\n")) return "\n";
    return "\n\n";
}

@WebSocketGateway({ path: WS_PATH })
@Injectable()
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
    @WebSocketServer()
    private readonly server!: Server;

    private titleGenerator: ThreadTitleGenerator | null = null;
    private compactionService: CompactionService | null = null;
    private roomManager!: ThreadRoomManager;

    /** Per-thread mutex: thread IDs for which the lock is currently held. */
    private readonly threadLockHeld = new Set<string>();
    /** Per-thread mutex: queued resolve callbacks waiting for the lock. */
    private readonly threadLockQueues = new Map<string, (() => void)[]>();

    /** Active agent streams, keyed by thread ID. */
    private readonly activeStreams = new Map<string, ActiveStream>();

    constructor(
        @Inject(AGENT_PROVIDER) private readonly agent: IAgentProvider,
        @Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider,
        @Optional() @Inject(VALIDATE_TOKEN_FN) private readonly validateToken: ValidateTokenFn | null,
        @Optional() @Inject(GENERATE_TITLE_FN) private readonly generateTitleFn: GenerateTitleFn | null,
        @Optional() @Inject(SEARCH_PROVIDER) private readonly searchProvider: ISearchProvider | null,
        private readonly auditLogger: AuditLogger,
    ) {}

    afterInit(_server: Server): void {
        const server = this.server;
        this.roomManager = new ThreadRoomManager(server, this.persistence);
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

        // Set up compaction service
        this.compactionService = new CompactionService({
            agent: this.agent,
            persistence: this.persistence,
            auditLogger: this.auditLogger,
        });

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
        // Emit a welcome event with the resolved user ID so the client can
        // tag optimistic inserts and distinguish own messages.
        const user = (socket.data as { user?: User | undefined }).user;
        if (user) {
            socket.emit("welcome", {
                event: "welcome",
                userId: user.id,
                features: { search: this.searchProvider !== null },
            });
            // Join per-user room for multi-tab broadcasts (archive / read sync).
            void socket.join(`user:${user.id}`);
            this.roomManager.joinActiveRooms(socket);
        }

        socket.on("send-message", (data: SendMessageEvent) => {
            this.handleSendMessage(socket, data).catch((err: unknown) => {
                this.auditLogger.audit("error", "ws.send-message.unhandled", {
                    error: err instanceof Error ? err.message : String(err),
                });
                socket.emit("error", {
                    event: "error",
                    message: "Internal server error",
                    code: ERROR_CODES.internal_error,
                });
            });
        });
        socket.on("invite-member", (data: InviteMemberEvent) => {
            this.handleInviteMember(socket, data).catch((err: unknown) => {
                this.auditLogger.audit("error", "ws.invite-member.unhandled", {
                    error: err instanceof Error ? err.message : String(err),
                });
                socket.emit("error", {
                    event: "error",
                    message: "Internal server error",
                    code: ERROR_CODES.internal_error,
                });
            });
        });
        socket.on("remove-member", (data: RemoveMemberEvent) => {
            this.handleRemoveMember(socket, data).catch((err: unknown) => {
                this.auditLogger.audit("error", "ws.remove-member.unhandled", {
                    error: err instanceof Error ? err.message : String(err),
                });
                socket.emit("error", {
                    event: "error",
                    message: "Internal server error",
                    code: ERROR_CODES.internal_error,
                });
            });
        });
        socket.on("update-member-role", (data: UpdateMemberRoleEvent) => {
            this.handleUpdateMemberRole(socket, data).catch((err: unknown) => {
                this.auditLogger.audit("error", "ws.update-member-role.unhandled", {
                    error: err instanceof Error ? err.message : String(err),
                });
                socket.emit("error", {
                    event: "error",
                    message: "Internal server error",
                    code: ERROR_CODES.internal_error,
                });
            });
        });
    }

    private async handleSendMessage(socket: Socket, data: SendMessageEvent): Promise<void> {
        const parsed = chatRequestSchema.safeParse(data);
        if (!parsed.success) {
            const errorMessage = parsed.error.issues[0]?.message ?? "Invalid message";
            socket.emit("error", { event: "error", message: errorMessage, code: ERROR_CODES.invalid_message });
            return;
        }

        const { threadId } = parsed.data;

        // Signal abort on any active stream immediately, before waiting for the
        // lock, so the streaming loop can break at the next chunk boundary.
        this.signalAbort(threadId);

        // ── Phase 1: under mutex — finalize interrupt, persist, start stream ──
        await this.acquireThreadLock(threadId);
        let streamSetup: {
            stream: AsyncIterable<AgentStreamChunk>;
            streamState: ActiveStream;
            userId: string;
        } | null;
        try {
            streamSetup = await this.prepareMessage(socket, data);
        } finally {
            this.releaseThreadLock(threadId);
        }

        if (!streamSetup) return;

        // ── Phase 2: stream with per-chunk mutex ──
        await this.runStream(socket, threadId, streamSetup);
    }

    /**
     * Validate, interrupt any active stream, persist the user message, and
     * start the agent stream.  Runs under the per-thread mutex.
     *
     * @returns Stream context for {@link runStream}, or `null` if the message
     *   should not proceed (validation failure, not a member, etc.).
     */
    private async prepareMessage(
        socket: Socket,
        data: SendMessageEvent,
    ): Promise<{
        stream: AsyncIterable<AgentStreamChunk>;
        streamState: ActiveStream;
        userId: string;
    } | null> {
        const parsed = chatRequestSchema.safeParse(data);
        if (!parsed.success) return null;

        const { threadId, messageId, content } = parsed.data;
        const aiMessageId = randomUUID();
        const user = (socket.data as { user?: User | undefined }).user;
        const userId = user?.id ?? "anonymous";

        // Membership guard
        if (user) {
            const isMember = await this.persistence.isMember(threadId, user.id);
            if (!isMember) {
                socket.emit("error", {
                    event: "error",
                    message: "Not a member of this thread",
                    code: ERROR_CODES.not_member,
                });
                return null;
            }
        }

        // Finalize any interrupted stream (abort was already signalled by handleSendMessage).
        await this.interruptActiveStream(threadId);

        // Persist the user message (client-generated ID — DB PK rejects dupes)
        let persistedMsg;
        try {
            persistedMsg = await this.persistence.appendMessage({
                id: messageId,
                threadId,
                role: "human",
                content,
                authorId: user?.id ?? null,
            });
        } catch {
            socket.emit("error", {
                event: "error",
                message: "Duplicate message ID",
                code: ERROR_CODES.duplicate_message,
            });
            return null;
        }
        this.auditLogger.audit("info", "message.send", { userId, threadId, messageId });

        // Fire-and-forget: index the user message for search.
        this.indexMessage(persistedMsg.id, threadId, content, "human", user?.id ?? null);

        // Broadcast new-message to all members except the sender
        const newMsgEvent: NewMessageEvent = {
            event: "new-message",
            threadId,
            messageId: persistedMsg.id,
            role: "human",
            content,
            authorId: user?.id ?? null,
            authorName: user?.name ?? null,
            authorAvatarUrl: user?.avatarUrl ?? null,
            createdAt: persistedMsg.createdAt.toISOString(),
        };
        void this.emitToThreadMembers(threadId, "new-message", newMsgEvent, socket.id);

        // Auto-unarchive for all members who have this thread archived.
        void this.persistence.autoUnarchiveThread(threadId).then(() => {
            void this.emitToThreadMembers(threadId, "thread-updated", {
                event: "thread-updated",
                threadId,
                archived: false,
            } satisfies ThreadUpdatedEvent);
        });

        // Load full history and convert to AgentMessage[]
        const history = await this.persistence.loadMessages({
            threadId,
            excludeCompacted: this.agent.externalCompaction,
        });
        const members = await this.persistence.listMembersWithUser(threadId);
        const authorAliases = buildAuthorAliases(members);
        const messages: AgentMessage[] = threadMessagesToAgentMessages(history, authorAliases);

        // Multi-user triage: decide whether the agent should respond
        const memberCount = members.length;
        if (memberCount >= 2) {
            // Triage context window: last 10 messages or 30 minutes
            const triageMaxMessages = 10;
            const triageMaxAgeMs = 30 * 60 * 1000;
            const cutoff = new Date(Date.now() - triageMaxAgeMs);

            // Slice from the full messages array (skip system prompt at index 0)
            const conversationMessages = messages.slice(1);
            const recentByTime = conversationMessages.filter((_, i) => {
                const original = history[i];
                return original !== undefined && original.createdAt >= cutoff;
            });
            const triageMessages = recentByTime.slice(-triageMaxMessages);

            const triageResult = await this.agent.shouldRespond(triageMessages, threadId, memberCount);
            this.auditLogger.audit("info", "agent.triage", {
                threadId,
                memberCount,
                shouldRespond: triageResult.shouldRespond,
                reason: triageResult.reason,
            });

            if (!triageResult.shouldRespond) {
                return null;
            }
        }

        // Set up abort controller for this stream
        const controller = new AbortController();
        const streamState: ActiveStream = {
            controller,
            fullText: "",
            messageId: aiMessageId,
            citations: [],
            usage: null,
            opaqueBlocks: [],
            hasTextSinceToolBoundary: false,
            pendingToolBoundaryBreak: false,
        };
        this.activeStreams.set(threadId, streamState);

        const stream = await this.agent.stream(messages, threadId, userId, controller.signal);
        return { stream, streamState, userId };
    }

    /**
     * Consume the agent stream, acquiring the per-thread mutex for each chunk
     * and for the final persistence step.  Between chunks the mutex is
     * released, allowing a new user message to interrupt the stream.
     */
    private async runStream(
        socket: Socket,
        threadId: string,
        ctx: {
            stream: AsyncIterable<AgentStreamChunk>;
            streamState: ActiveStream;
            userId: string;
        },
    ): Promise<void> {
        const { stream, streamState, userId } = ctx;
        const { controller, messageId } = streamState;

        try {
            for await (const chunk of stream) {
                await this.acquireThreadLock(threadId);
                try {
                    // If we were interrupted while waiting for the lock, bail out.
                    if (controller.signal.aborted) return;

                    const delta = typeof chunk.content === "string" ? chunk.content : "";
                    if (delta) {
                        let normalizedDelta = delta;
                        if (streamState.pendingToolBoundaryBreak) {
                            const separator = toolBoundarySeparator(streamState.fullText);
                            if (separator) {
                                normalizedDelta = `${separator}${normalizedDelta}`;
                            }
                            streamState.pendingToolBoundaryBreak = false;
                        }

                        streamState.fullText += normalizedDelta;
                        streamState.hasTextSinceToolBoundary = true;
                        const deltaEvent: MessageDeltaEvent = {
                            event: "message-delta",
                            threadId,
                            messageId,
                            delta: normalizedDelta,
                        };
                        void this.emitToThreadMembers(threadId, "message-delta", deltaEvent);
                    }

                    // Emit transient status indicator (e.g. "Running code…") if present.
                    if (chunk.status) {
                        if (streamState.hasTextSinceToolBoundary) {
                            streamState.pendingToolBoundaryBreak = true;
                            streamState.hasTextSinceToolBoundary = false;
                        }

                        const statusEvent: MessageStatusEvent = {
                            event: "message-status",
                            threadId,
                            messageId,
                            status: chunk.status,
                            statusText: chunk.statusText ?? chunk.status,
                        };
                        void this.emitToThreadMembers(threadId, "message-status", statusEvent);
                    }

                    // Collect structured citations from the chunk.
                    if (chunk.citations) {
                        streamState.citations.push(...chunk.citations);
                    }

                    // Capture token usage from the final chunk.
                    if (chunk.usage) {
                        streamState.usage = chunk.usage;
                    }

                    // Collect opaque blocks (e.g. compaction) from the chunk.
                    if (chunk.opaqueBlocks) {
                        streamState.opaqueBlocks.push(...chunk.opaqueBlocks);
                    }
                } finally {
                    this.releaseThreadLock(threadId);
                }
            }

            // Stream completed normally — persist under mutex.
            await this.acquireThreadLock(threadId);
            try {
                // Re-check: another message may have interrupted between the
                // last chunk and this lock acquisition.
                if (controller.signal.aborted) return;

                this.activeStreams.delete(threadId);

                const assistantVisibleLength = streamState.fullText.replace(/[\s\u200B-\u200D\uFEFF]/g, "").length;

                if (assistantVisibleLength === 0) {
                    const message = "Assistant returned an empty response";
                    socket.emit("error", {
                        event: "error",
                        message,
                        code: ERROR_CODES.unspecified,
                    });
                    this.auditLogger.audit("error", "agent.empty-response", {
                        userId,
                        threadId,
                        messageId,
                        error: message,
                        assistantTextLength: streamState.fullText.length,
                        assistantVisibleLength,
                    });
                    return;
                }

                const metadata: Record<string, unknown> = {};
                if (streamState.citations.length > 0) {
                    metadata.citations = streamState.citations;
                }
                if (streamState.usage) {
                    metadata.vendor = streamState.usage.vendor;
                    metadata.model = streamState.usage.model;
                    metadata.inputTokens = streamState.usage.inputTokens;
                    metadata.outputTokens = streamState.usage.outputTokens;
                    if (streamState.usage.cacheCreationInputTokens) {
                        metadata.cacheCreationInputTokens = streamState.usage.cacheCreationInputTokens;
                    }
                    if (streamState.usage.cacheReadInputTokens) {
                        metadata.cacheReadInputTokens = streamState.usage.cacheReadInputTokens;
                    }
                }

                // Build content array: prepend opaque blocks (e.g. compaction) before text.
                const contentParts: ContentPart[] = [];
                for (const block of streamState.opaqueBlocks) {
                    contentParts.push({ type: "opaque", provider: block.provider, data: block.data });
                }
                contentParts.push({ type: "text", text: streamState.fullText });

                await this.persistence.appendMessage({
                    threadId,
                    role: "ai",
                    content: contentParts,
                    authorId: null,
                    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
                });

                const completeEvent: MessageCompleteEvent = {
                    event: "message-complete",
                    threadId,
                    messageId,
                    content: contentParts.filter((p) => p.type !== "opaque"),
                    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
                };
                // Always deliver completion to the initiating socket directly.
                // If room emission fails, the sender still receives the final payload.
                socket.emit("message-complete", completeEvent);
                await this.emitToThreadMembers(threadId, "message-complete", completeEvent, socket.id);
                this.auditLogger.audit("info", "agent.complete", {
                    userId,
                    threadId,
                    messageId,
                    assistantTextLength: streamState.fullText.length,
                    assistantVisibleLength,
                });

                // Fire-and-forget: index the AI message for search.
                this.indexMessage(messageId, threadId, contentParts, "ai", null);

                // Auto-unarchive for all members who have this thread archived.
                void this.persistence.autoUnarchiveThread(threadId).then(() => {
                    void this.emitToThreadMembers(threadId, "thread-updated", {
                        event: "thread-updated",
                        threadId,
                        archived: false,
                    } satisfies ThreadUpdatedEvent);
                });

                // Fire-and-forget title generation.
                if (this.titleGenerator) {
                    void this.titleGenerator.maybeGenerateTitle(threadId);
                }

                // Fire-and-forget compaction check (only for external compaction providers).
                if (this.compactionService && this.agent.externalCompaction && streamState.usage) {
                    void this.compactionService.maybeCompact(threadId, streamState.usage.inputTokens);
                }
            } finally {
                this.releaseThreadLock(threadId);
            }
        } catch (error: unknown) {
            // If aborted, interruptActiveStream already handled persistence
            // and the message-complete broadcast.
            if (controller.signal.aborted) {
                this.auditLogger.audit("info", "agent.interrupted", { userId, threadId, messageId });
                return;
            }

            this.activeStreams.delete(threadId);
            const message = error instanceof Error ? error.message : "Unknown error";
            socket.emit("error", {
                event: "error",
                message,
                code: ERROR_CODES.unspecified,
            });
            this.auditLogger.audit("error", "agent.error", { userId, threadId, messageId, error: message });
        }
    }

    /**
     * If an agent stream is active for the given thread, abort it, persist
     * the partial response, and broadcast a `message-complete` event with
     * `interrupted: true`.
     *
     * Must be called under the per-thread mutex.
     */
    private async interruptActiveStream(threadId: string): Promise<void> {
        const active = this.activeStreams.get(threadId);
        if (!active) return;

        try {
            active.controller.abort();
        } catch {
            // abort() may throw if a signal listener throws synchronously.
            // The signal is still marked as aborted.
        }
        this.activeStreams.delete(threadId);

        // Persist partial response (if any text was generated)
        if (active.fullText) {
            await this.persistence.appendMessage({
                threadId,
                role: "ai",
                content: [{ type: "text", text: active.fullText }],
                authorId: null,
                metadata: { interrupted: true },
            });

            const completeEvent: MessageCompleteEvent = {
                event: "message-complete",
                threadId,
                messageId: active.messageId,
                content: [{ type: "text", text: active.fullText }],
                interrupted: true,
            };
            void this.emitToThreadMembers(threadId, "message-complete", completeEvent);

            // Fire-and-forget: index the interrupted AI message for search.
            this.indexMessage(active.messageId, threadId, [{ type: "text", text: active.fullText }], "ai", null);
        }
    }

    private async handleInviteMember(socket: Socket, data: InviteMemberEvent): Promise<void> {
        const parsed = inviteMemberRequestSchema.safeParse({ email: data.email });
        if (!parsed.success) {
            const errorMessage = parsed.error.issues[0]?.message ?? "Invalid invite request";
            socket.emit("error", { event: "error", message: errorMessage, code: ERROR_CODES.invalid_request });
            return;
        }

        const { email } = parsed.data;
        const threadId = data.threadId;
        const user = (socket.data as { user?: User | undefined }).user;

        if (!threadId || !user) {
            socket.emit("error", {
                event: "error",
                message: "Invalid invite request",
                code: ERROR_CODES.invalid_request,
            });
            return;
        }

        // Sender must be a member of the thread
        const senderIsMember = await this.persistence.isMember(threadId, user.id);
        if (!senderIsMember) {
            socket.emit("error", {
                event: "error",
                message: "Not a member of this thread",
                code: ERROR_CODES.not_member,
            });
            return;
        }

        // Look up the invited user by email
        const invitedUser = await this.persistence.findUserByEmail(email);
        if (!invitedUser) {
            socket.emit("error", { event: "error", message: "User not found", code: ERROR_CODES.user_not_found });
            return;
        }

        // Check if already a member
        const alreadyMember = await this.persistence.isMember(threadId, invitedUser.id);
        if (alreadyMember) {
            socket.emit("error", {
                event: "error",
                message: "User is already a member of this thread",
                code: ERROR_CODES.already_member,
            });
            return;
        }

        await this.persistence.addMember(threadId, invitedUser.id, "member");
        await this.roomManager.addMember(threadId, invitedUser.id);
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

        // Notify the invited user so the thread appears in their thread list.
        // emitToThreadMembers sends to all members; useThreadList deduplicates.
        const thread = await this.persistence.getThread(threadId);
        if (thread) this.notifyThreadCreated(thread);
    }

    private async handleRemoveMember(socket: Socket, data: RemoveMemberEvent): Promise<void> {
        const parsed = removeMemberRequestSchema.safeParse({ userId: data.userId });
        if (!parsed.success) {
            socket.emit("error", {
                event: "error",
                message: parsed.error.issues[0]?.message ?? "Invalid request",
                code: ERROR_CODES.invalid_request,
            });
            return;
        }

        const threadId = data.threadId;
        const targetUserId = parsed.data.userId;
        const user = (socket.data as { user?: User | undefined }).user;

        if (!threadId || !user) {
            socket.emit("error", { event: "error", message: "Invalid request", code: ERROR_CODES.invalid_request });
            return;
        }

        const senderRole = await this.persistence.getMemberRole(threadId, user.id);
        if (!senderRole) {
            socket.emit("error", {
                event: "error",
                message: "Not a member of this thread",
                code: ERROR_CODES.not_member,
            });
            return;
        }

        const isSelf = targetUserId === user.id;

        if (isSelf) {
            // Self-removal: only non-owners can leave
            if (senderRole === "owner") {
                socket.emit("error", {
                    event: "error",
                    message: "Owners cannot remove themselves",
                    code: ERROR_CODES.owner_cannot_self_remove,
                });
                return;
            }
        } else {
            // Removing another user: only owners can do this
            if (senderRole !== "owner") {
                socket.emit("error", {
                    event: "error",
                    message: "Only owners can remove other members",
                    code: ERROR_CODES.only_owners_can_remove,
                });
                return;
            }
        }

        // Verify target is actually a member
        const targetIsMember = await this.persistence.isMember(threadId, targetUserId);
        if (!targetIsMember) {
            socket.emit("error", {
                event: "error",
                message: "User is not a member of this thread",
                code: ERROR_CODES.not_a_member_target,
            });
            return;
        }

        await this.persistence.removeMember(threadId, targetUserId);
        this.auditLogger.audit("info", isSelf ? "member.leave" : "member.remove", {
            userId: user.id,
            threadId,
            targetUserId,
        });

        const event: MemberLeftEvent = {
            event: "member-left",
            threadId,
            userId: targetUserId,
        };
        void this.emitToThreadMembers(threadId, "member-left", event);
        // Also emit to the removed user directly so their client can react
        const targetSockets = await this.server.fetchSockets();
        for (const s of targetSockets) {
            if ((s.data as { user?: User | undefined }).user?.id === targetUserId) {
                s.emit("member-left", event);
                s.leave(`thread:${threadId}`);
            }
        }
    }

    private async handleUpdateMemberRole(socket: Socket, data: UpdateMemberRoleEvent): Promise<void> {
        const parsed = updateMemberRoleRequestSchema.safeParse({ userId: data.userId, role: data.role });
        if (!parsed.success) {
            socket.emit("error", {
                event: "error",
                message: parsed.error.issues[0]?.message ?? "Invalid request",
                code: ERROR_CODES.invalid_request,
            });
            return;
        }

        const threadId = data.threadId;
        const targetUserId = parsed.data.userId;
        const newRole = parsed.data.role;
        const user = (socket.data as { user?: User | undefined }).user;

        if (!threadId || !user) {
            socket.emit("error", { event: "error", message: "Invalid request", code: ERROR_CODES.invalid_request });
            return;
        }

        // Only owners can change roles
        const senderRole = await this.persistence.getMemberRole(threadId, user.id);
        if (senderRole !== "owner") {
            socket.emit("error", {
                event: "error",
                message: "Only owners can change member roles",
                code: ERROR_CODES.only_owners_can_change_roles,
            });
            return;
        }

        // Cannot change own role
        if (targetUserId === user.id) {
            socket.emit("error", {
                event: "error",
                message: "Cannot change your own role",
                code: ERROR_CODES.cannot_change_own_role,
            });
            return;
        }

        // Verify target is a member
        const targetRole = await this.persistence.getMemberRole(threadId, targetUserId);
        if (!targetRole) {
            socket.emit("error", {
                event: "error",
                message: "User is not a member of this thread",
                code: ERROR_CODES.not_a_member_target,
            });
            return;
        }

        if (targetRole === newRole) {
            return; // Already the requested role, no-op
        }

        await this.persistence.updateMemberRole(threadId, targetUserId, newRole);
        this.auditLogger.audit("info", "member.role-change", {
            userId: user.id,
            threadId,
            targetUserId,
            newRole,
        });

        const event: MemberRoleChangedEvent = {
            event: "member-role-changed",
            threadId,
            userId: targetUserId,
            role: newRole,
        };
        void this.emitToThreadMembers(threadId, "member-role-changed", event);
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
                memoryEnabled: thread.memoryEnabled,
                titleGeneratedAt: thread.titleGeneratedAt?.toISOString() ?? null,
                titleManuallySet: thread.titleManuallySet,
            },
        };
        void this.emitToThreadMembers(thread.id, "thread-created", event);
    }

    /**
     * Signal abort on any active agent stream for the given thread.
     * Called before acquiring the lock so the streaming loop can break
     * at the next chunk boundary without waiting.
     */
    private signalAbort(threadId: string): void {
        const active = this.activeStreams.get(threadId);
        if (active) {
            try {
                active.controller.abort();
            } catch {
                // AbortController.abort() may throw if an abort event listener
                // on the signal throws synchronously. The abort itself still
                // succeeds — the signal is marked as aborted.
            }
        }
    }

    /** Acquire the per-thread mutex.  Resolves when the lock is held. */
    private async acquireThreadLock(threadId: string): Promise<void> {
        if (!this.threadLockHeld.has(threadId)) {
            this.threadLockHeld.add(threadId);
            return;
        }
        return new Promise<void>((resolve) => {
            let queue = this.threadLockQueues.get(threadId);
            if (!queue) {
                queue = [];
                this.threadLockQueues.set(threadId, queue);
            }
            queue.push(resolve);
        });
    }

    /** Release the per-thread mutex, unblocking the next waiter if any. */
    private releaseThreadLock(threadId: string): void {
        const queue = this.threadLockQueues.get(threadId);
        if (queue && queue.length > 0) {
            const next = queue.shift();
            if (queue.length === 0) this.threadLockQueues.delete(threadId);
            if (next) next();
        } else {
            this.threadLockHeld.delete(threadId);
        }
    }

    /**
     * Emit an event to all connected sockets for a specific user (multi-tab sync).
     *
     * Uses the `user:{userId}` room that each socket joins on connection.
     */
    emitToUser(userId: string, eventName: string, payload: unknown): void {
        this.server.to(`user:${userId}`).emit(eventName, payload);
    }

    /**
     * Emit an event to all connected sockets in the thread room.
     *
     * The room is initialized on-demand if it does not already exist (one
     * `listMembers` DB query).  Subsequent emits for the same thread use the
     * Socket.io room directly with no DB queries.
     *
     * @param excludeSocketId - Optional socket ID to exclude (e.g. the sender).
     */
    private async emitToThreadMembers(
        threadId: string,
        eventName: string,
        payload: unknown,
        excludeSocketId?: string,
    ): Promise<void> {
        try {
            await this.roomManager.ensureRoom(threadId);
            const room = `thread:${threadId}`;
            if (excludeSocketId) {
                this.server.to(room).except(excludeSocketId).emit(eventName, payload);
            } else {
                this.server.to(room).emit(eventName, payload);
            }
        } catch (error) {
            this.auditLogger.audit("error", "ws.emit.failed", {
                threadId,
                eventName,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /**
     * Fire-and-forget: index a message for semantic search.
     *
     * Failures are logged but never propagated — search indexing must not
     * break messaging.
     */
    private indexMessage(
        messageId: string,
        threadId: string,
        content: ContentPart[],
        role: string,
        authorId: string | null,
    ): void {
        if (!this.searchProvider) return;
        const text = extractText(content);
        if (!text) return;

        void this.searchProvider
            .index("messages", {
                id: messageId,
                content: text,
                metadata: { threadId, role, authorId, createdAt: new Date().toISOString() },
            })
            .catch((error: unknown) => {
                this.auditLogger.audit("error", "search.index.failed", {
                    messageId,
                    threadId,
                    error: error instanceof Error ? error.message : String(error),
                });
            });
    }
}
