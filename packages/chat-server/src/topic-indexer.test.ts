import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ISearchProvider } from "@datonfly-assistant/core";

import { indexThreadTopics } from "./topic-indexer.js";

// Named consts (rather than accessing `searchProvider.index` etc. at each assertion) so
// `expect(...)` refers to a plain function, not an interface-typed method access.
const index = vi.fn().mockResolvedValue(undefined);
const deleteByFilter = vi.fn().mockResolvedValue(undefined);

const searchProvider: ISearchProvider = {
    index,
    indexBatch: vi.fn(),
    search: vi.fn(),
    dropIndex: vi.fn(),
    updateThreadMembers: vi.fn(),
    delete: vi.fn(),
    deleteByFilter,
};

interface IndexedPoint {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
}

/** The point argument of an `index()` call, typed for assertions (avoids `any` from `vi.fn()`). */
function indexedPoints(): IndexedPoint[] {
    return index.mock.calls.map((call) => call[1] as IndexedPoint);
}

describe("indexThreadTopics", () => {
    beforeEach(() => {
        index.mockClear();
        deleteByFilter.mockClear();
    });

    it("clears the thread's old topic points before indexing the new set", async () => {
        await indexThreadTopics({
            searchProvider,
            threadId: "t1",
            title: "Robot lawnmowers",
            topics: ["GNSS navigation", "battery replacement"],
            memberIds: ["u1"],
            updatedAt: new Date("2026-01-01T00:00:00Z"),
        });

        expect(deleteByFilter).toHaveBeenCalledWith("messages", { threadId: "t1", kind: "topic" });
    });

    it("indexes one dense-only point per topic, prefixed with the title", async () => {
        await indexThreadTopics({
            searchProvider,
            threadId: "t1",
            title: "Robot lawnmowers",
            topics: ["GNSS navigation", "battery replacement"],
            memberIds: ["u1"],
            updatedAt: new Date("2026-01-01T00:00:00Z"),
        });

        expect(index).toHaveBeenCalledWith(
            "messages",
            expect.objectContaining({
                content: "Robot lawnmowers\nGNSS navigation",
                channels: { dense: true, sparse: false },
            }),
        );
        const topicPoint = indexedPoints().find((point) => point.content === "Robot lawnmowers\nGNSS navigation");
        expect(topicPoint?.metadata).toEqual(
            expect.objectContaining({ threadId: "t1", kind: "topic", topic: "GNSS navigation" }),
        );
        expect(index).toHaveBeenCalledWith(
            "messages",
            expect.objectContaining({ content: "Robot lawnmowers\nbattery replacement" }),
        );
    });

    it("always indexes a thread-card point, even with zero topics", async () => {
        await indexThreadTopics({
            searchProvider,
            threadId: "t1",
            title: "Just saying hello",
            topics: [],
            memberIds: ["u1"],
            updatedAt: new Date("2026-01-01T00:00:00Z"),
        });

        expect(index).toHaveBeenCalledTimes(1);
        const [point] = indexedPoints();
        expect(point?.content).toBe("Just saying hello");
        expect(point?.metadata).toEqual(expect.objectContaining({ threadId: "t1", kind: "thread-card" }));
    });

    it("derives stable point ids so re-indexing the same topic upserts in place", async () => {
        const call = async (): Promise<void> =>
            indexThreadTopics({
                searchProvider,
                threadId: "t1",
                title: "Robot lawnmowers",
                topics: ["GNSS navigation"],
                memberIds: ["u1"],
                updatedAt: new Date("2026-01-01T00:00:00Z"),
            });
        await call();
        const firstId = indexedPoints()[0]?.id;
        index.mockClear();
        await call();
        const secondId = indexedPoints()[0]?.id;
        expect(firstId).toBe(secondId);
    });
});
