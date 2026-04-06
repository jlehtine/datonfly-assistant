import type { z } from "zod";

import type { ChatClient } from "./client.js";

/** Options for {@link typedFetch}. */
export interface TypedFetchOptions {
    /** HTTP method. Defaults to `"GET"`. */
    method?: string | undefined;
    /** Request body (will be JSON-serialized). */
    body?: unknown;
    /** Additional query parameters appended to the URL. */
    query?: Record<string, string> | undefined;
}

/**
 * Perform a validated HTTP request through a {@link ChatClient}.
 *
 * Builds the full URL from `client.basePath + path`, injects the
 * authorization header when `client.getToken` is available, and parses
 * the JSON response through the provided Zod schema.
 *
 * @param client - The chat client providing `basePath` and `getToken`.
 * @param path - Absolute endpoint path (e.g. {@link THREADS_PATH}).
 * @param schema - Zod schema used to parse and validate the response body.
 * @param options - Optional HTTP method, body, and query parameters.
 * @returns The parsed and validated response data.
 */
export async function typedFetch<T>(
    client: ChatClient,
    path: string,
    schema: z.ZodType<T>,
    options: TypedFetchOptions = {},
): Promise<T> {
    const { method = "GET", body, query } = options;

    let url = client.basePath + path;
    if (query) {
        const params = new URLSearchParams(query);
        url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {};
    const token = client.getToken?.();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
        throw new Error(`${method} ${path} failed: ${res.statusText}`);
    }

    const json: unknown = await res.json();
    return schema.parse(json);
}
