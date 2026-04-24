import { NOOP_PROVIDER_LOGGER, type IEmbeddingsProvider, type ProviderLogger } from "@datonfly-assistant/core";

/** Response shape from the infinity-emb OpenAI-compatible `/embeddings` endpoint. */
interface EmbeddingsResponse {
    data: { embedding: number[]; index: number }[];
    model: string;
    usage: { prompt_tokens: number; total_tokens: number };
}

/** Configuration for {@link InfinityEmbeddingsProvider}. */
export interface InfinityEmbeddingsConfig {
    /** Base URL of the infinity-emb server (e.g. `"http://localhost:8080"`). */
    url: string;
    /** Model identifier sent in the request body. */
    model?: string | undefined;
    /** Logger for error reporting. */
    logger?: ProviderLogger | undefined;
}

/**
 * {@link IEmbeddingsProvider} backed by an infinity-emb server.
 *
 * Calls the OpenAI-compatible `POST /embeddings` endpoint.
 */
export class InfinityEmbeddingsProvider implements IEmbeddingsProvider {
    private readonly url: string;
    private readonly model: string;
    private readonly logger: ProviderLogger;

    constructor(config: InfinityEmbeddingsConfig) {
        this.url = config.url.replace(/\/+$/, "");
        this.model = config.model ?? "BAAI/bge-m3";
        this.logger = config.logger ?? NOOP_PROVIDER_LOGGER;
    }

    async embedQuery(text: string): Promise<number[]> {
        const [first] = await this.embed([text]);
        if (!first) throw new Error("infinity-emb returned no embeddings");
        return first;
    }

    async embedDocuments(texts: string[]): Promise<number[][]> {
        return this.embed(texts);
    }

    private async embed(input: string[]): Promise<number[][]> {
        const response = await fetch(`${this.url}/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: this.model, input }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            const message = `infinity-emb returned ${String(response.status)}: ${body}`;
            this.logger.error({ status: response.status, body }, message);
            throw new Error(message);
        }

        const json = (await response.json()) as EmbeddingsResponse;
        // Sort by index to guarantee order matches input order.
        return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
    }
}
