/** The role of a message author. */
export type MessageRole = "human" | "ai" | "system";

/** A plain-text content part. */
export interface TextContentPart {
    type: "text";
    /** The text body. */
    text: string;
}

/** A model reasoning/thinking content part. */
export interface ThinkingContentPart {
    type: "thinking";
    /** The reasoning text body. */
    text: string;
}

/** A content part representing a tool invocation by the assistant. */
export interface ToolCallContentPart {
    type: "tool-call";
    /** Unique identifier for this tool call, used to correlate with its result. */
    toolCallId: string;
    /** Name of the tool being invoked. */
    toolName: string;
    /** Arguments passed to the tool. */
    args: Record<string, unknown>;
}

/** A content part carrying the result of a tool invocation. */
export interface ToolResultContentPart {
    type: "tool-result";
    /** Identifier of the tool call this result corresponds to. */
    toolCallId: string;
    /** Name of the tool that produced the result. */
    toolName: string;
    /** The value returned by the tool. */
    result: unknown;
    /** Whether the tool execution ended in an error. */
    isError?: boolean | undefined;
}

/**
 * An opaque content part carrying provider-specific data.
 *
 * The server stores and round-trips these without interpretation.
 * Only the originating provider knows how to consume them.
 */
export interface OpaqueContentPart {
    type: "opaque";
    /** Identifier of the provider that produced this block (e.g. `"anthropic"`). */
    provider: string;
    /** Provider-specific payload. */
    data: unknown;
}

/**
 * A content part referencing a file/image attachment uploaded as context input.
 *
 * The part itself carries only a reference (ID + descriptive metadata); the
 * bytes are stored separately and fetched on demand. The optional {@link data}
 * field is populated **server-side only** when resolving an attachment for the
 * AI agent and must never be persisted, serialized to clients, or logged.
 */
export interface AttachmentContentPart {
    type: "attachment";
    /** ID of the stored attachment record. */
    attachmentId: string;
    /** Original file name. */
    name: string;
    /** MIME type of the attachment. */
    mimeType: string;
    /** Size of the attachment in bytes. */
    size: number;
    /**
     * Base64-encoded attachment bytes.
     *
     * Server-only: set transiently when building agent context and never
     * persisted or sent over the wire.
     */
    data?: string | undefined;
}

/** Discriminated union of all possible message content parts. */
export type ContentPart =
    | TextContentPart
    | ThinkingContentPart
    | ToolCallContentPart
    | ToolResultContentPart
    | AttachmentContentPart
    | OpaqueContentPart;

/**
 * Provider-native data needed to replay an AI turn verbatim to the provider
 * that produced it (e.g. Anthropic's raw content blocks for the turn).
 *
 * Stored separately from {@link ContentPart}s — rather than as an
 * {@link OpaqueContentPart} — so it can be purged independently (e.g. after a
 * retention period) without rewriting the human-facing content. A message
 * without this field falls back to being reconstructed from its
 * {@link ContentPart}s, which is also what happens for pre-existing messages
 * and after a future purge.
 */
export interface ProviderReplayData {
    /** Identifier of the provider that produced this data (e.g. `"anthropic"`). */
    provider: string;
    /** Provider-specific payload. */
    data: unknown;
}

/** A single message within a thread. */
export interface ThreadMessage {
    /** Unique message identifier (UUID). */
    id: string;
    /** The thread this message belongs to. */
    threadId: string;
    /** Who authored the message. */
    role: MessageRole;
    /** Ordered list of content parts that make up the message body. */
    content: ContentPart[];
    /** User ID of the author, or `null` for system/agent messages. */
    authorId: string | null;
    /** Display name of the author, resolved from the user record. `null` for AI messages. */
    authorName: string | null;
    /** Avatar URL of the author. `null` when unavailable or for AI messages. */
    authorAvatarUrl: string | null;
    /** Timestamp when the message was created. */
    createdAt: Date;
    /** Logical ordering timestamp. Equals {@link createdAt} for regular messages. Only set server-side. */
    contentAt?: Date | undefined;
    /** Arbitrary key-value metadata attached to the message. */
    metadata?: Record<string, unknown> | undefined;
    /** Provider-native data for verbatim replay of an AI turn. `undefined` for non-AI messages. */
    replayData?: ProviderReplayData | undefined;
}
