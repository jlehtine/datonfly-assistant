import type Anthropic from "@anthropic-ai/sdk";

import type {
    AgentStreamChunk,
    AgentUsage,
    Citation,
    GeneratedFileChunk,
    ITool,
    OpaqueContentPart,
    ProviderLogger,
} from "@datonfly-assistant/core";

import { isInvalidContainerError, isOverloadedError } from "./errors.js";
import { compactionBlockToOpaquePart, rawTurnsToReplayData } from "./messages.js";
import { executeToolCall, toolNameToStatus, type ToolCall } from "./tools.js";

/** Bounded retries for a mid-stream `overloaded_error`, not the initial connection (the SDK already retries that). */
const MAX_OVERLOAD_RETRIES = 2;

/** Base delay before the first overload retry; doubles for each subsequent one. */
const OVERLOAD_RETRY_BASE_DELAY_MS = 500;

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

/** Whether a bash code execution result carries files rather than an error (`bash_code_execution_tool_result_error`). */
function isBashCodeExecutionResultBlock(content: unknown): content is Anthropic.Beta.BetaBashCodeExecutionResultBlock {
    return (
        typeof content === "object" &&
        content !== null &&
        (content as { type?: unknown }).type === "bash_code_execution_result" &&
        Array.isArray((content as { content?: unknown }).content)
    );
}

/**
 * Collect generated-file references from bash code execution results in a
 * completed assistant turn, deduplicated by file ID.
 *
 * Every reported file ID is a deliberate deliverable: the sandbox only exports
 * files copied into `$OUTPUT_DIR` to the Files API, so there is
 * no path filtering to apply here. Error results
 * (`bash_code_execution_tool_result_error`) and bash results with no files
 * (`content: []`) simply contribute nothing.
 */
export function readGeneratedFileChunks(message: Anthropic.Beta.BetaMessage): GeneratedFileChunk[] {
    const chunks: GeneratedFileChunk[] = [];
    for (const block of message.content) {
        if (block.type !== "bash_code_execution_tool_result") continue;
        const content: unknown = block.content;
        if (!isBashCodeExecutionResultBlock(content)) continue;
        for (const output of content.content) {
            const fileId: unknown = (output as { file_id?: unknown }).file_id;
            if (typeof fileId !== "string" || fileId.length === 0) continue;
            chunks.push({ type: "generated-file", fileRef: fileId });
        }
    }
    return chunks;
}

/** Copy of the request with `container` removed, used to retry once a stale reference is discarded. */
function withoutRequestContainer(
    request: Omit<Anthropic.Beta.Messages.MessageCreateParamsStreaming, "messages" | "stream">,
): Omit<Anthropic.Beta.Messages.MessageCreateParamsStreaming, "messages" | "stream"> {
    const next = { ...request };
    delete next.container;
    return next;
}

/** Resolve after `ms` milliseconds; rejects immediately (or as soon as it fires) if `signal` aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason as Error);
            return;
        }
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(signal?.reason as Error);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/** A content block accumulated during one stream attempt, kept in case it is cut short by a mid-stream overload. */
interface SalvageBlock {
    type: string;
    text: string;
    signature: string;
    completed: boolean;
}

/**
 * Build the assistant content safely replayable after a mid-stream overload.
 *
 * Verified empirically against the live API (`fixtures/continuation-experiment.ts`):
 * plain text is safe to replay whether or not its block reached
 * `content_block_stop`, but a `thinking` block is only valid once signed there —
 * one still open at the cut has no signature and the API rejects it with
 * `Invalid signature in thinking block`, so it (and only it) is dropped. Other
 * block types (`tool_use`, `server_tool_use`, …) are not replayed at all —
 * continuation has only been verified for text/thinking.
 */
function buildSalvageContent(blocks: SalvageBlock[]): Anthropic.Beta.BetaContentBlockParam[] {
    const salvage: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const block of blocks) {
        if (block.type === "text" && block.text.length > 0) {
            salvage.push({ type: "text", text: block.text });
        } else if (block.type === "thinking" && block.completed && block.signature.length > 0) {
            salvage.push({ type: "thinking", thinking: block.text, signature: block.signature });
        }
    }
    return salvage;
}

/**
 * Build the ephemeral instruction that asks the model to continue a salvaged
 * turn. Never persisted, yielded as a chunk, or shown to the user — it exists
 * only in the retried request.
 *
 * Deliberately generic rather than quoting the exact cutoff text: a prior
 * version asked the model to resume mid-word so the two halves joined into one
 * seamless paragraph, but the continuation is now its own text part (see the
 * `streamAgent` doc comment) and renders as a new paragraph regardless, so
 * there is nothing left to make seamless.
 */
function continuationInstruction(): string {
    return (
        "Your previous response was cut off by a service overload before you finished. " +
        "Continue your response from where it left off."
    );
}

