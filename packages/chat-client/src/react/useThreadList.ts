import { useCallback, useEffect, useRef, useState } from "react";

import {
    ERROR_CODES,
    threadListWireSchema,
    threadPath,
    THREADS_PATH,
    threadUserStatePath,
    threadWireSchema,
    type Thread,
    type ThreadUpdatedEvent,
} from "@datonfly-assistant/core";

import { typedFetch } from "../fetch.js";
import { useChatClient } from "./context.js";
import type { ChatErrorInfo } from "./useMessages.js";

/** Options for {@link useThreadList}. */
export interface UseThreadListOptions {
    /** Whether to include archived threads. Defaults to `false`. */
    includeArchived?: boolean | undefined;
    /** Number of threads to fetch per page. Defaults to 20. */
    pageSize?: number | undefined;
    /**
     * Thread ID that the user is actively viewing (selected + tab visible).
     * New-message events for this thread will not increment its unread count.
     */
    activelyViewingThreadId?: string | null | undefined;
}

/** Return value of {@link useThreadList}. */
export interface UseThreadListResult {
    /** Ordered list of threads (most recently updated first). */
    threads: Thread[];
    /** `true` while the initial or refresh fetch is in progress. */
    loading: boolean;
    /** The most recent fetch error, or `null`. */
    error: ChatErrorInfo | null;
    /** Re-fetch the thread list from scratch. */
    refresh: () => void;
    /** Archive or unarchive a thread by ID. */
    setArchived: (threadId: string, archived: boolean) => Promise<void>;
    /** Mark a thread as read (set unread count to 0 and update last-read timestamp). */
    markRead: (threadId: string) => void;
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
    activelyViewingThreadId = null,
}: UseThreadListOptions = {}): UseThreadListResult {
    const client = useChatClient();
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<ChatErrorInfo | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const loadingRef = useRef(false);

    // Keep a ref so WS event handlers always see the latest value without
    // being listed as effect dependencies.
    const activelyViewingRef = useRef(activelyViewingThreadId);
    useEffect(() => {
        activelyViewingRef.current = activelyViewingThreadId;
    }, [activelyViewingThreadId]);

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
            console.error("[useThreadList] Failed to load threads:", e);
            setError({ code: ERROR_CODES.client_error, message: "Failed to load threads" });
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
                console.error("[useThreadList] Failed to load threads:", e);
                setError({ code: ERROR_CODES.client_error, message: "Failed to load threads" });
            } finally {
                setLoading(false);
                loadingRef.current = false;
            }
        })();
    }, [fetchPage, hasMore, threads.length]);

    const setArchived = useCallback(
        async (threadId: string, archived: boolean): Promise<void> => {
            const body = { archivedAt: archived ? new Date().toISOString() : null };
            // Optimistically update local state.
            setThreads((prev) =>
                sortByUpdatedAt(
                    prev.map((t) => (t.id === threadId ? { ...t, archivedAt: archived ? new Date() : undefined } : t)),
                ),
            );
            await typedFetch(client, threadUserStatePath(threadId), null, {
                method: "PATCH",
                body,
            });
        },
        [client],
    );

    const markRead = useCallback(
        (threadId: string): void => {
            const now = new Date();
            // Optimistic update.
            setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unreadCount: 0, lastReadAt: now } : t)));
            // Fire-and-forget PATCH.
            void typedFetch(client, threadUserStatePath(threadId), null, {
                method: "PATCH",
                body: { lastReadAt: now.toISOString() },
            }).catch((e: unknown) => {
                console.error("[useThreadList] Failed to mark thread as read:", e);
            });
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
            const newThread: Thread = { ...parsed.data, unreadCount: 0 };
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

    // Listen for new-message events to increment unread counts for threads not actively viewed.
    useEffect(() => {
        const handleNewMessage = (event: { threadId: string }): void => {
            const tid = event.threadId;
            if (tid === activelyViewingRef.current) return;
            setThreads((prev) =>
                sortByUpdatedAt(
                    prev.map((t) =>
                        t.id === tid ? { ...t, unreadCount: (t.unreadCount ?? 0) + 1, updatedAt: new Date() } : t,
                    ),
                ),
            );
        };

        const handleMessageComplete = (event: { threadId: string }): void => {
            const tid = event.threadId;
            if (tid === activelyViewingRef.current) return;
            setThreads((prev) =>
                sortByUpdatedAt(
                    prev.map((t) =>
                        t.id === tid ? { ...t, unreadCount: (t.unreadCount ?? 0) + 1, updatedAt: new Date() } : t,
                    ),
                ),
            );
        };

        client.on("new-message", handleNewMessage as Parameters<typeof client.on<"new-message">>[1]);
        client.on("message-complete", handleMessageComplete as Parameters<typeof client.on<"message-complete">>[1]);
        return () => {
            client.off("new-message", handleNewMessage as Parameters<typeof client.off<"new-message">>[1]);
            client.off(
                "message-complete",
                handleMessageComplete as Parameters<typeof client.off<"message-complete">>[1],
            );
        };
    }, [client]);

    // Listen for thread-updated events (auto-unarchive, multi-tab archive/read sync).
    useEffect(() => {
        const handleThreadUpdated = (event: ThreadUpdatedEvent): void => {
            setThreads((prev) =>
                sortByUpdatedAt(
                    prev.map((t) => {
                        if (t.id !== event.threadId) return t;
                        const updated = { ...t };
                        if (event.archived !== undefined) {
                            updated.archivedAt = event.archived ? (t.archivedAt ?? new Date()) : undefined;
                        }
                        if (event.unreadCount !== undefined) {
                            updated.unreadCount = event.unreadCount;
                        }
                        if (event.title !== undefined) {
                            if (t.titleManuallySet && event.titleManuallySet === false) return t;
                            updated.title = event.title;
                            if (event.titleManuallySet !== undefined) {
                                updated.titleManuallySet = event.titleManuallySet;
                            }
                        }
                        if (event.memoryEnabled !== undefined) {
                            updated.memoryEnabled = event.memoryEnabled;
                        }
                        return updated;
                    }),
                ),
            );
        };

        client.on("thread-updated", handleThreadUpdated as Parameters<typeof client.on<"thread-updated">>[1]);
        return () => {
            client.off("thread-updated", handleThreadUpdated as Parameters<typeof client.off<"thread-updated">>[1]);
        };
    }, [client]);

    return {
        threads,
        loading,
        error,
        refresh,
        setArchived,
        markRead,
        renameThread,
        updateThreadTitle,
        hasMore,
        loadMore,
    };
}
