import type { MemoryEntry } from "../types/search.js";

/** Options for saving a new memory entry. */
export interface SaveMemoryOptions {
    /** The user the memory belongs to. */
    userId: string;
    /** Plain-text content of the memory. */
    content: string;
    /** Arbitrary metadata to store alongside the memory. */
    metadata?: Record<string, unknown> | undefined;
}

/** Options for searching memories by semantic similarity. */
export interface SearchMemoryOptions {
    /** Scope the search to this user's memories. */
    userId: string;
    /** Natural-language search query. */
    query: string;
    /** Maximum number of results to return. */
    limit?: number | undefined;
}

/** Options for listing memories with pagination. */
export interface ListMemoryOptions {
    /** Scope the listing to this user's memories. */
    userId: string;
    /** Maximum number of entries to return. */
    limit?: number | undefined;
    /** Number of entries to skip (for pagination). */
    offset?: number | undefined;
}

/** Provider for per-user long-term memory storage and retrieval. */
export interface IMemoryProvider {
    /** Persist a new memory entry. */
    save(options: SaveMemoryOptions): Promise<MemoryEntry>;
    /** Search memories by semantic similarity to a query. */
    search(options: SearchMemoryOptions): Promise<MemoryEntry[]>;
    /** List memories in chronological order. */
    list(options: ListMemoryOptions): Promise<MemoryEntry[]>;
    /** Delete a memory entry by ID. */
    delete(id: string): Promise<void>;
}
