import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { AnthropicAgent } from "../agent.js";
import { collectChunks, joinText, userMessage } from "./conformance.js";
import { startPlaybackServer, type PlaybackServer } from "./playback-server.js";

async function withPlayback<T>(fn: (server: PlaybackServer) => Promise<T>): Promise<T> {
    const server = await startPlaybackServer({ speed: 1000 });
    try {
        return await fn(server);
    } finally {
        await server.close();
    }
}

describe("startPlaybackServer", () => {
    it("replays the matching fixture for a raw request, paced as real chunked HTTP", async () => {
        await withPlayback(async (server) => {
            const client = new Anthropic({ apiKey: "sk-ant-test", baseURL: server.url });
            const stream = client.beta.messages.stream({
                model: "claude-opus-5",
                max_tokens: 100,
                stream: true,
                messages: [{ role: "user", content: "Say exactly: hello from the fixture." }],
            });
            const response = await stream.finalMessage();
            const text = response.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
            expect(text).toBe("hello from the fixture");
        });
    });

    it("drives a real AnthropicAgent through the fake API end to end", async () => {
        await withPlayback(async (server) => {
            const agent = new AnthropicAgent({
                modelName: "claude-opus-5",
                apiKey: "sk-ant-test",
                baseUrl: server.url,
                providerOptions: { maxRetries: 0, disableCaching: true },
            });
            const chunks = await collectChunks(agent, [
                userMessage("Search the web for the current stable Node.js LTS version and cite your source."),
            ]);
            expect(joinText(chunks).length).toBeGreaterThan(0);
            expect(chunks.some((chunk) => chunk.type === "status" && chunk.status === "tool_web_search")).toBe(true);
        });
    });

    it("falls back to the default scenario for unscripted conversation", async () => {
        await withPlayback(async (server) => {
            const agent = new AnthropicAgent({
                modelName: "claude-opus-5",
                apiKey: "sk-ant-test",
                baseUrl: server.url,
                providerOptions: { maxRetries: 0, disableCaching: true },
            });
            const chunks = await collectChunks(agent, [userMessage("Nothing in the fixture set mentions this.")]);
            expect(joinText(chunks)).toContain("hello from the fixture");
        });
    });

    it("reports a generated file and downloads its real bytes through the Files API fixtures", async () => {
        await withPlayback(async (server) => {
            const agent = new AnthropicAgent({
                modelName: "claude-opus-5",
                apiKey: "sk-ant-test",
                baseUrl: server.url,
                providerOptions: { maxRetries: 0, disableCaching: true },
            });
            const chunks = await collectChunks(agent, [
                userMessage(
                    "Write a minimal Python script that outputs Fibonacci numbers sequence and share it with me.",
                ),
            ]);

            const generatedFile = chunks.find((chunk) => chunk.type === "generated-file");
            expect(generatedFile?.fileRef).toBe("file_01FCiZjrYi2AHg9qV2XqhHXL");

            const file = await agent.fetchGeneratedFile(generatedFile?.fileRef ?? "");
            expect(file.filename).toBe("fibonacci.py");
            expect(file.mimeType).toBe("text/x-script.python");
            expect(new TextDecoder().decode(file.bytes)).toContain("def fib(n):");
        });
    });
});
