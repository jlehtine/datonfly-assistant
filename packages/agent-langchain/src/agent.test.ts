import { AIMessage, AIMessageChunk, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { AgentMessage, AgentStreamChunk, ITool } from "@datonfly-assistant/core";

import { agentMessagesToBaseMessages, AnthropicAgent } from "./agent.js";

/**
 * A stand-in for the bound chat model that replays a fixed sequence of streamed
 * turns. Each turn is a list of chunks; the recorded `streamedMessages` capture
 * the conversation passed to every turn so tests can assert the tool round-trip.
 */
class FakeStreamModel {
    public readonly streamedMessages: BaseMessage[][] = [];
    private turnIndex = 0;

    constructor(private readonly turns: AIMessageChunk[][]) {}

    bindTools(): this {
        return this;
    }

    // eslint-disable-next-line @typescript-eslint/require-await
    async stream(messages: BaseMessage[]): Promise<AsyncIterable<AIMessageChunk>> {
        this.streamedMessages.push(messages);
        const chunks = this.turns[Math.min(this.turnIndex, this.turns.length - 1)] ?? [];
        this.turnIndex += 1;
        return (function* () {
            yield* chunks;
        })();
    }
}

/** Build an agent and replace its underlying model with a fake streamer. */
function agentWithFakeModel(fake: FakeStreamModel): AnthropicAgent {
    const agent = new AnthropicAgent({ modelName: "claude-test", apiKey: "sk-ant-test", maxToolIterations: 3 });
    // Override both the base model (used when tools are bound per call) and the
    // pre-bound runnable (used on the no-tools path) so no real API call is made.
    (agent as unknown as { model: unknown; runnableModel: unknown }).model = fake;
    (agent as unknown as { model: unknown; runnableModel: unknown }).runnableModel = fake;
    return agent;
}

/** Build an agent with extra default config, then swap in the fake streamer. */
function agentWith(
    fake: FakeStreamModel,
    config: { defaultTools?: ITool[]; defaultSystemPrompt?: string },
): AnthropicAgent {
    const agent = new AnthropicAgent({
        modelName: "claude-test",
        apiKey: "sk-ant-test",
        maxToolIterations: 3,
        ...config,
    });
    (agent as unknown as { model: unknown; runnableModel: unknown }).model = fake;
    (agent as unknown as { model: unknown; runnableModel: unknown }).runnableModel = fake;
    return agent;
}

const HUMAN_MESSAGE: AgentMessage[] = [{ role: "human", content: [{ type: "text", text: "add 1 and 2" }] }];

function adderTool(onExecute?: (input: { a: number; b: number }) => void): ITool {
    return {
        name: "adder",
        description: "Adds two numbers.",
        schema: z.object({ a: z.number(), b: z.number() }),
        execute: (input: { a: number; b: number }) => {
            onExecute?.(input);
            return Promise.resolve(String(input.a + input.b));
        },
    };
}

async function collect(stream: AsyncIterable<AgentStreamChunk>): Promise<AgentStreamChunk[]> {
    const chunks: AgentStreamChunk[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
}

describe("AnthropicAgent.stream tool loop", () => {
    it("emits tool-call then tool-result then the final text, in order", async () => {
        let executedWith: { a: number; b: number } | undefined;
        const fake = new FakeStreamModel([
            [new AIMessageChunk({ content: "", tool_calls: [{ name: "adder", args: { a: 1, b: 2 }, id: "c1" }] })],
            [new AIMessageChunk({ content: "The answer is 3." })],
        ]);
        const agent = agentWithFakeModel(fake);

        const stream = await agent.stream(HUMAN_MESSAGE, "t1", "u1", undefined, {
            tools: [adderTool((input) => (executedWith = input))],
        });
        const chunks = await collect(stream);

        expect(executedWith).toEqual({ a: 1, b: 2 });

        const toolCallIdx = chunks.findIndex((c) => c.type === "tool-call");
        const toolResultIdx = chunks.findIndex((c) => c.type === "tool-result");
        const finalTextIdx = chunks.findIndex((c) => c.type === "text-delta" && c.delta === "The answer is 3.");
        expect(toolCallIdx).toBeGreaterThanOrEqual(0);
        expect(toolResultIdx).toBeGreaterThan(toolCallIdx);
        expect(finalTextIdx).toBeGreaterThan(toolResultIdx);

        const toolCall = chunks[toolCallIdx];
        const toolResult = chunks[toolResultIdx];
        if (toolCall.type !== "tool-call" || toolResult.type !== "tool-result") throw new Error("unexpected types");
        expect(toolCall.toolName).toBe("adder");
        expect(toolResult.result).toBe("3");
        expect(toolResult.isError).toBe(false);

        // The second turn's conversation must replay the assistant tool call and
        // append the tool result as a ToolMessage.
        const secondTurn = fake.streamedMessages[1];
        const aiMsg = secondTurn.find(
            (m): m is AIMessage | AIMessageChunk => m instanceof AIMessage || m instanceof AIMessageChunk,
        );
        const toolMsg = secondTurn.find((m): m is ToolMessage => m instanceof ToolMessage);
        expect(aiMsg?.tool_calls?.[0]?.name).toBe("adder");
        expect(toolMsg?.content).toBe("3");
        expect(toolMsg?.tool_call_id).toBe("c1");
    });

    it("reconstructs tool arguments split across streamed chunks via concat", async () => {
        let executedWith: { a: number; b: number } | undefined;
        const fake = new FakeStreamModel([
            [
                new AIMessageChunk({
                    content: "",
                    tool_call_chunks: [{ name: "adder", args: '{"a":1,', id: "c1", index: 0 }],
                }),
                new AIMessageChunk({
                    content: "",
                    tool_call_chunks: [{ args: '"b":2}', index: 0 }],
                }),
            ],
            [new AIMessageChunk({ content: "done" })],
        ]);
        const agent = agentWithFakeModel(fake);

        const stream = await agent.stream(HUMAN_MESSAGE, "t1", "u1", undefined, {
            tools: [adderTool((input) => (executedWith = input))],
        });
        await collect(stream);

        expect(executedWith).toEqual({ a: 1, b: 2 });
    });

    it("throws once the tool-iteration budget is exhausted", async () => {
        // The model always requests another tool call, never settling.
        const fake = new FakeStreamModel([
            [new AIMessageChunk({ content: "", tool_calls: [{ name: "adder", args: { a: 1, b: 1 }, id: "c" }] })],
        ]);
        const agent = agentWithFakeModel(fake);

        const stream = await agent.stream(HUMAN_MESSAGE, "t1", "u1", undefined, { tools: [adderTool()] });
        await expect(collect(stream)).rejects.toThrow(/exceeded the maximum of 3 iterations/);
    });

    it("honours an abort signal triggered mid-loop", async () => {
        const controller = new AbortController();
        const fake = new FakeStreamModel([
            [new AIMessageChunk({ content: "", tool_calls: [{ name: "adder", args: { a: 1, b: 2 }, id: "c1" }] })],
            [new AIMessageChunk({ content: "unreached" })],
        ]);
        const agent = agentWithFakeModel(fake);
        const tool: ITool = {
            name: "adder",
            description: "Adds and aborts.",
            schema: z.object({ a: z.number(), b: z.number() }),
            execute: () => {
                controller.abort(new Error("cancelled by caller"));
                return Promise.resolve("3");
            },
        };

        const stream = await agent.stream(HUMAN_MESSAGE, "t1", "u1", controller.signal, { tools: [tool] });
        await expect(collect(stream)).rejects.toThrow(/cancelled by caller/);
    });

    it("does not run the loop when no tools are supplied", async () => {
        const fake = new FakeStreamModel([[new AIMessageChunk({ content: "Hello." })]]);
        const agent = agentWithFakeModel(fake);

        const stream = await agent.stream(HUMAN_MESSAGE, "t1", "u1");
        const chunks = await collect(stream);

        expect(chunks.some((c) => c.type === "tool-call")).toBe(false);
        expect(chunks.some((c) => c.type === "text-delta" && c.delta === "Hello.")).toBe(true);
        expect(fake.streamedMessages).toHaveLength(1);
    });
});

describe("agentMessagesToBaseMessages tool-part round-trip", () => {
    it("serializes persisted tool-call and tool-result parts to LangChain messages", () => {
        const messages: AgentMessage[] = [
            { role: "human", content: [{ type: "text", text: "add 1 and 2" }] },
            {
                role: "ai",
                content: [
                    { type: "text", text: "Let me add those." },
                    { type: "tool-call", toolCallId: "c1", toolName: "adder", args: { a: 1, b: 2 } },
                    { type: "tool-result", toolCallId: "c1", toolName: "adder", result: "3", isError: false },
                    { type: "text", text: "The answer is 3." },
                ],
            },
        ];

        const base = agentMessagesToBaseMessages(messages);

        const aiMsg = base.find((m): m is AIMessage => m instanceof AIMessage);
        const toolMsg = base.find((m): m is ToolMessage => m instanceof ToolMessage);
        expect(aiMsg?.tool_calls).toHaveLength(1);
        expect(aiMsg?.tool_calls?.[0]).toMatchObject({ name: "adder", args: { a: 1, b: 2 }, id: "c1" });
        expect(toolMsg?.content).toBe("3");
        expect(toolMsg?.tool_call_id).toBe("c1");
        expect(toolMsg?.status).toBe("success");
    });

    it("marks failed tool results as error tool messages", () => {
        const messages: AgentMessage[] = [
            {
                role: "ai",
                content: [
                    { type: "tool-call", toolCallId: "c2", toolName: "boom", args: {} },
                    { type: "tool-result", toolCallId: "c2", toolName: "boom", result: "failed", isError: true },
                ],
            },
        ];

        const base = agentMessagesToBaseMessages(messages);
        const toolMsg = base.find((m): m is ToolMessage => m instanceof ToolMessage);
        expect(toolMsg?.status).toBe("error");
    });
});

describe("AnthropicAgent default tools and system prompt", () => {
    it("applies default tools when a call omits its own", async () => {
        let executedWith: { a: number; b: number } | undefined;
        const fake = new FakeStreamModel([
            [new AIMessageChunk({ content: "", tool_calls: [{ name: "adder", args: { a: 1, b: 2 }, id: "c1" }] })],
            [new AIMessageChunk({ content: "done" })],
        ]);
        const agent = agentWith(fake, { defaultTools: [adderTool((input) => (executedWith = input))] });

        await collect(await agent.stream(HUMAN_MESSAGE, "t1", "u1"));

        expect(executedWith).toEqual({ a: 1, b: 2 });
    });

    it("lets a call's tools fully replace the defaults", async () => {
        let defaultRan = false;
        let perCallRan = false;
        const defaultTool: ITool = {
            name: "adder",
            description: "Default adder.",
            schema: z.object({ a: z.number(), b: z.number() }),
            execute: () => {
                defaultRan = true;
                return Promise.resolve("default");
            },
        };
        const perCallTool: ITool = {
            name: "adder",
            description: "Per-call adder.",
            schema: z.object({ a: z.number(), b: z.number() }),
            execute: () => {
                perCallRan = true;
                return Promise.resolve("per-call");
            },
        };
        const fake = new FakeStreamModel([
            [new AIMessageChunk({ content: "", tool_calls: [{ name: "adder", args: { a: 1, b: 2 }, id: "c1" }] })],
            [new AIMessageChunk({ content: "done" })],
        ]);
        const agent = agentWith(fake, { defaultTools: [defaultTool] });

        await collect(await agent.stream(HUMAN_MESSAGE, "t1", "u1", undefined, { tools: [perCallTool] }));

        expect(perCallRan).toBe(true);
        expect(defaultRan).toBe(false);
    });

    it("prepends the default system prompt when a call omits its own", async () => {
        const fake = new FakeStreamModel([[new AIMessageChunk({ content: "Hi." })]]);
        const agent = agentWith(fake, { defaultSystemPrompt: "You are the default." });

        await collect(await agent.stream(HUMAN_MESSAGE, "t1", "u1"));

        const first = fake.streamedMessages[0]?.[0];
        expect(first).toBeInstanceOf(SystemMessage);
        expect(first?.content).toBe("You are the default.");
    });

    it("lets a call's system prompt override the default", async () => {
        const fake = new FakeStreamModel([[new AIMessageChunk({ content: "Hi." })]]);
        const agent = agentWith(fake, { defaultSystemPrompt: "You are the default." });

        await collect(await agent.stream(HUMAN_MESSAGE, "t1", "u1", undefined, { systemPrompt: "Override prompt." }));

        const first = fake.streamedMessages[0]?.[0];
        expect(first).toBeInstanceOf(SystemMessage);
        expect(first?.content).toBe("Override prompt.");
    });
});
