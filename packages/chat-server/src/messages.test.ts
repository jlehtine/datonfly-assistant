import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./messages.js";

function text(message: ReturnType<typeof buildSystemPrompt>): string {
    const part = message.content[0];
    return part?.type === "text" ? part.text : "";
}

describe("buildSystemPrompt", () => {
    it("omits generated-files guidance by default", () => {
        expect(text(buildSystemPrompt(new Map([["u1", "Alice"]])))).not.toContain("$OUTPUT_DIR");
    });

    it("appends generated-files guidance for a single-user thread when enabled", () => {
        expect(text(buildSystemPrompt(new Map([["u1", "Alice"]]), true))).toContain("$OUTPUT_DIR");
    });

    it("appends generated-files guidance for a multi-user thread when enabled", () => {
        const aliases = new Map([
            ["u1", "Alice"],
            ["u2", "Bob"],
        ]);
        expect(text(buildSystemPrompt(aliases, true))).toContain("$OUTPUT_DIR");
    });

    it("omits generated-files guidance for a multi-user thread when disabled", () => {
        const aliases = new Map([
            ["u1", "Alice"],
            ["u2", "Bob"],
        ]);
        expect(text(buildSystemPrompt(aliases, false))).not.toContain("$OUTPUT_DIR");
    });
});
