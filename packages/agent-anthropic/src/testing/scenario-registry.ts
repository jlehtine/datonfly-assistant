/**
 * Groups committed fixtures into scenarios and selects which one, and which
 * exchange of it, replays a given request.
 *
 * Selection is content-based rather than positional: each scenario's trigger is
 * simply the human text its own first recorded exchange was captured with — no
 * separate registry to keep in sync with the fixtures. A request matches a
 * scenario when that text appears anywhere in its `messages`. Anthropic always
 * resends the full conversation, so which exchange comes next is inferable
 * from the request alone (no server-side session state): it is the number of
 * `assistant` turns already present.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Fixture } from "./fixture-server.js";

const DEFAULT_FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures");

export { DEFAULT_FIXTURE_DIR };

/** Fallback scenario used for any request that doesn't match another one, and once a matched scenario is exhausted. */
const DEFAULT_SCENARIO = "plain-text";

/** A wire-format message, only as much of its shape as selection needs. */
interface WireMessage {
    role: string;
    content: unknown;
}

/** An ordered sequence of fixtures making up one scenario (usually one; several for a multi-turn scenario). */
export interface Scenario {
    /** Scenario name (the fixture's base file name, with any numeric suffix stripped). */
    name: string;
    /**
     * Text that selects this scenario, taken verbatim from its first exchange's
     * own recorded prompt. `undefined` for scenarios matched structurally
     * instead (`title`, `triage` — non-streaming calls with no human turn to
     * key off).
     */
    trigger: string | undefined;
    /** The scenario's exchanges, in replay order. */
    fixtures: Fixture[];
}

/** Extract the plain text of a message's content, whichever wire shape it used. */
function extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
        .filter((block): block is { type: string; text?: unknown } => typeof block === "object" && block !== null)
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n");
}

/**
 * Strip a sequence suffix (`tool-loop-01` -> `tool-loop`) to group a scenario's
 * exchanges.
 *
 * Matches exactly two digits, which is what the recorder pads to. A looser
 * `-\d+$` would also swallow the status code in `error-400` / `error-429` /
 * `error-529`, collapsing three unrelated scenarios into one whose exchanges
 * then replay in sequence.
 */
function baseName(fileStem: string): string {
    return fileStem.replace(/-\d{2}$/, "");
}

/** The trigger text for a scenario: its first exchange's last message, when that message is a plain human turn. */
function extractTrigger(first: Fixture): string | undefined {
    if (first.request.body.stream !== true) return undefined;
    const messages = first.request.body.messages as WireMessage[] | undefined;
    const last = messages?.[messages.length - 1];
    if (last?.role !== "user") return undefined;
    const text = extractText(last.content);
    return text.length > 0 ? text : undefined;
}

/** Load every committed fixture and group it into scenarios. */
export async function loadScenarios(fixtureDir: string = DEFAULT_FIXTURE_DIR): Promise<Scenario[]> {
    const files = (await readdir(fixtureDir)).filter((file) => file.endsWith(".json")).sort();

    const groups = new Map<string, { name: string; fixture: Fixture }[]>();
    for (const file of files) {
        const raw = await readFile(join(fixtureDir, file), "utf-8");
        const fixture = JSON.parse(raw) as Fixture;
        const name = file.replace(/\.json$/, "");
        const group = baseName(name);
        const list = groups.get(group) ?? [];
        list.push({ name, fixture });
        groups.set(group, list);
    }

    const scenarios: Scenario[] = [];
    for (const [group, entries] of groups) {
        entries.sort((a, b) => a.name.localeCompare(b.name));
        const fixtures = entries.map((entry) => entry.fixture);
        const first = fixtures[0];
        if (!first) continue;
        scenarios.push({ name: group, trigger: extractTrigger(first), fixtures });
    }
    return scenarios;
}

/** Count `assistant`-role turns already in the request — how many exchanges of a matched scenario have already replayed. */
/**
 * How many exchanges of the matched scenario have already replayed: the
 * `assistant` turns *after* the message that selected it.
 *
 * Counting every assistant turn in the conversation would be wrong as soon as a
 * scenario is triggered partway through a thread — earlier replies from
 * unrelated turns would push the index past the scenario's own exchanges and
 * silently fall back to the default.
 */
function exchangeIndex(messages: WireMessage[], matchedAt: number): number {
    return messages.slice(matchedAt + 1).filter((message) => message.role === "assistant").length;
}

/**
 * Select which fixture replays a streaming request.
 *
 * Scans `messages` in order for the first one containing a registered
 * scenario's trigger text. Falls back to {@link DEFAULT_SCENARIO} when nothing
 * matches, or once a matched scenario's own exchanges are exhausted (e.g. a
 * conversation continuing past what was recorded, or a retry after a
 * deliberately-failing fixture like `overloaded-mid-stream`).
 */
export function selectFixture(scenarios: Scenario[], messages: WireMessage[]): Fixture {
    const fallback = scenarios.find((scenario) => scenario.name === DEFAULT_SCENARIO)?.fixtures[0];
    if (!fallback) {
        throw new Error(`Playback requires the "${DEFAULT_SCENARIO}" fixture as its fallback scenario.`);
    }

    let matched: Scenario | undefined;
    let matchedAt = -1;
    for (const [index, message] of messages.entries()) {
        const text = extractText(message.content);
        if (text.length === 0) continue;
        const found = scenarios.find((scenario) => scenario.trigger !== undefined && text.includes(scenario.trigger));
        if (found) {
            matched = found;
            matchedAt = index;
            break;
        }
    }
    if (!matched) return fallback;

    const index = exchangeIndex(messages, matchedAt);
    return index < matched.fixtures.length ? (matched.fixtures[index] ?? fallback) : fallback;
}

/** Select the fixture for a non-streaming call, routed structurally rather than by content. */
export function selectNonStreamingFixture(scenarios: Scenario[], body: Record<string, unknown>): Fixture | undefined {
    const toolChoice = body.tool_choice as { type?: string; name?: string } | undefined;
    const name = toolChoice?.type === "tool" && toolChoice.name === "record_decision" ? "triage" : "title";
    return scenarios.find((scenario) => scenario.name === name)?.fixtures[0];
}
