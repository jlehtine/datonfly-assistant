import type { z } from "zod";

export interface ITool<TInput extends z.ZodType = z.ZodType> {
    name: string;
    description: string;
    schema: TInput;
    execute(input: z.infer<TInput>): Promise<string | Record<string, unknown>>;
}
