import { QdrantClient } from "@qdrant/js-client-rest";

import {
    formatLoggedError,
    NOOP_PROVIDER_LOGGER,
    type IEmbeddingsProvider,
    type IndexBatchResult,
    type IndexDocumentOptions,
    type ISearchProvider,
    type ProviderLogger,
    type SearchResultGroup,
    type SemanticSearchOptions,
} from "@datonfly-assistant/core";

import { documentVector, queryVector, tokenize, type SparseVector } from "./bm25.js";
import { selectSnippet } from "./snippet.js";

/** A point's named dense (`number[]`) and/or sparse (`SparseVector`) vectors. */
type NamedVector = Record<string, number[] | SparseVector>;

/**
 * Maximum character length for text sent to the embedding model.
 *
 * BGE-M3 has an 8 192-token context window (~32 K chars). Texts longer
 * than this are truncated before embedding.
 */
const MAX_EMBED_CHARS = 10_000;

/** Number of documents per embedding + upsert batch. */
const BATCH_SIZE = 8;

/**
 * RRF weights for the dense and sparse prefetch sources.
 *
 * Fixed for now — {@link QdrantSearchConfig} does not yet expose these, since nothing overrides the
 * defaults until the search overhaul plan's Phase 4 wires `DF_SEARCH_DENSE_WEIGHT` /
 * `DF_SEARCH_SPARSE_WEIGHT` through from config.
 */
const DENSE_WEIGHT = 1.0;
const SPARSE_WEIGHT = 1.0;

/** Configuration for {@link QdrantSearchProvider}. */
export interface QdrantSearchConfig {
    /** Qdrant REST base URL (e.g. `"http://localhost:6333"`). */
    qdrantUrl: string;
    /** Embeddings provider for dense vectors. */
    embeddings: IEmbeddingsProvider;
    /** Optional collection name prefix (e.g. `"prod_"`). */
    collectionPrefix?: string | undefined;
    /** Snowball stemmer language for the lexical channel (e.g. `"finnish"`). Omit for no stemming. */
    stemmerLanguage?: string | undefined;
    /** Logger for error/info reporting. */
    logger?: ProviderLogger | undefined;
}

/**
 * {@link ISearchProvider} backed by Qdrant with dense + lexical (BM25) hybrid search.
 *
 * Collections are auto-created on first use with:
 * - A named dense vector `dense` (1024-dim, cosine)
 * - A named sparse vector `lexical` (BM25 term-frequency weights from `bm25.ts`, IDF-scored by Qdrant)
 * - Keyword index on `threadId` (filtering + `group_by`) and `memberIds` (filtering only, no HNSW)
 * - Datetime index on `createdAt` (filtering + the recency formula rescore)
 */
export class QdrantSearchProvider implements ISearchProvider {
    private readonly client: QdrantClient;
    private readonly embeddings: IEmbeddingsProvider;
    private readonly collectionPrefix: string;
    private readonly languages: string[];
    private readonly logger: ProviderLogger;
    private readonly readyCollections = new Set<string>();

    constructor(config: QdrantSearchConfig) {
        this.client = new QdrantClient({ url: config.qdrantUrl });
        this.embeddings = config.embeddings;
        this.collectionPrefix = config.collectionPrefix ?? "";
        this.languages = config.stemmerLanguage ? [config.stemmerLanguage] : [];
        this.logger = config.logger ?? NOOP_PROVIDER_LOGGER;
    }

    private fullName(collection: string): string {
        return `${this.collectionPrefix}${collection}`;
    }

