/** A document returned by semantic search. */
export interface SearchDocument {
    /** The document content. */
    pageContent: string;
    /** Metadata associated with the document. */
    metadata: Record<string, unknown>;
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
export interface SemanticSearchOptions {
    /** Natural-language search query. */
    query: string;
    /** Maximum number of results to return. */
    limit?: number | undefined;
    /** Metadata filter applied before ranking. */
    filter?: Record<string, unknown> | undefined;
}

/** Provider for vector-based semantic search over indexed documents. */
export interface ISearchProvider {
    /**
     * Index a document for later semantic search.
     */
    index(collection: string, options: IndexDocumentOptions): Promise<void>;

    /**
     * Perform a semantic search over indexed documents.
     */
    semanticSearch(collection: string, options: SemanticSearchOptions): Promise<SearchDocument[]>;

    /**
     * Delete a document from the index.
     */
    delete(collection: string, id: string): Promise<void>;
}
