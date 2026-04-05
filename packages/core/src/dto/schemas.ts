import { z } from "zod";

// ─── Content Parts ───

export const textContentPartSchema = z.object({
    type: z.literal("text"),
    text: z.string().min(1),
});

export const toolCallContentPartSchema = z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.record(z.string(), z.unknown()),
});

export const toolResultContentPartSchema = z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    isError: z.boolean().optional(),
});

export const contentPartSchema = z.discriminatedUnion("type", [
    textContentPartSchema,
    toolCallContentPartSchema,
    toolResultContentPartSchema,
]);

// ─── Thread ───

export const createThreadRequestSchema = z.object({
    title: z.string().min(1).max(200),
    type: z.enum(["personal", "room"]),
});

export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

export const updateThreadRequestSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    archived: z.boolean().optional(),
    memoryEnabled: z.boolean().optional(),
});

export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;

// ─── Messages ───

export const chatRequestSchema = z.object({
    threadId: z.uuid(),
    content: z.array(contentPartSchema).min(1),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ─── Members ───

export const inviteMemberRequestSchema = z.object({
    email: z.email(),
});

export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

// ─── Search ───

export const searchRequestSchema = z.object({
    query: z.string().min(1).max(1000),
    threadId: z.uuid().optional(),
    limit: z.number().int().min(1).max(50).optional(),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

// ─── Memory ───

export const memorySearchRequestSchema = z.object({
    query: z.string().min(1).max(1000),
    limit: z.number().int().min(1).max(50).optional(),
});

export type MemorySearchRequest = z.infer<typeof memorySearchRequestSchema>;

// ─── Pagination ───

export const paginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.coerce.date().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
