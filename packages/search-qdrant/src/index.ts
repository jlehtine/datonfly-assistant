import type { IEmbeddingsProvider, ISearchProvider, ProviderLogger } from "@datonfly-assistant/core";

import { InfinityEmbeddingsProvider } from "./infinity-embeddings.js";
import { QdrantSearchProvider } from "./qdrant-search.js";

/** Configuration for {@link createQdrantSearch}. */
export interface QdrantSearchOptions {
    /** Qdrant REST base URL (e.g. `"http://localhost:6333"`). */
    qdrantUrl: string;
    /** infinity-emb base URL (e.g. `"http://localhost:8080"`). */
    infinityUrl: string;
    /** Embedding model identifier. Defaults to `"BAAI/bge-m3"`. */
    model?: string | undefined;
    /** Optional collection name prefix (e.g. `"prod_"`). */
    collectionPrefix?: string | undefined;
    /** Snowball stemmer language for full-text indexing (e.g. `"finnish"`). Omit to disable stemming. */
    stemmerLanguage?: string | undefined;
    /** Logger for error/info reporting. Defaults to a no-op logger. */
    logger?: ProviderLogger | undefined;
}

/** Result of {@link createQdrantSearch}. */
export interface QdrantSearchResult {
    /** Search provider for indexing and querying documents. */
    searchProvider: ISearchProvider;
    /** Embeddings provider for generating dense vectors. */
    embeddingsProvider: IEmbeddingsProvider;
}

/**
 * Create a Qdrant-backed search provider with infinity-emb embeddings.
 *
 * @returns An object containing the `searchProvider` and `embeddingsProvider`.
 */
export function createQdrantSearch(options: QdrantSearchOptions): QdrantSearchResult {
    const embeddingsProvider = new InfinityEmbeddingsProvider({
        url: options.infinityUrl,
        model: options.model,
        logger: options.logger,
    });

    const searchProvider = new QdrantSearchProvider({
        qdrantUrl: options.qdrantUrl,
        embeddings: embeddingsProvider,
        collectionPrefix: options.collectionPrefix,
        stemmerLanguage: options.stemmerLanguage,
        logger: options.logger,
    });

    return { searchProvider, embeddingsProvider };
}

export { InfinityEmbeddingsProvider } from "./infinity-embeddings.js";
export type { InfinityEmbeddingsConfig } from "./infinity-embeddings.js";
export { QdrantSearchProvider } from "./qdrant-search.js";
export type { QdrantSearchConfig } from "./qdrant-search.js";
