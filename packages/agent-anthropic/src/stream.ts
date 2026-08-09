import type Anthropic from "@anthropic-ai/sdk";

import type {
    AgentStreamChunk,
    AgentUsage,
    Citation,
    ITool,
    OpaqueContentPart,
    ProviderLogger,
    ThinkingContentPart,
} from "@datonfly-assistant/core";

import { compactionBlockToOpaquePart } from "./messages.js";
import { executeToolCall, toolNameToStatus, type ToolCall } from "./tools.js";

/** Parameters for {@link streamAgent}. */
export interface StreamAgentParams {
    /** Anthropic client used to issue every turn of the loop. */
    client: Anthropic;
    /** Request parameters shared by every turn (model, tools, thinking, …). */
    request: Omit<Anthropic.Beta.Messages.MessageCreateParamsStreaming, "messages" | "stream">;
    /** The conversation to continue. Copied; the caller's array is not mutated. */
    conversation: Anthropic.Beta.BetaMessageParam[];
    /** Tools the model may invoke during the loop. */
    tools: ITool[];
    /** Maximum number of model turns before the loop aborts. */
    maxToolIterations: number;
    /** Model identifier recorded in {@link AgentUsage}. */
    modelName: string;
    /** Vendor identifier recorded in {@link AgentUsage}. */
    vendor: string;
    /** Abort signal forwarded to the API and checked between turns. */
    signal?: AbortSignal | undefined;
    /** Logger for stream failures. */
    logger: ProviderLogger;
    /** Emit verbose debug logging of every streamed event. */
    debugApiContent: boolean;
}

/** Token usage for a single request, before aggregation across turns. */
interface TurnUsage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
}

/**
 * Read the prompt-side token counts from `message_start`.
 *
 * Anthropic reports `input_tokens` as the *uncached* remainder, with cached
 * tokens split out separately. `AgentUsage.inputTokens` means the size of the
 * submitted context — the gateway compares it against the compaction threshold
 * — so the three fields are summed. Reporting only the uncached remainder would
 * silently stop external compaction from ever triggering.
 *
 * When the API performs server-side iterations (compaction, server tool loops)
 * the top-level counts are zero and the real numbers live in `iterations`. The
 * last iteration carries the true context size, so it is preferred when present.
 */
function readPromptUsage(usage: Anthropic.Beta.BetaUsage): TurnUsage {
    const iterations = usage.iterations;
    const source = iterations && iterations.length > 0 ? (iterations[iterations.length - 1] ?? usage) : usage;
    const cacheCreation = source.cache_creation_input_tokens ?? 0;
    const cacheRead = source.cache_read_input_tokens ?? 0;
    return {
        inputTokens: source.input_tokens + cacheCreation + cacheRead,
        outputTokens: source.output_tokens,
        cacheCreationInputTokens: cacheCreation,
        cacheReadInputTokens: cacheRead,
    };
}

/**
 * Extract a {@link Citation} from a streamed citation delta.
 *
 * The citation union spans web-search results and document locations
 * (`char_location`, `page_location`, `content_block_location`). Only
 * web-sourced citations carry a URL, which is what {@link Citation} models;
 * document citations are ignored until that type gains a document form.
 */
function citationFromDelta(citation: Anthropic.Beta.BetaCitationsDelta["citation"]): Citation | undefined {
    const url: unknown = (citation as { url?: unknown }).url;
    if (typeof url !== "string" || url.length === 0) return undefined;
    const title: unknown = (citation as { title?: unknown }).title;
    return { url, title: typeof title === "string" ? title : url };
}

/** Deduplicate citations by URL, preserving first-seen order. */
function deduplicateCitations(citations: Citation[]): Citation[] {
    const seen = new Set<string>();
    const unique: Citation[] = [];
    for (const citation of citations) {
        if (seen.has(citation.url)) continue;
        seen.add(citation.url);
        unique.push(citation);
    }
    return unique;
}

/** Read the client-side tool calls from a completed assistant turn. */
function readToolCalls(message: Anthropic.Beta.BetaMessage): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        calls.push({
            id: block.id,
            name: block.name,
            args: (block.input ?? {}) as Record<string, unknown>,
        });
    }
    return calls;
}

