export type ThreadType = "personal" | "room";

export interface Thread {
    id: string;
    title: string;
    type: ThreadType;
    createdAt: Date;
    updatedAt: Date;
    archived: boolean;
    memoryEnabled: boolean;
}

export type ThreadMemberRole = "owner" | "member";

export interface ThreadMember {
    userId: string;
    threadId: string;
    role: ThreadMemberRole;
    joinedAt: Date;
}
