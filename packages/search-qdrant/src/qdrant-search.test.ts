import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn().mockResolvedValue(undefined);
const deleteFn = vi.fn().mockResolvedValue(undefined);
const setPayload = vi.fn().mockResolvedValue(undefined);
const createPayloadIndex = vi.fn().mockResolvedValue(undefined);
const getCollections = vi.fn().mockResolvedValue({ collections: [{ name: "messages" }] });

vi.mock("@qdrant/js-client-rest", () => ({
    QdrantClient: vi.fn().mockImplementation(function QdrantClientMock() {
        return {
            upsert,
            delete: deleteFn,
            setPayload,
            getCollections,
            createPayloadIndex,
            createCollection: vi.fn().mockResolvedValue(undefined),
        };
    }),
}));

const { QdrantSearchProvider } = await import("./qdrant-search.js");
const { NOOP_PROVIDER_LOGGER } = await import("@datonfly-assistant/core");

function makeProvider(): InstanceType<typeof QdrantSearchProvider> {
    return new QdrantSearchProvider({
        qdrantUrl: "http://localhost:6333",
        embeddings: { embedQuery: vi.fn().mockResolvedValue([0.1, 0.2]) },
        logger: NOOP_PROVIDER_LOGGER,
    });
}

/** The vector of the single point passed to the most recent `upsert` call. */
function lastUpsertedVector(): Record<string, unknown> {
    const call = upsert.mock.calls.at(-1) as [string, { points: { vector: Record<string, unknown> }[] }] | undefined;
    const points = call?.[1].points ?? [];
    return points[0]?.vector ?? {};
}

describe("QdrantSearchProvider", () => {
    beforeEach(() => {
        upsert.mockClear();
        deleteFn.mockClear();
        setPayload.mockClear();
        createPayloadIndex.mockClear();
    });

    it("creates a keyword payload index on kind", async () => {
        const provider = makeProvider();
        await provider.index("messages", { id: "1", content: "hello", metadata: {} });
        expect(createPayloadIndex).toHaveBeenCalledWith(
            "messages",
            expect.objectContaining({ field_name: "kind", field_schema: "keyword" }),
        );
    });

    it("indexes both channels by default", async () => {
        const provider = makeProvider();
        await provider.index("messages", { id: "1", content: "hello", metadata: {} });
        const vector = lastUpsertedVector();
        expect(vector).toHaveProperty("dense");
        expect(vector).toHaveProperty("lexical");
    });

    it("skips the sparse vector when channels.sparse is false", async () => {
        const provider = makeProvider();
        await provider.index("messages", {
            id: "topic-1",
            content: "a topic",
            metadata: { kind: "topic" },
            channels: { dense: true, sparse: false },
        });
        const vector = lastUpsertedVector();
        expect(vector).toHaveProperty("dense");
        expect(vector).not.toHaveProperty("lexical");
    });

    it("skips the dense vector (and any embedding call) when channels.dense is false", async () => {
        const embedQuery = vi.fn().mockResolvedValue([0.1]);
        const provider = new QdrantSearchProvider({
            qdrantUrl: "http://localhost:6333",
            embeddings: { embedQuery },
            logger: NOOP_PROVIDER_LOGGER,
        });
        await provider.index("messages", {
            id: "msg-1",
            content: "hello",
            metadata: {},
            channels: { dense: false, sparse: true },
        });
        expect(embedQuery).not.toHaveBeenCalled();
        const vector = lastUpsertedVector();
        expect(vector).not.toHaveProperty("dense");
        expect(vector).toHaveProperty("lexical");
    });

    it("deleteByFilter scopes to a thread and, optionally, a kind", async () => {
        const provider = makeProvider();
        await provider.deleteByFilter("messages", { threadId: "t1", kind: "topic" });
        expect(deleteFn).toHaveBeenCalledWith(
            "messages",
            expect.objectContaining({
                filter: {
                    must: [
                        { key: "threadId", match: { value: "t1" } },
                        { key: "kind", match: { value: "topic" } },
                    ],
                },
            }),
        );
    });

    it("deleteByFilter omits the kind clause when not given", async () => {
        const provider = makeProvider();
        await provider.deleteByFilter("messages", { threadId: "t1" });
        expect(deleteFn).toHaveBeenCalledWith(
            "messages",
            expect.objectContaining({
                filter: { must: [{ key: "threadId", match: { value: "t1" } }] },
            }),
        );
    });

    it("updateThreadMembers filters by threadId only, so it applies to every point kind", async () => {
        const provider = makeProvider();
        await provider.updateThreadMembers("messages", "t1", ["u1", "u2"]);
        expect(setPayload).toHaveBeenCalledWith(
            "messages",
            expect.objectContaining({
                payload: { memberIds: ["u1", "u2"] },
                filter: { must: [{ key: "threadId", match: { value: "t1" } }] },
            }),
        );
    });
});
