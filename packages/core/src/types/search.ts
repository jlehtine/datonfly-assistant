/** A single result returned from a semantic search query. */
export interface SearchResult {
    /** Identifier of the indexed document. */
    id: string;
    /** The document text that matched the query. */
    content: string;
    /** Relevance score (higher is more relevant). */
    score: number;
    /** Metadata stored alongside the document at indexing time. */
    metadata: Record<string, unknown>;
}

/** A long-term memory entry persisted for a specific user. */
export interface MemoryEntry {
    /** Unique memory entry identifier (UUID). */
    id: string;
    /** The user this memory belongs to. */
    userId: string;
    /** The memory content (plain text). */
    content: string;
    /** Timestamp when the memory was saved. */
    createdAt: Date;
    /** Arbitrary key-value metadata attached to the memory. */
    metadata?: Record<string, unknown> | undefined;
}