/** Collect compaction blocks from a completed assistant turn. */
function readCompactionParts(message: Anthropic.Beta.BetaMessage): OpaqueContentPart[] {
    const parts: OpaqueContentPart[] = [];
    for (const block of message.content) {
        if (block.type === "compaction") {
            parts.push(compactionBlockToOpaquePart(block));
        }
    }
    return parts;
}

/**
 * Stream a full agent response, driving the tool-calling loop to completion.
 *
 * Emits provider-neutral {@link AgentStreamChunk} values: incremental text and
 * thinking deltas plus server-tool status while a turn streams, tool calls and
 * results as they execute, and the accumulated thinking parts, opaque parts,
 * citations, and usage once the model stops requesting tools.
 *
 * Content-block indices come straight from the API, so each thinking block maps
 * to a stable part index without reassembly guesswork. All text collapses into
 * a single part, matching how the transcript stores an assistant turn.
 */
export async function* streamAgent(params: StreamAgentParams): AsyncGenerator<AgentStreamChunk> {
    const { client, request, tools, maxToolIterations, modelName, vendor, signal, logger, debugApiContent } = params;
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    const conversation = [...params.conversation];

    const thinkingParts: { partIndex: number; part: ThinkingContentPart }[] = [];
    const opaqueParts: OpaqueContentPart[] = [];
    const citations: Citation[] = [];
    const totals: TurnUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
    };
    let sawUsage = false;
    let nextPartIndex = 0;
    let textPartIndex: number | null = null;

    for (let turn = 0; turn < maxToolIterations; turn++) {
        signal?.throwIfAborted();

        let stream;
        try {
            stream = client.beta.messages.stream(
                { ...request, messages: conversation, stream: true },
                { ...(signal ? { signal } : {}) },
            );
        } catch (error) {
            logger.error({ phase: "stream_init", turn }, "Assistant API stream failed");
            throw error;
        }

        // Anthropic block index -> emitted part index, for the current turn only.
        const thinkingPartIndexByBlock = new Map<number, number>();
        const thinkingTextByBlock = new Map<number, string>();
        let turnUsage: TurnUsage | undefined;

        // A thinking block only claims a part index once it carries text. An
        // adaptive-thinking block whose summary is empty must not leave a gap.
        const thinkingPartIndexFor = (blockIndex: number): number => {
            const existing = thinkingPartIndexByBlock.get(blockIndex);
            if (existing !== undefined) return existing;
            const partIndex = nextPartIndex++;
            thinkingPartIndexByBlock.set(blockIndex, partIndex);
            return partIndex;
        };

        try {
            for await (const event of stream) {
                if (debugApiContent) {
                    logger.info({ turn, event }, "stream.api-event");
                }
                switch (event.type) {
                    case "message_start": {
                        turnUsage = readPromptUsage(event.message.usage);
                        break;
                    }
                    case "content_block_start": {
                        const block = event.content_block;
                        if (block.type === "thinking") {
                            if (block.thinking.length > 0) {
                                thinkingTextByBlock.set(event.index, block.thinking);
                                thinkingPartIndexFor(event.index);
                            } else {
                                thinkingTextByBlock.set(event.index, "");
                            }
                        } else if (block.type === "server_tool_use") {
                            const status = toolNameToStatus(block.name);
                            if (status) {
                                yield { type: "status", status: status.code, statusText: status.text };
                            }
                        }
                        break;
                    }
                    case "content_block_delta": {
                        const delta = event.delta;
                        if (delta.type === "text_delta") {
                            textPartIndex ??= nextPartIndex++;
                            if (delta.text.length > 0) {
                                yield {
                                    type: "text-delta",
                                    partType: "text",
                                    partIndex: textPartIndex,
                                    delta: delta.text,
                                };
                            }
                        } else if (delta.type === "thinking_delta") {
                            if (thinkingTextByBlock.has(event.index) && delta.thinking.length > 0) {
                                thinkingTextByBlock.set(
                                    event.index,
                                    (thinkingTextByBlock.get(event.index) ?? "") + delta.thinking,
                                );
                                yield {
                                    type: "text-delta",
                                    partType: "thinking",
                                    partIndex: thinkingPartIndexFor(event.index),
                                    delta: delta.thinking,
                                };
                            }
                        } else if (delta.type === "citations_delta") {
                            const citation = citationFromDelta(delta.citation);
                            if (citation) citations.push(citation);
                        }
                        break;
                    }
                    case "content_block_stop": {
                        const partIndex = thinkingPartIndexByBlock.get(event.index);
                        const text = thinkingTextByBlock.get(event.index);
                        if (partIndex !== undefined && text !== undefined && text.length > 0) {
                            thinkingParts.push({ partIndex, part: { type: "thinking", text } });
                        }
                        break;
                    }
                    case "message_delta": {
                        // Carries the final output count; the prompt-side numbers
                        // stay as reported at message_start.
                        if (turnUsage) turnUsage.outputTokens = event.usage.output_tokens;
                        break;
                    }
                    default:
                        break;
                }
            }
        } catch (error) {
            logger.error({ phase: "stream_iterate", turn }, "Assistant API stream failed");
            throw error;
        }

        if (turnUsage) {
            sawUsage = true;
            // Input is a snapshot of the context, so the largest turn wins;
            // output and cache writes are per-request costs, so they add up.
            totals.inputTokens = Math.max(totals.inputTokens, turnUsage.inputTokens);
            totals.outputTokens += turnUsage.outputTokens;
            totals.cacheCreationInputTokens += turnUsage.cacheCreationInputTokens;
            totals.cacheReadInputTokens += turnUsage.cacheReadInputTokens;
        }

        const finalMessage = await stream.finalMessage();
        opaqueParts.push(...readCompactionParts(finalMessage));

        if (finalMessage.stop_reason === "refusal") {
            throw new Error("The model declined to answer this request.");
        }

        // Both suspend the turn without answering: a long-running server tool
        // (`pause_turn`), or the API compacting the history and handing back the
        // compaction block (`compaction`). Either way the assistant turn is
        // replayed and the model asked to continue — after a compaction the
        // block stands in for everything before it.
        if (finalMessage.stop_reason === "pause_turn" || finalMessage.stop_reason === "compaction") {
            conversation.push({ role: "assistant", content: finalMessage.content });
            continue;
        }

        const toolCalls = readToolCalls(finalMessage);
        if (toolCalls.length === 0) break;

        signal?.throwIfAborted();

        // Replay the assistant turn verbatim: thinking blocks keep the exact
        // bytes and signature the API produced, which it requires when tool
        // results follow.
        conversation.push({ role: "assistant", content: finalMessage.content });

        const results: Anthropic.Beta.BetaContentBlockParam[] = [];
        for (const call of toolCalls) {
            yield { type: "tool-call", toolCallId: call.id, toolName: call.name, args: call.args };
            const { resultContent, isError } = await executeToolCall(toolMap, call);
            yield {
                type: "tool-result",
                toolCallId: call.id,
                toolName: call.name,
                result: resultContent,
                isError,
            };
            results.push({
                type: "tool_result",
                tool_use_id: call.id,
                content: resultContent,
                ...(isError ? { is_error: true } : {}),
            });
        }
        conversation.push({ role: "user", content: results });

        if (turn === maxToolIterations - 1) {
            throw new Error(`Tool-calling loop exceeded the maximum of ${maxToolIterations.toString()} iterations.`);
        }
    }

    for (const { partIndex, part } of thinkingParts) {
        yield { type: "thinking-part", partIndex, part };
    }
    for (const [index, part] of opaqueParts.entries()) {
        yield { type: "opaque-part", partIndex: index, part };
    }
    const uniqueCitations = deduplicateCitations(citations);
    if (uniqueCitations.length > 0) {
        yield { type: "citations", citations: uniqueCitations };
    }
    if (sawUsage) {
        const usage: AgentUsage = {
            vendor,
            model: modelName,
            inputTokens: totals.inputTokens,
            outputTokens: totals.outputTokens,
            ...(totals.cacheCreationInputTokens > 0
                ? { cacheCreationInputTokens: totals.cacheCreationInputTokens }
                : {}),
            ...(totals.cacheReadInputTokens > 0 ? { cacheReadInputTokens: totals.cacheReadInputTokens } : {}),
        };
        yield { type: "usage", usage };
    }
}
