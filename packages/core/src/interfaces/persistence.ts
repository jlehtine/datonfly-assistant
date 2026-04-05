import type { ContentPart, ThreadMessage } from "../types/message.js";
import type { Thread, ThreadMember, ThreadMemberRole } from "../types/thread.js";
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
}

/** Options for appending a message to a thread. */
export interface AppendMessageOptions {
    /** Target thread ID. */
    threadId: string;
    /** Role of the message author. */
    role: "user" | "assistant" | "system";
    /** Ordered content parts making up the message body. */
    content: ContentPart[];
    /** User ID of the author, or `null` for system/agent messages. */
    authorId: string | null;
    /** Arbitrary metadata to attach to the message. */
    metadata?: Record<string, unknown> | undefined;
}

/** Options for loading messages from a thread with cursor-based pagination. */
export interface LoadMessagesOptions {
    /** Thread to load messages from. */
    threadId: string;
    /** Maximum number of messages to return. */
    limit?: number | undefined;
    /** Return only messages created before this timestamp. */
    before?: Date | undefined;
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
        updates: Partial<Pick<Thread, "title" | "archivedAt" | "memoryEnabled">>,
    ): Promise<Thread>;
    /** Permanently delete a thread and all its messages. */
    deleteThread(threadId: string): Promise<void>;

    // Membership
    /** Add a user to a thread with the given role. */
    addMember(threadId: string, userId: string, role: ThreadMemberRole): Promise<ThreadMember>;
    /** Remove a user from a thread. */
    removeMember(threadId: string, userId: string): Promise<void>;
    /** List all members of a thread. */
    listMembers(threadId: string): Promise<ThreadMember[]>;
    /** Check whether a user is a member of a thread. */
    isMember(threadId: string, userId: string): Promise<boolean>;

    // Messages
    /** Append a new message to a thread. */
    appendMessage(options: AppendMessageOptions): Promise<ThreadMessage>;
    /** Load messages from a thread with optional cursor-based pagination. */
    loadMessages(options: LoadMessagesOptions): Promise<ThreadMessage[]>;
}
