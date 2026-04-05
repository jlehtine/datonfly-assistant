import type { ContentPart } from "../types/message.js";

// ─── Client → Server Events ───

/** Client sends a new message to a thread. */
export interface SendMessageEvent {
    event: "send-message";
    /** Target thread. */
    threadId: string;
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

/** Discriminated union of all events the client can send to the server. */
export type ClientToServerEvent =
    | SendMessageEvent
    | JoinThreadEvent
    | LeaveThreadEvent
    | TypingStartEvent
    | TypingStopEvent
    | InviteMemberEvent;

// ─── Server → Client Events ───

/** Incremental text chunk streamed while the assistant is generating a response. */
export interface MessageDeltaEvent {
    event: "message-delta";
    threadId: string;
    /** Stable ID for the message being streamed. */
    messageId: string;
    /** The new text fragment to append. */
    delta: string;
}

/** Signals that assistant streaming is finished and provides the final content. */
export interface MessageCompleteEvent {
    event: "message-complete";
    threadId: string;
    messageId: string;
    /** Complete, authoritative content parts for the finished message. */
    content: ContentPart[];
}

/** A fully-formed message broadcast to all thread members (e.g. another user's message). */
export interface NewMessageEvent {
    event: "new-message";
    threadId: string;
    messageId: string;
    role: "user" | "assistant" | "system";
    content: ContentPart[];
    /** User ID of the author, or `null` for system/agent messages. */
    authorId: string | null;
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

/** One or more mutable thread properties have been updated. */
export interface ThreadUpdatedEvent {
    event: "thread-updated";
    threadId: string;
    title?: string | undefined;
    archived?: boolean | undefined;
    memoryEnabled?: boolean | undefined;
}

/** Server-side error related to the current connection or a specific operation. */
export interface ErrorEvent {
    event: "error";
    /** Human-readable error description. */
    message: string;
    /** Machine-readable error code for programmatic handling. */
    code?: string | undefined;
}

/** Discriminated union of all events the server can send to the client. */
export type ServerToClientEvent =
    | MessageDeltaEvent
    | MessageCompleteEvent
    | NewMessageEvent
    | TypingEvent
    | PresenceUpdateEvent
    | MemberJoinedEvent
    | MemberLeftEvent
    | ThreadUpdatedEvent
    | ErrorEvent;
