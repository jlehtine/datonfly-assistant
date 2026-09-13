import type { ISearchProvider } from "@datonfly-assistant/core";

import { derivePointId } from "./search-point-id.js";

const COLLECTION = "messages";

/** Options for {@link indexThreadTopics}. */
export interface IndexThreadTopicsOptions {
    /** Search provider to index into. */
    searchProvider: ISearchProvider;
    /** Thread the topics belong to. */
    threadId: string;
    /** Current thread title, prefixed onto every topic and the thread card for context. */
    title: string;
    /** Current topic set (may be empty for small-talk threads). */
    topics: string[];
    /** Thread members, for the same ACL payload the message channel uses. */
    memberIds: string[];
    /** Timestamp used for the recency formula (the thread's `updatedAt` at generation time). */
    updatedAt: Date;
}

/**
 * (Re)index a thread's dense-channel topic and thread-card points.
 *
 * Called after topics are (re)generated (`ThreadSummaryGenerator`) and whenever the title changes
 * (manual rename or auto-generated), since both the thread card and every topic's embedded text
 * are prefixed with the title. Deletes the thread's existing topic points first, since
 * regeneration replaces the whole set rather than patching individual entries — a shrunk topic
 * list would otherwise leave stale points behind.
 */
export async function indexThreadTopics(options: IndexThreadTopicsOptions): Promise<void> {
    const { searchProvider, threadId, title, topics, memberIds, updatedAt } = options;
    const createdAt = updatedAt.toISOString();
    const channels = { dense: true, sparse: false };

    await searchProvider.deleteByFilter(COLLECTION, { threadId, kind: "topic" });

    for (const [ordinal, topic] of topics.entries()) {
        await searchProvider.index(COLLECTION, {
            id: derivePointId(`topic:${threadId}:${ordinal.toString()}`),
            content: `${title}\n${topic}`,
            metadata: { threadId, kind: "topic", topic, memberIds, createdAt },
            channels,
        });
    }

    // Indexed even with zero topics, so small-talk / not-yet-generated threads still have a
    // title-based dense representation.
    await searchProvider.index(COLLECTION, {
        id: derivePointId(`thread-card:${threadId}`),
        content: [title, ...topics].join("\n"),
        metadata: { threadId, kind: "thread-card", memberIds, createdAt },
        channels,
    });
}
