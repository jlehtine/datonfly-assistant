/** Thread type discriminator: `"personal"` for 1:1 agent chats, `"room"` for multi-user rooms. */
export type ThreadType = "personal" | "room";

/** A conversation thread that contains messages and members. */
export interface Thread {
    /** Unique thread identifier (UUID). */
    id: string;
    /** Human-readable title of the thread. */
    title: string;
    /** Whether this is a personal agent chat or a multi-user room. */
    type: ThreadType;
    /** Timestamp when the thread was created. */
    createdAt: Date;
    /** Timestamp of the last modification (title change, new message, etc.). */
    updatedAt: Date;
    /** Whether the thread is archived and hidden from default listings. */
    archived: boolean;
    /** Whether the agent persists long-term memories from this thread. */
    memoryEnabled: boolean;
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
