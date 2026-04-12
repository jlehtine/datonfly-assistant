import type { z } from "zod";

import type { ErrorCode } from "@datonfly-assistant/core";

import type { ChatClient } from "./client.js";

/**
 * Error subclass that may carry a machine-readable {@link ErrorCode}.
 *
 * When the server responds with a JSON body containing a `code` field, it is
 * attached to this error so callers can handle it programmatically.
 */
export class ChatError extends Error {
    readonly code: ErrorCode | undefined;

    constructor(message: string, code?: ErrorCode) {
        super(message);
        this.name = "ChatError";
        this.code = code;
    }
}

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
 * Builds the full URL from `client.basePath + path` and parses
 * the JSON response through the provided Zod schema. Authentication
 * is handled automatically via HTTP-only cookies.
 *
 * When `schema` is `null` the response body is not parsed and the
 * return type is `null` — useful for endpoints that return 204 No Content.
 *
 * @param client - The chat client providing `basePath`.
 * @param path - Absolute endpoint path (e.g. {@link THREADS_PATH}).
 * @param schema - Zod schema used to parse and validate the response body, or `null` to skip parsing.
 * @param options - Optional HTTP method, body, and query parameters.
 * @returns The parsed and validated response data, or `null` when `schema` is `null`.
 */
/** Overload: schema provided → returns `T`. */
export async function typedFetch<T>(
    client: ChatClient,
    path: string,
    schema: z.ZodType<T>,
    options?: TypedFetchOptions,
): Promise<T>;
/** Overload: `null` schema → returns `null` (for 204 No Content). */
export async function typedFetch(
    client: ChatClient,
    path: string,
    schema: null,
    options?: TypedFetchOptions,
): Promise<null>;
export async function typedFetch<T>(
    client: ChatClient,
    path: string,
    schema: z.ZodType<T> | null,
    options: TypedFetchOptions = {},
): Promise<T | null> {
    const { method = "GET", body, query } = options;

    let url = client.basePath + path;
    if (query) {
        const params = new URLSearchParams(query);
        url += `?${params.toString()}`;
    }

    const headers: Record<string, string> = {};
    if (body !== undefined) {
        headers["Content-Type"] = "application/json";
    }

    const res = await fetch(url, {
        method,
        headers,
        credentials: "include",
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
        let code: ErrorCode | undefined;
        let message = `${method} ${path} failed: ${res.statusText}`;
        try {
            const body: unknown = await res.json();
            if (typeof body === "object" && body !== null) {
                const obj = body as Record<string, unknown>;
                if (typeof obj.code === "string") code = obj.code as ErrorCode;
                if (typeof obj.message === "string") message = obj.message;
            }
        } catch {
            // Response body is not JSON — use the default message.
        }
        throw new ChatError(message, code);
    }

    if (!schema || res.status === 204) return null;

    const json: unknown = await res.json();
    return schema.parse(json);
}
