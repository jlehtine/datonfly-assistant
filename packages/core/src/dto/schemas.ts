import { z } from "zod";

// ─── Content Parts ───

/** Zod schema for a plain-text content part. */
export const textContentPartSchema = z.object({
    type: z.literal("text"),
    text: z.string().min(1),
});

/** Zod schema for a tool-call content part. */
export const toolCallContentPartSchema = z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
});

/** Zod schema for a tool-result content part. */
export const toolResultContentPartSchema = z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    isError: z.boolean().optional(),
});

/** Zod discriminated union schema covering all content part types. */
export const contentPartSchema = z.discriminatedUnion("type", [
    textContentPartSchema,
    toolCallContentPartSchema,
    toolResultContentPartSchema,
]);

// ─── Thread ───

/** Zod schema for a request to create a new thread. */
export const createThreadRequestSchema = z.object({
    title: z.string().min(1).max(200),
    type: z.enum(["personal", "room"]),
});

/** Validated request body for creating a new thread. */
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

/** Zod schema for a request to update an existing thread. */
export const updateThreadRequestSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
    memoryEnabled: z.boolean().optional(),
});

/** Validated request body for updating a thread. */
export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;

// ─── Messages ───

/** Zod schema for a request to send a chat message. */
export const chatRequestSchema = z.object({
    threadId: z.uuid(),
    content: z.array(contentPartSchema).min(1),
});

/** Validated request body for sending a chat message. */
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ─── Members ───

/** Zod schema for a request to invite a member by email. */
export const inviteMemberRequestSchema = z.object({
    email: z.email(),
});

/** Validated request body for inviting a member. */
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

// ─── Search ───

/** Zod schema for a semantic search request. */
export const searchRequestSchema = z.object({
    query: z.string().min(1).max(1000),
    threadId: z.uuid().optional(),
    limit: z.number().int().min(1).max(50).optional(),
});

/** Validated request body for performing a semantic search. */
export type SearchRequest = z.infer<typeof searchRequestSchema>;

// ─── Memory ───

/** Zod schema for a memory search request. */
export const memorySearchRequestSchema = z.object({
    query: z.string().min(1).max(1000),
    limit: z.number().int().min(1).max(50).optional(),
});

/** Validated request body for searching user memories. */
export type MemorySearchRequest = z.infer<typeof memorySearchRequestSchema>;

// ─── Pagination ───

/** Zod schema for cursor-based pagination query parameters. */
export const paginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.coerce.date().optional(),
});

/** Validated pagination query parameters. */
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
