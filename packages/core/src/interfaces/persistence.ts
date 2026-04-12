import type { ContentPart, MessageRole, ThreadMessage } from "../types/message.js";
import type { Thread, ThreadMember, ThreadMemberInfo, ThreadMemberRole } from "../types/thread.js";
import type { User } from "../types/user.js";

/** Options for creating a new thread. */
export interface CreateThreadOptions {
    /** Human-readable title. */
    title: string;
    /** User ID of the thread creator (becomes the owner). */
    creatorId: string;
}

/** Options for listing threads visible to a user. */
export interface ListThreadsOptions {
    /** Only return threads the user is a member of. */
    userId: string;
    /** Whether to include archived threads in the results. */
    includeArchived?: boolean | undefined;
    /** Maximum number of threads to return. */
    limit?: number | undefined;
    /** Number of threads to skip (for offset-based pagination). */
    offset?: number | undefined;
}

/** Options for appending a message to a thread. */
export interface AppendMessageOptions {
    /**
     * Optional pre-assigned message ID.
     *
     * When provided the persistence layer uses this ID instead of generating
     * one.  Human messages supply a client-generated UUID v4; AI/agent
     * messages omit this and let the server generate the ID.
     * See CONVENTIONS.md § "Record ID Ownership".
     */
    id?: string | undefined;
    /** Target thread ID. */
    threadId: string;
    /** Role of the message author. */
    role: MessageRole;
    /** Ordered content parts making up the message body. */
    content: ContentPart[];
    /** User ID of the author, or `null` for system/agent messages. */
    authorId: string | null;
    /** Arbitrary metadata to attach to the message. */
    metadata?: Record<string, unknown> | undefined;
    /** Override the logical ordering timestamp. Defaults to the current time. */
    contentAt?: Date | undefined;
}

/** Options for loading messages from a thread with cursor-based pagination. */
export interface LoadMessagesOptions {
    /** Thread to load messages from. */
    threadId: string;
    /** Maximum number of messages to return. */
    limit?: number | undefined;
    /** Return only messages created before this timestamp. */
    before?: Date | undefined;
    /** Exclude messages marked as compacted (original messages replaced by a summary). */
    excludeCompacted?: boolean | undefined;
    /** Exclude compaction summary messages (agent-generated summaries not shown to users). */
    excludeCompactionSummaries?: boolean | undefined;
}

/**
 * Storage provider for users, threads, memberships, and messages.
 *
 * Implementations back the data layer (e.g. PostgreSQL via TypeORM).
 */
export interface IPersistenceProvider {
    // Users
    /** Find a user by their email address. */
    findUserByEmail(email: string): Promise<User | null>;
    /** Find a user by their unique ID. */
    findUserById(id: string): Promise<User | null>;
    /** Create or update a user record (matched by ID). */
    upsertUser(user: Omit<User, "createdAt">): Promise<User>;
    /** Update mutable user properties. */
    updateUser(userId: string, updates: Partial<Pick<User, "agentAlias">>): Promise<User>;

    // Threads
    /** Create a new thread and add the creator as owner. */
    createThread(options: CreateThreadOptions): Promise<Thread>;
    /** Retrieve a thread by ID, or `null` if not found. */
    getThread(threadId: string): Promise<Thread | null>;
    /** List threads the given user is a member of. */
    listThreads(options: ListThreadsOptions): Promise<Thread[]>;
    /** Update mutable thread properties. */
    updateThread(
        threadId: string,
        updates: Partial<Pick<Thread, "title" | "memoryEnabled" | "titleGeneratedAt" | "titleManuallySet">>,
    ): Promise<Thread>;
    /** Permanently delete a thread and all its messages. */
    deleteThread(threadId: string): Promise<void>;

    /** Update per-user thread state (archive / last-read). Creates the row on first call (UPSERT). */
    updateThreadUserState(
        threadId: string,
        userId: string,
        updates: { archivedAt?: Date | null; lastReadAt?: Date | null },
    ): Promise<void>;
    /** Clear `archived_at` for all members who have the thread archived (auto-unarchive). */
    autoUnarchiveThread(threadId: string): Promise<void>;

    // Membership
    /** Add a user to a thread with the given role. */
    addMember(threadId: string, userId: string, role: ThreadMemberRole): Promise<ThreadMember>;
    /** Remove a user from a thread. */
    removeMember(threadId: string, userId: string): Promise<void>;
    /** List all members of a thread. */
    listMembers(threadId: string): Promise<ThreadMember[]>;
    /** List all members of a thread with their user display information. */
    listMembersWithUser(threadId: string): Promise<ThreadMemberInfo[]>;
    /** Check whether a user is a member of a thread. */
    isMember(threadId: string, userId: string): Promise<boolean>;
    /** Return the role of a user in a thread, or `null` if not a member. */
    getMemberRole(threadId: string, userId: string): Promise<ThreadMemberRole | null>;
    /** Update the role of an existing thread member. */
    updateMemberRole(threadId: string, userId: string, role: ThreadMemberRole): Promise<void>;

    // Messages
    /** Append a new message to a thread. */
    appendMessage(options: AppendMessageOptions): Promise<ThreadMessage>;
    /** Load messages from a thread with optional cursor-based pagination. */
    loadMessages(options: LoadMessagesOptions): Promise<ThreadMessage[]>;
    /** Count the total number of messages in a thread. */
    countMessages(threadId: string): Promise<number>;
    /** Merge additional metadata into an existing message's metadata JSONB. */
    updateMessageMetadata(messageId: string, metadata: Record<string, unknown>): Promise<void>;
    /** Permanently delete a message by ID. */
    deleteMessage(messageId: string): Promise<void>;

    // Search
    /** Search users by name or email (case-insensitive substring match). */
    searchUsers(query: string, limit?: number): Promise<User[]>;
}
