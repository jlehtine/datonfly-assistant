import type { MemoryEntry } from "../types/search.js";

export interface SaveMemoryOptions {
    userId: string;
    content: string;
    metadata?: Record<string, unknown> | undefined;
}

export interface SearchMemoryOptions {
    userId: string;
    query: string;
    limit?: number | undefined;
}

export interface ListMemoryOptions {
    userId: string;
    limit?: number | undefined;
    offset?: number | undefined;
}

export interface IMemoryProvider {
    save(options: SaveMemoryOptions): Promise<MemoryEntry>;
    search(options: SearchMemoryOptions): Promise<MemoryEntry[]>;
    list(options: ListMemoryOptions): Promise<MemoryEntry[]>;
    delete(id: string): Promise<void>;
}
