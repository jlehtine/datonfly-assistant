/**
 * Observational timing capture: drive a few real streaming calls through the
 * recording proxy (which now timestamps every chunk as `frames`) and report
 * typical pacing statistics, to replace the placeholder constants in
 * `testing/timing.ts` with numbers grounded in a real capture.
 *
 * This does not write fixtures — it only measures timing and prints it. Run it
 * whenever the synthesized model needs re-grounding; there is no need to keep
 * this data committed anywhere beyond the constants it produces.
 *
 * Usage (from the repository root), a real, billable API call:
 *
 *     pnpm --filter @datonfly-assistant/agent-anthropic experiment:timing
 *
 * `ANTHROPIC_API_KEY` and the model are read from the environment or the root
 * `.env`, matching `record-fixtures.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentMessage } from "@datonfly-assistant/core";

import { AnthropicAgent } from "../agent.js";
import { splitSseEvents } from "../testing/timing.js";
import { startRecordingProxy, type RecordedExchange } from "./recording-proxy.js";

function findRepoRoot(): string {
    let dir = dirname(fileURLToPath(import.meta.url));
    while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
        const parent = dirname(dir);
        if (parent === dir) throw new Error("Could not locate the workspace root (no pnpm-workspace.yaml found).");
        dir = parent;
    }
    return dir;
}

const REPO_ROOT = findRepoRoot();

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

function human(text: string): AgentMessage[] {
    return [{ role: "human", content: [{ type: "text", text }] }];
}

/**
 * Split each raw captured frame into individual SSE events, keeping the
 * frame's own timestamp for every event it bundled — a single network read
 * can carry several logical SSE events at once, and treating them as
 * simultaneous is directionally correct (they really did arrive together).
 */
function flattenToEvents(frames: { atMs: number; text: string }[]): { atMs: number; text: string }[] {
    return frames.flatMap((frame) => splitSseEvents(frame.text).map((text) => ({ atMs: frame.atMs, text })));
}

/** Gaps (ms) between consecutive events whose `event:` line matches `eventName`, optionally requiring `dataFilter` in the data line. */
function gapsBetween(frames: { atMs: number; text: string }[], eventName: string, dataFilter?: string): number[] {
    const matching = flattenToEvents(frames).filter(
        (event) => event.text.startsWith(`event: ${eventName}`) && (!dataFilter || event.text.includes(dataFilter)),
    );
    const gaps: number[] = [];
    for (let i = 1; i < matching.length; i++) {
        const prev = matching[i - 1];
        const cur = matching[i];
        if (prev && cur) gaps.push(cur.atMs - prev.atMs);
    }
    return gaps;
}

function median(values: number[]): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
}

/**
 * Average ms/event across the whole run of matching events, smoothing over
 * bursty chunk batching that makes individual gaps unreliable on short prompts.
 */
function averageIntervalMs(
    frames: { atMs: number; text: string }[],
    eventName: string,
    dataFilter?: string,
): number | undefined {
    const matching = flattenToEvents(frames).filter(
        (event) => event.text.startsWith(`event: ${eventName}`) && (!dataFilter || event.text.includes(dataFilter)),
    );
    if (matching.length < 2) return undefined;
    const first = matching[0];
    const last = matching[matching.length - 1];
    if (!first || !last) return undefined;
    return (last.atMs - first.atMs) / (matching.length - 1);
}

function report(label: string, exchanges: RecordedExchange[]): void {
    const frames = exchanges.flatMap((exchange) => exchange.response.frames ?? []);
    if (frames.length === 0) {
        process.stdout.write(`  ! ${label}: no frames captured\n`);
        return;
    }
    const first = frames[0];
    process.stdout.write(`  ${label}:\n`);
    process.stdout.write(`    time to first frame (message_start): ${first ? first.atMs.toString() : "?"}ms\n`);
    const textGaps = gapsBetween(frames, "content_block_delta", "text_delta");
    const thinkingGaps = gapsBetween(frames, "content_block_delta", "thinking_delta");
    process.stdout.write(
        `    text_delta gaps: n=${textGaps.length.toString()} median=${String(median(textGaps) ?? "n/a")}ms avg-interval=${String(averageIntervalMs(frames, "content_block_delta", "text_delta") ?? "n/a")}ms\n`,
    );
    process.stdout.write(
        `    thinking_delta gaps: n=${thinkingGaps.length.toString()} median=${String(median(thinkingGaps) ?? "n/a")}ms avg-interval=${String(averageIntervalMs(frames, "content_block_delta", "thinking_delta") ?? "n/a")}ms\n`,
    );
    if (process.env.TIMING_DEBUG === "1") {
        process.stdout.write("    raw frames (atMs, byte length, first 60 chars):\n");
        for (const frame of frames) {
            process.stdout.write(
                `      ${frame.atMs.toString().padStart(6)}ms  ${frame.text.length.toString().padStart(5)}B  ${JSON.stringify(frame.text.slice(0, 60))}\n`,
            );
        }
    }
}

async function main(): Promise<void> {
    const apiKey = loadApiKey();
    const model = resolveModel();
    const proxy = await startRecordingProxy({ apiKey });
    process.stdout.write(`Timing experiment with ${model} via ${proxy.url}\n`);

    try {
        // Plain text: no thinking, establishes a baseline text_delta cadence.
        proxy.setScenario("timing-plain");
        const plain = new AnthropicAgent({
            modelName: model,
            apiKey,
            baseUrl: proxy.url,
            providerOptions: { enableCompaction: false, thinkingType: "disabled", maxRetries: 0 },
        });
        const plainStream = await plain.stream(
            human("Count from 1 to 100, one number per line, formatted as '<n>: <spelled out>'."),
            "t",
            "u",
        );
        for await (const _chunk of plainStream) {
            // draining is enough; only the recorded frames matter here.
        }
        await proxy.idle();
        report("plain-text", proxy.pending("timing-plain"));
        proxy.discard("timing-plain");

        // Adaptive thinking: establishes the thinking_delta cadence separately.
        proxy.setScenario("timing-thinking");
        const thinking = new AnthropicAgent({
            modelName: model,
            apiKey,
            baseUrl: proxy.url,
            providerOptions: { enableCompaction: false, thinkingEffort: "low", maxRetries: 0 },
        });
        const thinkingStream = await thinking.stream(
            human("A farmer has 17 sheep; all but 9 run away. How many are left? Think it through."),
            "t",
            "u",
        );
        for await (const _chunk of thinkingStream) {
            // draining is enough; only the recorded frames matter here.
        }
        await proxy.idle();
        report("thinking-adaptive", proxy.pending("timing-thinking"));
        proxy.discard("timing-thinking");
    } finally {
        await proxy.close();
    }
}

await main();
