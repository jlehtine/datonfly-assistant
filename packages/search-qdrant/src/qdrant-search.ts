import { QdrantClient } from "@qdrant/js-client-rest";

import {
    NOOP_PROVIDER_LOGGER,
    type IEmbeddingsProvider,
    type IndexBatchResult,
    type IndexDocumentOptions,
    type ISearchProvider,
    type ProviderLogger,
    type SearchDocument,
    type SemanticSearchOptions,
} from "@datonfly-assistant/core";

/**
 * Maximum character length for text sent to the embedding model.
 *
 * BGE-M3 has an 8 192-token context window (~32 K chars). Texts longer
 * than this are truncated before embedding.
 */
const MAX_EMBED_CHARS = 10_000;

/** Number of documents per embedding + upsert batch. */
const BATCH_SIZE = 8;

/** Configuration for {@link QdrantSearchProvider}. */
export interface QdrantSearchConfig {
    /** Qdrant REST base URL (e.g. `"http://localhost:6333"`). */
    qdrantUrl: string;
    /** Embeddings provider for dense vectors. */
    embeddings: IEmbeddingsProvider;
    /** Optional collection name prefix (e.g. `"prod_"`). */
    collectionPrefix?: string | undefined;
    /** Snowball stemmer language for full-text indexing (e.g. `"finnish"`). Omit for no stemming. */
    stemmerLanguage?: string | undefined;
    /** Logger for error/info reporting. */
    logger?: ProviderLogger | undefined;
}

/**
 * {@link ISearchProvider} backed by Qdrant with dense + full-text hybrid search.
 *
 * Collections are auto-created on first use with:
 * - A default dense vector (1024-dim, cosine)
 * - Full-text payload index on `content` (multilingual tokenizer + optional Snowball stemmer)
 * - Keyword index on `threadId` (filtering + `group_by`)
 * - Datetime index on `createdAt`
 */
export class QdrantSearchProvider implements ISearchProvider {
    private readonly client: QdrantClient;
    private readonly embeddings: IEmbeddingsProvider;
    private readonly collectionPrefix: string;
    private readonly stemmerLanguage: string | undefined;
    private readonly logger: ProviderLogger;
    private readonly readyCollections = new Set<string>();

    constructor(config: QdrantSearchConfig) {
        this.client = new QdrantClient({ url: config.qdrantUrl });
        this.embeddings = config.embeddings;
        this.collectionPrefix = config.collectionPrefix ?? "";
        this.stemmerLanguage = config.stemmerLanguage;
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
                vectors: { size: 1024, distance: "Cosine" },
            });
            this.logger.info({ collection: name }, "Created Qdrant collection");
        }

        // Ensure payload indexes exist (idempotent — Qdrant ignores if already present).
        const fullTextParams: Record<string, unknown> = {
            type: "text",
            tokenizer: "multilingual",
            lowercase: true,
        };
        if (this.stemmerLanguage) {
            fullTextParams.stemmer = { type: "snowball", language: this.stemmerLanguage };
        }

        await Promise.all([
            this.client.createPayloadIndex(name, {
                field_name: "content",
                field_schema: fullTextParams,
                wait: true,
            }),
            this.client.createPayloadIndex(name, {
                field_name: "threadId",
                field_schema: "keyword",
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

        const vector = await this.embeddings.embedQuery(options.content.slice(0, MAX_EMBED_CHARS));

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

    async semanticSearch(collection: string, options: SemanticSearchOptions): Promise<SearchDocument[]> {
        await this.ensureCollection(collection);
        const name = this.fullName(collection);
        const limit = options.limit ?? 50;

        const queryVector = await this.embeddings.embedQuery(options.query.slice(0, MAX_EMBED_CHARS));

        // Build membership filter from the caller-supplied filter.
        const threadIds = (options.filter?.threadIds as string[] | undefined) ?? [];
        const membershipFilter =
            threadIds.length > 0
                ? {
                      must: [
                          {
                              key: "threadId",
                              match: { any: threadIds },
                          },
                      ],
                  }
                : undefined;

        // Hybrid query: semantic + keyword-boosted, fused via RRF, grouped by threadId.
        const result = await this.client.queryGroups(name, {
            prefetch: [
                { query: queryVector, limit: limit * 3 },
                {
                    query: queryVector,
                    filter: {
                        must: [{ key: "content", match: { text: options.query } }],
                    },
                    limit: limit * 3,
                },
            ],
            query: { fusion: "rrf" as const },
            group_by: "threadId",
            limit,
            group_size: 1,
            with_payload: true,
            ...(membershipFilter ? { filter: membershipFilter } : {}),
        });

        return result.groups.flatMap((group) =>
            group.hits.map((hit) => ({
                pageContent: (hit.payload?.content ?? "") as string,
                metadata: hit.payload ?? {},
                score: hit.score,
            })),
        );
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
            // when batch texts vary widely in length. Failed documents are
            // skipped so one bad document does not abort the entire reindex.
            const points: { id: string; vector: number[]; payload: Record<string, unknown> }[] = [];
            let chunkSkipped = 0;
            for (const doc of chunk) {
                try {
                    const vector = await this.embeddings.embedQuery(doc.content.slice(0, MAX_EMBED_CHARS));
                    points.push({
                        id: doc.id,
                        vector,
                        payload: { content: doc.content, ...doc.metadata },
                    });
                } catch (error) {
                    this.logger.warn(
                        {
                            documentId: doc.id,
                            contentLength: doc.content.length,
                            error: error instanceof Error ? error.message : String(error),
                        },
                        "Embedding failed for document, skipping",
                    );
                    chunkSkipped++;
                }
            }

            if (points.length > 0) {
                await this.client.upsert(name, { wait: true, points });
            }

            indexed += points.length;
            skipped += chunkSkipped;
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
