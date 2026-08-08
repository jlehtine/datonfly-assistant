import { describe, expect, it } from "vitest";
import { z } from "zod";

import { zodTool } from "./zod-tool.js";

describe("zodTool", () => {
    it("emits a draft-7 JSON Schema for the input", () => {
        const tool = zodTool({
            name: "adder",
            description: "Adds two numbers.",
            schema: z.object({ a: z.number(), b: z.number().describe("The addend.") }),
            execute: (input) => Promise.resolve(String(input.a + input.b)),
        });

        expect(tool.name).toBe("adder");
        expect(tool.description).toBe("Adds two numbers.");
        expect(tool.inputSchema).toMatchObject({
            type: "object",
            properties: {
                a: { type: "number" },
                b: { type: "number", description: "The addend." },
            },
            required: ["a", "b"],
        });
    });

    it("validates input before execution and infers the executed type", async () => {
        const seen: { value: number }[] = [];
        const tool = zodTool({
            name: "echo",
            description: "Echoes a number.",
            schema: z.object({ value: z.number() }),
            execute: (input) => {
                seen.push(input);
                return Promise.resolve({ value: input.value });
            },
        });

        const parsed = tool.validate?.({ value: 41 });
        expect(parsed).toEqual({ value: 41 });
        await expect(tool.execute({ value: 41 })).resolves.toEqual({ value: 41 });
        expect(seen).toEqual([{ value: 41 }]);
    });

    it("throws from validate on invalid input", () => {
        const tool = zodTool({
            name: "echo",
            description: "Echoes a number.",
            schema: z.object({ value: z.number() }),
            execute: (input) => Promise.resolve(String(input.value)),
        });

        expect(() => tool.validate?.({ value: "not a number" })).toThrow();
    });

    it("describes defaults on the input side", () => {
        const tool = zodTool({
            name: "greet",
            description: "Greets someone.",
            schema: z.object({ name: z.string(), greeting: z.string().default("Hello") }),
            execute: (input) => Promise.resolve(`${input.greeting}, ${input.name}`),
        });

        // `io: "input"` keeps a defaulted property optional, matching what the model must produce.
        expect(tool.inputSchema).toMatchObject({ required: ["name"] });
        expect(tool.validate?.({ name: "Ada" })).toEqual({ name: "Ada", greeting: "Hello" });
    });

    it("preserves constraints the model should respect", () => {
        const tool = zodTool({
            name: "search",
            description: "Searches.",
            schema: z.object({
                query: z.string().min(1),
                limit: z.number().int().min(1).max(100),
                mode: z.enum(["fast", "thorough"]),
            }),
            execute: () => Promise.resolve("ok"),
        });

        expect(tool.inputSchema).toMatchObject({
            properties: {
                query: { type: "string", minLength: 1 },
                limit: { type: "integer", minimum: 1, maximum: 100 },
                mode: { enum: ["fast", "thorough"] },
            },
        });
    });

    it("degrades unrepresentable constructs instead of throwing", () => {
        const tool = zodTool({
            name: "schedule",
            description: "Schedules something.",
            schema: z.object({ at: z.date() }),
            execute: () => Promise.resolve("ok"),
        });

        expect(tool.inputSchema).toMatchObject({ type: "object" });
        expect(tool.inputSchema.properties?.at).toBeDefined();
    });
});
