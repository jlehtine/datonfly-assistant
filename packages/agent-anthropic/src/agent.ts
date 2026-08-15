import Anthropic from "@anthropic-ai/sdk";

import {
    NOOP_PROVIDER_LOGGER,
    type AgentCapabilities,
    type AgentMessage,
    type AgentRunOptions,
    type AgentStreamChunk,
    type ContentPart,
    type IAgentProvider,
    type ITool,
    type ProviderLogger,
    type ShouldRespondResult,
    type ThinkingContentPart,
} from "@datonfly-assistant/core";

import { applyCacheBreakpoints } from "./caching.js";
import {
    buildContextManagement,
    buildOutputConfig,
    buildThinkingParam,
    DEFAULT_CONTEXT_WINDOW_SIZE,
    DEFAULT_MAX_TOKENS,
    DEFAULT_MAX_TOOL_ITERATIONS,
    PROVIDER_ID,
    requiredBetas,
    type AnthropicAgentConfig,
    type AnthropicProviderOptions,
} from "./config.js";
import { describeApiError } from "./errors.js";
import { agentMessagesToParams, trimBeforeCompaction } from "./messages.js";
import { streamAgent } from "./stream.js";
import { serverToolParams, toolToParam } from "./tools.js";

/** Result of the triage classifier, returned through forced tool use. */
const TRIAGE_TOOL_NAME = "record_decision";

const TRIAGE_SYSTEM_PROMPT =
    "You are a classifier deciding whether an AI assistant should respond to the latest message " +
    "in a group conversation. Each human message includes a header line with the sender's name " +
    "and timestamp, for example:\n\n" +
    "[Alice] @ 2026-04-10T14:30+02:00\n\n" +
    "Can you explain how this works?\n\n" +
    `Call the ${TRIAGE_TOOL_NAME} tool exactly once with your decision.\n\n` +
    "Respond YES if:\n" +
    "- The message is addressed to the AI/assistant\n" +
    "- The message asks a question not directed at a specific person\n" +
    "- The AI can add meaningful factual or technical value\n" +
    "- No specific human seems to be the intended recipient\n\n" +
    "Respond NO if:\n" +
    "- The message is clearly directed at another human participant\n" +
    "- The message is social/casual chat between humans\n" +
    "- The AI has nothing useful to add";

const TRIAGE_TOOL: Anthropic.Beta.BetaTool = {
    name: TRIAGE_TOOL_NAME,
    description: "Record whether the assistant should respond to the latest message.",
    input_schema: {
        type: "object",
        properties: {
            shouldRespond: {
                type: "boolean",
                description: "True if the assistant should reply to the latest message.",
            },
            reason: {
                type: "string",
                description: "One short sentence explaining the decision.",
            },
        },
        required: ["shouldRespond"],
    },
};

const TITLE_INSTRUCTION =
    "Generate a short, descriptive title (3-8 words) for the above conversation. " +
    "The title MUST be in the same language that the participants are predominantly using in the conversation. " +
    "Respond with ONLY the title, no quotes, no explanation.";

/**
 * Chat agent backed by an Anthropic model through the official SDK.
 *
 * Implements {@link IAgentProvider} with a single streaming code path:
 * {@link run} drains {@link stream}, so the tool loop, reasoning handling, and
 * usage accounting cannot drift between the two entry points.
 *
 * Every request goes through the beta Messages API because context management,
 * thinking effort, and the 2026 server tools are only exposed there.
 */
export class AnthropicAgent implements IAgentProvider {
    private readonly client: Anthropic;
    private readonly options: AnthropicProviderOptions;
    private readonly modelName: string;
    private readonly maxTokens: number;
    private readonly temperature: number | undefined;
    private readonly contextWindowSize: number;
    private readonly maxToolIterations: number;
    private readonly defaultTools: ITool[];
    private readonly defaultSystemPrompt: string | undefined;
    private readonly serverTools: Anthropic.Beta.BetaToolUnion[];
    private readonly triageModelName: string | undefined;
    private readonly titleModelName: string | undefined;
    private readonly debugApiContent: boolean;
    private readonly logger: ProviderLogger;

