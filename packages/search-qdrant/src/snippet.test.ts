import { describe, expect, it } from "vitest";

import { selectSnippet } from "./snippet.js";

function firstHighlight(highlights: [number, number][]): [number, number] {
    const [highlight] = highlights;
    if (!highlight) throw new Error("expected at least one highlight");
    return highlight;
}

describe("selectSnippet", () => {
    it("falls back to the content prefix when nothing matches", () => {
        const content = "no relevant words here at all, just filler text for padding purposes";
        const result = selectSnippet(content, "xyzzy", ["english"], 20);
        expect(result.snippet).toBe(`${content.slice(0, 20)}…`);
        expect(result.highlights).toEqual([]);
    });

    it("does not truncate content shorter than snippetChars", () => {
        const content = "short content";
        const result = selectSnippet(content, "short", ["english"], 400);
        expect(result.snippet).toBe(content);
    });

    it("highlights an exact-word match at the correct offset", () => {
        const content = "the quick brown fox jumps over the lazy dog";
        const result = selectSnippet(content, "fox", ["english"], 400);
        expect(result.snippet).toBe(content);
        expect(result.highlights).toHaveLength(1);
        const [start, end] = firstHighlight(result.highlights);
        expect(result.snippet.slice(start, end)).toBe("fox");
    });

    it("matches a stemmed inflection of the query", () => {
        const content = "yesterday she was running in the park";
        const result = selectSnippet(content, "run", ["english"], 400);
        expect(result.highlights).toHaveLength(1);
        const [start, end] = firstHighlight(result.highlights);
        expect(result.snippet.slice(start, end)).toBe("running");
    });

    it("selects the window with the most matches when content exceeds snippetChars", () => {
        const filler = "z".repeat(60);
        const content = `${filler} needle needle needle ${filler}`;
        const result = selectSnippet(content, "needle", ["english"], 40);
        const needleCount = (result.snippet.match(/needle/g) ?? []).length;
        expect(needleCount).toBe(3);
        expect(result.highlights).toHaveLength(3);
        for (const [start, end] of result.highlights) {
            expect(result.snippet.slice(start, end)).toBe("needle");
        }
    });

    it("adds ellipsis markers and keeps highlight offsets correct when truncated on both sides", () => {
        const filler = "z".repeat(60);
        const content = `${filler} needle ${filler}`;
        const result = selectSnippet(content, "needle", ["english"], 20);
        expect(result.snippet.startsWith("…")).toBe(true);
        expect(result.snippet.endsWith("…")).toBe(true);
        expect(result.highlights).toHaveLength(1);
        const [start, end] = firstHighlight(result.highlights);
        expect(result.snippet.slice(start, end)).toBe("needle");
    });

    it("handles accented, multi-byte content and matches an ASCII-folded query", () => {
        const content = "we had a lovely café near the station";
        const result = selectSnippet(content, "cafe", ["english"], 400);
        expect(result.highlights).toHaveLength(1);
        const [start, end] = firstHighlight(result.highlights);
        expect(result.snippet.slice(start, end)).toBe("café");
    });
});
