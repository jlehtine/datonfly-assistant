/**
 * A fake Anthropic API that replays committed/synthesized fixtures over real
 * HTTP, so `AgentConfig.baseUrl` (or the SDK's own `ANTHROPIC_BASE_URL`) can
 * point a real backend at it for deterministic, free, fast E2E testing.
 *
 * Unlike {@link startFixtureServer}, which replays fixtures strictly in
 * request order for unit tests that control exactly what they send, this
 * selects a scenario by content (see `scenario-registry.ts`) since an E2E spec
 * drives the real app and has no way to sequence raw HTTP requests itself.
 */
import { watch, type FSWatcher } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

import {
    DEFAULT_FIXTURE_DIR,
    loadFileFixtures,
    loadScenarios,
    selectFixture,
    selectNonStreamingFixture,
    type FileFixture,
    type Scenario,
} from "./scenario-registry.js";
import { buildFrames } from "./timing.js";

/** Options for {@link startPlaybackServer}. */
export interface PlaybackServerOptions {
    /** Port to listen on. Defaults to an ephemeral port when omitted. */
    port?: number | undefined;
    /**
     * Replay speed multiplier: `8` (the default) replays roughly 8x faster
     * than the recorded/synthesized pacing. Use `1` for specs that need
     * realistic timing.
     */
    speed?: number | undefined;
    /** Directory to load fixtures from. Defaults to the committed `test/fixtures`. */
    fixtureDir?: string | undefined;
}

/** A running playback server. */
export interface PlaybackServer {
    /** Base URL to point an Anthropic client (or `ANTHROPIC_BASE_URL`) at. */
    readonly url: string;
    close(): Promise<void>;
}

/** Read a request body fully into a string. */
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
            resolve(Buffer.concat(chunks).toString("utf-8"));
        });
        req.on("error", reject);
    });
}

/** Resolve after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    scenarios: Scenario[],
    fileFixtures: Map<string, FileFixture>,
    speed: number,
): Promise<void> {
    // The caller can disconnect mid-stream (an interrupted turn, or a test's
    // browser context tearing down); without this the pacing loop below would
    // keep awaiting delays and writing to an already-closed socket.
    const clientGone = new AbortController();
    res.on("close", () => {
        clientGone.abort();
    });

    // Files API calls (fetching a generated file) are plain GETs with no body
    // and no scenario to select — served straight from their own fixture map.
    if (req.method === "GET") {
        const fixture = fileFixtures.get(req.url ?? "");
        if (!fixture) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: `no file fixture for ${req.url ?? ""}` }));
            return;
        }
        res.writeHead(fixture.response.status, fixture.response.headers);
        res.end(fixture.response.body);
        return;
    }

    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

    if (body.stream !== true) {
        const fixture = selectNonStreamingFixture(scenarios, body);
        if (!fixture) {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "no non-streaming fixture available (need title.json / triage.json)" }));
            return;
        }
        res.writeHead(fixture.response.status, fixture.response.headers);
        res.end(fixture.response.body);
        return;
    }

    const messages = (body.messages ?? []) as { role: string; content: unknown }[];
    const fixture = selectFixture(scenarios, messages);

    res.writeHead(fixture.response.status, fixture.response.headers);
    for (const frame of buildFrames(fixture.response)) {
        const waitMs = frame.delayMs / speed;
        if (waitMs > 0.5) await delay(waitMs);
        if (clientGone.signal.aborted || res.writableEnded) return;
        res.write(frame.text);
    }
    res.end();
}

/** Start a fake Anthropic API replaying fixtures, on an ephemeral port unless one is given. */
export async function startPlaybackServer(options: PlaybackServerOptions = {}): Promise<PlaybackServer> {
    const speed = options.speed ?? 8;
    let scenarios = await loadScenarios(options.fixtureDir);
    let fileFixtures = await loadFileFixtures(options.fixtureDir);

    // Reload when a fixture is added or edited. Without this an unloaded
    // fixture does not error, it silently falls back to the default scenario —
    // which surfaces as a puzzling assertion failure in whichever spec needed
    // it, rather than as an obvious problem with the harness.
    const fixtureDir = options.fixtureDir ?? DEFAULT_FIXTURE_DIR;
    let reloadTimer: NodeJS.Timeout | undefined;
    const scheduleReload = (): void => {
        clearTimeout(reloadTimer);
        // Debounced: an editor save can emit several events for one write.
        reloadTimer = setTimeout(() => {
            void Promise.all([loadScenarios(options.fixtureDir), loadFileFixtures(options.fixtureDir)])
                .then(([reloadedScenarios, reloadedFileFixtures]) => {
                    scenarios = reloadedScenarios;
                    fileFixtures = reloadedFileFixtures;
                })
                .catch((error: unknown) => {
                    process.stderr.write(
                        `fixture reload failed: ${error instanceof Error ? error.message : String(error)}\n`,
                    );
                });
        }, 150);
    };
    let watcher: FSWatcher | undefined;
    let filesWatcher: FSWatcher | undefined;
    try {
        watcher = watch(fixtureDir, scheduleReload);
    } catch {
        // Watching is a convenience; a platform that cannot do it still serves
        // the fixtures loaded at startup.
    }
    try {
        // Watched separately: `files/` is a subdirectory of `fixtureDir`, and
        // `fs.watch` isn't recursive on every platform.
        filesWatcher = watch(join(fixtureDir, "files"), scheduleReload);
    } catch {
        // The subdirectory may not exist for a fixtureDir with no file fixtures.
    }

    const server: Server = createServer((req, res) => {
        void handleRequest(req, res, scenarios, fileFixtures, speed).catch((error: unknown) => {
            // Once headers are sent, a second writeHead() throws
            // ERR_HTTP_HEADERS_SENT — that secondary throw would otherwise go
            // unhandled here and leave the connection hanging until the
            // client's own timeout, rather than surfacing the real error.
            if (res.writableEnded || res.headersSent) {
                if (!res.writableEnded) res.end();
                return;
            }
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : "playback failure" }));
        });
    });

    await new Promise<void>((resolve) => {
        server.listen(options.port ?? 0, resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Playback server did not bind to a TCP port.");
    }

    return {
        url: `http://127.0.0.1:${String(address.port)}`,
        close: () =>
            new Promise<void>((resolve, reject) => {
                clearTimeout(reloadTimer);
                watcher?.close();
                filesWatcher?.close();
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            }),
    };
}
