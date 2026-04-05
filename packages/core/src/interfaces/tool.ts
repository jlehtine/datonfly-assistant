import type { z } from "zod";

/**
 * A tool that the chat agent can invoke during a conversation.
 *
 * @typeParam TInput - Zod schema describing the tool's input parameters.
 */
export interface ITool<TInput extends z.ZodType = z.ZodType> {
    /** Unique tool name (used by the LLM to select the tool). */
    name: string;
    /** Human-readable description shown to the LLM to explain what the tool does. */
    description: string;
    /** Zod schema used to validate and describe the tool's input parameters. */
    schema: TInput;
    /** Execute the tool with validated input and return a result. */
    execute(input: z.infer<TInput>): Promise<string | Record<string, unknown>>;
}