/**
 * Stream a full agent response, driving the tool-calling loop to completion.
 *
 * Emits provider-neutral {@link AgentStreamChunk} values in true chronological
 * order: incremental text and thinking deltas plus server-tool status while a
 * turn streams, a complete thinking/opaque/generated-file chunk as soon as it is
 * known, tool calls and results as they execute, then raw-turn replay data,
 * citations, and usage once the model stops requesting tools.
 *
 * Content-block indices come straight from the API, so each thinking block maps
 * to a stable part index without reassembly guesswork. Text deltas share one
 * part index across consecutive text blocks (including ones split only by a
 * citation), but start a *new* part index after any visible content —
 * thinking, a tool call/result, a generated file, or an overload-retry
 * continuation — so the transcript preserves where text was truly interrupted.
 */
export async function* streamAgent(params: StreamAgentParams): AsyncGenerator<AgentStreamChunk> {
    const { client, request, tools, maxToolIterations, modelName, vendor, signal, logger, debugApiContent } = params;
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    const conversation = [...params.conversation];

    const citations: Citation[] = [];
    // Generated-file refs already yielded, across every turn — a file id is not
    // scoped to the turn that reported it.
    const seenGeneratedFileRefs = new Set<string>();
    // Mutable copy of the request, so a stale `container` can be dropped after
    // a single failed attempt (see `isInvalidContainerError`) without losing the
    // original `request` the caller passed in.
    let effectiveRequest = request;
    let containerRetryAvailable = Boolean(request.container);
    // The provider's code-execution container for this call, once reported —
    // reused from the request or newly created, either way surfaced once at the
    // end so the caller can persist it for the next call.
    let containerId: string | undefined;
    // Every message param appended to `conversation` during this call, plus the
    // final answer (which the loop never pushes to `conversation` since nothing
    // continues after it) — captured verbatim for replay on a later turn.
    const rawTurns: Anthropic.Beta.BetaMessageParam[] = [];
    const totals: TurnUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
    };
    let sawUsage = false;
    let nextPartIndex = 0;
    // The part index the next text delta joins, or `null` right after a visible
    // part (thinking, tool activity, a generated file, an overload retry) —
    // which forces the next text delta to start a new part instead of resuming
    // this one. See the `streamAgent` doc comment for the full rule.
    let currentTextPartIndex: number | null = null;

    for (let turn = 0; turn < maxToolIterations; turn++) {
        signal?.throwIfAborted();

        // Messages sent for the *next* attempt of this turn. Starts as the
        // shared conversation; a mid-stream overload retries with a salvaged
        // assistant turn plus an ephemeral continuation instruction appended,
        // never persisted to `conversation` itself.
        let attemptMessages = conversation;
        let overloadRetriesLeft = MAX_OVERLOAD_RETRIES;
        let finalMessage: Anthropic.Beta.BetaMessage | undefined;

        for (;;) {
            let stream;
            try {
                stream = client.beta.messages.stream(
                    { ...effectiveRequest, messages: attemptMessages, stream: true },
                    { ...(signal ? { signal } : {}) },
                );
            } catch (error) {
                logger.error({ phase: "stream_init", turn }, "Assistant API stream failed");
                throw error;
            }

            // Anthropic block index -> emitted part index, for this attempt only.
            const thinkingPartIndexByBlock = new Map<number, number>();
            const thinkingTextByBlock = new Map<number, string>();
            // Content blocks accumulated this attempt, in order, kept in case a
            // mid-stream overload cuts the attempt short.
            const salvageBlocks = new Map<number, SalvageBlock>();
            let turnUsage: TurnUsage | undefined;
            let overloaded = false;
            let invalidContainer = false;

            // A thinking block only claims a part index once it carries text. An
            // adaptive-thinking block whose summary is empty must not leave a gap.
            // Claiming one is a visible part, so it also ends whatever text part
            // was open (see the `streamAgent` doc comment).
            const thinkingPartIndexFor = (blockIndex: number): number => {
                const existing = thinkingPartIndexByBlock.get(blockIndex);
                if (existing !== undefined) return existing;
                const partIndex = nextPartIndex++;
                thinkingPartIndexByBlock.set(blockIndex, partIndex);
                currentTextPartIndex = null;
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
                            salvageBlocks.set(event.index, {
                                type: block.type,
                                text: block.type === "thinking" ? block.thinking : "",
                                signature: "",
                                completed: false,
                            });
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
                            const salvageBlock = salvageBlocks.get(event.index);
                            if (delta.type === "text_delta") {
                                if (salvageBlock) salvageBlock.text += delta.text;
                                currentTextPartIndex ??= nextPartIndex++;
                                if (delta.text.length > 0) {
                                    yield {
                                        type: "text-delta",
                                        partType: "text",
                                        partIndex: currentTextPartIndex,
                                        delta: delta.text,
                                    };
                                }
                            } else if (delta.type === "thinking_delta") {
                                if (salvageBlock) salvageBlock.text += delta.thinking;
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
                            } else if (delta.type === "signature_delta") {
                                if (salvageBlock) salvageBlock.signature = delta.signature;
                            } else if (delta.type === "citations_delta") {
                                const citation = citationFromDelta(delta.citation);
                                if (citation) citations.push(citation);
                            }
                            break;
                        }
                        case "content_block_stop": {
                            const salvageBlock = salvageBlocks.get(event.index);
                            if (salvageBlock) salvageBlock.completed = true;

                            const partIndex = thinkingPartIndexByBlock.get(event.index);
                            const text = thinkingTextByBlock.get(event.index);
                            if (partIndex !== undefined && text !== undefined && text.length > 0) {
                                yield { type: "thinking-part", partIndex, part: { type: "thinking", text } };
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
                if (isOverloadedError(error) && overloadRetriesLeft > 0) {
                    overloaded = true;
                } else if (containerRetryAvailable && isInvalidContainerError(error)) {
                    invalidContainer = true;
                } else {
                    logger.error({ phase: "stream_iterate", turn }, "Assistant API stream failed");
                    throw error;
                }
            }

            if (turnUsage) {
                sawUsage = true;
                // Input is a snapshot of the context, so the largest turn wins;
                // output and cache writes are per-request costs, so they add up.
                // This applies even to an abandoned overloaded attempt: its
                // output tokens up to the cut were still billed.
                totals.inputTokens = Math.max(totals.inputTokens, turnUsage.inputTokens);
                totals.outputTokens += turnUsage.outputTokens;
                totals.cacheCreationInputTokens += turnUsage.cacheCreationInputTokens;
                totals.cacheReadInputTokens += turnUsage.cacheReadInputTokens;
            }

            if (invalidContainer) {
                containerRetryAvailable = false;
                effectiveRequest = withoutRequestContainer(effectiveRequest);
                logger.info(
                    { phase: "invalid_container", turn },
                    "Discarding invalid/expired container, retrying without it",
                );
                continue;
            }

            if (overloaded) {
                overloadRetriesLeft--;
                yield { type: "status", status: "retrying_overloaded", statusText: "Server overloaded, retrying…" };
                const attemptNumber = MAX_OVERLOAD_RETRIES - overloadRetriesLeft - 1;
                await delay(OVERLOAD_RETRY_BASE_DELAY_MS * 2 ** attemptNumber, signal);

                const salvage = buildSalvageContent([...salvageBlocks.values()]);
                attemptMessages =
                    salvage.length > 0
                        ? [
                              ...conversation,
                              { role: "assistant", content: salvage },
                              { role: "user", content: continuationInstruction() },
                          ]
                        : conversation;
                // The continuation is a fresh text part rather than a mid-word
                // splice back into the salvaged one (see the `streamAgent` doc
                // comment and `continuationInstruction`).
                currentTextPartIndex = null;
                continue;
            }

            finalMessage = await stream.finalMessage();
            break;
        }

        for (const part of readCompactionParts(finalMessage)) {
            yield { type: "opaque-part", part };
        }
        for (const chunk of readGeneratedFileChunks(finalMessage)) {
            if (seenGeneratedFileRefs.has(chunk.fileRef)) continue;
            seenGeneratedFileRefs.add(chunk.fileRef);
            currentTextPartIndex = null;
            yield chunk;
        }
        if (finalMessage.container) containerId = finalMessage.container.id;

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
            rawTurns.push({ role: "assistant", content: finalMessage.content });
            continue;
        }

        const toolCalls = readToolCalls(finalMessage);
        if (toolCalls.length === 0) {
            rawTurns.push({ role: "assistant", content: finalMessage.content });
            break;
        }

        signal?.throwIfAborted();

        // Replay the assistant turn verbatim: thinking blocks keep the exact
        // bytes and signature the API produced, which it requires when tool
        // results follow.
        conversation.push({ role: "assistant", content: finalMessage.content });
        rawTurns.push({ role: "assistant", content: finalMessage.content });

        // A tool call/result is a visible part, so it ends whatever text part
        // preceded it (see the `streamAgent` doc comment).
        currentTextPartIndex = null;
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
        rawTurns.push({ role: "user", content: results });

        if (turn === maxToolIterations - 1) {
            throw new Error(`Tool-calling loop exceeded the maximum of ${maxToolIterations.toString()} iterations.`);
        }
    }

    if (containerId) {
        yield { type: "container", containerId };
    }
    if (rawTurns.length > 0) {
        yield { type: "replay-data", data: rawTurnsToReplayData(rawTurns) };
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
