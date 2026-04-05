import type { ContentPart } from "../types/message.js";

// ─── Client → Server Events ───

export interface SendMessageEvent {
    event: "send-message";
    threadId: string;
    content: ContentPart[];
}

export interface JoinThreadEvent {
    event: "join-thread";
    threadId: string;
}

export interface LeaveThreadEvent {
    event: "leave-thread";
    threadId: string;
}

export interface TypingStartEvent {
    event: "typing-start";
    threadId: string;
}

export interface TypingStopEvent {
    event: "typing-stop";
    threadId: string;
}

export interface InviteMemberEvent {
    event: "invite-member";
    threadId: string;
    email: string;
}

export type ClientToServerEvent =
    | SendMessageEvent
    | JoinThreadEvent
    | LeaveThreadEvent
    | TypingStartEvent
    | TypingStopEvent
    | InviteMemberEvent;

// ─── Server → Client Events ───

export interface MessageDeltaEvent {
    event: "message-delta";
    threadId: string;
    messageId: string;
    delta: string;
}

export interface MessageCompleteEvent {
    event: "message-complete";
    threadId: string;
    messageId: string;
    content: ContentPart[];
}

export interface NewMessageEvent {
    event: "new-message";
    threadId: string;
    messageId: string;
    role: "user" | "assistant" | "system";
    content: ContentPart[];
    authorId: string | null;
    createdAt: string;
}

export interface TypingEvent {
    event: "typing";
    threadId: string;
    userId: string;
    isTyping: boolean;
}

export interface PresenceUpdateEvent {
    event: "presence-update";
    threadId: string;
    onlineUserIds: string[];
}

export interface MemberJoinedEvent {
    event: "member-joined";
    threadId: string;
    userId: string;
    role: "owner" | "member";
}

export interface MemberLeftEvent {
    event: "member-left";
    threadId: string;
    userId: string;
}

export interface ThreadUpdatedEvent {
    event: "thread-updated";
    threadId: string;
    title?: string | undefined;
    archived?: boolean | undefined;
    memoryEnabled?: boolean | undefined;
}

export interface ErrorEvent {
    event: "error";
    message: string;
    code?: string | undefined;
}

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
