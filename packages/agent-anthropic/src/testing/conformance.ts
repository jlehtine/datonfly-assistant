import assert from "node:assert/strict";

import type {
    AgentMessage,
    AgentStreamChunk,
    GeneratedFileChunk,
    IAgentProvider,
    ITool,
    TextDeltaChunk,
} from "@datonfly-assistant/core";

/**
 * How a conformance case obtains a provider.
 *
 * The suite starts the fixture servers and hands over a base URL, so it stays
 * provider-neutral: any {@link IAgentProvider} that speaks the Anthropic wire
 * format can be measured against the same expectations.
 */
export interface ConformanceHarness {
    /** Build a provider pointed at the replay server. */
    createAgent(options: { baseUrl: string; tools?: ITool[] | undefined }): IAgentProvider;
}

/** A single conformance expectation. */
export interface ConformanceCase {
    /** Human-readable case name. */
    name: string;
    /** Fixtures served, in request order. */
    fixtures: string[];
    /** Tools the provider is configured with. */
    tools?: ITool[] | undefined;
    /** Messages sent to the provider. */
    messages: AgentMessage[];
    /** Assert the emitted chunk sequence. Throws on violation. */
    check(chunks: AgentStreamChunk[]): void;
}

/** Collect every chunk a provider emits for a call. */
export async function collectChunks(
    agent: IAgentProvider,
    messages: AgentMessage[],
    signal?: AbortSignal,
): Promise<AgentStreamChunk[]> {
    const stream = await agent.stream(messages, "thread-1", "user-1", signal);
    const chunks: AgentStreamChunk[] = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    return chunks;
}

/** All text deltas, in emission order. */
function textDeltas(chunks: AgentStreamChunk[]): TextDeltaChunk[] {
    return chunks.filter((chunk): chunk is TextDeltaChunk => chunk.type === "text-delta" && chunk.partType === "text");
}

/** All thinking deltas, in emission order. */
function thinkingDeltas(chunks: AgentStreamChunk[]): TextDeltaChunk[] {
    return chunks.filter(
        (chunk): chunk is TextDeltaChunk => chunk.type === "text-delta" && chunk.partType === "thinking",
    );
}

/** All generated-file chunks, in emission order. */
function generatedFileChunks(chunks: AgentStreamChunk[]): GeneratedFileChunk[] {
    return chunks.filter((chunk): chunk is GeneratedFileChunk => chunk.type === "generated-file");
}

/**
 * Assert that text/thinking part indices never move backwards across the
 * stream. Text and thinking share one increasing counter (see `stream.ts`), so
 * this is what "a part index is never resumed once a later one has been used"
 * — i.e. a real ordering, not just a bag of parts — reduces to.
 */
function assertPartIndicesNeverDecrease(chunks: AgentStreamChunk[]): void {
    const indices = chunks
        .filter((chunk): chunk is TextDeltaChunk => chunk.type === "text-delta")
        .map((chunk) => chunk.partIndex);
    for (let i = 1; i < indices.length; i++) {
        assert.ok(
            (indices[i] ?? 0) >= (indices[i - 1] ?? 0),
            `part index must never decrease (saw ${String(indices[i - 1])} then ${String(indices[i])})`,
        );
    }
}

/** Concatenate all text deltas in emission order. */
export function joinText(chunks: AgentStreamChunk[]): string {
    return textDeltas(chunks)
        .map((chunk) => chunk.delta)
        .join("");
}

/** A user message carrying a single text part. */
export function userMessage(text: string): AgentMessage {
    return { role: "human", content: [{ type: "text", text }] };
}

