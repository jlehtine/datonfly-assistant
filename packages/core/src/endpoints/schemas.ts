import { z } from "zod";

import { contentPartSchema } from "../dto/schemas.js";

// ─── Thread (wire format) ───

/** Zod schema for a {@link Thread} as serialized over JSON (dates as ISO strings). */
export const threadWireSchema = z.object({
    id: z.string(),
    title: z.string(),
    createdAt: z.string().transform((s) => new Date(s)),
    updatedAt: z.string().transform((s) => new Date(s)),
    archivedAt: z
        .string()
        .nullable()
        .optional()
        .transform((s) => (s ? new Date(s) : undefined)),
    memoryEnabled: z.boolean(),
    titleGeneratedAt: z
        .string()
        .nullable()
        .optional()
        .transform((s) => (s ? new Date(s) : undefined)),
    titleManuallySet: z.boolean(),
});

/** A {@link Thread} parsed from its JSON wire representation. */
export type ThreadWire = z.infer<typeof threadWireSchema>;

/** Zod schema for an array of threads as returned by the list endpoint. */
export const threadListWireSchema = z.array(threadWireSchema);

// ─── ThreadMessage (wire format) ───

/** Zod schema for a {@link ThreadMessage} as serialized over JSON. */
export const threadMessageWireSchema = z.object({
    id: z.string(),
    threadId: z.string(),
    role: z.enum(["human", "ai"]),
    content: z.array(contentPartSchema),
    authorId: z.string().nullable(),
    authorName: z.string().nullable(),
    authorAvatarUrl: z.string().nullable(),
    createdAt: z.string().transform((s) => new Date(s)),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

/** A {@link ThreadMessage} parsed from its JSON wire representation. */
export type ThreadMessageWire = z.infer<typeof threadMessageWireSchema>;

/** Zod schema for an array of messages as returned by the messages endpoint. */
export const threadMessageListWireSchema = z.array(threadMessageWireSchema);

// ─── ThreadMemberInfo (wire format) ───

/** Zod schema for a thread member with user info as serialized over JSON. */
export const threadMemberInfoWireSchema = z.object({
    userId: z.string(),
    role: z.enum(["owner", "member"]),
    joinedAt: z.string().transform((s) => new Date(s)),
    name: z.string(),
    email: z.string(),
    avatarUrl: z
        .string()
        .nullable()
        .optional()
        .transform((s) => s ?? undefined),
});

/** A thread member with user info parsed from its JSON wire representation. */
export type ThreadMemberInfoWire = z.infer<typeof threadMemberInfoWireSchema>;

/** Zod schema for an array of thread members with user info. */
export const threadMemberInfoListWireSchema = z.array(threadMemberInfoWireSchema);

// ─── User Profile (wire format) ───

/** Zod schema for the authenticated user's profile as serialized over JSON. */
export const userProfileWireSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable().optional(),
    agentAlias: z.string().nullable().optional(),
});

/** An authenticated user's profile parsed from its JSON wire representation. */
export type UserProfileWire = z.infer<typeof userProfileWireSchema>;
