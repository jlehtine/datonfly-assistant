import { useCallback, useEffect, useRef, useState } from "react";

import type { Thread } from "@verbal-assistant/core";

/** Options for {@link useThreadList}. */
export interface UseThreadListOptions {
    /** REST server base URL. */
    url: string;
    /** Optional callback that returns a JWT for authentication, or `null` for anonymous access. */
    getToken?: (() => string | null) | undefined;
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
}

/**
 * Fetch and manage the authenticated user's thread list from the REST API.
 *
 * Automatically refreshes whenever `includeArchived` changes.
 */
export function useThreadList({ url, getToken, includeArchived = false }: UseThreadListOptions): UseThreadListResult {
    const [threads, setThreads] = useState<Thread[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const refreshCountRef = useRef(0);

    const authHeaders = useCallback((): Record<string, string> => {
        const token = getToken?.();
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [getToken]);

    const fetchThreads = useCallback(async (): Promise<void> => {
        setLoading(true);
        setError(null);
        try {
            const qs = includeArchived ? "?includeArchived=true" : "";
            const res = await fetch(`${url}/threads${qs}`, {
                headers: authHeaders(),
            });
            if (!res.ok) {
                throw new Error(`Failed to load threads: ${res.statusText}`);
            }
            const data = (await res.json()) as (Omit<Thread, "createdAt" | "updatedAt" | "archivedAt"> & {
                createdAt: string;
                updatedAt: string;
                archivedAt?: string | null;
            })[];
            const parsed: Thread[] = data.map((t) => ({
                ...t,
                createdAt: new Date(t.createdAt),
                updatedAt: new Date(t.updatedAt),
                archivedAt: t.archivedAt ? new Date(t.archivedAt) : undefined,
            }));
            // Sort by most recently updated first
            parsed.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
            setThreads(parsed);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : "Failed to load threads");
        } finally {
            setLoading(false);
        }
    }, [url, includeArchived, authHeaders]);

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
            const res = await fetch(`${url}/threads/${threadId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                throw new Error(`Failed to update thread: ${res.statusText}`);
            }
            void fetchThreads();
        },
        [url, authHeaders, fetchThreads],
    );

    return { threads, loading, error, refresh, setArchived };
}
