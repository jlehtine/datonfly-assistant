import { describe, expect, it } from "vitest";

import { documentVector, fnv1a32, queryVector, tokenize } from "./bm25.js";

describe("tokenize", () => {
    it("keeps identifier-like tokens intact", () => {
        const tokens = tokenize("see ticket ABC-1234 for details", ["english"]);
        expect(tokens).toContain("abc-1234");
    });

    it("keeps mixed-case identifiers (camelCase) intact", () => {
        const tokens = tokenize("call getUserById next", ["english"]);
        expect(tokens).toContain("getuserbyid");
    });

    it("keeps email-like identifiers intact", () => {
        const tokens = tokenize("contact user@example.com now", ["english"]);
        expect(tokens).toContain("user@example.com");
    });

    it("also contributes word-segmented sub-tokens for punctuated identifiers", () => {
        const tokens = tokenize("see ticket ABC-1234 for details", ["english"]);
        expect(tokens).toContain("abc");
        expect(tokens).toContain("1234");
    });

    it("emits namespaced stems per configured language, leaving the surface form un-namespaced", () => {
        const tokens = tokenize("running", ["english"]);
        expect(tokens).toContain("running");
        expect(tokens.some((t) => t.startsWith("en:"))).toBe(true);
        expect(tokens).not.toContain("run");
    });

    it("runs every configured language's stemmer over every token, without detection", () => {
        const tokens = tokenize("cats", ["english", "finnish"]);
        expect(tokens.some((t) => t.startsWith("en:"))).toBe(true);
        expect(tokens.some((t) => t.startsWith("fi:"))).toBe(true);
    });

    it("does not build stopword lists — common words survive", () => {
        const tokens = tokenize("the quick fox", ["english"]);
        expect(tokens).toContain("the");
    });

    it("folds ASCII-foldable accented terms to an additional plain variant", () => {
        const tokens = tokenize("café", ["english"]);
        expect(tokens).toContain("café");
        expect(tokens).toContain("cafe");
    });
});

describe("fnv1a32", () => {
    it("is deterministic", () => {
        expect(fnv1a32("hello")).toBe(fnv1a32("hello"));
    });

    it("produces different hashes for different terms (in general)", () => {
        expect(fnv1a32("hello")).not.toBe(fnv1a32("world"));
    });

    it("always returns an unsigned 32-bit integer", () => {
        const hash = fnv1a32("some fairly long term to hash");
        expect(Number.isInteger(hash)).toBe(true);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(0xffffffff);
    });
});

describe("documentVector", () => {
    it("carries one entry per distinct term", () => {
        const vector = documentVector(["a", "b", "a", "c"]);
        expect(vector.indices).toHaveLength(3);
        expect(vector.values).toHaveLength(3);
    });

    it("matches the BM25 term-frequency formula", () => {
        const k1 = 1.5;
        const b = 0.75;
        const avgLen = 256;
        const tokens = ["term", "term", "other"];
        const vector = documentVector(tokens, { k1, b, avgLen });

        const len = tokens.length;
        const expectedForTf2 = (2 * (k1 + 1)) / (2 + k1 * (1 - b + (b * len) / avgLen));
        const termIndex = vector.indices.indexOf(fnv1a32("term"));
        expect(vector.values[termIndex]).toBeCloseTo(expectedForTf2);
    });

    it("gives a higher weight to a term repeated more often", () => {
        const single = documentVector(["term", "other"]);
        const repeated = documentVector(["term", "term", "term", "other"]);
        const singleWeight = single.values[single.indices.indexOf(fnv1a32("term"))] ?? 0;
        const repeatedWeight = repeated.values[repeated.indices.indexOf(fnv1a32("term"))] ?? 0;
        expect(repeatedWeight).toBeGreaterThan(singleWeight);
    });
});

describe("queryVector", () => {
    it("assigns weight 1.0 per distinct term, ignoring repeats", () => {
        const vector = queryVector(["a", "b", "a"]);
        expect(vector.indices).toHaveLength(2);
        expect(vector.values).toEqual([1.0, 1.0]);
    });
});
