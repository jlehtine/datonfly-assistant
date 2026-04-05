import type { ContentPart, ThreadMessage } from "../types/message.js";
import type { Thread, ThreadMember, ThreadMemberRole, ThreadType } from "../types/thread.js";
import type { User } from "../types/user.js";

export interface CreateThreadOptions {
    title: string;
    type: ThreadType;
    creatorId: string;
}

export interface ListThreadsOptions {
    userId: string;
    includeArchived?: boolean | undefined;
}

export interface AppendMessageOptions {
    threadId: string;
    role: "user" | "assistant" | "system";
    content: ContentPart[];
    authorId: string | null;
    metadata?: Record<string, unknown> | undefined;
}

export interface LoadMessagesOptions {
    threadId: string;
    limit?: number | undefined;
    before?: Date | undefined;
}

export interface IPersistenceProvider {
    // Users
    findUserByEmail(email: string): Promise<User | null>;
    findUserById(id: string): Promise<User | null>;
    upsertUser(user: Omit<User, "createdAt">): Promise<User>;

    // Threads
    createThread(options: CreateThreadOptions): Promise<Thread>;
    getThread(threadId: string): Promise<Thread | null>;
    listThreads(options: ListThreadsOptions): Promise<Thread[]>;
    updateThread(
        threadId: string,
        updates: Partial<Pick<Thread, "title" | "archived" | "memoryEnabled">>,
    ): Promise<Thread>;
    deleteThread(threadId: string): Promise<void>;

    // Membership
    addMember(threadId: string, userId: string, role: ThreadMemberRole): Promise<ThreadMember>;
    removeMember(threadId: string, userId: string): Promise<void>;
    listMembers(threadId: string): Promise<ThreadMember[]>;
    isMember(threadId: string, userId: string): Promise<boolean>;

    // Messages
    appendMessage(options: AppendMessageOptions): Promise<ThreadMessage>;
    loadMessages(options: LoadMessagesOptions): Promise<ThreadMessage[]>;
}
