/** A conversation thread that contains messages and members. */
export interface Thread {
    /** Unique thread identifier (UUID). */
    id: string;
    /** Human-readable title of the thread. */
    title: string;
    /** Timestamp when the thread was created. */
    createdAt: Date;
    /** Timestamp of the last modification (title change, new message, etc.). */
    updatedAt: Date;
    /** Timestamp when the thread was archived by the requesting user, or `undefined` if active. Per-user. */
    archivedAt?: Date | undefined;
    /** Whether the agent persists long-term memories from this thread. */
    memoryEnabled: boolean;
    /** Timestamp when the requesting user last read this thread, or `undefined`. Per-user. */
    lastReadAt?: Date | undefined;
    /** Number of unread messages from others since the user last read. Per-user. */
    unreadCount?: number | undefined;
    /** Timestamp of the last auto-generated title, or `undefined` if never generated. */
    titleGeneratedAt?: Date | undefined;
    /** Whether the title was manually set by a user (protected from auto-generation). */
    titleManuallySet: boolean;
}

/** Role a user can have within a thread. */
export type ThreadMemberRole = "owner" | "member";

/** A user's membership in a thread. */
export interface ThreadMember {
    /** The member's user ID. */
    userId: string;
    /** The thread this membership belongs to. */
    threadId: string;
    /** The member's role within the thread. */
    role: ThreadMemberRole;
    /** Timestamp when the user joined the thread. */
    joinedAt: Date;
}

/** Thread membership enriched with the user's display information. */
export interface ThreadMemberInfo {
    /** The member's user ID. */
    userId: string;
    /** The member's role within the thread. */
    role: ThreadMemberRole;
    /** Timestamp when the user joined the thread. */
    joinedAt: Date;
    /** Display name of the member. */
    name: string;
    /** Email address of the member. */
    email: string;
    /** URL to the member's avatar, if available. */
    avatarUrl?: string | undefined;
    /** Name shown to the AI agent in place of the member's real name. */
    agentAlias?: string | undefined;
}
