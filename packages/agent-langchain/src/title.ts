import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

/** Configuration for {@link createTitleGenerateFn}. */
export interface TitleModelConfig {
    /** Anthropic model identifier (e.g. `"claude-haiku-4-5"`). */
    modelName: string;
    /** Anthropic API key. Falls back to the `ANTHROPIC_API_KEY` environment variable when omitted. */
    apiKey?: string | undefined;
}

const TITLE_INSTRUCTION = new HumanMessage(
    "Generate a short, descriptive title (3-8 words) for the above conversation. " +
        "Respond with ONLY the title, no quotes, no explanation.",
);

/**
 * Create a function that generates a thread title from conversation messages
 * using an Anthropic model via LangChain streaming.
 */
export function createTitleGenerateFn(config: TitleModelConfig): (messages: BaseMessage[]) => Promise<string> {
    const options: ConstructorParameters<typeof ChatAnthropic>[0] = {
        model: config.modelName,
        temperature: 0,
        maxTokens: 100,
    };
    if (config.apiKey) {
        options.anthropicApiKey = config.apiKey;
    }
    const model = new ChatAnthropic(options);

    return async (messages: BaseMessage[]): Promise<string> => {
        const prompt: BaseMessage[] = [...messages, TITLE_INSTRUCTION];
        const response = await model.invoke(prompt);
        if (typeof response.content === "string") return response.content;
        if (Array.isArray(response.content)) {
            return response.content
                .filter(
                    (block): block is { type: "text"; text: string } =>
                        typeof block === "object" && block.type === "text",
                )
                .map((block) => block.text)
                .join("");
        }
        return "";
    };
}
