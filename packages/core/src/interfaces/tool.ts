import type { JSONSchema7 } from "json-schema";

/**
 * JSON Schema describing a tool's input parameters.
 *
 * Deliberately loose: every model provider subsets JSON Schema differently, so
 * the schema is handed to the provider as authored rather than normalised here.
 */
export type JsonSchema = JSONSchema7;

/**
 * A tool that the chat agent can invoke during a conversation.
 *
 * JSON Schema is the canonical description of the input, because it is what
 * every wire protocol in this space speaks (MCP `inputSchema`, Anthropic
 * `input_schema`, OpenAI `function.parameters`). Use `zodTool()` to author a
 * tool from a Zod schema instead of writing JSON Schema by hand.
 *
 * @typeParam TInput - Type of the input passed to {@link ITool.execute}.
 */
export interface ITool<TInput = unknown> {
    /** Unique tool name (used by the LLM to select the tool). */
    name: string;
    /** Human-readable description shown to the LLM to explain what the tool does. */
    description: string;
    /** JSON Schema for the tool input, passed to the model verbatim. */
    inputSchema: JsonSchema;
    /**
     * Optional pre-dispatch validation, throwing on invalid input.
     *
     * Omit when the tool validates its own input — a proxied backend is the
     * authority on its own schema and reports better errors than a
     * reconstruction of it.
     */
    validate?: (input: unknown) => TInput;
    /** Execute the tool and return a result. */
    execute(input: TInput): Promise<string | Record<string, unknown>>;
}
