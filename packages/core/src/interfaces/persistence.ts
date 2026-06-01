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

/** Options for saving a newly uploaded attachment. */
export interface SaveAttachmentOptions {
    /** Optional pre-assigned attachment ID. Generated when omitted. */
    id?: string | undefined;
    /** User ID of the uploader. */
    uploaderId: string;
    /** Original file name. */
    name: string;
    /** MIME type of the attachment. */
    mimeType: string;
    /** Size of the attachment in bytes. */
    size: number;
    /** Raw attachment bytes. */
    bytes: Uint8Array;
}

/** Stored attachment metadata (without the raw bytes). */
export interface AttachmentRecord {
    /** Unique attachment ID. */
    id: string;
    /** User ID of the uploader. */
    uploaderId: string;
    /** Thread the attachment is associated with, or `null` while still pending. */
    threadId: string | null;
    /** Message the attachment is associated with, or `null` while still pending. */
    messageId: string | null;
    /** Original file name. */
    name: string;
    /** MIME type of the attachment. */
    mimeType: string;
    /** Size of the attachment in bytes. */
    size: number;
    /** Timestamp when the attachment was uploaded. */
    createdAt: Date;
}

/** A stored attachment together with its raw bytes. */
export interface AttachmentData {
    /** Attachment metadata. */
    record: AttachmentRecord;
    /** Raw attachment bytes. */
    bytes: Uint8Array;
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

    // Thread IDs
    /** Return the IDs of all threads the given user is a member of. */
    listThreadIds(userId: string): Promise<string[]>;

    // Attachments
    /** Persist a newly uploaded attachment (initially not associated with any thread/message). */
    saveAttachment(options: SaveAttachmentOptions): Promise<AttachmentRecord>;
    /** Fetch attachment metadata (without bytes) by ID, or `null` if not found. */
    getAttachment(id: string): Promise<AttachmentRecord | null>;
    /** Load an attachment's metadata and raw bytes by ID, or `null` if not found. */
    loadAttachmentData(id: string): Promise<AttachmentData | null>;
    /**
     * Associate the given pending attachments with a thread and message.
     *
     * Only updates attachments that are owned by `uploaderId` and not yet
     * associated (`thread_id IS NULL`). Returns the number of rows updated so
     * callers can detect invalid or already-consumed references.
     */
    associateAttachments(ids: string[], uploaderId: string, threadId: string, messageId: string): Promise<number>;
    /** Permanently delete an attachment by ID. */
    deleteAttachment(id: string): Promise<void>;
    /** Delete unassociated attachments uploaded before the given cutoff. Returns the number deleted. */
    deleteOrphanAttachments(olderThan: Date): Promise<number>;

    // Bulk operations
    /**
     * Stream all messages across all threads in `created_at` order.
     *
     * Returns an async iterable of batches. Each batch contains up to
     * `batchSize` messages (default 100). Used for full reindexing.
     */
    loadAllMessages(options?: { batchSize?: number | undefined }): AsyncIterable<ThreadMessage[]>;

    // Search
    /** Search users by name or email (case-insensitive substring match). */
    searchUsers(query: string, limit?: number): Promise<User[]>;
    /**
     * Search users who share at least one thread with `userId`.
     *
     * Results are filtered by a case-insensitive substring match on name or
     * email, exclude the caller, and exclude soft-deleted users.
     */
    searchCoMembers(userId: string, query: string, limit?: number): Promise<User[]>;
}