    private async ensureCollection(collection: string): Promise<void> {
        const name = this.fullName(collection);
        if (this.readyCollections.has(name)) return;

        const { collections } = await this.client.getCollections();
        if (!collections.some((c) => c.name === name)) {
            await this.client.createCollection(name, {
                vectors: { dense: { size: 1024, distance: "Cosine" } },
                sparse_vectors: { lexical: { modifier: "idf" } },
            });
            this.logger.info({ collection: name }, "Created Qdrant collection");
        }

        // Ensure payload indexes exist (idempotent — Qdrant ignores if already present). No full-text
        // index on `content` any more — the lexical sparse vector now does real BM25 scoring, so nothing
        // filters on it, and dropping it frees Qdrant memory. `content` stays in the payload for snippets.
        await Promise.all([
            this.client.createPayloadIndex(name, {
                field_name: "threadId",
                field_schema: "keyword",
                wait: true,
            }),
            this.client.createPayloadIndex(name, {
                field_name: "memberIds",
                field_schema: { type: "keyword", enable_hnsw: false },
                wait: true,
            }),
            this.client.createPayloadIndex(name, {
                field_name: "createdAt",
                field_schema: "datetime",
                wait: true,
            }),
        ]);

        this.readyCollections.add(name);
        this.logger.info({ collection: name }, "Qdrant collection ready");
    }

    async index(collection: string, options: IndexDocumentOptions): Promise<void> {
        await this.ensureCollection(collection);
        const name = this.fullName(collection);
        const content = options.content.slice(0, MAX_EMBED_CHARS);
        const lexical = documentVector(tokenize(content, this.languages));

        let vector: NamedVector = { lexical };
        try {
            vector = { dense: await this.embeddings.embedQuery(content), lexical };
        } catch (error) {
            this.logger.warn(
                { documentId: options.id, error: formatLoggedError(error) },
                "Dense embedding failed for document, indexing sparse-only",
            );
        }

        await this.client.upsert(name, {
            wait: false,
            points: [
                {
                    id: options.id,
                    vector,
                    payload: {
                        content: options.content,
                        ...options.metadata,
                    },
                },
            ],
        });
    }

    async search(collection: string, options: SemanticSearchOptions): Promise<SearchResultGroup[]> {
        await this.ensureCollection(collection);
        const name = this.fullName(collection);
        const limit = options.limit ?? 50;
        const hitsPerThread = options.hitsPerThread ?? 1;
        const snippetChars = options.snippetChars ?? 400;
        const prefetchLimit = limit * 3;

        let denseVector: number[] | undefined;
        try {
            denseVector = await this.embeddings.embedQuery(options.query.slice(0, MAX_EMBED_CHARS));
        } catch (error) {
            this.logger.warn(
                { error: formatLoggedError(error) },
                "Dense embedding failed for search query, degrading to sparse-only",
            );
        }
        const sparseVector = queryVector(tokenize(options.query, this.languages));

        // Dense stays primary; sparse (lexical) is fused in for names, identifiers and exact words that
        // semantic search misses. Degrades to sparse-only, rather than failing, if embedding is down.
        const sparseSource = { query: sparseVector, using: "lexical", weight: SPARSE_WEIGHT };
        const denseSource = denseVector ? { query: denseVector, using: "dense", weight: DENSE_WEIGHT } : undefined;
        const rankedQuery = denseSource
            ? {
                  prefetch: [denseSource, sparseSource].map((source) => ({
                      query: source.query,
                      using: source.using,
                      limit: prefetchLimit,
                  })),
                  query: { rrf: { weights: [denseSource.weight, sparseSource.weight] } },
                  limit: prefetchLimit,
              }
            : { query: sparseSource.query, using: sparseSource.using, limit: prefetchLimit };

        // Build membership filter from the caller-supplied filter.
        const threadIds = options.filter?.threadIds ?? [];
        const memberUserId = options.filter?.memberUserId;
        const mustFilters: Record<string, unknown>[] = [];
        if (threadIds.length > 0) {
            mustFilters.push({
                key: "threadId",
                match: { any: threadIds },
            });
        }
        if (memberUserId) {
            mustFilters.push({
                key: "memberIds",
                match: { any: [memberUserId] },
            });
        }
        const membershipFilter = mustFilters.length > 0 ? { must: mustFilters } : undefined;

        // A main query cannot be both a fusion and a formula, so on recency the fusion above is nested in
        // a prefetch and the formula becomes the main query. Only correct on a single shard (see TODO.md).
        const recency = options.recency;
        const rescoredQuery = recency
            ? {
                  prefetch: rankedQuery,
                  query: {
                      formula: {
                          sum: [
                              "$score",
                              {
                                  mult: [
                                      recency.weight,
                                      {
                                          exp_decay: {
                                              x: { datetime_key: "createdAt" },
                                              target: { datetime: new Date().toISOString() },
                                              scale: recency.halfLifeDays * 86400,
                                              midpoint: 0.5,
                                          },
                                      },
                                  ],
                              },
                          ],
                      },
                  },
              }
            : rankedQuery;

        const result = await this.client.queryGroups(name, {
            ...rescoredQuery,
            group_by: "threadId",
            limit,
            group_size: hitsPerThread,
            with_payload: true,
            ...(membershipFilter ? { filter: membershipFilter } : {}),
        });

        return result.groups.map((group) => ({
            threadId: String(group.id),
            score: group.hits[0]?.score ?? 0,
            hits: group.hits.map((hit) => {
                const content = (hit.payload?.content ?? "") as string;
                const { snippet, highlights } = selectSnippet(content, options.query, this.languages, snippetChars);
                return {
                    id: String(hit.id),
                    pageContent: snippet,
                    metadata: hit.payload ?? {},
                    score: hit.score,
                    highlights,
                };
            }),
        }));
    }

