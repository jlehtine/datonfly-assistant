import { describe, it } from "vitest";

import {
    collectChunks,
    CONFORMANCE_CASES,
    serveFixtures,
    type FixtureServer,
} from "@datonfly-assistant/agent-anthropic/testing";
import type { ITool } from "@datonfly-assistant/core";

import { AnthropicAgent } from "./agent.js";

/**
 * Measure the outgoing LangChain provider against the conformance suite.
 *
 * `agent-langchain` is being deleted, so failures here are not defects to fix.
 * The purpose is to know exactly where the two providers diverge before the
 * cutover, so a behaviour change is never mistaken for a regression later.
 * Divergences are reported rather than asserted, and the catalogue is recorded
 * in `TODO.md`.
 */
function createAgent(baseUrl: string, tools?: ITool[]): AnthropicAgent {
    return new AnthropicAgent({
        modelName: "claude-opus-5",
        apiKey: "sk-ant-test",
        baseUrl,
        ...(tools ? { defaultTools: tools } : {}),
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

describe("agent-langchain conformance comparison", () => {
    for (const testCase of CONFORMANCE_CASES) {
        it(`reports divergence: ${testCase.name}`, async () => {
            const outcome = await withServer(testCase.fixtures, async (server) => {
                const agent = createAgent(server.baseUrl, testCase.tools);
                try {
                    const chunks = await collectChunks(agent, testCase.messages);
                    testCase.check(chunks);
                    return "matches";
                } catch (error) {
                    return `DIVERGES — ${error instanceof Error ? error.message : String(error)}`;
                }
            });
             
            console.info(`[conformance] ${testCase.name}: ${outcome}`);
        });
    }
});
