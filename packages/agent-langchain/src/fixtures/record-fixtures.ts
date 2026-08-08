/**
 * Record streaming fixtures from the current `agent-langchain` implementation.
 *
 * These fixtures are the regression baseline for the Anthropic SDK rewrite, so
 * they must be captured while this provider still runs. Every scenario drives a
 * real Anthropic request through {@link startRecordingProxy}.
 *
 * Usage (from the repository root):
 *
 *     pnpm --filter @datonfly-assistant/agent-langchain record:fixtures -- --list
 *     pnpm --filter @datonfly-assistant/agent-langchain record:fixtures -- plain-text
 *     pnpm --filter @datonfly-assistant/agent-langchain record:fixtures -- --all
 *
 * `ANTHROPIC_API_KEY` and the model are read from the environment or the root
 * `.env`; `--model` overrides the latter. Scenarios cost real money; record only
 * what you need.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentConfig, AgentMessage, AgentStreamChunk } from "@datonfly-assistant/core";

import { AnthropicAgent, type AnthropicAgentConfig, type AnthropicProviderOptions } from "../agent.js";
import { startRecordingProxy, type RecordingProxy } from "./recording-proxy.js";

/** Walk up from this module until the workspace root is found. */
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
const FIXTURE_DIR = join(REPO_ROOT, "packages/agent-anthropic/test/fixtures");

/** A 1x1 transparent PNG, so the image scenario needs no binary asset in the repo. */
const TINY_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** A minimal one-page PDF containing the word "Datonfly". */
const TINY_PDF_BASE64 = Buffer.from(
    [
        "%PDF-1.4",
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
        "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
        "4 0 obj<</Length 46>>stream",
        "BT /F1 18 Tf 20 40 Td (Datonfly) Tj ET",
        "endstream endobj",
        "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
        "trailer<</Root 1 0 R>>",
        "%%EOF",
    ].join("\n"),
    "utf-8",
).toString("base64");

/** Build a single human message with the given text. */
function human(text: string): AgentMessage[] {
    return [{ role: "human", content: [{ type: "text", text }] }];
}

/** Build a human message carrying one attachment alongside its prompt. */
function humanWithAttachment(text: string, name: string, mimeType: string, base64: string): AgentMessage[] {
    return [
        {
            role: "human",
            content: [
                { type: "text", text },
                {
                    type: "attachment",
                    attachmentId: `fixture-${name}`,
                    name,
                    mimeType,
                    size: Buffer.from(base64, "base64").byteLength,
                    data: base64,
                },
            ],
        },
    ];
}

/** How a scenario drives the agent once the proxy is in place. */
interface Scenario {
    /** Fixture file base name. */
    name: string;
    /** What the fixture exercises, mirrored into the fixtures README. */
    description: string;
    /** Neutral configuration on top of the shared defaults. */
    config?: Partial<AgentConfig>;
    /** Anthropic-only configuration for this scenario. */
    providerOptions?: AnthropicProviderOptions;
    /**
     * Needs a model that supports Anthropic's server-side tools.
     *
     * Haiku does not, so these scenarios only record on a Sonnet/Opus-class model.
     */
    requiresServerTools?: boolean;
    /** Conversation sent to the agent. */
    messages: AgentMessage[];
    /** Abort the stream after this many chunks, instead of draining it. */
    abortAfterChunks?: number;
    /** Expect the run to fail; the fixture captures the error response. */
    expectFailure?: boolean;
}

