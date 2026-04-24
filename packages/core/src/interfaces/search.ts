/** A document returned by semantic search. */
export interface SearchDocument {
    /** The document content. */
    pageContent: string;
    /** Metadata associated with the document. */
    metadata: Record<string, unknown>;
    /** Relevance score assigned by the search provider (higher is more relevant). */
    score?: number | undefined;
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
    /** Maximum number of results to return. */
    limit?: number | undefined;
    /** Metadata filter applied before ranking. */
    filter?: SemanticSearchFilter | undefined;
}

/** Result of a batch indexing operation. */
export interface IndexBatchResult {
    /** Number of documents successfully indexed. */
    indexed: number;
    /** Number of documents skipped (e.g. empty content). */
    skipped: number;
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
     * Perform a semantic search over indexed documents.
     */
    semanticSearch(collection: string, options: SemanticSearchOptions): Promise<SearchDocument[]>;

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
