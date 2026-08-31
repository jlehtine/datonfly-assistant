import type Anthropic from "@anthropic-ai/sdk";
import { APIConnectionError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_MAX_GENERATED_FILE_BYTES,
    fetchGeneratedFile,
    GeneratedFileTooLargeError,
    MAX_GENERATED_FILE_RETRIES,
} from "./generated-files.js";

function metadataOf(sizeBytes: number): unknown {
    return {
        id: "file_1",
        created_at: "2026-08-08T00:00:00Z",
        filename: "output.png",
        mime_type: "image/png",
        size_bytes: sizeBytes,
        type: "file",
        downloadable: true,
    };
}

function responseOf(bytes: Uint8Array): unknown {
    return { arrayBuffer: () => Promise.resolve(bytes.buffer) };
}

function fakeClient(retrieveMetadata: () => unknown, download: () => unknown): Anthropic {
    return {
        beta: {
            files: {
                retrieveMetadata: vi.fn(retrieveMetadata),
                download: vi.fn(download),
            },
        },
    } as unknown as Anthropic;
}

describe("fetchGeneratedFile", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("downloads a file's bytes and metadata on the first attempt", async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const client = fakeClient(
            () => metadataOf(bytes.length),
            () => responseOf(bytes),
        );

        const result = await fetchGeneratedFile(client, "file_1");

        expect(result).toEqual({ filename: "output.png", mimeType: "image/png", bytes });
    });

    it("retries a transient failure and succeeds once it clears", async () => {
        let calls = 0;
        const bytes = new Uint8Array([9]);
        const client = fakeClient(
            () => {
                calls++;
                if (calls === 1) throw new APIConnectionError({ message: "connection reset" });
                return metadataOf(bytes.length);
            },
            () => responseOf(bytes),
        );

        const promise = fetchGeneratedFile(client, "file_1");
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toEqual({ filename: "output.png", mimeType: "image/png", bytes });
        expect(calls).toBe(2);
    });

    it("gives up after exhausting the retry budget", async () => {
        let calls = 0;
        const client = fakeClient(() => {
            calls++;
            throw new APIConnectionError({ message: "connection reset" });
        }, vi.fn());

        const promise = fetchGeneratedFile(client, "file_1");
        promise.catch(() => {
            // Prevent unhandled rejection while the fake timers advance below.
        });
        await vi.runAllTimersAsync();

        await expect(promise).rejects.toBeInstanceOf(APIConnectionError);
        expect(calls).toBe(MAX_GENERATED_FILE_RETRIES + 1);
    });

    it("does not retry when the file exceeds the size cap", async () => {
        let calls = 0;
        const client = fakeClient(() => {
            calls++;
            return metadataOf(DEFAULT_MAX_GENERATED_FILE_BYTES + 1);
        }, vi.fn());

        await expect(fetchGeneratedFile(client, "file_1")).rejects.toBeInstanceOf(GeneratedFileTooLargeError);
        expect(calls).toBe(1);
    });
});
