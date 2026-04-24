import { QdrantClient } from "@qdrant/js-client-rest";

import {
    NOOP_PROVIDER_LOGGER,
    type IEmbeddingsProvider,
    type IndexDocumentOptions,
    type ISearchProvider,
    type ProviderLogger,
    type SearchDocument,
    type SemanticSearchOptions,
} from "@datonfly-assistant/core";

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

        const vector = await this.embeddings.embedQuery(options.content);

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
        const limit = options.limit ?? 10;

        const queryVector = await this.embeddings.embedQuery(options.query);

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
}
