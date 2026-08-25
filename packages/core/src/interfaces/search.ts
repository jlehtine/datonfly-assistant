/** A document returned by semantic search. */
export interface SearchDocument {
    /** Unique document identifier, as passed to {@link IndexDocumentOptions.id}. */
    id: string;
    /** The document content. */
    pageContent: string;
    /** Metadata associated with the document. */
    metadata: Record<string, unknown>;
    /** Relevance score assigned by the search provider (higher is more relevant). */
    score?: number | undefined;
    /** `[start, end]` offset pairs into `pageContent` marking matched regions. */
    highlights?: [number, number][] | undefined;
}

/** Options for indexing a document for semantic search. */
export interface IndexDocumentOptions {
    /** Unique document identifier (used for updates and deletes). */
    id: string;
    /** Plain-text content to embed and index. */
    content: string;
    /** Metadata stored alongside the document and returned in search results. */
    metadata: Record<string, unknown>;
}

/** Options for performing a semantic search query. */
export interface SemanticSearchFilter {
    /** Restrict results to specific thread IDs. */
    threadIds?: string[] | undefined;
    /** Restrict results to threads where this user is a member. */
    memberUserId?: string | undefined;
}

/** Options for performing a semantic search query. */
export interface SemanticSearchOptions {
    /** Natural-language search query. */
    query: string;
    /** Maximum number of result groups (threads) to return. */
    limit?: number | undefined;
    /** Metadata filter applied before ranking. */
    filter?: SemanticSearchFilter | undefined;
    /** Maximum number of hits to return per thread. */
    hitsPerThread?: number | undefined;
    /** Maximum snippet length, in characters. */
    snippetChars?: number | undefined;
    /** Recency boost applied on top of relevance ranking. */
    recency?: { halfLifeDays: number; weight: number } | undefined;
}

/** Result of a batch indexing operation. */
export interface IndexBatchResult {
    /** Number of documents successfully indexed. */
    indexed: number;
    /** Number of documents skipped (e.g. empty content). */
    skipped: number;
}

/** A group of search hits belonging to the same thread. */
export interface SearchResultGroup {
    /** Thread the hits belong to. */
    threadId: string;
    /** Best score among the group's hits. */
    score: number;
    /** Matching documents within the thread, best first. */
    hits: SearchDocument[];
}

/** Provider for vector-based semantic search over indexed documents. */
export interface ISearchProvider {
    /**
     * Index a document for later semantic search.
     */
    index(collection: string, options: IndexDocumentOptions): Promise<void>;

    /**
     * Index a stream of documents in batches.
     *
     * The provider pulls documents from the async iterable, chunks them
     * internally (e.g. 32 at a time), batch-embeds and upserts. The
     * optional `onProgress` callback is invoked after each chunk with
     * running totals.
     */
    indexBatch(
        collection: string,
        documents: AsyncIterable<IndexDocumentOptions>,
        onProgress?: (indexed: number, skipped: number) => void,
    ): Promise<IndexBatchResult>;

    /**
     * Perform a hybrid (dense + lexical) search over indexed documents, grouped
     * by thread.
     */
    search(collection: string, options: SemanticSearchOptions): Promise<SearchResultGroup[]>;

    /**
     * Drop and re-create a collection, applying current schema settings.
     *
     * Used for full reindexing — provides a clean slate and picks up
     * any configuration changes (e.g. stemmer language).
     */
    dropIndex(collection: string): Promise<void>;

    /**
     * Update per-thread access metadata used for query-time ACL filtering.
     */
    updateThreadMembers(collection: string, threadId: string, memberIds: string[]): Promise<void>;

    /**
     * Delete a document from the index.
     */
    delete(collection: string, id: string): Promise<void>;
}
