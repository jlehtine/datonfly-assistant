import {
    APIConnectionError,
    APIError,
    APIUserAbortError,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    PermissionDeniedError,
    RateLimitError,
} from "@anthropic-ai/sdk";

import { formatLoggedError, type ErrorCode } from "@datonfly-assistant/core";

/** Structured fields describing a failed Anthropic API call, for logging. */
export interface ApiErrorDetails {
    /** Constructor name of the SDK error class, e.g. `"RateLimitError"`. */
    errorName?: string | undefined;
    /** Full formatted error chain. */
    errorMessage?: string | undefined;
    /** Anthropic error type, e.g. `"invalid_request_error"`. */
    errorType?: string | undefined;
    /** HTTP status code returned by the API. */
    apiStatusCode?: number | undefined;
    /** Anthropic request identifier, for support escalation. */
    requestId?: string | undefined;
    /** Value of the `retry-after` response header, in seconds. */
    retryAfterSeconds?: number | undefined;
    /** Whether the failure was a caller-initiated abort rather than an API fault. */
    isAbortError?: boolean | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/** Read the Anthropic error `type` out of an API error's parsed body. */
function readErrorType(body: unknown): string | undefined {
    if (!isRecord(body)) return undefined;
    const inner: unknown = body.error;
    const source = isRecord(inner) ? inner : body;
    return typeof source.type === "string" ? source.type : undefined;
}

/** Read `retry-after` from response headers, in seconds. */
function readRetryAfterSeconds(headers: Headers | undefined): number | undefined {
    const raw = headers?.get("retry-after");
    if (raw === null || raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Describe a caught value as structured log fields.
 *
 * Uses the SDK's typed error classes instead of probing arbitrary properties,
 * so the shape of the log entry does not depend on transport internals.
 */
export function describeApiError(error: unknown): ApiErrorDetails {
    if (error instanceof APIUserAbortError) {
        return { errorName: error.constructor.name, errorMessage: formatLoggedError(error), isAbortError: true };
    }
    if (error instanceof APIError) {
        return {
            errorName: error.constructor.name,
            errorMessage: formatLoggedError(error),
            errorType: readErrorType(error.error as unknown),
            apiStatusCode: error.status as number | undefined,
            requestId: error.requestID ?? undefined,
            retryAfterSeconds: readRetryAfterSeconds(error.headers as Headers | undefined),
            isAbortError: false,
        };
    }
    return {
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: formatLoggedError(error),
        isAbortError: isAbortError(error),
    };
}

/** Whether a caught value represents a caller-initiated abort. */
export function isAbortError(error: unknown): boolean {
    if (error instanceof APIUserAbortError) return true;
    return error instanceof Error && error.name === "AbortError";
}

/**
 * Whether a caught value is a mid-stream `overloaded_error`.
 *
 * The SDK throws this straight from the SSE `event: error` frame as a bare
 * `APIError` with `status: undefined` (see `core/streaming.mjs`) — it is not
 * `RateLimitError`/`InternalServerError`, which only come from
 * `APIError.generate()` on a real HTTP status. So detection has to read the
 * Anthropic error `type` out of the body instead of using `instanceof`.
 */
export function isOverloadedError(error: unknown): boolean {
    if (!(error instanceof APIError)) return false;
    return readErrorType(error.error as unknown) === "overloaded_error";
}

/**
 * Map a caught value onto a machine-readable {@link ErrorCode}.
 *
 * Lets the gateway report a meaningful reason to the user instead of a generic
 * failure, without any caller having to parse provider error strings.
 */
export function toErrorCode(error: unknown): ErrorCode {
    if (error instanceof RateLimitError) return "rate_limited";
    if (error instanceof AuthenticationError) return "auth_required";
    if (error instanceof PermissionDeniedError) return "auth_required";
    if (error instanceof BadRequestError) return "invalid_request";
    if (error instanceof APIError) return "internal_error";
    return "unspecified";
}

/** Whether a failed request is worth retrying with the same input. */
export function isRetryableApiError(error: unknown): boolean {
    if (error instanceof RateLimitError) return true;
    if (error instanceof InternalServerError) return true;
    if (error instanceof APIConnectionError) return true;
    return false;
}
