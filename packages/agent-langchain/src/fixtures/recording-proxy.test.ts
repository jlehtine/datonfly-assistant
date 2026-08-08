import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scrubSecrets, startRecordingProxy, type RecordedExchange, type RecordingProxy } from "./recording-proxy.js";

/** A stand-in upstream that streams a short SSE body and echoes nothing sensitive. */
function startFakeUpstream(): Promise<{ url: string; close: () => Promise<void> }> {
    const server: Server = createServer((_req, res) => {
        res.writeHead(200, {
            "content-type": "text/event-stream",
            "anthropic-organization-id": "org-should-not-be-recorded",
            "set-cookie": "session=should-not-be-recorded",
        });
        res.write("event: message_start\ndata: {}\n\n");
        res.end("event: message_stop\ndata: {}\n\n");
    });
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address === null || typeof address === "string") throw new Error("no port");
            resolve({
                url: `http://127.0.0.1:${address.port.toString()}`,
                close: () =>
                    new Promise<void>((done, fail) => {
                        server.close((error) => {
                            if (error) fail(error);
                            else done();
                        });
                    }),
            });
        });
    });
}

describe("scrubSecrets", () => {
    it("redacts Anthropic keys and bearer tokens", () => {
        const text = 'key=sk-ant-api03-AbCdEf_12-34 and "Authorization: Bearer abc.def-123"';
        expect(scrubSecrets(text)).toBe('key=<REDACTED> and "Authorization: <REDACTED>"');
    });

    it("leaves ordinary text untouched", () => {
        expect(scrubSecrets("no secrets here")).toBe("no secrets here");
    });
});

describe("startRecordingProxy", () => {
    let proxy: RecordingProxy | undefined;
    let upstream: { url: string; close: () => Promise<void> } | undefined;
    let outputDir: string | undefined;

    afterEach(async () => {
        await proxy?.close();
        await upstream?.close();
        if (outputDir) await rm(outputDir, { recursive: true, force: true });
        proxy = undefined;
        upstream = undefined;
        outputDir = undefined;
    });

    it("records an exchange without any credentials", async () => {
        upstream = await startFakeUpstream();
        proxy = await startRecordingProxy({ apiKey: "sk-ant-real-key", upstream: upstream.url });
        proxy.setScenario("plain-text");

        const response = await fetch(`${proxy.url}/v1/messages`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": "sk-ant-caller-key",
                authorization: "Bearer caller-token",
                cookie: "session=abc",
            },
            body: JSON.stringify({ model: "claude-test", note: "leaked sk-ant-inline-key" }),
        });
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain("message_start");

        outputDir = await mkdtemp(join(tmpdir(), "fixture-test-"));
        const written = await proxy.flush("plain-text", outputDir);
        expect(written).toHaveLength(1);

        const recorded = JSON.parse(await readFile(written[0] ?? "", "utf-8")) as RecordedExchange;
        const serialized = JSON.stringify(recorded);

        expect(serialized).not.toContain("sk-ant-real-key");
        expect(serialized).not.toContain("sk-ant-caller-key");
        expect(serialized).not.toContain("caller-token");
        expect(serialized).not.toContain("session=abc");
        expect(recorded.request.headers["x-api-key"]).toBeUndefined();
        expect(recorded.request.headers.authorization).toBeUndefined();
        expect(recorded.request.headers.cookie).toBeUndefined();
        expect(recorded.request.headers["content-type"]).toBe("application/json");
        expect(recorded.request.body).toMatchObject({ model: "claude-test", note: "leaked <REDACTED>" });
    });

    it("keeps only the response headers a replay needs", async () => {
        upstream = await startFakeUpstream();
        proxy = await startRecordingProxy({ apiKey: "sk-ant-real-key", upstream: upstream.url });
        proxy.setScenario("plain-text");

        await (await fetch(`${proxy.url}/v1/messages`, { method: "POST", body: "{}" })).text();

        outputDir = await mkdtemp(join(tmpdir(), "fixture-test-"));
        const [file] = await proxy.flush("plain-text", outputDir);
        const recorded = JSON.parse(await readFile(file ?? "", "utf-8")) as RecordedExchange;

        expect(Object.keys(recorded.response.headers)).toEqual(["content-type"]);
        expect(recorded.response.status).toBe(200);
        expect(recorded.response.body).toBe("event: message_start\ndata: {}\n\nevent: message_stop\ndata: {}\n\n");
    });

    it("numbers fixtures when a scenario issues several calls", async () => {
        upstream = await startFakeUpstream();
        proxy = await startRecordingProxy({ apiKey: "sk-ant-real-key", upstream: upstream.url });
        proxy.setScenario("tool-loop");

        await (await fetch(`${proxy.url}/v1/messages`, { method: "POST", body: "{}" })).text();
        await (await fetch(`${proxy.url}/v1/messages`, { method: "POST", body: "{}" })).text();

        outputDir = await mkdtemp(join(tmpdir(), "fixture-test-"));
        const written = await proxy.flush("tool-loop", outputDir);

        expect(written.map((path) => path.split("/").pop())).toEqual(["tool-loop-01.json", "tool-loop-02.json"]);
    });
});
