/**
 * Live experiment: does provider-side compaction fire transparently when
 * `pauseAfterCompaction` is left unset (the default)?
 *
 * Anthropic's docs describe two modes for `compact_20260112`:
 *   - default (`pause_after_compaction` unset/false): compaction happens
 *     inside the same request — the response contains the `compaction` block
 *     followed by the model's actual answer, under the turn's normal
 *     `stop_reason`.
 *   - `pause_after_compaction: true`: the API stops immediately after the
 *     `compaction` block with `stop_reason: "compaction"` and nothing else,
 *     requiring a second request to get an answer.
 *
 * This had never been tested here: every earlier capture set
 * `pauseAfterCompaction: true` from the start, so it was never established
 * whether the transparent default path fires at all against a real
 * conversation. This script runs both configurations back to back against the
 * same conversation and reports what actually came back on the wire.
 *
 * Usage (from the repository root), a real, billable API call:
 *
 *     pnpm --filter @datonfly-assistant/agent-anthropic experiment:compaction
 *
 * `ANTHROPIC_API_KEY` and the model are read from the environment or the root
 * `.env`, matching `record-fixtures.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentMessage } from "@datonfly-assistant/core";

import { AnthropicAgent } from "../agent.js";
import type { AnthropicProviderOptions } from "../config.js";
import { startRecordingProxy, type RecordedExchange } from "./recording-proxy.js";

function findRepoRoot(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
        const parent = dirname(dir);
        if (parent === dir) {
            throw new Error("Could not locate the workspace root (no pnpm-workspace.yaml found).");
        }
        dir = parent;
    }
    return dir;
}

const REPO_ROOT = findRepoRoot();

/** Read a setting from the process environment, falling back to the root `.env`. */
function readSetting(name: string): string | undefined {
    const fromEnv = process.env[name];
    if (fromEnv) return fromEnv;
    const envFile = join(REPO_ROOT, ".env");
    if (!existsSync(envFile)) return undefined;
    for (const line of readFileSync(envFile, "utf-8").split("\n")) {
        const match = new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`).exec(line);
        if (match?.[1]) return match[1].replace(/^["']|["']$/g, "");
    }
    return undefined;
}

function loadApiKey(): string {
    const value = readSetting("ANTHROPIC_API_KEY");
    if (!value) throw new Error("ANTHROPIC_API_KEY is not set (checked the environment and the root .env).");
    return value;
}

function resolveModel(): string {
    const model = readSetting("DF_AGENT_MODEL");
    if (!model) throw new Error("No model selected. Set DF_AGENT_MODEL in the environment or .env.");
    return model;
}

/** Smallest `trigger.value` the compaction API accepts. */
const COMPACTION_MIN_TRIGGER_TOKENS = 50_000;

/** Filler for one conversation turn; several turns together cross the trigger. */
const LOG_CHUNK = "log line\n".repeat(4_000);

/**
 * A conversation large enough for compaction to have something to compact.
 *
 * Compaction replaces *earlier* turns with a summary, so a single oversized
 * message crosses the trigger without producing any edit — the history has to
 * be spread across turns. Matches the shape of the `compaction` fixture
 * scenario in `record-fixtures.ts`.
 */
function compactionConversation(): AgentMessage[] {
    const messages: AgentMessage[] = [];
    for (let batch = 1; batch <= 6; batch++) {
        messages.push({
            role: "human",
            content: [{ type: "text", text: `Log batch ${String(batch)}:\n${LOG_CHUNK}` }],
        });
        messages.push({ role: "ai", content: [{ type: "text", text: `Recorded batch ${String(batch)}.` }] });
    }
    messages.push({ role: "human", content: [{ type: "text", text: "How many log batches did I send?" }] });
    return messages;
}

/** Parsed facts about one raw SSE exchange, independent of how the agent interpreted it. */
interface ExchangeFacts {
    status: number;
    stopReason: string | undefined;
    contentBlockTypes: string[];
    compactionBlockContent: string | null | undefined;
    usageIterationTypes: string[] | undefined;
    topLevelInputTokens: number | undefined;
    topLevelOutputTokens: number | undefined;
}

/** Extract the facts this experiment cares about from a recorded SSE body. */
function parseExchange(exchange: RecordedExchange): ExchangeFacts {
    const contentBlockTypes: string[] = [];
    let stopReason: string | undefined;
    let compactionBlockContent: string | null | undefined;
    let usageIterationTypes: string[] | undefined;
    let topLevelInputTokens: number | undefined;
    let topLevelOutputTokens: number | undefined;

    for (const line of exchange.response.body.split("\n")) {
        if (!line.startsWith("data:")) continue;
        let event: Record<string, unknown>;
        try {
            event = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
        } catch {
            continue;
        }

        if (event.type === "content_block_start") {
            const block = event.content_block as Record<string, unknown>;
            contentBlockTypes.push(String(block.type));
            if (block.type === "compaction") {
                compactionBlockContent = block.content as string | null;
            }
        } else if (event.type === "content_block_delta") {
            const delta = event.delta as Record<string, unknown>;
            if (delta.type === "compaction_delta") {
                compactionBlockContent = (delta.content as string | undefined) ?? compactionBlockContent;
            }
        } else if (event.type === "message_start") {
            const usage = (event.message as Record<string, unknown>).usage as Record<string, unknown>;
            topLevelInputTokens = usage.input_tokens as number | undefined;
            topLevelOutputTokens = usage.output_tokens as number | undefined;
        } else if (event.type === "message_delta") {
            stopReason = (event.delta as Record<string, unknown>).stop_reason as string | undefined;
            const usage = event.usage as Record<string, unknown> | undefined;
            if (usage) {
                topLevelInputTokens = (usage.input_tokens as number | undefined) ?? topLevelInputTokens;
                topLevelOutputTokens = (usage.output_tokens as number | undefined) ?? topLevelOutputTokens;
                const iterations = usage.iterations as Record<string, unknown>[] | null | undefined;
                if (iterations) {
                    usageIterationTypes = iterations.map((iteration) => String(iteration.type));
                }
            }
        }
    }

    return {
        status: exchange.response.status,
        stopReason,
        contentBlockTypes,
        compactionBlockContent,
        usageIterationTypes,
        topLevelInputTokens,
        topLevelOutputTokens,
    };
}

/** Run one configuration against the compaction conversation and report the raw facts. */
async function runConfiguration(
    label: string,
    apiKey: string,
    model: string,
    providerOptions: AnthropicProviderOptions,
): Promise<void> {
    process.stdout.write(`\n=== ${label} ===\n`);
    process.stdout.write(`providerOptions: ${JSON.stringify(providerOptions)}\n`);

    const proxy = await startRecordingProxy({ apiKey });
    proxy.setScenario(label);
    try {
        const agent = new AnthropicAgent({
            modelName: model,
            apiKey,
            baseUrl: proxy.url,
            maxTokens: 200,
            providerOptions,
        });

        const controller = new AbortController();
        const chunkTypes: string[] = [];
        let compactionOpaquePart: unknown;
        try {
            const stream = await agent.stream(
                compactionConversation(),
                "experiment-thread",
                "experiment-user",
                controller.signal,
            );
            for await (const chunk of stream) {
                chunkTypes.push(chunk.type);
                if (chunk.type === "opaque-part" && chunk.part.provider === "anthropic") {
                    const data = chunk.part.data as { type?: string };
                    if (data.type === "compaction") compactionOpaquePart = chunk.part;
                }
            }
        } catch (error) {
            process.stdout.write(`  agent.stream() threw: ${error instanceof Error ? error.message : String(error)}\n`);
        }

        await proxy.idle();
        const exchanges = proxy.pending(label);
        process.stdout.write(`  HTTP exchanges made: ${String(exchanges.length)}\n`);

        exchanges.forEach((exchange, index) => {
            const facts = parseExchange(exchange);
            process.stdout.write(`  --- exchange ${String(index + 1)} ---\n`);
            process.stdout.write(`    status: ${String(facts.status)}\n`);
            process.stdout.write(`    stop_reason: ${String(facts.stopReason)}\n`);
            process.stdout.write(`    content block types (in order): ${JSON.stringify(facts.contentBlockTypes)}\n`);
            process.stdout.write(
                `    compaction block present: ${String(facts.compactionBlockContent !== undefined)}` +
                    (facts.compactionBlockContent !== undefined
                        ? `, content length: ${String(facts.compactionBlockContent?.length ?? 0)}`
                        : "") +
                    "\n",
            );
            process.stdout.write(
                `    top-level usage: input=${String(facts.topLevelInputTokens)} output=${String(facts.topLevelOutputTokens)}\n`,
            );
            process.stdout.write(`    usage.iterations types: ${JSON.stringify(facts.usageIterationTypes)}\n`);
        });

        process.stdout.write(`  agent-level AgentStreamChunk types emitted: ${JSON.stringify(chunkTypes)}\n`);
        process.stdout.write(
            `  agent-level compaction opaque-part emitted: ${String(compactionOpaquePart !== undefined)}\n`,
        );
        if (compactionOpaquePart !== undefined) {
            process.stdout.write(`  agent-level compaction opaque-part: ${JSON.stringify(compactionOpaquePart)}\n`);
        }
    } finally {
        await proxy.close();
    }
}

async function main(): Promise<void> {
    const apiKey = loadApiKey();
    const model = resolveModel();
    process.stdout.write(`Running compaction experiment with model ${model}\n`);
    process.stdout.write(
        "Real, billable API calls. Two configurations against the same 6-batch log conversation " +
            `(~72k input tokens, trigger set to the API minimum of ${String(COMPACTION_MIN_TRIGGER_TOKENS)}).\n`,
    );

    await runConfiguration("transparent (pauseAfterCompaction unset)", apiKey, model, {
        enableCompaction: true,
        compactionTriggerTokens: COMPACTION_MIN_TRIGGER_TOKENS,
    });

    await runConfiguration("paused (pauseAfterCompaction: true)", apiKey, model, {
        enableCompaction: true,
        compactionTriggerTokens: COMPACTION_MIN_TRIGGER_TOKENS,
        pauseAfterCompaction: true,
    });
}

main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
});