const SCENARIOS: Scenario[] = [
    {
        name: "plain-text",
        description: "Plain streamed text response with no tools or thinking.",
        messages: human("Say exactly: hello from the fixture."),
    },
    {
        name: "thinking-adaptive",
        description: "Adaptive thinking: summarized reasoning blocks interleaved with the answer.",
        providerOptions: { thinkingType: "adaptive", thinkingDisplay: "summarized", thinkingEffort: "low" },
        messages: human("A farmer has 17 sheep; all but 9 run away. How many are left? Think it through."),
    },
    {
        name: "thinking-enabled",
        description: "Manual thinking with an explicit token budget.",
        config: { maxTokens: 4096 },
        providerOptions: { thinkingType: "enabled", thinkingBudgetTokens: 1024 },
        messages: human("What is 17 * 23? Show your reasoning."),
    },
    {
        name: "web-search",
        description: "Server-side web_search tool use, including citation blocks.",
        providerOptions: { enableCodeExecution: true, enableWebSearch: true, webSearchMaxUses: 1 },
        requiresServerTools: true,
        messages: human("Search the web for the current stable Node.js LTS version and cite your source."),
    },
    {
        name: "web-fetch",
        description: "Server-side web_fetch tool use against a URL given in the prompt.",
        providerOptions: { enableCodeExecution: true, enableWebFetch: true, webFetchMaxUses: 1 },
        requiresServerTools: true,
        messages: human("Fetch https://example.com and quote its heading."),
    },
    {
        name: "code-execution",
        description: "Server-side code_execution tool use.",
        providerOptions: { enableCodeExecution: true },
        requiresServerTools: true,
        messages: human("Use code execution to compute the 20th Fibonacci number."),
    },
    {
        name: "tool-loop",
        description: "Multi-iteration local tool loop: two dependent calls before the final answer.",
        config: { maxToolIterations: 5 },
        messages: human("Add 2 and 3 using the adder tool, then add 10 to that result using the same tool."),
    },
    {
        name: "attachment-image",
        description: "Image attachment mapped to an Anthropic image block.",
        messages: humanWithAttachment(
            "Describe this image in one sentence.",
            "pixel.png",
            "image/png",
            TINY_PNG_BASE64,
        ),
    },
    {
        name: "attachment-pdf",
        description: "PDF attachment mapped to an Anthropic document block.",
        messages: humanWithAttachment("What word appears in this PDF?", "tiny.pdf", "application/pdf", TINY_PDF_BASE64),
    },
    {
        name: "attachment-text",
        description: "Text attachment decoded and inlined as a text block.",
        messages: humanWithAttachment(
            "Summarise the attached note.",
            "note.txt",
            "text/plain",
            Buffer.from("Datonfly Assistant fixture note.\nSecond line.", "utf-8").toString("base64"),
        ),
    },
    {
        name: "compaction",
        description:
            "Provider-side context compaction. The trigger is lowered so it fires on a cheap prompt " +
            "instead of the ~120k input tokens the production default would need.",
        providerOptions: { enableCompaction: true, compactionTriggerTokens: 1000 },
        messages: [
            { role: "human", content: [{ type: "text", text: `Summarise this log:\n${"log line\n".repeat(400)}` }] },
        ],
    },
    {
        name: "abort-mid-stream",
        description: "Stream aborted by the caller partway through the response.",
        messages: human("Count slowly from 1 to 200, one number per line."),
        abortAfterChunks: 5,
    },
    {
        name: "error-400",
        description: "Invalid request rejected by the API (max_tokens above the model limit).",
        config: { maxTokens: 100_000_000 },
        messages: human("This request is intentionally malformed."),
        expectFailure: true,
    },
];

/** The adder tool used by the tool-loop scenario. */
async function toolLoopTools(): Promise<AnthropicAgentConfig["defaultTools"]> {
    const { zodTool } = await import("@datonfly-assistant/core");
    const { z } = await import("zod");
    return [
        zodTool({
            name: "adder",
            description: "Adds two numbers and returns the sum.",
            schema: z.object({ a: z.number(), b: z.number() }),
            execute: (input) => Promise.resolve(String(input.a + input.b)),
        }),
    ];
}

/** Load `ANTHROPIC_API_KEY`, preferring the process environment over the root `.env`. */
function loadApiKey(): string {
    const value = readSetting("ANTHROPIC_API_KEY");
    if (!value) {
        throw new Error("ANTHROPIC_API_KEY is not set (checked the environment and the root .env).");
    }
    return value;
}

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

/**
 * Resolve the model to record with.
 *
 * There is deliberately no default: the fixtures are a regression baseline for a
 * specific deployment, and the cheap models do not support every scenario.
 */
function resolveModel(args: string[]): string {
    const flagIndex = args.indexOf("--model");
    const fromFlag = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
    if (flagIndex >= 0 && !fromFlag) {
        throw new Error("--model requires a model name.");
    }
    const model = fromFlag ?? readSetting("DF_AGENT_MODEL");
    if (!model) {
        throw new Error("No model selected. Pass --model <name> or set DF_AGENT_MODEL in the environment or .env.");
    }
    return model;
}

