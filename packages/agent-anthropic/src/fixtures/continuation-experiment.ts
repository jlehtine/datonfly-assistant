/**
 * Live experiment: can a partial assistant turn be replayed to continue an
 * answer that was cut off mid-stream (as a mid-stream `overloaded_error` would
 * do)?
 *
 * Two candidate recovery strategies need deciding between, and the choice hangs
 * entirely on what the API accepts:
 *
 *   - **Prefill** — end `messages` with the partial assistant turn and let the
 *     model continue *that same turn*. Seamless, no injected instruction. Widely
 *     documented as incompatible with extended thinking, which this deployment
 *     runs by default, so it may simply be rejected.
 *   - **Continue instruction** — replay the partial assistant turn, then append
 *     an ephemeral `user` turn asking the model to carry on. Costs a visible
 *     seam and a synthetic turn, but does not rely on prefill being legal.
 *
 * Both depend on the partial turn itself being replayable, which is the real
 * unknown: a stream cut mid-flight can leave a `thinking` block that never
 * received its `signature_delta`, and the API validates those.
 *
 * The script first drives a real streaming request and aborts it partway, so
 * the partial content is genuinely truncated rather than hand-built, then
 * replays it under each strategy and reports what the API said.
 *
 * Usage (from the repository root); every case is a real, billable API call:
 *
 *     pnpm --filter @datonfly-assistant/agent-anthropic experiment:continuation
 *
 * `ANTHROPIC_API_KEY` and the model are read from the environment or the root
 * `.env`, matching `record-fixtures.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

import { buildOutputConfig, buildThinkingParam, requiredBetas, type AnthropicProviderOptions } from "../config.js";

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

/** Thinking configuration matching the deployment default (adaptive + summarized). */
const ADAPTIVE: AnthropicProviderOptions = { enableCompaction: false, thinkingEffort: "low" };

const PROMPT = "Explain how a bicycle derailleur works, in about six sentences.";

/** Blocks salvaged from a stream that was cut off partway through. */
interface PartialTurn {
    /** Blocks that reached `content_block_stop`, so thinking blocks carry a signature. */
    completed: Anthropic.Beta.BetaContentBlock[];
    /** Text accumulated for a block that was still open when the cut happened. */
    openText: string;
    /** Whether a thinking block was still open (and therefore unsigned) at the cut. */
    openThinking: boolean;
}

/**
 * Drive a real streaming request and cut it off once enough text has arrived.
 *
 * Mirrors what a mid-stream `overloaded_error` leaves behind: whatever blocks
 * the SDK had finished, plus a partially accumulated open block.
 */
async function capturePartialTurn(
    client: Anthropic,
    model: string,
    options: AnthropicProviderOptions,
    cutAfterChars: number,
): Promise<PartialTurn> {
    const controller = new AbortController();
    const outputConfig = buildOutputConfig(options);
    const stream = client.beta.messages.stream(
        {
            model,
            max_tokens: 2048,
            betas: requiredBetas(options),
            thinking: buildThinkingParam(options),
            ...(outputConfig ? { output_config: outputConfig } : {}),
            messages: [{ role: "user", content: PROMPT }],
            stream: true,
        },
        { signal: controller.signal },
    );

    const completed: Anthropic.Beta.BetaContentBlock[] = [];
    const openBlocks = new Map<number, { type: string; text: string; signature: string }>();
    let textSeen = 0;
    let openText = "";
    let openThinking = false;

    try {
        for await (const event of stream) {
            if (event.type === "content_block_start") {
                openBlocks.set(event.index, { type: event.content_block.type, text: "", signature: "" });
            } else if (event.type === "content_block_delta") {
                const open = openBlocks.get(event.index);
                if (!open) continue;
                if (event.delta.type === "text_delta") {
                    open.text += event.delta.text;
                    textSeen += event.delta.text.length;
                } else if (event.delta.type === "thinking_delta") {
                    open.text += event.delta.thinking;
                } else if (event.delta.type === "signature_delta") {
                    // The signature only arrives here, at the end of the block.
                    open.signature = event.delta.signature;
                }
                // Cut only once real answer text is flowing, so the capture has
                // both a finished thinking block and a truncated text block.
                if (textSeen >= cutAfterChars) {
                    openText = open.type === "text" ? open.text : "";
                    openThinking = open.type === "thinking";
                    controller.abort(new Error("simulated overload cut"));
                    break;
                }
            } else if (event.type === "content_block_stop") {
                const open = openBlocks.get(event.index);
                openBlocks.delete(event.index);
                if (!open) continue;
                // finalMessage() is unavailable after an abort, so blocks are
                // rebuilt from the accumulated events instead.
                if (open.type === "text") {
                    completed.push({ type: "text", text: open.text, citations: [] });
                } else if (open.type === "thinking") {
                    completed.push({
                        type: "thinking",
                        thinking: open.text,
                        signature: open.signature,
                    });
                }
            }
        }
    } catch (error) {
        if (!(error instanceof Anthropic.APIUserAbortError)) throw error;
    }

    return { completed, openText, openThinking };
}

