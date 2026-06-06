import { ToolMessage, type AIMessage, type BaseMessage } from "@langchain/core/messages";

import type { ContentPart, ITool } from "@datonfly-assistant/core";

/** A tool invocation requested by the model, normalised from the provider format. */
export interface LoopToolCall {
    /** Provider-assigned identifier correlating the call with its result. */
    id?: string | undefined;
    /** Name of the tool the model requested. */
    name: string;
    /** Raw arguments produced by the model (validated before execution). */
    args: Record<string, unknown>;
}

/**
 * Minimal model abstraction the tool-calling loop drives.
 *
 * Implemented in production by a LangChain {@link AIMessage}-returning runnable
 * and by fakes in tests, so the loop can be exercised without a live model.
 */
export interface ToolLoopModel {
    /** Invoke the model with the running conversation and return its response. */
    invoke(messages: BaseMessage[], options?: Record<string, unknown>): Promise<AIMessage>;
}

/** Parameters for {@link runToolLoop}. */
export interface RunToolLoopParams {
    /** The model that produces responses and tool-call requests. */
    model: ToolLoopModel;
    /** The conversation so far, as LangChain messages. */
    messages: BaseMessage[];
    /** Tools the model may invoke during the loop. */
    tools: ITool[];
    /** Maximum number of model turns before the loop aborts. */
    maxIterations: number;
    /** Options forwarded to each {@link ToolLoopModel.invoke} call. */
    invokeOptions?: Record<string, unknown> | undefined;
    /** Abort signal checked before each model turn. */
    signal?: AbortSignal | undefined;
}

/** Result of a completed {@link runToolLoop}. */
export interface RunToolLoopResult {
    /** The final model response that did not request any further tools. */
    finalResponse: AIMessage;
    /**
     * The interleaved `tool-call` / `tool-result` content parts recorded across
     * the loop, in execution order.
     */
    toolParts: ContentPart[];
}

/** Convert an {@link ITool} into a LangChain tool-binding definition. */
export function toLangChainToolDef(tool: ITool): { name: string; description: string; schema: ITool["schema"] } {
    return { name: tool.name, description: tool.description, schema: tool.schema };
}

/** Render a tool's return value as the string content of a tool result. */
function stringifyToolResult(value: string | Record<string, unknown>): string {
    return typeof value === "string" ? value : JSON.stringify(value);
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
}

/** Throw if the given abort signal has been aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
    signal?.throwIfAborted();
}

/** Read and normalise the tool calls requested by a model response. */
export function readToolCalls(message: AIMessage): LoopToolCall[] {
    const calls = message.tool_calls ?? [];
    return calls.map((call) => ({
        ...(call.id !== undefined ? { id: call.id } : {}),
        name: call.name,
        args: call.args,
    }));
}

/**
 * Execute a single tool call: validate its arguments against the tool's schema,
 * run the tool, and stringify the result.
 *
 * Never throws for tool-side failures — a missing tool, invalid arguments, or a
 * thrown error are all returned as `isError: true` results so the model can
 * observe and recover from them.
 */
export async function executeToolCall(
    toolMap: Map<string, ITool>,
    call: LoopToolCall,
): Promise<{ resultContent: string; isError: boolean }> {
    const tool = toolMap.get(call.name);
    if (!tool) {
        return { resultContent: `Tool "${call.name}" is not available.`, isError: true };
    }

    let parsed: unknown;
    try {
        parsed = tool.schema.parse(call.args);
    } catch (error) {
        return { resultContent: `Invalid arguments for tool "${call.name}": ${errorMessage(error)}`, isError: true };
    }

    try {
        const output = await tool.execute(parsed);
        return { resultContent: stringifyToolResult(output), isError: false };
    } catch (error) {
        return { resultContent: `Tool "${call.name}" failed: ${errorMessage(error)}`, isError: true };
    }
}

/**
 * Drive an agentic tool-calling loop against {@link ToolLoopParams.model}.
 *
 * Each iteration invokes the model; if it requests no tools, the loop resolves
 * with that response. Otherwise every requested tool is executed, the results
 * are appended to the conversation as tool messages, and the model is invoked
 * again. The loop records each call and result as `tool-call` / `tool-result`
 * content parts, honours the abort signal between turns, and aborts with an
 * error once {@link RunToolLoopParams.maxIterations} turns have elapsed without
 * a tool-free response.
 */
export async function runToolLoop(params: RunToolLoopParams): Promise<RunToolLoopResult> {
    const { model, tools, maxIterations, invokeOptions, signal } = params;
    const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
    const conversation = [...params.messages];
    const toolParts: ContentPart[] = [];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
        throwIfAborted(signal);
        const response = await model.invoke(conversation, invokeOptions);
        const toolCalls = readToolCalls(response);
        if (toolCalls.length === 0) {
            return { finalResponse: response, toolParts };
        }

        conversation.push(response);
        for (const call of toolCalls) {
            const toolCallId = call.id ?? crypto.randomUUID();
            toolParts.push({ type: "tool-call", toolCallId, toolName: call.name, args: call.args });
            const { resultContent, isError } = await executeToolCall(toolMap, call);
            toolParts.push({ type: "tool-result", toolCallId, toolName: call.name, result: resultContent, isError });
            conversation.push(
                new ToolMessage({
                    content: resultContent,
                    tool_call_id: toolCallId,
                    status: isError ? "error" : "success",
                }),
            );
        }
    }

    throw new Error(`Tool-calling loop exceeded the maximum of ${maxIterations.toString()} iterations.`);
}