    /** @inheritdoc */
    readonly capabilities: AgentCapabilities;

    /** Create the agent with the given model configuration. */
    constructor(config: AnthropicAgentConfig) {
        const options = config.providerOptions ?? {};
        this.options = options;
        this.modelName = config.modelName;
        this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
        this.temperature = config.temperature;
        this.contextWindowSize = config.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE;
        this.maxToolIterations = config.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
        this.defaultTools = config.defaultTools ?? [];
        this.defaultSystemPrompt = config.defaultSystemPrompt;
        this.triageModelName = config.triageModelName;
        this.titleModelName = config.titleModelName;
        this.debugApiContent = config.debugApiContent ?? false;
        this.logger = config.logger ?? NOOP_PROVIDER_LOGGER;
        this.serverTools = serverToolParams(options);

        this.client = new Anthropic({
            ...(config.apiKey ? { apiKey: config.apiKey } : {}),
            ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
            ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
            ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
        });

        this.capabilities = {
            compaction: options.enableCompaction === false ? "none" : "provider",
            webSearch: options.enableWebSearch === true,
            codeExecution: options.enableCodeExecution === true,
            // Reasoning is on unless switched off explicitly, because leaving
            // the parameter unset accepts the API's adaptive default.
            thinking: options.thinkingType !== "disabled",
            attachments: { images: true, pdf: true },
        };
    }

    /** Build the request parameters shared by every turn of a call. */
    private buildRequest(
        system: Anthropic.Beta.BetaTextBlockParam[] | undefined,
        messages: Anthropic.Beta.BetaMessageParam[],
        tools: ITool[],
    ): Omit<Anthropic.Beta.Messages.MessageCreateParamsStreaming, "messages" | "stream"> {
        const allTools = [...this.serverTools, ...tools.map(toolToParam)];
        const thinking = buildThinkingParam(this.options);
        const outputConfig = buildOutputConfig(this.options);
        const contextManagement = buildContextManagement(this.options, this.contextWindowSize);

        const request = {
            model: this.modelName,
            max_tokens: this.maxTokens,
            betas: requiredBetas(this.options),
            ...(system ? { system } : {}),
            ...(allTools.length > 0 ? { tools: allTools } : {}),
            thinking,
            ...(outputConfig ? { output_config: outputConfig } : {}),
            ...(contextManagement ? { context_management: contextManagement } : {}),
            ...(typeof this.temperature === "number" ? { temperature: this.temperature } : {}),
        };

        applyCacheBreakpoints({ ...(system ? { system } : {}), tools: allTools, messages }, this.options);
        return request;
    }

    /** @inheritdoc */
    stream(
        messages: AgentMessage[],
        threadId: string,
        userId: string,
        signal?: AbortSignal,
        options?: AgentRunOptions,
    ): Promise<AsyncIterable<AgentStreamChunk>> {
        const logger = this.logger.child({
            vendor: PROVIDER_ID,
            model: this.modelName,
            operation: "stream",
            threadId,
            userId,
        });
        const tools = options?.tools ?? this.defaultTools;
        const systemPrompt = options?.systemPrompt ?? this.defaultSystemPrompt;
        const conversation = agentMessagesToParams(trimBeforeCompaction(messages));
        const system = systemPrompt
            ? [{ type: "text" as const, text: systemPrompt }, ...(conversation.system ?? [])]
            : conversation.system;
        const request = this.buildRequest(system, conversation.messages, tools);

        return Promise.resolve(
            streamAgent({
                client: this.client,
                request,
                conversation: conversation.messages,
                tools,
                maxToolIterations: this.maxToolIterations,
                modelName: this.modelName,
                vendor: PROVIDER_ID,
                ...(signal ? { signal } : {}),
                logger,
                debugApiContent: this.debugApiContent,
            }),
        );
    }

