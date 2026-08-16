import { z } from "zod";

import type { ITool, JsonSchema } from "./tool.js";

/** Definition of a tool authored with a Zod schema, for {@link zodTool}. */
export interface ZodToolDefinition<TSchema extends z.ZodType> {
    /** Unique tool name (used by the LLM to select the tool). */
    name: string;
    /** Human-readable description shown to the LLM to explain what the tool does. */
    description: string;
    /** Zod schema describing the tool's input parameters. */
    schema: TSchema;
    /** Execute the tool with validated input and return a result. */
    execute: (input: z.infer<TSchema>) => Promise<string | Record<string, unknown>>;
}

/**
 * Author an {@link ITool} from a Zod schema.
 *
 * The ergonomic path for tools defined in TypeScript: the JSON Schema handed to
 * the model is derived from the Zod schema, and `validate` parses arguments
 * before dispatch, so `execute()` receives a typed, validated input.
 *
 * Tools that proxy a backend owning its own schema (e.g. MCP servers) should
 * build the {@link ITool} directly instead, passing the published JSON Schema
 * through untouched and omitting `validate`.
 */
export function zodTool<TSchema extends z.ZodType>(definition: ZodToolDefinition<TSchema>): ITool<z.infer<TSchema>> {
    const { name, description, schema, execute } = definition;
    return {
        name,
        description,
        // `io: "input"` describes defaults and transforms on the side the model
        // generates; `unrepresentable: "any"` degrades exotic types instead of throwing.
        inputSchema: z.toJSONSchema(schema, {
            io: "input",
            target: "draft-7",
            unrepresentable: "any",
        }) as JsonSchema,
        validate: (input: unknown) => schema.parse(input),
        execute,
    };
}
