import { describe, expect, it } from "vitest";

import { buildThinkingParam, requiredBetas } from "./config.js";

describe("buildThinkingParam", () => {
    it("omits the parameter when thinking is unconfigured, accepting the API default", () => {
        expect(buildThinkingParam({})).toBeUndefined();
    });

    it("switches thinking off when asked explicitly", () => {
        expect(buildThinkingParam({ thinkingType: "disabled" })).toEqual({ type: "disabled" });
    });

    // Without `display` the model reasons, bills the tokens, and returns empty
    // thinking blocks — reasoning paid for and never shown.
    it("requests summarized reasoning by default so thinking is visible", () => {
        expect(buildThinkingParam({ thinkingType: "adaptive" })).toEqual({
            type: "adaptive",
            display: "summarized",
        });
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
