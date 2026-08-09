import { describe, it } from "vitest";

import { AnthropicAgent as SdkAgent } from "@datonfly-assistant/agent-anthropic";
import {
    ADDER_TOOL,
    collectChunks,
    serveFixtures,
    userMessage,
    type FixtureServer,
} from "@datonfly-assistant/agent-anthropic/testing";
import type { AgentMessage, AgentStreamChunk, IAgentProvider, ITool } from "@datonfly-assistant/core";

import { AnthropicAgent as LangChainAgent } from "./agent.js";

/**
 * Diff the chunk sequences the two providers emit for identical input.
 *
 * `agent-langchain` is being deleted, so a difference here is not a defect to
 * fix in it. The point is to enumerate every behavioural change the cutover
 * introduces, so none of them is mistaken for a regression afterwards. The
 * conformance suite is deliberately coarse — it pins the contract, not the byte
 * sequence — which is why this comparison exists alongside it.
 */

interface Scenario {
    name: string;
    fixtures: string[];
    messages: AgentMessage[];
    tools?: ITool[] | undefined;
}

const SCENARIOS: Scenario[] = [
    { name: "plain-text", fixtures: ["plain-text"], messages: [userMessage("Say hello.")] },
    { name: "thinking-summarized", fixtures: ["thinking-summarized"], messages: [userMessage("Think, then answer.")] },
    { name: "thinking-adaptive", fixtures: ["thinking-adaptive"], messages: [userMessage("Think, then answer.")] },
    {
        name: "tool-loop",
        fixtures: ["tool-loop-01", "tool-loop-02", "tool-loop-03"],
        messages: [userMessage("Add 2 and 3, then add 10.")],
        tools: [ADDER_TOOL],
    },
    { name: "web-search", fixtures: ["web-search"], messages: [userMessage("Search and cite a source.")] },
    { name: "web-fetch", fixtures: ["web-fetch"], messages: [userMessage("Fetch that page.")] },
    { name: "code-execution", fixtures: ["code-execution"], messages: [userMessage("Compute something.")] },
    { name: "attachment-text", fixtures: ["attachment-text"], messages: [userMessage("Review the attachment.")] },
];

/** Reduce a chunk to a comparable signature, collapsing delta granularity. */
function signature(chunk: AgentStreamChunk): string {
    switch (chunk.type) {
        case "text-delta":
            return `text-delta:${chunk.partType}:${String(chunk.partIndex)}`;
        case "thinking-part":
            return `thinking-part:${String(chunk.partIndex)}:${String(chunk.part.text.length)}`;
        case "opaque-part":
            return `opaque-part:${String(chunk.partIndex)}`;
        case "status":
            return `status:${chunk.status}`;
        case "citations":
            return `citations:${String(chunk.citations.length)}`;
        case "tool-call":
            return `tool-call:${chunk.toolName}`;
        case "tool-result":
            return `tool-result:${chunk.toolName}:${String(chunk.isError ?? false)}`;
        case "usage":
            return `usage:in=${String(chunk.usage.inputTokens)}:out=${String(chunk.usage.outputTokens)}`;
    }
}

/** Collapse runs of identical signatures, so delta counts do not dominate the diff. */
function collapse(chunks: AgentStreamChunk[]): string[] {
    const out: string[] = [];
    for (const chunk of chunks) {
        const sig = signature(chunk);
        if (out[out.length - 1] !== sig) out.push(sig);
    }
    return out;
}

/** Concatenate text deltas, to compare the visible answer independent of chunking. */
function text(chunks: AgentStreamChunk[]): string {
    return chunks
        .filter((chunk) => chunk.type === "text-delta" && chunk.partType === "text")
        .map((chunk) => (chunk.type === "text-delta" ? chunk.delta : ""))
        .join("");
}

async function withServer<T>(names: string[], fn: (server: FixtureServer) => Promise<T>): Promise<T> {
    const server = await serveFixtures(...names);
    try {
        return await fn(server);
    } finally {
        await server.close();
    }
}

async function runProvider(
    scenario: Scenario,
    build: (baseUrl: string, tools?: ITool[]) => IAgentProvider,
): Promise<{ chunks: AgentStreamChunk[]; requests: Record<string, unknown>[] } | { error: string }> {
    try {
        return await withServer(scenario.fixtures, async (server) => {
            const chunks = await collectChunks(build(server.baseUrl, scenario.tools), scenario.messages);
            return { chunks, requests: server.requests };
        });
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Compare the first request each provider sends.
 *
 * Replaying fixtures returns the same bytes whatever was asked for, so a
 * response diff cannot see a change in what goes *out*. Request parameters are
 * where a silent behaviour change would hide.
 */
function requestDifferences(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
    const describe = (source: Record<string, unknown>, key: string): string =>
        key in source ? JSON.stringify(source[key]) : "absent";
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const differences: string[] = [];
    for (const key of keys) {
        if (key === "messages") continue;
        const left = describe(a, key);
        const right = describe(b, key);
        if (left !== right) {
            differences.push(`  ${key}: langchain=${left} sdk=${right}`);
        }
    }
    return differences;
}

function buildLangChain(baseUrl: string, tools?: ITool[]): IAgentProvider {
    return new LangChainAgent({
        modelName: "claude-opus-5",
        apiKey: "sk-ant-test",
        baseUrl,
        ...(tools ? { defaultTools: tools } : {}),
    });
}

function buildSdk(baseUrl: string, tools?: ITool[]): IAgentProvider {
    return new SdkAgent({
        modelName: "claude-opus-5",
        apiKey: "sk-ant-test",
        baseUrl,
        ...(tools ? { defaultTools: tools } : {}),
        providerOptions: { maxRetries: 0, disableCaching: true },
    });
}

describe("provider chunk-sequence comparison", () => {
    for (const scenario of SCENARIOS) {
        it(`compares ${scenario.name}`, async () => {
            const langchain = await runProvider(scenario, buildLangChain);
            const sdk = await runProvider(scenario, buildSdk);
            const report: string[] = [];

            if ("error" in langchain || "error" in sdk) {
                report.push(
                    `langchain=${"error" in langchain ? `ERROR ${langchain.error}` : "ok"}`,
                    `sdk=${"error" in sdk ? `ERROR ${sdk.error}` : "ok"}`,
                );
            } else {
                const a = collapse(langchain.chunks);
                const b = collapse(sdk.chunks);
                if (a.join("|") !== b.join("|")) {
                    report.push(`sequence differs`, `  langchain: ${a.join(" ")}`, `  sdk:       ${b.join(" ")}`);
                }
                if (text(langchain.chunks) !== text(sdk.chunks)) {
                    report.push(
                        `visible text differs`,
                        `  langchain: ${JSON.stringify(text(langchain.chunks).slice(0, 120))}`,
                        `  sdk:       ${JSON.stringify(text(sdk.chunks).slice(0, 120))}`,
                    );
                }
                const first = langchain.requests[0];
                const second = sdk.requests[0];
                if (first && second) {
                    const differences = requestDifferences(first, second);
                    if (differences.length > 0) {
                        report.push(`request differs`, ...differences);
                    }
                }
            }

            console.info(
                report.length === 0
                    ? `[diff] ${scenario.name}: identical`
                    : `[diff] ${scenario.name}:\n${report.join("\n")}`,
            );
        });
    }
});
