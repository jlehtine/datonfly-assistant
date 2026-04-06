import { useCallback, useEffect, useRef, useState } from "react";

import {
    threadListWireSchema,
    threadPath,
    THREADS_PATH,
    threadWireSchema,
    type Thread,
} from "@datonfly-assistant/core";

import { typedFetch } from "../fetch.js";
import { useChatClient } from "./context.js";

/** Options for {@link useThreadList}. */
export interface UseThreadListOptions {
    /** Whether to include archived threads. Defaults to `false`. */
    includeArchived?: boolean | undefined;
    /** Number of threads to fetch per page. Defaults to 20. */
    pageSize?: number | undefined;
}

/** Return value of {@link useThreadList}. */
export interface UseThreadListResult {
    /** Ordered list of threads (most recently updated first). */
    threads: Thread[];
    /** `true` while the initial or refresh fetch is in progress. */
    loading: boolean;
    /** The most recent fetch error message, or `null`. */
    error: string | null;
    /** Re-fetch the thread list from scratch. */
    refresh: () => void;
    /** Archive or unarchive a thread by ID. */
    setArchived: (threadId: string, archived: boolean) => Promise<void>;
    /** Rename a thread. */
    renameThread: (threadId: string, title: string) => Promise<void>;
    /**
     * Update a single thread's title in-place without re-fetching.
     * When `titleManuallySet` is provided, the update is skipped if the local
     * thread already has `titleManuallySet === true` and the incoming value is `false`.
     */
    updateThreadTitle: (threadId: string, title: string, titleManuallySet?: boolean) => void;
    /** `true` when there are more threads to load. */
    hasMore: boolean;
    /** Load the next page of threads. */
    loadMore: () => void;
}

/**
 * Fetch and manage the authenticated user's thread list from the REST API.
 *
 * Automatically refreshes whenever `includeArchived` changes.
 */
export function useThreadList({
    includeArchived = false,
    pageSize = 20,
}: UseThreadListOptions = {}): UseThreadListResult {
    const client = useChatClient();
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const loadingRef = useRef(false);

    const sortByUpdatedAt = (list: Thread[]): Thread[] =>
        [...list].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const fetchPage = useCallback(
        async (offset: number): Promise<{ data: Thread[]; hasMore: boolean }> => {
            const query: Record<string, string> = { limit: String(pageSize), offset: String(offset) };
            if (includeArchived) query.includeArchived = "true";
            const data = await typedFetch(client, THREADS_PATH, threadListWireSchema, { query });
            return { data, hasMore: data.length === pageSize };
        },
        [client, includeArchived, pageSize],
    );

    const fetchInitial = useCallback(async (): Promise<void> => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        setLoading(true);
        setError(null);
        try {
            const result = await fetchPage(0);
            setThreads(sortByUpdatedAt(result.data));
            setHasMore(result.hasMore);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load threads");
        } finally {
            setLoading(false);
            loadingRef.current = false;
        }
    }, [fetchPage]);

    const refresh = useCallback(() => {
        void fetchInitial();
    }, [fetchInitial]);

    useEffect(() => {
        void fetchInitial();
    }, [fetchInitial]);

    const loadMore = useCallback(() => {
        if (loadingRef.current || !hasMore) return;
        loadingRef.current = true;
        setLoading(true);
        void (async () => {
            try {
                const result = await fetchPage(threads.length);
                setThreads((prev) => {
                    // Deduplicate in case new threads were inserted via WS.
                    const existingIds = new Set(prev.map((t) => t.id));
                    const newThreads = result.data.filter((t) => !existingIds.has(t.id));
                    return sortByUpdatedAt([...prev, ...newThreads]);
                });
                setHasMore(result.hasMore);
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Failed to load threads");
            } finally {
                setLoading(false);
                loadingRef.current = false;
            }
        })();
    }, [fetchPage, hasMore, threads.length]);

    const setArchived = useCallback(
        async (threadId: string, archived: boolean): Promise<void> => {
            const body = { archivedAt: archived ? new Date().toISOString() : null };
            const updated = await typedFetch(client, threadPath(threadId), threadWireSchema, {
                method: "PATCH",
                body,
            });
            setThreads((prev) => sortByUpdatedAt(prev.map((t) => (t.id === threadId ? updated : t))));
        },
        [client],
    );

    const renameThread = useCallback(
        async (threadId: string, title: string): Promise<void> => {
            // Optimistically mark the thread as manually titled so incoming
            // auto-title events don't overwrite it while the request is in flight.
            setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, title, titleManuallySet: true } : t)));
            const updated = await typedFetch(client, threadPath(threadId), threadWireSchema, {
                method: "PATCH",
                body: { title },
            });
            setThreads((prev) => sortByUpdatedAt(prev.map((t) => (t.id === threadId ? updated : t))));
        },
        [client],
    );

    const updateThreadTitle = useCallback((threadId: string, title: string, titleManuallySet?: boolean): void => {
        setThreads((prev) =>
            prev.map((t) => {
                if (t.id !== threadId) return t;
                // If the local thread was manually renamed but the incoming
                // update is an auto-generated title, skip the update.
                if (t.titleManuallySet && titleManuallySet === false) return t;
                return { ...t, title, ...(titleManuallySet !== undefined ? { titleManuallySet } : {}) };
            }),
        );
    }, []);

    // Listen for new threads created by other clients (or this client in another tab).
    useEffect(() => {
        const handler = (event: { thread: Record<string, unknown> }): void => {
            const parsed = threadWireSchema.safeParse(event.thread);
            if (!parsed.success) return;
            const newThread = parsed.data;
            setThreads((prev) => {
                // Avoid duplicates.
                if (prev.some((t) => t.id === newThread.id)) return prev;
                return [newThread, ...prev];
            });
        };
        client.on("thread-created", handler as Parameters<typeof client.on<"thread-created">>[1]);
        return () => {
            client.off("thread-created", handler as Parameters<typeof client.off<"thread-created">>[1]);
        };
    }, [client]);

    return { threads, loading, error, refresh, setArchived, renameThread, updateThreadTitle, hasMore, loadMore };
}
