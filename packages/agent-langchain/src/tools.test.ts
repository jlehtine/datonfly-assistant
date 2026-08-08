import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { zodTool, type ContentPart, type ITool } from "@datonfly-assistant/core";

import { executeToolCall, runToolLoop, toLangChainToolDef, type ToolLoopModel } from "./tools.js";

/** Build a fake model that replays a fixed sequence of responses. */
function fakeModel(responses: AIMessage[]): { model: ToolLoopModel; calls: BaseMessage[][] } {
    let index = 0;
    const calls: BaseMessage[][] = [];
    const model: ToolLoopModel = {
        invoke: (messages) => {
            calls.push(messages);
            const response = responses[Math.min(index, responses.length - 1)];
            index++;
            return Promise.resolve(response);
        },
    };
    return { model, calls };
}

/** Build an AI message that requests a single tool call. */
function toolCallMessage(name: string, args: Record<string, unknown>, id: string): AIMessage {
    return new AIMessage({ content: "", tool_calls: [{ name, args, id, type: "tool_call" }] });
}

function findPart<T extends ContentPart["type"]>(parts: ContentPart[], type: T): Extract<ContentPart, { type: T }> {
    const part = parts.find((p): p is Extract<ContentPart, { type: T }> => p.type === type);
    if (!part) throw new Error(`No content part of type "${type}" found.`);
    return part;
}

describe("runToolLoop", () => {
    it("executes a tool and feeds its result back for a follow-up turn", async () => {
        let executed: { a: number; b: number } | undefined;
        const adder = zodTool({
            name: "adder",
            description: "Adds two numbers.",
            schema: z.object({ a: z.number(), b: z.number() }),
            execute: (input) => {
                executed = input;
                return Promise.resolve(String(input.a + input.b));
            },
        });
        const { model, calls } = fakeModel([
            toolCallMessage("adder", { a: 1, b: 2 }, "call_1"),
            new AIMessage("The sum is 3."),
        ]);

        const result = await runToolLoop({
            model,
            messages: [],
            tools: [adder],
            maxIterations: 5,
        });

        expect(executed).toEqual({ a: 1, b: 2 });
        expect(result.finalResponse.content).toBe("The sum is 3.");
        expect(calls).toHaveLength(2);

        const toolCallPart = findPart(result.toolParts, "tool-call");
        expect(toolCallPart.toolName).toBe("adder");
        expect(toolCallPart.toolCallId).toBe("call_1");

        const toolResultPart = findPart(result.toolParts, "tool-result");
        expect(toolResultPart.isError).toBe(false);
        expect(toolResultPart.result).toBe("3");

        // The follow-up turn must include the tool result as a ToolMessage.
        const followUpMessages = calls[1];
        const lastMessage = followUpMessages[followUpMessages.length - 1];
        expect(lastMessage).toBeInstanceOf(ToolMessage);
        expect((lastMessage as ToolMessage).content).toBe("3");
        expect((lastMessage as ToolMessage).tool_call_id).toBe("call_1");
    });

    it("returns a schema-validation failure as an error result without executing the tool", async () => {
        let wasExecuted = false;
        const adder = zodTool({
            name: "adder",
            description: "Adds two numbers.",
            schema: z.object({ a: z.number(), b: z.number() }),
            execute: () => {
                wasExecuted = true;
                return Promise.resolve("unreachable");
            },
        });
        const { model } = fakeModel([
            toolCallMessage("adder", { a: "not-a-number", b: 2 }, "call_1"),
            new AIMessage("Sorry, I could not add those."),
        ]);

        const result = await runToolLoop({
            model,
            messages: [],
            tools: [adder],
            maxIterations: 5,
        });

        expect(wasExecuted).toBe(false);
        const toolResultPart = findPart(result.toolParts, "tool-result");
        expect(toolResultPart.isError).toBe(true);
        expect(toolResultPart.result).toContain("Invalid arguments");
    });

    it("aborts with an error once the iteration cap is exceeded", async () => {
        const looper = zodTool({
            name: "looper",
            description: "Always asks to be called again.",
            schema: z.object({}),
            execute: () => Promise.resolve("again"),
        });
        // The model always requests another tool call, never settling.
        const { model } = fakeModel([toolCallMessage("looper", {}, "call_loop")]);

        await expect(
            runToolLoop({
                model,
                messages: [],
                tools: [looper],
                maxIterations: 2,
            }),
        ).rejects.toThrow(/exceeded the maximum of 2 iterations/);
    });

    it("honours an abort signal triggered mid-loop", async () => {
        const controller = new AbortController();
        const aborter = zodTool({
            name: "aborter",
            description: "Aborts the loop when executed.",
            schema: z.object({}),
            execute: () => {
                controller.abort(new Error("cancelled by caller"));
                return Promise.resolve("done");
            },
        });
        const { model } = fakeModel([toolCallMessage("aborter", {}, "call_abort")]);

        await expect(
            runToolLoop({
                model,
                messages: [],
                tools: [aborter],
                maxIterations: 5,
                signal: controller.signal,
            }),
        ).rejects.toThrow(/cancelled by caller/);
    });
});

describe("executeToolCall", () => {
    it("reports an unavailable tool as an error", async () => {
        const result = await executeToolCall(new Map(), { name: "missing", args: {} });
        expect(result.isError).toBe(true);
        expect(result.resultContent).toContain("is not available");
    });

    it("stringifies object results as JSON", async () => {
        const tool = zodTool({
            name: "echo",
            description: "Echoes an object.",
            schema: z.object({ value: z.string() }),
            execute: (input) => Promise.resolve({ echoed: input.value }),
        });
        const result = await executeToolCall(new Map([[tool.name, tool as ITool]]), {
            name: "echo",
            args: { value: "hi" },
        });
        expect(result.isError).toBe(false);
        expect(result.resultContent).toBe(JSON.stringify({ echoed: "hi" }));
    });

    it("captures a thrown tool error as an error result", async () => {
        const tool = zodTool({
            name: "boom",
            description: "Always throws.",
            schema: z.object({}),
            execute: () => Promise.reject(new Error("kaboom")),
        });
        const result = await executeToolCall(new Map([[tool.name, tool as ITool]]), { name: "boom", args: {} });
        expect(result.isError).toBe(true);
        expect(result.resultContent).toContain("kaboom");
    });

    it("dispatches unvalidated arguments verbatim when the tool omits validate", async () => {
        let received: unknown;
        const tool: ITool = {
            name: "passthrough",
            description: "Records what it receives.",
            inputSchema: { type: "object", additionalProperties: false },
            execute: (input) => {
                received = input;
                return Promise.resolve("ok");
            },
        };
        const args = { extra: "kept", nested: { deep: true } };

        const result = await executeToolCall(new Map([[tool.name, tool]]), { name: "passthrough", args });

        expect(result.isError).toBe(false);
        expect(received).toEqual(args);
    });
});

describe("toLangChainToolDef", () => {
    it("passes the tool's JSON Schema through as the binding schema", () => {
        const inputSchema = {
            type: "object" as const,
            properties: { selector: { oneOf: [{ type: "string" }, { type: "number" }] } },
            additionalProperties: false,
        };
        const tool: ITool = {
            name: "inspect",
            description: "Inspects a target.",
            inputSchema,
            execute: () => Promise.resolve("ok"),
        };

        expect(toLangChainToolDef(tool)).toEqual({
            name: "inspect",
            description: "Inspects a target.",
            schema: inputSchema,
        });
    });
});
