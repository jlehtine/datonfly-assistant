import type Anthropic from "@anthropic-ai/sdk";

import type { ITool, StatusCode } from "@datonfly-assistant/core";

import type { AnthropicProviderOptions } from "./config.js";

/** A tool invocation requested by the model. */
export interface ToolCall {
    /** Provider-assigned identifier correlating the call with its result. */
    id: string;
    /** Name of the tool the model requested. */
    name: string;
    /** Raw arguments produced by the model. */
    args: Record<string, unknown>;
}

/** Convert an {@link ITool} into an Anthropic tool definition. */
export function toolToParam(tool: ITool): Anthropic.Beta.BetaTool {
    return {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
    };
}

/**
 * Build the Anthropic server-side tool definitions enabled by the configuration.
 *
 * SDK 0.74 only types the 2025 tool versions, so the 2026 ones are asserted.
 * The definitions are plain data validated by the API, and pinning the version
 * identifiers here keeps that lag contained to this function.
 */
export function serverToolParams(options: AnthropicProviderOptions): Anthropic.Beta.BetaToolUnion[] {
    const tools: Record<string, unknown>[] = [];
    if (options.enableCodeExecution) {
        tools.push({ type: "code_execution_20260120", name: "code_execution" });
    }
    if (options.enableWebSearch) {
        tools.push({
            type: "web_search_20260209",
            name: "web_search",
            ...(options.webSearchMaxUses != null ? { max_uses: options.webSearchMaxUses } : {}),
        });
    }
    if (options.enableWebFetch) {
        tools.push({
            type: "web_fetch_20260209",
            name: "web_fetch",
            ...(options.webFetchMaxUses != null ? { max_uses: options.webFetchMaxUses } : {}),
            ...(options.webFetchMaxContentTokens != null
                ? { max_content_tokens: options.webFetchMaxContentTokens }
                : {}),
        });
    }
    return tools as unknown as Anthropic.Beta.BetaToolUnion[];
}

/** Server-tool names that indicate code execution activity. */
const CODE_EXECUTION_TOOL_NAMES = new Set(["code_execution", "bash_code_execution", "text_editor_code_execution"]);

/** A user-visible status derived from a server-tool invocation. */
export interface ToolStatus {
    code: StatusCode;
    text: string;
}

/** Map a server-tool name to a user-visible status, or `undefined` when it has none. */
export function toolNameToStatus(name: string): ToolStatus | undefined {
    if (CODE_EXECUTION_TOOL_NAMES.has(name)) return { code: "tool_code_execution", text: "Running code…" };
    if (name === "web_fetch") return { code: "tool_web_fetch", text: "Fetching page…" };
    if (name === "web_search") return { code: "tool_web_search", text: "Searching the web…" };
    return undefined;
}

/** Render a tool's return value as the string content of a tool result. */
function stringifyToolResult(value: string | Record<string, unknown>): string {
    return typeof value === "string" ? value : JSON.stringify(value);
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Execute a single tool call: validate its arguments when the tool opts into
 * pre-dispatch validation, run the tool, and stringify the result.
 *
 * Never throws for tool-side failures — a missing tool, invalid arguments, or a
 * thrown error are all returned as `isError: true` results so the model can
 * observe and recover from them.
 */
export async function executeToolCall(
    toolMap: Map<string, ITool>,
    call: ToolCall,
): Promise<{ resultContent: string; isError: boolean }> {
    const tool = toolMap.get(call.name);
    if (!tool) {
        return { resultContent: `Tool "${call.name}" is not available.`, isError: true };
    }

    let parsed: unknown;
    try {
        parsed = tool.validate?.(call.args) ?? call.args;
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
