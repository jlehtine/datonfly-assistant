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
    /** Snowball stemmer languages for the lexical channel (e.g. `["english", "finnish"]`). Every language's stemmer runs over every token; omit to disable stemming (surface-form + ASCII-folded matching only). */
    languages?: string[] | undefined;
    /** RRF weight for the dense (semantic) channel. Defaults to `1.0`. */
    denseWeight?: number | undefined;
    /** RRF weight for the sparse (lexical/BM25) channel. Defaults to `1.0`. */
    sparseWeight?: number | undefined;
    /** Minimum cosine score for a dense-channel candidate to enter the fused ranking. Omit to disable. */
    denseScoreThreshold?: number | undefined;
    /** Minimum BM25 score for a sparse-channel candidate to enter the fused ranking. Omit to disable. */
    sparseScoreThreshold?: number | undefined;
    /** Logger for error/info reporting. Defaults to a no-op logger. */
    logger?: ProviderLogger | undefined;
    /** Embeddings request timeout in milliseconds. Defaults to `120_000` (2 minutes). */
    embeddingsTimeoutMs?: number | undefined;
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
        timeoutMs: options.embeddingsTimeoutMs,
        logger: options.logger,
    });

    const searchProvider = new QdrantSearchProvider({
        qdrantUrl: options.qdrantUrl,
        embeddings: embeddingsProvider,
        collectionPrefix: options.collectionPrefix,
        languages: options.languages,
        denseWeight: options.denseWeight,
        sparseWeight: options.sparseWeight,
        denseScoreThreshold: options.denseScoreThreshold,
        sparseScoreThreshold: options.sparseScoreThreshold,
        logger: options.logger,
    });

    return { searchProvider, embeddingsProvider };
}

export { InfinityEmbeddingsProvider } from "./infinity-embeddings.js";
export type { InfinityEmbeddingsConfig } from "./infinity-embeddings.js";
export { QdrantSearchProvider } from "./qdrant-search.js";
export type { QdrantSearchConfig } from "./qdrant-search.js";
