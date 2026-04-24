import {
    THREAD_SEARCH_PATH,
    threadSearchResponseWireSchema,
    type ThreadSearchResultWire,
} from "@datonfly-assistant/core";

import type { ChatClient } from "./client.js";
import { typedFetch } from "./fetch.js";

/**
 * Search threads by semantic + keyword query.
 *
 * @param client - The chat client providing `basePath`.
 * @param query - Natural-language search query.
 * @param limit - Maximum number of results. Defaults to 10.
 * @param signal - Optional abort signal for cancellation.
 * @returns Array of thread search results.
 */
export async function searchThreads(
    client: ChatClient,
    query: string,
    limit?: number,
    signal?: AbortSignal,
): Promise<ThreadSearchResultWire[]> {
    const queryParams: Record<string, string> = { q: query };
    if (limit !== undefined) queryParams.limit = String(limit);

    const response = await typedFetch(client, THREAD_SEARCH_PATH, threadSearchResponseWireSchema, {
        query: queryParams,
        signal,
    });

    return response.results;
}
