import type { Document } from "@langchain/core/documents";

export interface IndexDocumentOptions {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
}

export interface SemanticSearchOptions {
    query: string;
    limit?: number | undefined;
    filter?: Record<string, unknown> | undefined;
}

export interface ISearchProvider {
    /**
     * Index a document for later semantic search.
     */
    index(collection: string, options: IndexDocumentOptions): Promise<void>;

    /**
     * Perform a semantic search over indexed documents.
     */
    semanticSearch(collection: string, options: SemanticSearchOptions): Promise<Document[]>;

    /**
     * Delete a document from the index.
     */
    delete(collection: string, id: string): Promise<void>;
}
