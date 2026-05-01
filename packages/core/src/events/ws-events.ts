import type { ErrorCode } from "../types/error-code.js";
import type { ContentPart, MessageRole } from "../types/message.js";
import type { StatusCode } from "../types/status-code.js";

// ─── Client → Server Events ───

/** Client sends a new message to a thread. */
export interface SendMessageEvent {
    event: "send-message";
    /** Target thread. */
    threadId: string;
    /**
     * Client-generated UUID v4 for the message.
     *
     * Human messages are ID'd by the client so optimistic inserts use the
     * real, permanent identifier. The server validates format and uniqueness.
     * See CONVENTIONS.md § "Record ID Ownership".
     */
    messageId: string;
    /** Message content parts. */
    content: ContentPart[];
}

/** Client joins a thread to receive its real-time events. */
export interface JoinThreadEvent {
    event: "join-thread";
    threadId: string;
}

/** Client leaves a thread and stops receiving its events. */
export interface LeaveThreadEvent {
    event: "leave-thread";
    threadId: string;
}

/** Client signals that the user has started typing. */
export interface TypingStartEvent {
    event: "typing-start";
    threadId: string;
}

/** Client signals that the user has stopped typing. */
export interface TypingStopEvent {
    event: "typing-stop";
    threadId: string;
}

/** Client invites another user to a thread by email. */
export interface InviteMemberEvent {
    event: "invite-member";
    threadId: string;
    /** Email address of the user to invite. */
    email: string;
}

/** Client requests removal of a member from a thread (including self-removal). */
export interface RemoveMemberEvent {
    event: "remove-member";
    threadId: string;
    /** User ID of the member to remove. */
    userId: string;
}

/** Client requests a role change for a thread member. */
export interface UpdateMemberRoleEvent {
    event: "update-member-role";
    threadId: string;
    /** User ID of the member whose role should change. */
    userId: string;
    /** The new role to assign. */
    role: "owner" | "member";
}

/** Discriminated union of all events the client can send to the server. */
export type ClientToServerEvent =
    | SendMessageEvent
    | JoinThreadEvent
    | LeaveThreadEvent
    | TypingStartEvent
    | TypingStopEvent
    | InviteMemberEvent
    | RemoveMemberEvent
    | UpdateMemberRoleEvent;

// ─── Server → Client Events ───

/** Incremental content-part chunk streamed while the assistant is generating a response. */
export interface PartDeltaEvent {
    event: "part-delta";
    threadId: string;
    /** Stable ID for the message being streamed. */
    messageId: string;
    /** Zero-based index of the content part being updated. */
    partIndex: number;
    /** The type of the content part (only `"text"` is currently streamed incrementally). */
    type: "text";
    /** The new text fragment to append. */
    delta: string;
}

/** Transient status update during assistant streaming (e.g. "Running code…"). Not persisted. */
export interface MessageStatusEvent {
    event: "message-status";
    threadId: string;
    /** Stable ID for the message being streamed. */
    messageId: string;
    /** Machine-readable status code for translation lookup. */
    status: StatusCode;
    /** Human-readable English status label. Always included as a fallback for UIs without i18n. */
    statusText: string;
}

/** Signals that assistant streaming is finished and provides the final content. */
export interface MessageCompleteEvent {
    event: "message-complete";
    threadId: string;
    messageId: string;
    /** Complete, authoritative content parts for the finished message. */
    content: ContentPart[];
    /** `true` when the response was interrupted by a new message before completion. */
    interrupted?: boolean | undefined;
    /** Arbitrary key-value metadata attached to the completed message (e.g. citations). */
    metadata?: Record<string, unknown> | undefined;
}

/** A fully-formed message broadcast to all thread members (e.g. another user's message). */
export interface NewMessageEvent {
    event: "new-message";
    threadId: string;
    messageId: string;
    role: MessageRole;
    content: ContentPart[];
    /** User ID of the author, or `null` for system/agent messages. */
    authorId: string | null;
    /** Display name of the author, or `null` for system/agent messages. */
    authorName: string | null;
    /** Avatar URL of the author, or `null` if unavailable. */
    authorAvatarUrl: string | null;
    /** ISO-8601 timestamp of when the message was created. */
    createdAt: string;
}

/** Notifies thread members that a user started or stopped typing. */
export interface TypingEvent {
    event: "typing";
    threadId: string;
    userId: string;
    isTyping: boolean;
}

/** Snapshot of which users are currently online in a thread. */
export interface PresenceUpdateEvent {
    event: "presence-update";
    threadId: string;
    onlineUserIds: string[];
}

/** A new member has joined the thread. */
export interface MemberJoinedEvent {
    event: "member-joined";
    threadId: string;
    userId: string;
    role: "owner" | "member";
}

/** A member has left (or been removed from) the thread. */
export interface MemberLeftEvent {
    event: "member-left";
    threadId: string;
    userId: string;
}

/** A member's role has been changed. */
export interface MemberRoleChangedEvent {
    event: "member-role-changed";
    threadId: string;
    userId: string;
    role: "owner" | "member";
}

/** One or more mutable thread properties have been updated. */
export interface ThreadUpdatedEvent {
    event: "thread-updated";
    threadId: string;
    title?: string | undefined;
    titleManuallySet?: boolean | undefined;
    archived?: boolean | undefined;
    memoryEnabled?: boolean | undefined;
    /** Per-user unread count (only sent to the affected user's sockets). */
    unreadCount?: number | undefined;
}

/** A new thread has been created. */
export interface ThreadCreatedEvent {
    event: "thread-created";
    /** The full thread object (with ISO-8601 date strings). */
    thread: {
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        archivedAt?: string | null | undefined;
        memoryEnabled: boolean;
        titleGeneratedAt?: string | null | undefined;
        titleManuallySet: boolean;
    };
}

/** Server-side error related to the current connection or a specific operation. */
export interface ErrorEvent {
    event: "error";
    /** Human-readable English error description. Always included as a fallback for UIs without i18n. */
    message: string;
    /** Machine-readable error code for programmatic handling and translation lookup. */
    code: ErrorCode;
}

/** Server-advertised feature flags sent with the welcome event. */
export interface ServerFeatures {
    /** Whether semantic thread search is available. */
    search?: boolean | undefined;
}

/** Emitted to a client immediately after successful WebSocket authentication. */
export interface WelcomeEvent {
    event: "welcome";
    /** The resolved database user ID for the authenticated connection. */
    userId: string;
    /** Optional feature flags advertised by the server. */
    features?: ServerFeatures | undefined;
}

/** Discriminated union of all events the server can send to the client. */
export type ServerToClientEvent =
    | PartDeltaEvent
    | MessageStatusEvent
    | MessageCompleteEvent
    | NewMessageEvent
    | TypingEvent
    | PresenceUpdateEvent
    | MemberJoinedEvent
    | MemberLeftEvent
    | MemberRoleChangedEvent
    | ThreadUpdatedEvent
    | ThreadCreatedEvent
    | ErrorEvent
    | WelcomeEvent;
