import { describe, expect, it } from "vitest";

import type { AgentMessage, ITool } from "@datonfly-assistant/core";

import { AnthropicAgent } from "./agent.js";
import { ADDER_TOOL, collectChunks, CONFORMANCE_CASES, joinText, userMessage } from "./testing/conformance.js";
import { serveFixtures, type FixtureServer } from "./testing/fixture-server.js";

function createAgent(baseUrl: string, tools?: ITool[]): AnthropicAgent {
    return new AnthropicAgent({
        modelName: "claude-opus-5",
        apiKey: "sk-ant-test",
        baseUrl,
        ...(tools ? { defaultTools: tools } : {}),
        providerOptions: { maxRetries: 0, disableCaching: true },
    });
}

async function withServer<T>(names: string[], fn: (server: FixtureServer) => Promise<T>): Promise<T> {
    const server = await serveFixtures(...names);
    try {
        return await fn(server);
    } finally {
        await server.close();
    }
}

describe("AnthropicAgent conformance", () => {
    for (const testCase of CONFORMANCE_CASES) {
        it(testCase.name, async () => {
            await withServer(testCase.fixtures, async (server) => {
                const agent = createAgent(server.baseUrl, testCase.tools);
                const chunks = await collectChunks(agent, testCase.messages);
                testCase.check(chunks);
            });
        });
    }
});

describe("AnthropicAgent streaming", () => {
    it("sends the conversation as alternating turns", async () => {
        await withServer(["plain-text"], async (server) => {
            const agent = createAgent(server.baseUrl);
            await collectChunks(agent, [userMessage("Say hello.")]);

            const request = server.requests[0];
            expect(request).toBeDefined();
            expect(request?.model).toBe("claude-opus-5");
            expect(request?.stream).toBe(true);
            const messages = request?.messages as { role: string }[];
            expect(messages.map((message) => message.role)).toEqual(["user"]);
        });
    });

    it("merges consecutive human turns so the API sees alternating roles", async () => {
        await withServer(["plain-text"], async (server) => {
            const agent = createAgent(server.baseUrl);
            await collectChunks(agent, [
                userMessage("First question."),
                userMessage("Second question."),
                { role: "ai", content: [{ type: "text", text: "An answer." }] },
                userMessage("Third question."),
            ]);

            const messages = server.requests[0]?.messages as { role: string }[];
            expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
        });
    });

    it("hoists system messages into the system parameter", async () => {
        await withServer(["plain-text"], async (server) => {
            const agent = createAgent(server.baseUrl);
            await collectChunks(agent, [
                { role: "system", content: [{ type: "text", text: "Be terse." }] },
                userMessage("Say hello."),
            ]);

            const request = server.requests[0];
            expect(request?.system).toEqual([{ type: "text", text: "Be terse." }]);
            const messages = request?.messages as { role: string }[];
            expect(messages.map((message) => message.role)).toEqual(["user"]);
        });
    });

    it("replays the assistant turn verbatim before tool results", async () => {
        const adder: ITool = {
            name: "adder",
            description: "Adds two numbers and returns the sum.",
            inputSchema: {
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
            },
            execute: (input: unknown) => {
                const { a, b } = input as { a: number; b: number };
                return Promise.resolve(String(a + b));
            },
        };

        await withServer(["tool-loop-01", "tool-loop-02", "tool-loop-03"], async (server) => {
            const agent = createAgent(server.baseUrl, [adder]);
            await collectChunks(agent, [userMessage("Add 2 and 3, then add 10.")]);

            expect(server.requests.length).toBeGreaterThan(1);
            const second = server.requests[1]?.messages as { role: string; content: unknown }[];
            const assistantTurn = second.find((message) => message.role === "assistant");
            expect(assistantTurn).toBeDefined();

            // The replayed assistant turn must carry the tool_use block the model
            // produced, so the follow-up tool_result correlates on the wire.
            const blocks = assistantTurn?.content as { type: string }[];
            expect(blocks.some((block) => block.type === "tool_use")).toBe(true);

            const userTurn = second[second.length - 1];
            expect(userTurn?.role).toBe("user");
            const resultBlocks = userTurn?.content as { type: string }[];
            expect(resultBlocks.every((block) => block.type === "tool_result")).toBe(true);
        });
    });

    it("propagates an abort to the caller", async () => {
        await withServer(["plain-text"], async (server) => {
            const agent = createAgent(server.baseUrl);
            const controller = new AbortController();
            controller.abort();

            await expect(collectChunks(agent, [userMessage("Say hello.")], controller.signal)).rejects.toThrow();
        });
    });

    it("surfaces API errors to the caller", async () => {
        await withServer(["error-400"], async (server) => {
            const agent = createAgent(server.baseUrl);
            await expect(collectChunks(agent, [userMessage("Say hello.")])).rejects.toThrow();
        });
    });
});