    async delete(collection: string, id: string): Promise<void> {
        const name = this.fullName(collection);
        await this.client.delete(name, { wait: false, points: [id] });
    }

    async dropIndex(collection: string): Promise<void> {
        const name = this.fullName(collection);
        this.readyCollections.delete(name);

        const { collections } = await this.client.getCollections();
        if (collections.some((c) => c.name === name)) {
            await this.client.deleteCollection(name);
            this.logger.info({ collection: name }, "Dropped Qdrant collection");
        }

        // Re-create with current schema.
        await this.ensureCollection(collection);
    }

    async updateThreadMembers(collection: string, threadId: string, memberIds: string[]): Promise<void> {
        await this.ensureCollection(collection);
        const name = this.fullName(collection);

        await this.client.setPayload(name, {
            payload: { memberIds },
            filter: {
                must: [
                    {
                        key: "threadId",
                        match: { value: threadId },
                    },
                ],
            },
            wait: false,
        });
    }

    async indexBatch(
        collection: string,
        documents: AsyncIterable<IndexDocumentOptions>,
        onProgress?: (indexed: number, skipped: number) => void,
    ): Promise<IndexBatchResult> {
        await this.ensureCollection(collection);
        const name = this.fullName(collection);

        let indexed = 0;
        let skipped = 0;
        let chunk: IndexDocumentOptions[] = [];

        const flushChunk = async (): Promise<void> => {
            if (chunk.length === 0) return;

            // Embed documents individually to avoid padding-induced memory spikes
            // when batch texts vary widely in length. A dense-embedding failure still
            // indexes the document via its sparse vector alone, rather than dropping
            // it from the index entirely until the next reindex.
            const points: { id: string; vector: NamedVector; payload: Record<string, unknown> }[] = [];
            for (const doc of chunk) {
                const lexical = documentVector(tokenize(doc.content, this.languages));
                const payload = { content: doc.content, ...doc.metadata };
                try {
                    const dense = await this.embeddings.embedQuery(doc.content.slice(0, MAX_EMBED_CHARS));
                    points.push({ id: doc.id, vector: { dense, lexical }, payload });
                } catch (error) {
                    this.logger.warn(
                        {
                            documentId: doc.id,
                            contentLength: doc.content.length,
                            error: formatLoggedError(error),
                        },
                        "Dense embedding failed for document, indexing sparse-only",
                    );
                    points.push({ id: doc.id, vector: { lexical }, payload });
                }
            }

            await this.client.upsert(name, { wait: true, points });

            indexed += points.length;
            chunk = [];
            onProgress?.(indexed, skipped);
        };

        for await (const doc of documents) {
            if (!doc.content.trim()) {
                skipped++;
                continue;
            }
            chunk.push(doc);
            if (chunk.length >= BATCH_SIZE) {
                await flushChunk();
            }
        }
        // Flush remaining.
        await flushChunk();

        return { indexed, skipped };
    }
}
