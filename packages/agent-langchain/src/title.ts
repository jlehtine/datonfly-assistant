import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";

import type { AgentMessage } from "@datonfly-assistant/core";

/** Configuration for {@link createTitleGenerateFn}. */
export interface TitleModelConfig {
    /** Anthropic model identifier (e.g. `"claude-haiku-4-5"`). */
    modelName: string;
    /** Anthropic API key. Falls back to the `ANTHROPIC_API_KEY` environment variable when omitted. */
    apiKey?: string | undefined;
}

/** Convert framework-agnostic {@link AgentMessage} instances to LangChain {@link BaseMessage} instances. */
function agentMessagesToBaseMessages(messages: AgentMessage[]): BaseMessage[] {
    return messages.map((msg) => {
        switch (msg.role) {
            case "human":
                return new HumanMessage(msg.content);
            case "ai":
                return new AIMessage(msg.content);
            case "system":
                return new SystemMessage(msg.content);
        }
    });
}

const TITLE_INSTRUCTION = new HumanMessage(
    "Generate a short, descriptive title (3-8 words) for the above conversation. " +
        "The title MUST be in the same language that the participants are predominantly using in the conversation. " +
        "Respond with ONLY the title, no quotes, no explanation.",
);

/**
 * Create a function that generates a thread title from conversation messages
 * using an Anthropic model via LangChain streaming.
 */
export function createTitleGenerateFn(config: TitleModelConfig): (messages: AgentMessage[]) => Promise<string> {
    const options: ConstructorParameters<typeof ChatAnthropic>[0] = {
        model: config.modelName,
        temperature: 0,
        maxTokens: 100,
    };
    if (config.apiKey) {
        options.anthropicApiKey = config.apiKey;
    }
    const model = new ChatAnthropic(options);

    return async (messages: AgentMessage[]): Promise<string> => {
        const prompt: BaseMessage[] = [...agentMessagesToBaseMessages(messages), TITLE_INSTRUCTION];
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
