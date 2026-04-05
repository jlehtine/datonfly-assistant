import type { EmbeddingsInterface } from "@langchain/core/embeddings";

/**
 * Embeddings provider aligned with LangChain's EmbeddingsInterface.
 * Implementations should provide both single-query and batch embedding.
 */
export interface IEmbeddingsProvider extends EmbeddingsInterface {
    /**
     * Embed a single text string.
     */
    embedQuery(text: string): Promise<number[]>;

    /**
     * Embed a batch of text strings.
     */
    embedDocuments(texts: string[]): Promise<number[][]>;
}
