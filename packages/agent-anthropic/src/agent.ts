import Anthropic from "@anthropic-ai/sdk";

import {
    NOOP_PROVIDER_LOGGER,
    type AgentCapabilities,
    type AgentMessage,
    type AgentRunOptions,
    type AgentStreamChunk,
    type ContentPart,
    type GeneratedFileData,
    type IAgentProvider,
    type ITool,
    type ProviderLogger,
    type ShouldRespondResult,
    type ThreadSummaryResult,
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
import { DEFAULT_MAX_GENERATED_FILE_BYTES, fetchGeneratedFile } from "./generated-files.js";
import { agentMessagesToParams, trimBeforeCompaction } from "./messages.js";
import { streamAgent } from "./stream.js";
import { serverToolParams, toolToParam } from "./tools.js";
import { createTrafficDumpingFetch } from "./traffic-dump.js";

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

/** Name of the tool used to record a generated thread title and topics. */
const SUMMARY_TOOL_NAME = "record_thread_summary";

/**
 * Declared in every request's tool set (not just the dedicated summary call) so the `tools`
 * array stays byte-identical across turns -- adding a tool only for the summary call would
 * change that array and invalidate the tools/system/messages prompt cache for every turn.
 * Not wired into the per-call `ITool` tool loop: if the model calls it mid-conversation,
 * `executeToolCall` already replies with a graceful "not available" tool result rather than
 * persisting anything, since only the dedicated {@link AnthropicAgent.generateThreadSummary}
 * call currently acts on it.
 */
const SUMMARY_TOOL: Anthropic.Beta.BetaTool = {
    name: SUMMARY_TOOL_NAME,
    description:
        "Record a short title and the distinct topics discussed in this conversation so far. Call this only " +
        "when the user explicitly asks for a summary of the conversation, or when explicitly instructed to do " +
        "so at the end of a message. An empty topics list is the correct answer when the conversation so far " +
        "is only greetings, small talk, or acknowledgements with no substantive subject yet.",
    input_schema: {
        type: "object",
        properties: {
            title: {
                type: "string",
                description:
                    "A short, descriptive title (3-8 words) for the conversation, in the language the " +
                    "participants are predominantly using.",
            },
            topics: {
                type: "array",
                items: { type: "string" },
                description:
                    "Up to 5 short (roughly 100 characters or fewer) descriptions of the distinct topics " +
                    "discussed. Empty if there is no substantive topic yet.",
            },
        },
        required: ["title", "topics"],
    },
};

const SUMMARY_INSTRUCTION = `Call the ${SUMMARY_TOOL_NAME} tool now to record a title and the topics discussed in this conversation.`;

/** Caps applied to a generated summary, independent of what the instruction itself asks for. */
const MAX_SUMMARY_TOPICS = 5;
const MAX_TOPIC_LENGTH = 100;
const MAX_TITLE_LENGTH = 200;

/**
 * Output budget for a summary call, deliberately far below {@link DEFAULT_MAX_TOKENS}.
 *
 * `buildRequest` otherwise sets `max_tokens` to the same 64k budget a full agentic turn
 * gets, which trips the SDK's own non-streaming guard: it estimates wall-clock time as
 * proportional to `max_tokens` and refuses to run non-streaming if that estimate exceeds
 * 10 minutes (roughly `max_tokens > 21_333` for a model with no explicit entry in the
 * SDK's per-model table, which `claude-opus-5` currently has none of) -- failing before any
 * request reaches the network, so a traffic dump never sees it. Doesn't affect the cache:
 * `max_tokens` isn't part of the cached prefix.
 */
const SUMMARY_MAX_TOKENS = 4096;

/** Trim, cap and drop-empty a raw title/topics pair from either the tool call or the text fallback. */
function sanitizeSummary(rawTitle: string, rawTopics: string[]): ThreadSummaryResult {
    const title = rawTitle
        .replace(/^["']+|["']+$/g, "")
        .trim()
        .slice(0, MAX_TITLE_LENGTH);
    const topics = rawTopics
        .map((topic) => topic.trim())
        .filter((topic) => topic.length > 0)
        .slice(0, MAX_SUMMARY_TOPICS)
        .map((topic) => topic.slice(0, MAX_TOPIC_LENGTH));
    return { title, topics };
}

/**
 * Extract `{ title, topics }` from a summary response: prefer a `record_thread_summary` tool
 * call, and fall back to parsing plain text for the (rarer) turns where the model answers
 * instead of calling the tool -- first non-empty line is the title, each subsequent non-empty
 * line is one topic, leading list markers stripped. The fallback format cannot hard-fail; a
 * mangled result just costs one thread's indexing quality until the next regeneration.
 */
function parseSummaryResponse(response: Anthropic.Beta.BetaMessage): ThreadSummaryResult {
    for (const block of response.content) {
        if (block.type === "tool_use" && block.name === SUMMARY_TOOL_NAME) {
            const input = (block.input ?? {}) as { title?: unknown; topics?: unknown };
            const topics = Array.isArray(input.topics)
                ? input.topics.filter((topic): topic is string => typeof topic === "string")
                : [];
            return sanitizeSummary(typeof input.title === "string" ? input.title : "", topics);
        }
    }

    const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    const lines = text
        .split("\n")
        .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
        .filter((line) => line.length > 0);
    const [title = "", ...topics] = lines;
    return sanitizeSummary(title, topics);
}

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
    private readonly maxGeneratedFileBytes: number;

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
        this.maxGeneratedFileBytes = options.maxGeneratedFileBytes ?? DEFAULT_MAX_GENERATED_FILE_BYTES;
        this.serverTools = serverToolParams(options);

        this.client = new Anthropic({
            ...(config.apiKey ? { apiKey: config.apiKey } : {}),
            ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
            ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
            ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
            ...(options.trafficDumpDir ? { fetch: createTrafficDumpingFetch(options.trafficDumpDir) } : {}),
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
        containerId: string | undefined,
    ): Omit<Anthropic.Beta.Messages.MessageCreateParamsStreaming, "messages" | "stream"> {
        const allTools = [...this.serverTools, ...tools.map(toolToParam), SUMMARY_TOOL];
        const thinking = buildThinkingParam(this.options);
        const outputConfig = buildOutputConfig(this.options);
        const contextManagement = buildContextManagement(this.options, this.contextWindowSize);

        const request = {
            model: this.modelName,
            max_tokens: this.maxTokens,
            betas: requiredBetas(this.options),
            ...(system ? { system } : {}),
            ...(allTools.length > 0 ? { tools: allTools } : {}),
            ...(containerId ? { container: containerId } : {}),
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
        const request = this.buildRequest(system, conversation.messages, tools, options?.containerId);

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
        // Built in true chronological arrival order, matching `stream()`'s
        // contract. A text delta's part index maps to its position here so a
        // later delta for the same part updates in place instead of appending;
        // thinking parts arrive complete and are pushed once, at the position
        // they occur.
        const parts: ContentPart[] = [];
        const textPositionByPartIndex = new Map<number, number>();

        for await (const chunk of stream) {
            switch (chunk.type) {
                case "text-delta": {
                    if (chunk.partType !== "text") break;
                    const position = textPositionByPartIndex.get(chunk.partIndex);
                    if (position !== undefined) {
                        const existing = parts[position] as Extract<ContentPart, { type: "text" }>;
                        parts[position] = { type: "text", text: existing.text + chunk.delta };
                    } else {
                        textPositionByPartIndex.set(chunk.partIndex, parts.length);
                        parts.push({ type: "text", text: chunk.delta });
                    }
                    break;
                }
                case "thinking-part":
                    parts.push(chunk.part);
                    break;
                case "opaque-part":
                    parts.push(chunk.part);
                    break;
                case "tool-call":
                    parts.push({
                        type: "tool-call",
                        toolCallId: chunk.toolCallId,
                        toolName: chunk.toolName,
                        args: chunk.args,
                    });
                    break;
                case "tool-result":
                    parts.push({
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

        return { role: "ai", content: parts };
    }

    /** @inheritdoc */
    getContextWindowSize(): number {
        return this.contextWindowSize;
    }

    /** @inheritdoc */
    fetchGeneratedFile(fileRef: string, signal?: AbortSignal): Promise<GeneratedFileData> {
        return fetchGeneratedFile(this.client, fileRef, this.maxGeneratedFileBytes, signal);
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
     * Cache-aligned by default ({@link titleModelName} unset): reuses the same
     * request builder and tool set a normal turn uses, with the instruction
     * appended as a trailing message, so it reads back the turn's own prompt
     * cache instead of paying base rate for the whole thread on every call.
     * Setting {@link titleModelName} switches to a separate model on a fresh,
     * uncached request instead -- see {@link generateThreadSummaryStandalone}.
     */
    async generateThreadSummary(messages: AgentMessage[], threadId: string): Promise<ThreadSummaryResult> {
        return this.titleModelName
            ? this.generateThreadSummaryStandalone(messages, threadId)
            : this.generateThreadSummaryCacheAligned(messages, threadId);
    }

    /** Cache-aligned path: same request builder, same tool set, same model as a normal turn. */
    private async generateThreadSummaryCacheAligned(
        messages: AgentMessage[],
        threadId: string,
    ): Promise<ThreadSummaryResult> {
        const logger = this.logger.child({
            vendor: PROVIDER_ID,
            model: this.modelName,
            operation: "generateThreadSummary",
            threadId,
        });
        const conversation = agentMessagesToParams(trimBeforeCompaction(messages));
        const requestMessages: Anthropic.Beta.BetaMessageParam[] = [
            ...conversation.messages,
            { role: "user", content: SUMMARY_INSTRUCTION },
        ];
        // Same tool set (this.defaultTools) and builder as stream()'s default call, so the
        // `tools` array -- and therefore the cache -- lines up with the turn that just ran.
        const request = this.buildRequest(conversation.system, requestMessages, this.defaultTools, undefined);

        try {
            const response = await this.client.beta.messages.create({
                ...request,
                max_tokens: SUMMARY_MAX_TOKENS,
                messages: requestMessages,
            });
            logger.info(
                {
                    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
                    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
                },
                "Thread summary cache usage",
            );
            return parseSummaryResponse(response);
        } catch (error) {
            logger.error({ phase: "thread-summary", ...describeApiError(error) }, "Assistant API call failed");
            return { title: "", topics: [] };
        }
    }

    /** Fallback path for a deployment that would rather not spend main-model tokens on background work. */
    private async generateThreadSummaryStandalone(
        messages: AgentMessage[],
        threadId: string,
    ): Promise<ThreadSummaryResult> {
        const model = this.titleModelName ?? this.modelName;
        const logger = this.logger.child({
            vendor: PROVIDER_ID,
            model,
            operation: "generateThreadSummary",
            threadId,
        });
        const conversation = agentMessagesToParams(trimBeforeCompaction(messages));

        try {
            const response = await this.client.beta.messages.create({
                model,
                max_tokens: 300,
                ...(conversation.system ? { system: conversation.system } : {}),
                tools: [SUMMARY_TOOL],
                messages: [...conversation.messages, { role: "user", content: SUMMARY_INSTRUCTION }],
            });
            return parseSummaryResponse(response);
        } catch (error) {
            logger.error({ phase: "thread-summary", ...describeApiError(error) }, "Assistant API call failed");
            return { title: "", topics: [] };
        }
    }
}