/** Drain a stream, optionally aborting it after a number of chunks. */
async function drain(
    stream: AsyncIterable<AgentStreamChunk>,
    controller: AbortController,
    abortAfterChunks?: number,
): Promise<void> {
    let seen = 0;
    for await (const _chunk of stream) {
        seen += 1;
        if (abortAfterChunks !== undefined && seen >= abortAfterChunks) {
            controller.abort(new Error("fixture abort"));
        }
    }
}

/** Run one scenario and write its fixture. */
async function record(scenario: Scenario, proxy: RecordingProxy, apiKey: string, model: string): Promise<void> {
    process.stdout.write(`▶ ${scenario.name}\n`);
    proxy.setScenario(scenario.name);

    const config: AnthropicAgentConfig = {
        modelName: model,
        apiKey,
        baseUrl: proxy.url,
        maxTokens: 1024,
        ...scenario.config,
        ...(scenario.name === "tool-loop" ? { defaultTools: await toolLoopTools() } : {}),
        providerOptions: { enableCompaction: false, ...scenario.providerOptions },
    };

    const agent = new AnthropicAgent(config);
    const controller = new AbortController();
    try {
        const stream = await agent.stream(scenario.messages, "fixture-thread", "fixture-user", controller.signal);
        await drain(stream, controller, scenario.abortAfterChunks);
        if (scenario.expectFailure) {
            process.stdout.write(`  ! expected a failure but the call succeeded\n`);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const expected = scenario.expectFailure === true || scenario.abortAfterChunks !== undefined;
        process.stdout.write(`  ${expected ? "·" : "!"} ${message}\n`);
    }

    // An unexpected error response would enshrine a broken baseline (e.g. a model
    // that does not support the server tools this scenario needs).
    const rejected = proxy.pending(scenario.name).filter((exchange) => exchange.response.status >= 400);
    if (rejected.length > 0 && scenario.expectFailure !== true) {
        const statuses = rejected.map((exchange) => exchange.response.status.toString()).join(", ");
        process.stdout.write(`  ! not recorded: the API rejected the request (${statuses})\n`);
        if (scenario.requiresServerTools) {
            process.stdout.write(`    "${model}" may not support Anthropic's server-side tools.\n`);
        }
        proxy.discard(scenario.name);
        return;
    }

    const written = await proxy.flush(scenario.name, FIXTURE_DIR);
    for (const file of written) {
        process.stdout.write(`  → ${file.replace(`${REPO_ROOT}/`, "")}\n`);
    }
    if (written.length === 0) {
        process.stdout.write("  ! nothing recorded\n");
    }
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes("--help")) {
        process.stdout.write(
            "Usage: record:fixtures -- [--list] [--all] [--model <name>] [scenario...]\n" +
                "Records raw Anthropic SSE fixtures. Each scenario is a real, billable API call.\n" +
                "The model comes from --model or DF_AGENT_MODEL; scenarios marked as needing\n" +
                "server-side tools do not record on Haiku.\n",
        );
        return;
    }
    if (args.includes("--list")) {
        for (const scenario of SCENARIOS) {
            const note = scenario.requiresServerTools ? " [needs server-tool support]" : "";
            process.stdout.write(`${scenario.name.padEnd(20)} ${scenario.description}${note}\n`);
        }
        return;
    }

    const model = resolveModel(args);
    const flagIndex = args.indexOf("--model");
    const modelValueIndex = flagIndex >= 0 ? flagIndex + 1 : -1;
    const positional = args.filter((arg, index) => !arg.startsWith("--") && index !== modelValueIndex);
    const selected = args.includes("--all") ? SCENARIOS : SCENARIOS.filter((s) => positional.includes(s.name));
    const unknown = positional.filter((arg) => !SCENARIOS.some((s) => s.name === arg));
    if (unknown.length > 0) {
        throw new Error(`Unknown scenario(s): ${unknown.join(", ")}. Use --list to see the available names.`);
    }
    if (selected.length === 0) {
        throw new Error("No scenarios selected.");
    }

    const apiKey = loadApiKey();
    const proxy = await startRecordingProxy({ apiKey });
    process.stdout.write(`Recording ${selected.length.toString()} scenario(s) with ${model} via ${proxy.url}\n`);
    try {
        for (const scenario of selected) {
            await record(scenario, proxy, apiKey, model);
        }
    } finally {
        await proxy.close();
    }
}

await main();
