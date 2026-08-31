import type Anthropic from "@anthropic-ai/sdk";

import type { GeneratedFileData } from "@datonfly-assistant/core";

import { isRetryableApiError } from "./errors.js";

/** Beta header required to use the Files API. */
export const FILES_API_BETA = "files-api-2025-04-14";

/** Bounded retries for a failed generated-file download (fail-fast + bounded retry, see TODO.md). */
export const MAX_GENERATED_FILE_RETRIES = 3;

/** Base delay before the first retry; doubles for each subsequent one. */
export const GENERATED_FILE_RETRY_BASE_DELAY_MS = 500;

/** Default cap on a single generated file's size, applied while downloading. */
export const DEFAULT_MAX_GENERATED_FILE_BYTES = 25 * 1024 * 1024;

/** Thrown when a generated file exceeds the configured size cap. Never retried. */
export class GeneratedFileTooLargeError extends Error {
    constructor(
        readonly fileId: string,
        readonly sizeBytes: number,
        readonly maxBytes: number,
    ) {
        super(
            `Generated file ${fileId} is ${sizeBytes.toString()} bytes, exceeding the ${maxBytes.toString()}-byte cap`,
        );
        this.name = "GeneratedFileTooLargeError";
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether a failed download is worth retrying with the same file ID. */
function isRetryableFileError(error: unknown): boolean {
    if (error instanceof GeneratedFileTooLargeError) return false;
    return isRetryableApiError(error);
}

/** One attempt at retrieving metadata and downloading a generated file's bytes. */
async function downloadOnce(
    client: Anthropic,
    fileId: string,
    maxBytes: number,
    signal: AbortSignal | undefined,
): Promise<GeneratedFileData> {
    const requestOptions = signal ? { signal } : {};
    const metadata = await client.beta.files.retrieveMetadata(fileId, { betas: [FILES_API_BETA] }, requestOptions);
    if (metadata.size_bytes > maxBytes) {
        throw new GeneratedFileTooLargeError(fileId, metadata.size_bytes, maxBytes);
    }
    const response = await client.beta.files.download(fileId, { betas: [FILES_API_BETA] }, requestOptions);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
        throw new GeneratedFileTooLargeError(fileId, arrayBuffer.byteLength, maxBytes);
    }
    return {
        filename: metadata.filename,
        mimeType: metadata.mime_type,
        bytes: new Uint8Array(arrayBuffer),
    };
}

/**
 * Download a generated file from the Files API by its provider file ID.
 *
 * Retries a transient failure (rate limit, server error, connection error) a
 * bounded number of times with exponential backoff before giving up; an
 * oversized file is never retried. This is the whole of the "fetch-failure
 * handling" decision in TODO.md — there is no persisted pending state and no
 * later retry, so a caller that exhausts this should drop the file and move on.
 */
export async function fetchGeneratedFile(
    client: Anthropic,
    fileId: string,
    maxBytes: number = DEFAULT_MAX_GENERATED_FILE_BYTES,
    signal?: AbortSignal,
): Promise<GeneratedFileData> {
    for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        try {
            return await downloadOnce(client, fileId, maxBytes, signal);
        } catch (error) {
            if (attempt >= MAX_GENERATED_FILE_RETRIES || !isRetryableFileError(error)) throw error;
            await delay(GENERATED_FILE_RETRY_BASE_DELAY_MS * 2 ** attempt);
        }
    }
}
