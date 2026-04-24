import { useCallback, useEffect, useRef, useState } from "react";

import type { ThreadSearchResultWire } from "@datonfly-assistant/core";

import { searchThreads } from "../search.js";
import { useChatClient } from "./context.js";

/** Return value of {@link useThreadSearch}. */
export interface UseThreadSearchResult {
    /** Current search query text. */
    query: string;
    /** Update the search query. Triggers a debounced search when ≥ 2 characters. */
    setQuery: (query: string) => void;
    /** Search results from the most recent successful query. */
    results: ThreadSearchResultWire[];
    /** `true` while a search request is in-flight. */
    isSearching: boolean;
    /** Clear the search query and results. */
    clearSearch: () => void;
}

/**
 * Debounced thread search hook.
 *
 * Calls `GET /datonfly-assistant/threads/search` after a short debounce.
 * Requires at least 2 characters before firing a request. Previous
 * in-flight requests are automatically cancelled via AbortController.
 *
 * @param debounceMs - Debounce delay in milliseconds. Defaults to 300.
 */
export function useThreadSearch(debounceMs = 300): UseThreadSearchResult {
    const client = useChatClient();
    const [query, setQueryState] = useState("");
    const [results, setResults] = useState<ThreadSearchResultWire[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const setQuery = useCallback(
        (q: string): void => {
            setQueryState(q);

            if (timerRef.current) clearTimeout(timerRef.current);
            if (abortRef.current) abortRef.current.abort();

            if (q.trim().length < 2) {
                setResults([]);
                setIsSearching(false);
                return;
            }

            setIsSearching(true);
            timerRef.current = setTimeout(() => {
                const controller = new AbortController();
                abortRef.current = controller;

                void searchThreads(client, q.trim(), undefined, controller.signal)
                    .then((data) => {
                        if (!controller.signal.aborted) {
                            setResults(data);
                        }
                    })
                    .catch((error: unknown) => {
                        if (error instanceof DOMException && error.name === "AbortError") return;
                        if (!controller.signal.aborted) {
                            setResults([]);
                        }
                    })
                    .finally(() => {
                        if (!controller.signal.aborted) {
                            setIsSearching(false);
                        }
                    });
            }, debounceMs);
        },
        [client, debounceMs],
    );

    const clearSearch = useCallback((): void => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (abortRef.current) abortRef.current.abort();
        setQueryState("");
        setResults([]);
        setIsSearching(false);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            if (abortRef.current) abortRef.current.abort();
        };
    }, []);

    return { query, setQuery, results, isSearching, clearSearch };
}
