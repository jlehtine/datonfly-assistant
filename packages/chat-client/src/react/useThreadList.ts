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
}

/** Return value of {@link useThreadList}. */
export interface UseThreadListResult {
    /** Ordered list of threads (most recently updated first). */
    threads: Thread[];
    /** `true` while the initial or refresh fetch is in progress. */
    loading: boolean;
    /** The most recent fetch error message, or `null`. */
    error: string | null;
    /** Re-fetch the thread list immediately. */
    refresh: () => void;
    /** Archive or unarchive a thread by ID and refresh the list. */
    setArchived: (threadId: string, archived: boolean) => Promise<void>;
    /** Rename a thread and refresh the list. */
    renameThread: (threadId: string, title: string) => Promise<void>;
    /** Update a single thread's title in-place without re-fetching. */
    updateThreadTitle: (threadId: string, title: string) => void;
}

/**
 * Fetch and manage the authenticated user's thread list from the REST API.
 *
 * Automatically refreshes whenever `includeArchived` changes.
 */
export function useThreadList({ includeArchived = false }: UseThreadListOptions = {}): UseThreadListResult {
    const client = useChatClient();
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const refreshCountRef = useRef(0);

    const fetchThreads = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const query = includeArchived ? { includeArchived: "true" } : undefined;
            const data = await typedFetch(client, THREADS_PATH, threadListWireSchema, { query });
            const sorted = [...data].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
            setThreads(sorted);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load threads");
        } finally {
            setLoading(false);
        }
    }, [client, includeArchived]);

    const refresh = useCallback(() => {
        refreshCountRef.current += 1;
        void fetchThreads();
    }, [fetchThreads]);

    useEffect(() => {
        void fetchThreads();
    }, [fetchThreads]);

    const setArchived = useCallback(
        async (threadId: string, archived: boolean): Promise<void> => {
            const body = { archivedAt: archived ? new Date().toISOString() : null };
            await typedFetch(client, threadPath(threadId), threadWireSchema, {
                method: "PATCH",
                body,
            });
            void fetchThreads();
        },
        [client, fetchThreads],
    );

    const renameThread = useCallback(
        async (threadId: string, title: string): Promise<void> => {
            await typedFetch(client, threadPath(threadId), threadWireSchema, {
                method: "PATCH",
                body: { title },
            });
            void fetchThreads();
        },
        [client, fetchThreads],
    );

    const updateThreadTitle = useCallback((threadId: string, title: string): void => {
        setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, title } : t)));
    }, []);

    return { threads, loading, error, refresh, setArchived, renameThread, updateThreadTitle };
}
