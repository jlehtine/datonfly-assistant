import { useCallback, useEffect, useRef, useState } from "react";

import { USERS_SEARCH_PATH, userSearchResultListWireSchema, type UserSearchResultWire } from "@datonfly-assistant/core";

import { typedFetch } from "../fetch.js";
import { useChatClient } from "./context.js";

/** Return value of {@link useUserSearch}. */
export interface UseUserSearchResult {
    /** Search results (excluding users already in `excludeUserIds`). */
    results: UserSearchResultWire[];
    /** `true` while a search request is in-flight. */
    isSearching: boolean;
    /** Trigger a search. The query is debounced internally. */
    search: (query: string) => void;
    /** Clear the current results. */
    clear: () => void;
}

/**
 * Debounced user search hook.
 *
 * Calls the `GET /datonfly-assistant/users/search` endpoint after a short
 * debounce and filters out users whose IDs appear in `excludeUserIds`.
 *
 * @param excludeUserIds - User IDs to omit from results (e.g. existing members).
 * @param debounceMs - Debounce delay in milliseconds. Defaults to 300.
 */
export function useUserSearch(excludeUserIds: string[], debounceMs = 300): UseUserSearchResult {
    const client = useChatClient();
    const [results, setResults] = useState<UserSearchResultWire[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const excludeRef = useRef(excludeUserIds);
    excludeRef.current = excludeUserIds;

    const search = useCallback(
        (query: string): void => {
            if (timerRef.current) clearTimeout(timerRef.current);

            if (!query.trim()) {
                setResults([]);
                setIsSearching(false);
                return;
            }

            setIsSearching(true);
            timerRef.current = setTimeout(() => {
                void typedFetch(client, USERS_SEARCH_PATH, userSearchResultListWireSchema, {
                    query: { q: query.trim() },
                })
                    .then((data) => {
                        const excludeSet = new Set(excludeRef.current);
                        setResults(data.filter((u) => !excludeSet.has(u.id)));
                    })
                    .catch(() => {
                        setResults([]);
                    })
                    .finally(() => {
                        setIsSearching(false);
                    });
            }, debounceMs);
        },
        [client, debounceMs],
    );

    const clear = useCallback((): void => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setResults([]);
        setIsSearching(false);
    }, []);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    return { results, isSearching, search, clear };
}
