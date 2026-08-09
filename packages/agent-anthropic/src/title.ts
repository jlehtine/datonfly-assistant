import Anthropic from "@anthropic-ai/sdk";

import type { AgentMessage } from "@datonfly-assistant/core";

import { agentMessagesToParams } from "./messages.js";

/** Configuration for {@link createTitleGenerateFn}. */
export interface TitleModelConfig {
    /** Anthropic model identifier (e.g. `"claude-haiku-4-5"`). */
    modelName: string;
    /** Anthropic API key. Falls back to the `ANTHROPIC_API_KEY` environment variable when omitted. */
    apiKey?: string | undefined;
    /** Override the Anthropic API base URL. */
    baseUrl?: string | undefined;
}

const TITLE_INSTRUCTION =
    "Generate a short, descriptive title (3-8 words) for the above conversation. " +
    "The title MUST be in the same language that the participants are predominantly using in the conversation. " +
    "Respond with ONLY the title, no quotes, no explanation.";

/**
 * Create a function that generates a thread title from conversation messages.
 *
 * Uses a plain non-streaming request against a cheap model; titles are short
 * and generated off the interactive path.
 */
export function createTitleGenerateFn(config: TitleModelConfig): (messages: AgentMessage[]) => Promise<string> {
    const client = new Anthropic({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    });

    return async (messages: AgentMessage[]): Promise<string> => {
        const conversation = agentMessagesToParams(messages);
        const response = await client.beta.messages.create({
            model: config.modelName,
            max_tokens: 100,
            temperature: 0,
            ...(conversation.system ? { system: conversation.system } : {}),
            messages: [...conversation.messages, { role: "user", content: TITLE_INSTRUCTION }],
        });
        return response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("")
            .trim();
    };
}
