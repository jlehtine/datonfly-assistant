/**
 * Live experiment: does an always-declared-but-unforced tool, appended to
 * with a trailing instruction message and nothing else changed, still get a
 * cache hit on the conversation prefix?
 *
 * This is the mechanism `generateThreadSummary` (tasks/2026/search-topic-indexing.md,
 * Phase 2) is designed around: declare `record_thread_summary` in the standard
 * tool set so `tools` stays byte-identical on every request, invoke it by
 * instruction, and never touch `tool_choice`. Anthropic's own docs already
 * settle the one question that would have ruled this out on its own —
 * "Changing the `output_config.format` parameter will invalidate any prompt
 * cache for that conversation thread" (structured-outputs docs) — so
 * `output_config.format` is confirmed NOT cache-neutral and is not tested
 * here. What this script checks instead, because it is not spelled out with
 * the same certainty anywhere: whether a real multi-turn conversation that
 * carries a tool the model is free to ignore actually exhibits the standard
 * partial-read/partial-write caching pattern once a third turn's prefix has
 * already been written at each layer.
 *
 * Three requests against the same growing conversation, cache_control placed
 * exactly as `applyCacheBreakpoints` places it (system + last tool + boundary
 * at `messages.length - tail - 1`, tail = 1):
 *   1. First turn: only long enough to write the system+tool cache. No
 *      message-level breakpoint yet (not enough messages for a tail).
 *   2. Second turn: message-level breakpoint appears for the first time — this
 *      necessarily creates a new cache entry (nothing was written there
 *      before), while the system+tool prefix reads from turn 1's write.
 *   3. Third turn: the trailing instruction — the boundary from turn 2 has
 *      now been written once, so this is the first request positioned to
 *      prove a full read of system + tools + turn-1 exchange, with only the
 *      newest content uncached. This is the shape every real
 *      `generateThreadSummary` call will have.
 *
 * Usage (from the repository root), a real, billable API call:
 *
 *     pnpm --filter @datonfly-assistant/agent-anthropic experiment:summary-cache
 *
 * `ANTHROPIC_API_KEY` and the model are read from the environment or the root
 * `.env`, matching `record-fixtures.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

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

/** Filler long enough to clear Opus 5's 512-token cache minimum once combined with the tool definition. */
const SYSTEM_FILLER =
    "You are a customer support assistant for a small software company called Northwind Labs. " +
    "Answer questions helpfully and concisely. ".repeat(80);

const SUMMARY_TOOL: Anthropic.Beta.BetaToolUnion = {
    name: "record_thread_summary",
    description:
        "Call this only when the user explicitly asks you to summarise the conversation so far. " +
        "Records a short title and a list of the distinct topics discussed.",
    input_schema: {
        type: "object",
        properties: {
            title: { type: "string" },
            topics: { type: "array", items: { type: "string" } },
        },
        required: ["title", "topics"],
    },
};

interface UsageFacts {
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    inputTokens: number;
}

function usageFacts(usage: Anthropic.Beta.BetaUsage): UsageFacts {
    return {
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        inputTokens: usage.input_tokens,
    };
}

/** Copy `messages`, wrapping the message at `boundary` in a single cache-control breakpoint block. */
function withBreakpoint(
    messages: Anthropic.Beta.BetaMessageParam[],
    boundary: number,
): Anthropic.Beta.BetaMessageParam[] {
    return messages.map((m, i) => {
        if (i !== boundary) return m;
        const text = typeof m.content === "string" ? m.content : "";
        return { role: m.role, content: [{ type: "text", text, cache_control: { type: "ephemeral" } }] };
    });
}

async function main(): Promise<void> {
    const apiKey = loadApiKey();
    const model = resolveModel();
    const client = new Anthropic({ apiKey });

    const system: Anthropic.Beta.BetaTextBlockParam[] = [
        { type: "text", text: SYSTEM_FILLER, cache_control: { type: "ephemeral" } },
    ];
    const tools: Anthropic.Beta.BetaToolUnion[] = [{ ...SUMMARY_TOOL, cache_control: { type: "ephemeral" } }];

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: "What are your support hours?" }];

    console.log(`Model: ${model}\n`);

    // Turn 1: system + tools cache write only (tail=1 leaves no room for a message breakpoint yet).
    const turn1 = await client.beta.messages.create({
        model,
        max_tokens: 200,
        system,
        tools,
        messages,
        betas: ["context-management-2025-06-27"],
    });
    console.log("Turn 1 (write system+tools):", usageFacts(turn1.usage));

    const assistantText1 = turn1.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    messages.push({
        role: "assistant",
        content: assistantText1 || "Our support hours are 9am-5pm ET, Monday to Friday.",
    });
    messages.push({ role: "user", content: "And what about weekends?" });

    // Turn 2: message-level breakpoint appears for the first time -- necessarily a write, not a read, at that layer.
    const boundary2 = messages.length - 1 - 1; // tail = 1
    const turn2 = await client.beta.messages.create({
        model,
        max_tokens: 200,
        system,
        tools,
        messages: withBreakpoint(messages, boundary2),
        betas: ["context-management-2025-06-27"],
    });
    console.log("Turn 2 (first message-level write, system/tools read):", usageFacts(turn2.usage));

    const assistantText2 = turn2.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
    messages.push({ role: "assistant", content: assistantText2 || "We're closed on weekends." });
    messages.push({
        role: "user",
        content:
            "Please summarise this conversation using the record_thread_summary tool if you have not already done so.",
    });

    // Turn 3: the shape a real generateThreadSummary call has -- trailing instruction, tool declared but not
    // forced, tool_choice left at its default. This is the request that should show a large cache read.
    const boundary3 = messages.length - 1 - 1;
    const turn3 = await client.beta.messages.create({
        model,
        max_tokens: 300,
        system,
        tools,
        messages: withBreakpoint(messages, boundary3),
        betas: ["context-management-2025-06-27"],
    });
    console.log("Turn 3 (trailing instruction, tool_choice left at default):", usageFacts(turn3.usage));
    console.log("Turn 3 stop_reason:", turn3.stop_reason);
    for (const block of turn3.content) {
        if (block.type === "tool_use") console.log("Turn 3 called tool:", block.name, JSON.stringify(block.input));
        if (block.type === "text") console.log("Turn 3 text:", block.text);
    }
}

await main();
