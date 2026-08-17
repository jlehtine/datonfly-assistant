import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTrafficDumpingFetch } from "./traffic-dump.js";

async function readDumps(dir: string): Promise<Record<string, unknown>[]> {
    const files = (await readdir(dir)).sort();
    return Promise.all(
        files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf-8")) as Record<string, unknown>),
    );
}

describe("createTrafficDumpingFetch", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "traffic-dump-test-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("dumps a non-streaming exchange without leaking the API key", async () => {
        const fakeFetch = (): Promise<Response> =>
            Promise.resolve(
                new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );
        const dumpingFetch = createTrafficDumpingFetch(dir, fakeFetch);

        const response = await dumpingFetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": "sk-ant-secret", "content-type": "application/json" },
            body: JSON.stringify({ model: "claude-x", messages: [] }),
        });
        expect(await response.json()).toEqual({ ok: true });

        // Give the fire-and-forget dump write a tick to settle.
        await new Promise((resolve) => setTimeout(resolve, 20));

        const [dump] = await readDumps(dir);
        expect(dump).toBeDefined();
        expect(dump).toMatchObject({
            scenario: "live-traffic-dump",
            request: {
                method: "POST",
                path: "/v1/messages",
                body: { model: "claude-x", messages: [] },
            },
            response: { status: 200, body: JSON.stringify({ ok: true }) },
        });
        expect((dump.request as { headers: Record<string, string> }).headers["x-api-key"]).toBeUndefined();
        expect(typeof dump.capturedAt).toBe("string");
    });

    it("streams the response to the caller untouched while dumping the same bytes", async () => {
        const chunks = ["event: one\n\n", "event: two\n\n"];
        const fakeFetch = (): Promise<Response> => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
                    controller.close();
                },
            });
            return Promise.resolve(
                new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
            );
        };
        const dumpingFetch = createTrafficDumpingFetch(dir, fakeFetch);

        const response = await dumpingFetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { authorization: "Bearer secret" },
            body: JSON.stringify({ stream: true }),
        });
        expect(await response.text()).toBe(chunks.join(""));

        await new Promise((resolve) => setTimeout(resolve, 20));

        const [dump] = await readDumps(dir);
        expect(dump).toMatchObject({ response: { status: 200, body: chunks.join("") } });
        expect((dump.request as { headers: Record<string, string> }).headers.authorization).toBeUndefined();
        const frames = (dump.response as { frames?: { atMs: number; text: string }[] }).frames;
        expect(frames?.map((frame) => frame.text)).toEqual(chunks);
    });
});
