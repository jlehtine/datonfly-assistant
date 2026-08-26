import { z } from "zod";

// ─── Content Parts ───

/** Zod schema for a plain-text content part. */
export const textContentPartSchema = z.object({
    type: z.literal("text"),
    text: z.string().max(100_000),
});

/** Zod schema for a model reasoning/thinking content part. */
export const thinkingContentPartSchema = z.object({
    type: z.literal("thinking"),
    text: z.string().max(100_000),
});

/** Zod schema for a tool-call content part. */
export const toolCallContentPartSchema = z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string().min(1).max(200),
    toolName: z.string().min(1).max(200),
    args: z.record(z.string(), z.unknown()),
});

/** Zod schema for a tool-result content part. */
export const toolResultContentPartSchema = z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string().min(1).max(200),
    toolName: z.string().min(1).max(200),
    result: z.unknown(),
    isError: z.boolean().optional(),
});

/** Zod schema for an opaque provider-specific content part. */
export const opaqueContentPartSchema = z.object({
    type: z.literal("opaque"),
    provider: z.string().min(1).max(200),
    data: z.unknown(),
});

/**
 * Zod schema for an attachment reference content part (wire format).
 *
 * Intentionally omits the server-only `data` field; unknown keys are stripped
 * during parsing so clients cannot inject attachment bytes through this schema.
 */
export const attachmentContentPartSchema = z.object({
    type: z.literal("attachment"),
    attachmentId: z.uuid(),
    name: z.string().min(1).max(500),
    mimeType: z.string().min(1).max(200),
    size: z.number().int().nonnegative(),
});

/** Zod discriminated union schema covering all content part types. */
export const contentPartSchema = z.discriminatedUnion("type", [
    textContentPartSchema,
    thinkingContentPartSchema,
    toolCallContentPartSchema,
    toolResultContentPartSchema,
    attachmentContentPartSchema,
    opaqueContentPartSchema,
]);

// ─── Thread ───

/** Zod schema for a request to create a new thread. */
export const createThreadRequestSchema = z.object({
    title: z.string().min(1).max(200),
});

/** Validated request body for creating a new thread. */
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

/** Zod schema for a request to update an existing thread. */
export const updateThreadRequestSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    memoryEnabled: z.boolean().optional(),
});

/** Validated request body for updating a thread. */
export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;

/** Zod schema for a request to update per-user thread state (archive / mark-read). */
export const updateThreadUserStateRequestSchema = z.object({
    archivedAt: z.coerce.date().nullable().optional(),
    lastReadAt: z.coerce.date().nullable().optional(),
});

/** Validated request body for updating per-user thread state. */
export type UpdateThreadUserStateRequest = z.infer<typeof updateThreadUserStateRequestSchema>;

// ─── Messages ───

/** Zod schema for a request to send a chat message. */
export const chatRequestSchema = z.object({
    threadId: z.uuid(),
    /**
     * Client-generated UUID v4 for the message.
     *
     * Human messages are ID'd by the client so optimistic inserts use the
     * real, permanent identifier. The server validates format and uniqueness.
     * See CONVENTIONS.md § "Record ID Ownership".
     */
    messageId: z.uuid(),
    content: z.array(contentPartSchema).min(1).max(100),
});

/** Validated request body for sending a chat message. */
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ─── Transcription ───

/** Zod schema for the response of the audio transcription endpoint. */
export const transcriptionResponseSchema = z.object({
    text: z.string(),
});

/** Validated response body from the audio transcription endpoint. */
export type TranscriptionResponse = z.infer<typeof transcriptionResponseSchema>;

// ─── Attachments ───

/** Zod schema for the metadata returned after uploading an attachment. */
export const attachmentInfoSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number().int().nonnegative(),
});

/** Validated attachment metadata returned by the upload endpoint. */
export type AttachmentInfoWire = z.infer<typeof attachmentInfoSchema>;

// ─── Members ───

/** Zod schema for a request to invite a member by email. */
export const inviteMemberRequestSchema = z.object({
    email: z.email(),
});

/** Validated request body for inviting a member. */
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

/** Zod schema for a request to remove a member from a thread. */
export const removeMemberRequestSchema = z.object({
    userId: z.uuid(),
});

/** Validated request body for removing a member. */
export type RemoveMemberRequest = z.infer<typeof removeMemberRequestSchema>;

/** Zod schema for a request to update a member's role. */
export const updateMemberRoleRequestSchema = z.object({
    userId: z.uuid(),
    role: z.enum(["owner", "member"]),
});

/** Validated request body for updating a member's role. */
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

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

/**
 * Zod schema for thread list seek-pagination query parameters. `cursorUpdatedAt` and `cursorId`
 * must be supplied together (they jointly identify the last-seen row) or omitted together (first page).
 */
export const threadListQuerySchema = z
    .object({
        includeArchived: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursorUpdatedAt: z.coerce.date().optional(),
        cursorId: z.uuid().optional(),
    })
    .refine((v) => (v.cursorUpdatedAt === undefined) === (v.cursorId === undefined), {
        message: "cursorUpdatedAt and cursorId must be supplied together",
    });

/** Validated thread list query parameters. */
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;

// ─── User Search ───

/** Zod schema for user search query parameters. */
export const userSearchQuerySchema = z.object({
    q: z.string().min(1).max(200),
    limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** Validated user search query parameters. */
export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;

/** Zod schema for a user search result item (wire format). */
export const userSearchResultWireSchema = z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable().optional(),
});

/** A user search result item parsed from JSON. */
export type UserSearchResultWire = z.infer<typeof userSearchResultWireSchema>;

/** Zod schema for the user search result list. */
export const userSearchResultListWireSchema = z.array(userSearchResultWireSchema);

// ─── User Profile ───

/** Zod schema for a request to update the authenticated user's profile. */
export const updateUserRequestSchema = z.object({
    agentAlias: z.string().max(50).nullable().optional(),
});

/** Validated request body for updating user profile. */
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

// ─── Thread Search ───

/** Zod schema for thread search query parameters (GET endpoint). */
export const threadSearchQuerySchema = z.object({
    q: z.string().min(1).max(1000),
    limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** Validated thread search query parameters. */
export type ThreadSearchQuery = z.infer<typeof threadSearchQuerySchema>;
