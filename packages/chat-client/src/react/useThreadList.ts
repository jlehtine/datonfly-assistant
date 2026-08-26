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

/** Default cap on how many threads are kept in memory (and rendered); see {@link UseThreadListOptions.maxLoadedThreads}. */
const DEFAULT_MAX_LOADED_THREADS = 500;

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
    /**
     * Maximum number of threads kept in memory at once. Defaults to 500.
     *
     * Only enforced against `thread-created` events, which can arrive at any rate independent of
     * user scrolling — a tab left open otherwise accumulates every thread created from any device
     * or tab for its lifetime, unbounded, which crashed a dev-UI tab with out-of-memory during an
     * E2E run that created ~1500 threads. `loadMore`-driven growth is deliberately left uncapped:
     * it is paced by the user's own scrolling (self-limiting), and evicting from either end of the
     * list would break either "just loaded" content or scroll continuity without real virtualization.
     */
    maxLoadedThreads?: number | undefined;
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
    maxLoadedThreads = DEFAULT_MAX_LOADED_THREADS,
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

    // Lets the thread-created handler check current length before deciding whether its prepend
    // will evict, without needing `threads` as an effect/callback dependency.
    const threadsRef = useRef<Thread[]>(threads);
    useEffect(() => {
        threadsRef.current = threads;
    }, [threads]);

    const sortByUpdatedAt = (list: Thread[]): Thread[] =>
        [...list].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const fetchPage = useCallback(
        async (cursor?: { updatedAt: Date; id: string }): Promise<{ data: Thread[]; hasMore: boolean }> => {
            const query: Record<string, string> = { limit: String(pageSize) };
            if (includeArchived) query.includeArchived = "true";
            if (cursor) {
                query.cursorUpdatedAt = cursor.updatedAt.toISOString();
                query.cursorId = cursor.id;
            }
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
            const result = await fetchPage();
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
        // Seek from the last-seen thread's own position rather than `threads.length`, which
        // `thread-created` prepends can inflate independent of how many pages were actually
        // fetched, skipping or duplicating rows at the wrong offset.
        const last = threads[threads.length - 1];
        if (!last) return;
        loadingRef.current = true;
        setLoading(true);
        void (async () => {
            try {
                const result = await fetchPage({ updatedAt: last.updatedAt, id: last.id });
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
    }, [fetchPage, hasMore, threads]);

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

    // Keep a ref so WS event handlers can call markRead without re-registering.
    const markReadRef = useRef(markRead);
    useEffect(() => {
        markReadRef.current = markRead;
    }, [markRead]);

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
            if (threadsRef.current.some((t) => t.id === newThread.id)) return;
            // A tab left open otherwise accumulates every thread created from any device or tab for
            // its lifetime, unbounded — this crashed a dev-UI tab with out-of-memory during an E2E
            // run that created ~1500 threads. Cap by evicting the oldest loaded thread.
            const willEvict = threadsRef.current.length >= maxLoadedThreads;
            setThreads((prev) => {
                if (prev.some((t) => t.id === newThread.id)) return prev;
                const next = [newThread, ...prev];
                return next.length > maxLoadedThreads ? next.slice(0, maxLoadedThreads) : next;
            });
            if (willEvict) {
                // There is now definitely more history beyond what's cached, regardless of prior hasMore.
                setHasMore(true);
            }
        };
        client.on("thread-created", handler);
        return () => {
            client.off("thread-created", handler);
        };
    }, [client, maxLoadedThreads]);

    // Listen for new-message events to increment unread counts for threads not actively viewed.
    useEffect(() => {
        const handleNewMessage = (event: { threadId: string }): void => {
            const tid = event.threadId;
            const isActivelyViewing = tid === activelyViewingRef.current;
            setThreads((prev) =>
                sortByUpdatedAt(
                    prev.map((t) => {
                        if (t.id !== tid) return t;
                        return {
                            ...t,
                            ...(isActivelyViewing ? {} : { unreadCount: (t.unreadCount ?? 0) + 1 }),
                            updatedAt: new Date(),
                        };
                    }),
                ),
            );
        };

        const handleMessageComplete = (event: { threadId: string }): void => {
            const tid = event.threadId;
            const isActivelyViewing = tid === activelyViewingRef.current;
            setThreads((prev) =>
                sortByUpdatedAt(
                    prev.map((t) => {
                        if (t.id !== tid) return t;
                        return {
                            ...t,
                            ...(isActivelyViewing ? {} : { unreadCount: (t.unreadCount ?? 0) + 1 }),
                            updatedAt: new Date(),
                        };
                    }),
                ),
            );
            // Persist lastReadAt on the server so the unread count stays 0
            // after a page refresh or when opening from another tab.
            if (isActivelyViewing) {
                markReadRef.current(tid);
            }
        };

        client.on("new-message", handleNewMessage);
        client.on("message-complete", handleMessageComplete);
        return () => {
            client.off("new-message", handleNewMessage);
            client.off("message-complete", handleMessageComplete);
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

        client.on("thread-updated", handleThreadUpdated);
        return () => {
            client.off("thread-updated", handleThreadUpdated);
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