describe("AnthropicAgent usage accounting", () => {
    // Anthropic splits the prompt across input_tokens (uncached), cache creation,
    // and cache read. inputTokens means context size — the gateway compares it
    // against the compaction threshold — so all three must be summed.
    it("reports input tokens as the whole submitted context", async () => {
        await withServer(["web-search"], async (server) => {
            const agent = createAgent(server.baseUrl);
            const chunks = await collectChunks(agent, [userMessage("Search the web.")]);

            const usage = chunks.find((chunk) => chunk.type === "usage");
            expect(usage?.type === "usage" ? usage.usage.inputTokens : 0).toBe(5903);
            expect(usage?.type === "usage" ? usage.usage.cacheCreationInputTokens : 0).toBe(5901);
        });
    });

    it("reports the final output token count, not the message_start placeholder", async () => {
        await withServer(["plain-text"], async (server) => {
            const agent = createAgent(server.baseUrl);
            const chunks = await collectChunks(agent, [userMessage("Say hello.")]);

            const usage = chunks.find((chunk) => chunk.type === "usage");
            expect(usage?.type === "usage" ? usage.usage.outputTokens : 0).toBe(9);
        });
    });

    it("sums output across a tool loop and keeps the largest context", async () => {
        await withServer(["tool-loop-01", "tool-loop-02", "tool-loop-03"], async (server) => {
            const agent = createAgent(server.baseUrl, [ADDER_TOOL]);
            const chunks = await collectChunks(agent, [userMessage("Add 2 and 3, then add 10.")]);

            const usage = chunks.find((chunk) => chunk.type === "usage");
            expect(usage?.type === "usage" ? usage.usage.inputTokens : 0).toBe(616);
            expect(usage?.type === "usage" ? usage.usage.outputTokens : 0).toBe(209);
        });
    });
});

describe("AnthropicAgent provider-side compaction", () => {
    it("resumes after a compaction pause and replays the block", async () => {
        await withServer(["compaction-01", "compaction-02"], async (server) => {
            const agent = createAgent(server.baseUrl);
            const chunks = await collectChunks(agent, [userMessage("How many log batches did I send?")]);

            // The first turn stops with stop_reason=compaction and answers nothing,
            // so the loop must continue rather than treat it as the final response.
            expect(server.requests).toHaveLength(2);
            expect(joinText(chunks).length).toBeGreaterThan(0);

            const opaque = chunks.filter((chunk) => chunk.type === "opaque-part");
            expect(opaque).toHaveLength(1);
            const part = opaque[0];
            expect(part?.type === "opaque-part" ? part.part.provider : "").toBe("anthropic");
            expect(part?.type === "opaque-part" ? (part.part.data as { type: string }).type : "").toBe("compaction");

            // The resumed request carries the compaction block, which stands in
            // for everything before it.
            const resumed = server.requests[1]?.messages as { role: string; content: unknown }[];
            const blocks = resumed.flatMap((message) =>
                Array.isArray(message.content) ? (message.content as { type: string }[]) : [],
            );
            expect(blocks.some((block) => block.type === "compaction")).toBe(true);
        });
    });

    it("reports context size from the compaction iteration, not the zeroed totals", async () => {
        await withServer(["compaction-01", "compaction-02"], async (server) => {
            const agent = createAgent(server.baseUrl);
            const chunks = await collectChunks(agent, [userMessage("How many log batches did I send?")]);

            // A compacting turn zeroes the top-level counts and reports the real
            // numbers under `iterations`.
            const usage = chunks.find((chunk) => chunk.type === "usage");
            expect(usage?.type === "usage" ? usage.usage.inputTokens : 0).toBeGreaterThan(50_000);
        });
    });
});

describe("AnthropicAgent.run", () => {
    it("returns the same text the stream emitted", async () => {
        const messages: AgentMessage[] = [userMessage("Say hello.")];

        const streamed = await withServer(["plain-text"], async (server) =>
            joinText(await collectChunks(createAgent(server.baseUrl), messages)),
        );
        const result = await withServer(["plain-text"], async (server) =>
            createAgent(server.baseUrl).run(messages, "thread-1", "user-1"),
        );

        const text = result.content.find((part) => part.type === "text");
        expect(text?.type === "text" ? text.text : "").toBe(streamed);
        expect(result.role).toBe("ai");
    });

    it("records tool calls and results as content parts", async () => {
        const adder: ITool = {
            name: "adder",
            description: "Adds two numbers and returns the sum.",
            inputSchema: {
                type: "object",
                properties: { a: { type: "number" }, b: { type: "number" } },
                required: ["a", "b"],
            },
            execute: () => Promise.resolve("5"),
        };

        await withServer(["tool-loop-01", "tool-loop-02", "tool-loop-03"], async (server) => {
            const agent = createAgent(server.baseUrl, [adder]);
            const result = await agent.run([userMessage("Add 2 and 3.")], "thread-1", "user-1");

            const calls = result.content.filter((part) => part.type === "tool-call");
            const results = result.content.filter((part) => part.type === "tool-result");
            expect(calls.length).toBeGreaterThan(0);
            expect(results.length).toBe(calls.length);
        });
    });
});

describe("AnthropicAgent capabilities", () => {
    it("reports provider compaction and configured server tools", () => {
        const agent = new AnthropicAgent({
            modelName: "claude-opus-5",
            apiKey: "sk-ant-test",
            providerOptions: { enableWebSearch: true, enableCodeExecution: true, thinkingType: "adaptive" },
        });

        expect(agent.capabilities).toEqual({
            compaction: "provider",
            webSearch: true,
            codeExecution: true,
            thinking: true,
            attachments: { images: true, pdf: true },
        });
    });

    it("reports no compaction when it is switched off", () => {
        const agent = new AnthropicAgent({
            modelName: "claude-opus-5",
            apiKey: "sk-ant-test",
            providerOptions: { enableCompaction: false },
        });

        expect(agent.capabilities.compaction).toBe("none");
        // Reasoning stays on: an unset thinking parameter accepts the API's
        // adaptive default rather than switching it off.
        expect(agent.capabilities.thinking).toBe(true);
    });
});
