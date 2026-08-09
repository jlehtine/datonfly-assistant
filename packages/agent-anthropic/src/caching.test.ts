import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { applyCacheBreakpoints } from "./caching.js";

function textTurn(role: "user" | "assistant", text: string): Anthropic.Beta.BetaMessageParam {
    return { role, content: [{ type: "text", text }] };
}

function cacheControlOf(message: Anthropic.Beta.BetaMessageParam | undefined): unknown {
    const content = message?.content;
    if (!Array.isArray(content)) return undefined;
    const last = content[content.length - 1];
    return (last as { cache_control?: unknown } | undefined)?.cache_control;
}

describe("applyCacheBreakpoints", () => {
    it("marks the system prompt, the tools, and the stable message prefix", () => {
        const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: "Be terse." }];
        const tools = [
            { name: "a", description: "", input_schema: { type: "object" } },
            { name: "b", description: "", input_schema: { type: "object" } },
        ] as unknown as Anthropic.Beta.BetaToolUnion[];
        const messages = [
            textTurn("user", "one"),
            textTurn("assistant", "two"),
            textTurn("user", "three"),
            textTurn("assistant", "four"),
            textTurn("user", "five"),
        ];

        applyCacheBreakpoints({ system, tools, messages }, {});

        expect(system[0]?.cache_control).toEqual({ type: "ephemeral" });
        expect((tools[1] as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
        expect((tools[0] as { cache_control?: unknown }).cache_control).toBeUndefined();

        // Default tail of 2 leaves the last two turns uncached.
        expect(cacheControlOf(messages[2])).toEqual({ type: "ephemeral" });
        expect(cacheControlOf(messages[3])).toBeUndefined();
        expect(cacheControlOf(messages[4])).toBeUndefined();
    });

    it("honours an explicit TTL", () => {
        const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: "Be terse." }];
        applyCacheBreakpoints({ system, messages: [] }, { cacheTtl: "1h" });
        expect(system[0]?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    });

    it("marks nothing when caching is disabled", () => {
        const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: "Be terse." }];
        const messages = [textTurn("user", "one"), textTurn("assistant", "two"), textTurn("user", "three")];

        applyCacheBreakpoints({ system, messages }, { disableCaching: true });

        expect(system[0]?.cache_control).toBeUndefined();
        expect(cacheControlOf(messages[0])).toBeUndefined();
    });

    it("skips the message breakpoint when the conversation is shorter than the tail", () => {
        const messages = [textTurn("user", "one")];
        applyCacheBreakpoints({ messages }, {});
        expect(cacheControlOf(messages[0])).toBeUndefined();
    });
});
