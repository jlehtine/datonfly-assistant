import type { IndexDocumentOptions, ISearchProvider } from "@datonfly-assistant/core";

import { derivePointId } from "./search-point-id.js";

const COLLECTION = "messages";

/** A thread's current title, topics, members and recency timestamp, for building index documents. */
export interface ThreadTopicDocumentsInput {
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
 * Build the dense-only topic and thread-card index documents for a thread's current title and
 * topics — one per topic plus a trailing thread-card document (title + all topics joined),
 * indexed even with zero topics so small-talk / not-yet-generated threads still get a
 * title-based dense representation. Shared by `indexThreadTopics` (single-thread, incremental)
 * and the admin reindex's bulk topic pass, so the two can never drift apart in point shape.
 */
export function buildThreadTopicDocuments(input: ThreadTopicDocumentsInput): IndexDocumentOptions[] {
    const { threadId, title, topics, memberIds, updatedAt } = input;
    const createdAt = updatedAt.toISOString();
    const channels = { dense: true, sparse: false };

    const documents: IndexDocumentOptions[] = topics.map((topic, ordinal) => ({
        id: derivePointId(`topic:${threadId}:${ordinal.toString()}`),
        content: `${title}\n${topic}`,
        metadata: { threadId, kind: "topic", topic, memberIds, createdAt },
        channels,
    }));

    documents.push({
        id: derivePointId(`thread-card:${threadId}`),
        content: [title, ...topics].join("\n"),
        metadata: { threadId, kind: "thread-card", memberIds, createdAt },
        channels,
    });

    return documents;
}

/** Options for {@link indexThreadTopics}. */
export interface IndexThreadTopicsOptions extends ThreadTopicDocumentsInput {
    /** Search provider to index into. */
    searchProvider: ISearchProvider;
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
    const { searchProvider, ...input } = options;
    await searchProvider.deleteByFilter(COLLECTION, { threadId: input.threadId, kind: "topic" });
    for (const document of buildThreadTopicDocuments(input)) {
        await searchProvider.index(COLLECTION, document);
    }
}