    /**
     * @inheritdoc
     *
     * Implemented by draining {@link stream}, so both entry points share one
     * code path through the API, the tool loop, and reasoning handling.
     */
    async run(
        messages: AgentMessage[],
        threadId: string,
        userId: string,
        signal?: AbortSignal,
        options?: AgentRunOptions,
    ): Promise<AgentMessage> {
        const stream = await this.stream(messages, threadId, userId, signal, options);
        const toolParts: ContentPart[] = [];
        const thinkingByIndex = new Map<number, ThinkingContentPart>();
        const opaqueParts: ContentPart[] = [];
        let text = "";

        for await (const chunk of stream) {
            switch (chunk.type) {
                case "text-delta":
                    if (chunk.partType === "text") text += chunk.delta;
                    break;
                case "thinking-part":
                    thinkingByIndex.set(chunk.partIndex, chunk.part);
                    break;
                case "opaque-part":
                    opaqueParts.push(chunk.part);
                    break;
                case "tool-call":
                    toolParts.push({
                        type: "tool-call",
                        toolCallId: chunk.toolCallId,
                        toolName: chunk.toolName,
                        args: chunk.args,
                    });
                    break;
                case "tool-result":
                    toolParts.push({
                        type: "tool-result",
                        toolCallId: chunk.toolCallId,
                        toolName: chunk.toolName,
                        result: chunk.result,
                        isError: chunk.isError,
                    });
                    break;
                default:
                    break;
            }
        }

        const thinkingParts = [...thinkingByIndex.entries()]
            .sort(([a], [b]) => a - b)
            .map(([, part]) => part as ContentPart);
        return { role: "ai", content: [...toolParts, ...thinkingParts, ...opaqueParts, { type: "text", text }] };
    }

    /** @inheritdoc */
    getContextWindowSize(): number {
        return this.contextWindowSize;
    }

    /**
     * @inheritdoc
     *
     * Without a configured triage model the agent always responds. Otherwise a
     * cheap classifier decides through forced tool use, so the answer is a typed
     * value rather than free text that has to be pattern-matched.
     */
    async shouldRespond(messages: AgentMessage[], threadId: string, memberCount: number): Promise<ShouldRespondResult> {
        if (!this.triageModelName) {
            return { shouldRespond: true };
        }
        const logger = this.logger.child({
            vendor: PROVIDER_ID,
            model: this.triageModelName,
            operation: "shouldRespond",
            threadId,
            memberCount,
        });
        const conversation = agentMessagesToParams(messages);

        try {
            const response = await this.client.beta.messages.create({
                model: this.triageModelName,
                max_tokens: 200,
                system: [{ type: "text", text: TRIAGE_SYSTEM_PROMPT }],
                messages: conversation.messages,
                tools: [TRIAGE_TOOL],
                tool_choice: { type: "tool", name: TRIAGE_TOOL_NAME },
            });
            for (const block of response.content) {
                if (block.type !== "tool_use" || block.name !== TRIAGE_TOOL_NAME) continue;
                const input = (block.input ?? {}) as { shouldRespond?: unknown; reason?: unknown };
                return {
                    shouldRespond: input.shouldRespond !== false,
                    ...(typeof input.reason === "string" ? { reason: input.reason } : {}),
                };
            }
            return { shouldRespond: true, reason: "triage returned no decision — defaulting to respond" };
        } catch (error) {
            logger.error({ phase: "triage", ...describeApiError(error) }, "Assistant API call failed");
            return { shouldRespond: true, reason: "triage error — defaulting to respond" };
        }
    }

    /**
     * @inheritdoc
     *
     * Uses {@link titleModelName} when configured, falling back to the main
     * model otherwise — titling always runs, just against whichever model the
     * deployment chose for it.
     */
    async generateTitle(messages: AgentMessage[], threadId: string): Promise<string> {
        const model = this.titleModelName ?? this.modelName;
        const logger = this.logger.child({
            vendor: PROVIDER_ID,
            model,
            operation: "generateTitle",
            threadId,
        });
        const conversation = agentMessagesToParams(messages);

        try {
            const response = await this.client.beta.messages.create({
                model,
                max_tokens: 100,
                ...(conversation.system ? { system: conversation.system } : {}),
                messages: [...conversation.messages, { role: "user", content: TITLE_INSTRUCTION }],
            });
            return response.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("")
                .trim();
        } catch (error) {
            logger.error({ phase: "title", ...describeApiError(error) }, "Assistant API call failed");
            return "";
        }
    }
}
