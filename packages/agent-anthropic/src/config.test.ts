import { describe, expect, it } from "vitest";

import { buildThinkingParam, requiredBetas } from "./config.js";

describe("buildThinkingParam", () => {
    // Adaptive matches the API default, but `display` does not: omitting it
    // makes the model reason, bill the tokens, and return nothing.
    it("requests summarized reasoning by default so thinking is visible", () => {
        expect(buildThinkingParam({})).toEqual({ type: "adaptive", display: "summarized" });
        expect(buildThinkingParam({ thinkingType: "adaptive" })).toEqual({
            type: "adaptive",
            display: "summarized",
        });
    });

    it("switches thinking off when asked explicitly", () => {
        expect(buildThinkingParam({ thinkingType: "disabled" })).toEqual({ type: "disabled" });
    });

    it("honours an explicit display mode", () => {
        expect(buildThinkingParam({ thinkingType: "adaptive", thinkingDisplay: "omitted" })).toEqual({
            type: "adaptive",
            display: "omitted",
        });
    });
});

describe("requiredBetas", () => {
    // The API rejects `compact_20260112` outright without this header.
    it("adds the compaction beta when compaction is on", () => {
        expect(requiredBetas({})).toContain("compact-2026-01-12");
        expect(requiredBetas({ enableCompaction: true })).toContain("compact-2026-01-12");
    });

    it("omits the compaction beta when compaction is off", () => {
        expect(requiredBetas({ enableCompaction: false })).not.toContain("compact-2026-01-12");
    });

    it("always requests context management", () => {
        expect(requiredBetas({ enableCompaction: false })).toContain("context-management-2025-06-27");
    });
});
