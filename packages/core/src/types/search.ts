export interface SearchResult {
    id: string;
    content: string;
    score: number;
    metadata: Record<string, unknown>;
}

export interface MemoryEntry {
    id: string;
    userId: string;
    content: string;
    createdAt: Date;
    metadata?: Record<string, unknown> | undefined;
}
