import { describe, expect, it } from "vitest";

import { derivePointId } from "./search-point-id.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("derivePointId", () => {
    it("returns a valid UUIDv5 (version and variant nibbles set)", () => {
        expect(derivePointId("topic:thread-1:0")).toMatch(UUID_RE);
    });

    it("is deterministic for the same name", () => {
        expect(derivePointId("thread-card:thread-1")).toBe(derivePointId("thread-card:thread-1"));
    });

    it("differs for different names", () => {
        expect(derivePointId("topic:thread-1:0")).not.toBe(derivePointId("topic:thread-1:1"));
        expect(derivePointId("topic:thread-1:0")).not.toBe(derivePointId("topic:thread-2:0"));
    });
});
