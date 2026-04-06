/**
 * Embeddings provider for generating vector embeddings from text.
 * Implementations should provide both single-query and batch embedding.
 */
export interface IEmbeddingsProvider {
    /**
     * Embed a single text string.
     */
    embedQuery(text: string): Promise<number[]>;

    /**
     * Embed a batch of text strings.
     */
    embedDocuments(texts: string[]): Promise<number[][]>;
}