/** Tool used by the tool-loop conformance case, matching the recorded fixtures. */
export const ADDER_TOOL: ITool = {
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

/**
 * Behavioural contract every agent provider must satisfy.
 *
 * These are the guarantees `chat-server` relies on. Asserting them against each
 * provider is what makes the provider seam verifiable rather than aspirational:
 * a second provider is interchangeable exactly insofar as it passes this suite.
 */
export const CONFORMANCE_CASES: ConformanceCase[] = [
    {
        name: "streams text deltas and reports usage last",
        fixtures: ["plain-text"],
        messages: [userMessage("Say hello.")],
        check(chunks: AgentStreamChunk[]): void {
            assert.ok(joinText(chunks).length > 0, "expected streamed text");

            const usageIndex = chunks.findIndex((chunk) => chunk.type === "usage");
            assert.notEqual(usageIndex, -1, "expected a usage chunk");
            assert.equal(usageIndex, chunks.length - 1, "usage must be the final chunk");

            const usage = chunks[usageIndex];
            assert.ok(usage?.type === "usage");
            assert.ok(usage.usage.inputTokens > 0, "expected input token count");
            assert.ok(usage.usage.outputTokens > 0, "expected output token count");
            assert.equal(usage.usage.vendor, "anthropic");

            assertPartIndicesNeverDecrease(chunks);
        },
    },
    {
        name: "emits thinking deltas and a matching complete thinking part",
        fixtures: ["thinking-summarized"],
        messages: [userMessage("Think about this, then answer.")],
        check(chunks: AgentStreamChunk[]): void {
            const deltas = thinkingDeltas(chunks);
            assert.ok(deltas.length > 0, "expected thinking deltas");

            const parts = chunks.filter((chunk) => chunk.type === "thinking-part");
            assert.ok(parts.length > 0, "expected a complete thinking part");

            // Every thinking delta must belong to a part that is later completed,
            // otherwise the transcript cannot reconcile the two.
            const deltaIndices = new Set(deltas.map((chunk) => chunk.partIndex));
            const partIndices = new Set(parts.map((chunk) => chunk.partIndex));
            for (const index of deltaIndices) {
                assert.ok(partIndices.has(index), `thinking delta part ${String(index)} was never completed`);
            }

            // Thinking and text must not collide on a part index.
            for (const chunk of textDeltas(chunks)) {
                assert.ok(!deltaIndices.has(chunk.partIndex), "text and thinking must not share a part index");
            }

            const accumulated = deltas.map((chunk) => chunk.delta).join("");
            const completed = parts.map((chunk) => chunk.part.text).join("");
            assert.equal(completed, accumulated, "completed thinking must equal the streamed deltas");
        },
    },
    {
        name: "pairs every tool call with a result and continues the loop",
        fixtures: ["tool-loop-01", "tool-loop-02", "tool-loop-03"],
        tools: [ADDER_TOOL],
        messages: [userMessage("Add 2 and 3, then add 10 to the result.")],
        check(chunks: AgentStreamChunk[]): void {
            const calls = chunks.filter((chunk) => chunk.type === "tool-call");
            const results = chunks.filter((chunk) => chunk.type === "tool-result");
            assert.ok(calls.length > 0, "expected at least one tool call");
            assert.equal(calls.length, results.length, "every tool call needs a result");

            for (const [i, call] of calls.entries()) {
                const result = results[i];
                assert.ok(result, "missing tool result");
                assert.equal(result.toolCallId, call.toolCallId, "result must correlate with its call");
                assert.equal(result.toolName, call.toolName);
                assert.ok(chunks.indexOf(call) < chunks.indexOf(result), "a call must precede its result");
            }

            const usageIndex = chunks.findIndex((chunk) => chunk.type === "usage");
            assert.equal(usageIndex, chunks.length - 1, "usage must be the final chunk");
        },
    },
    {
        // `01`/`02` each answer with text then a tool call; `03` answers with
        // text only. Each turn's text must land in its own part — the primary
        // guard that a tool call actually splits text into multiple parts.
        name: "splits text into a new part around each tool-call turn",
        fixtures: ["tool-loop-01", "tool-loop-02", "tool-loop-03"],
        tools: [ADDER_TOOL],
        messages: [userMessage("Add 2 and 3, then add 10 to the result.")],
        check(chunks: AgentStreamChunk[]): void {
            assertPartIndicesNeverDecrease(chunks);
            const distinct = new Set(textDeltas(chunks).map((chunk) => chunk.partIndex));
            assert.equal(distinct.size, 3, "expected one text part per loop turn");
        },
    },
    {
        name: "reports server-tool activity as status and collects citations",
        fixtures: ["web-search"],
        messages: [userMessage("Search the web and cite a source.")],
        check(chunks: AgentStreamChunk[]): void {
            const statuses = chunks.filter((chunk) => chunk.type === "status");
            assert.ok(statuses.length > 0, "expected server-tool status updates");
            assert.ok(
                statuses.some((chunk) => chunk.status === "tool_web_search"),
                "expected a web search status",
            );

            for (const chunk of chunks.filter((candidate) => candidate.type === "citations")) {
                for (const citation of chunk.citations) {
                    assert.ok(citation.url.length > 0, "citations need a URL");
                    assert.ok(citation.title.length > 0, "citations need a title");
                }
                const urls = chunk.citations.map((citation) => citation.url);
                assert.equal(new Set(urls).size, urls.length, "citations must be deduplicated");
            }

            // The fixture's response spans 8 separate API `text` blocks (citation
            // spans split them). None of that is a part boundary, so they must
            // still merge into one text part rather than fragmenting the answer.
            const distinct = new Set(textDeltas(chunks).map((chunk) => chunk.partIndex));
            assert.equal(distinct.size, 1, "citation-split text blocks must merge into one part");
        },
    },
    {
        // Server-tool blocks (`server_tool_use` / its result) are not a part
        // boundary, so the text before and after the code-execution activity in
        // this fixture must merge into one part. The generated file is placed at
        // end of turn (D2), i.e. after that merged text part, not between the
        // two text blocks it actually occurred between.
        name: "does not split text around server-tool activity, and places the file after it",
        fixtures: ["code-execution-with-file"],
        messages: [userMessage("Write a minimal Python script that outputs Fibonacci numbers sequence.")],
        check(chunks: AgentStreamChunk[]): void {
            assertPartIndicesNeverDecrease(chunks);

            const deltas = textDeltas(chunks);
            const distinct = new Set(deltas.map((chunk) => chunk.partIndex));
            assert.equal(distinct.size, 1, "text around server-tool activity must merge into one part");

            const files = generatedFileChunks(chunks);
            assert.equal(files.length, 1, "expected exactly one generated file");
            const fileIndex = chunks.indexOf(files[0] as AgentStreamChunk);
            const lastTextDeltaIndex = chunks.lastIndexOf(deltas[deltas.length - 1] as AgentStreamChunk);
            assert.ok(fileIndex > lastTextDeltaIndex, "the generated file must be emitted after all text deltas");
        },
    },
    {
        // Adaptive thinking with a summarized display can return a thinking block
        // carrying only a signature. That must not surface as an empty part.
        name: "ignores a thinking block that carries no reasoning text",
        fixtures: ["thinking-adaptive"],
        messages: [userMessage("Think about this, then answer.")],
        check(chunks: AgentStreamChunk[]): void {
            assert.ok(joinText(chunks).length > 0, "expected streamed text");
            assert.equal(
                chunks.filter((chunk) => chunk.type === "thinking-part").length,
                0,
                "an empty thinking block must not produce a part",
            );
            assert.equal(thinkingDeltas(chunks).length, 0, "an empty thinking block must not produce deltas");
        },
    },
];