/** Issue a non-streaming request and report success or the API's complaint. */
async function attempt(
    label: string,
    client: Anthropic,
    model: string,
    options: AnthropicProviderOptions,
    messages: Anthropic.Beta.BetaMessageParam[],
): Promise<string | undefined> {
    process.stdout.write(`\n▶ ${label}\n`);
    const outputConfig = buildOutputConfig(options);
    try {
        const response = await client.beta.messages.create({
            model,
            max_tokens: 1024,
            betas: requiredBetas(options),
            thinking: buildThinkingParam(options),
            ...(outputConfig ? { output_config: outputConfig } : {}),
            messages,
        });
        const text = response.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
        const kinds = response.content.map((block) => block.type).join(", ");
        process.stdout.write(`  ✓ accepted — stop_reason=${String(response.stop_reason)} blocks=[${kinds}]\n`);
        process.stdout.write(`  continuation: ${JSON.stringify(text.slice(0, 220))}\n`);
        return text;
    } catch (error) {
        if (error instanceof Anthropic.APIError) {
            process.stdout.write(`  ✗ HTTP ${String(error.status)} ${error.message.slice(0, 300)}\n`);
        } else {
            process.stdout.write(`  ✗ ${error instanceof Error ? error.message : String(error)}\n`);
        }
        return undefined;
    }
}

/** Print how the partial text and its continuation actually join up. */
function reportSeam(partialText: string, continuation: string | undefined): void {
    if (continuation === undefined) return;
    const before = partialText.slice(-70);
    const after = continuation.slice(0, 70);
    process.stdout.write(`  seam: ...${JSON.stringify(before)} ➕ ${JSON.stringify(after)}...\n`);
}

/** Cut a partial answer back to its last sentence boundary, if there is one. */
function trimToSentenceBoundary(text: string): string {
    const match = /^[\s\S]*[.!?](\s|$)/.exec(text);
    return match ? match[0].trimEnd() : text;
}

async function main(): Promise<void> {
    const client = new Anthropic({ apiKey: loadApiKey(), maxRetries: 0 });
    const model = resolveModel();
    process.stdout.write(`Continuation experiment with ${model}\n`);

    process.stdout.write("\n── Capturing a genuinely truncated turn (adaptive thinking) ──\n");
    const partial = await capturePartialTurn(client, model, ADAPTIVE, 200);
    const kinds = partial.completed.map((block) => block.type).join(", ") || "none";
    process.stdout.write(`  completed blocks: [${kinds}]\n`);
    process.stdout.write(`  open block was thinking: ${String(partial.openThinking)}\n`);
    process.stdout.write(`  truncated text: ${JSON.stringify(partial.openText.slice(0, 160))}\n`);

    const signedThinking = partial.completed.filter((block) => block.type === "thinking");
    for (const block of signedThinking) {
        const signature = block.signature;
        process.stdout.write(
            `  thinking signature captured: ${String(signature.length > 0)} (${String(signature.length)} chars)\n`,
        );
    }
    const partialText = partial.openText.length > 0 ? partial.openText : "";
    if (partialText.length === 0) {
        process.stdout.write("\n! No truncated text captured; the cut landed outside a text block.\n");
        return;
    }

    const user: Anthropic.Beta.BetaMessageParam = { role: "user", content: PROMPT };
    const CONTINUE = "Your answer was cut off due to an overload. Please continue from where you left off.";

    // Prefill (assistant turn last, model continues it) is rejected outright by
    // this model — "the conversation must end with a user message" — with or
    // without thinking, so only the instruction-based variants are tried here.

    // 1. Text only: the minimum a continuation needs.
    await attempt("continue instruction / adaptive thinking (text only)", client, model, ADAPTIVE, [
        user,
        { role: "assistant", content: [{ type: "text", text: partialText }] },
        { role: "user", content: CONTINUE },
    ]);

    // 2. Same, but replaying the genuinely signed thinking block alongside it.
    await attempt("continue instruction / adaptive thinking + signed thinking block", client, model, ADAPTIVE, [
        user,
        {
            role: "assistant",
            content: [
                ...(signedThinking as Anthropic.Beta.BetaContentBlockParam[]),
                { type: "text", text: partialText },
            ],
        },
        { role: "user", content: CONTINUE },
    ]);

    // 3. An unsigned thinking block, to confirm it must be dropped before replay.
    await attempt("continue instruction / unsigned thinking block", client, model, ADAPTIVE, [
        user,
        {
            role: "assistant",
            content: [
                { type: "thinking", thinking: "Partial reasoning that never got signed.", signature: "" },
                { type: "text", text: partialText },
            ],
        },
        { role: "user", content: CONTINUE },
    ]);

    // The remaining question is seam quality: the answer is appended verbatim to
    // what the user already saw, so the join has to read as one continuous text.
    process.stdout.write("\n── Seam quality by instruction phrasing ──\n");

    const strict =
        "Your previous message was cut off mid-sentence by a service overload. " +
        `It ended with exactly: ${JSON.stringify(partialText.slice(-120))}. ` +
        "Continue writing from exactly that point so the two parts join seamlessly. " +
        "Do not repeat any of it, do not restate, do not add a preamble — emit only the remaining text.";
    reportSeam(
        partialText,
        await attempt("strict seam instruction", client, model, ADAPTIVE, [
            user,
            { role: "assistant", content: [{ type: "text", text: partialText }] },
            { role: "user", content: strict },
        ]),
    );

    // Trimming the dangling fragment moves the join to a sentence boundary, at
    // the cost of having to retract text the user already saw.
    const trimmed = trimToSentenceBoundary(partialText);
    process.stdout.write(`\n  (trimmed tail dropped: ${JSON.stringify(partialText.slice(trimmed.length))})\n`);
    reportSeam(
        trimmed,
        await attempt("trimmed to sentence boundary", client, model, ADAPTIVE, [
            user,
            { role: "assistant", content: [{ type: "text", text: trimmed }] },
            {
                role: "user",
                content: strict.replace(JSON.stringify(partialText.slice(-120)), JSON.stringify(trimmed.slice(-120))),
            },
        ]),
    );
}

await main();
