import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A recorded Anthropic exchange, as stored under `test/fixtures/`. */
export interface Fixture {
    scenario: string;
    request: {
        method: string;
        path: string;
        headers: Record<string, string>;
        body: Record<string, unknown>;
    };
    response: {
        status: number;
        headers: Record<string, string>;
        body: string;
        /**
         * Per-chunk arrival timing, `atMs` relative to the request being sent.
         * Optional: absent on every fixture committed so far, in which case the
         * playback server paces replay with a synthesized model instead.
         */
        frames?: { atMs: number; text: string }[] | undefined;
    };
}

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures");

/** Load a recorded fixture by name (without the `.json` suffix). */
export async function loadFixture(name: string): Promise<Fixture> {
    const raw = await readFile(join(FIXTURE_DIR, `${name}.json`), "utf-8");
    return JSON.parse(raw) as Fixture;
}

/** A running replay server and the requests it has received. */
export interface FixtureServer {
    /** Base URL to point an Anthropic client at. */
    baseUrl: string;
    /** Request bodies received so far, in order. */
    requests: Record<string, unknown>[];
    /** Stop the server. */
    close(): Promise<void>;
}

/**
 * Serve recorded fixtures over HTTP, in order, on an ephemeral port.
 *
 * Replaying at the transport boundary means the provider is exercised through
 * its real SDK, HTTP stack, and SSE parser — the parts most likely to break —
 * rather than against a hand-written stub of the SDK's surface.
 *
 * Once the fixture list is exhausted the last one repeats, so a scenario that
 * relies on SDK-level retries does not run off the end.
 */
export async function startFixtureServer(fixtures: Fixture[]): Promise<FixtureServer> {
    if (fixtures.length === 0) throw new Error("startFixtureServer requires at least one fixture.");
    const requests: Record<string, unknown>[] = [];
    let served = 0;

    const server: Server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            try {
                requests.push(JSON.parse(raw) as Record<string, unknown>);
            } catch {
                requests.push({});
            }
            const fixture = fixtures[Math.min(served, fixtures.length - 1)];
            served += 1;
            if (!fixture) {
                res.writeHead(500).end();
                return;
            }
            res.writeHead(fixture.response.status, fixture.response.headers);
            res.end(fixture.response.body);
        });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Fixture server did not bind to a TCP port.");
    }

    return {
        baseUrl: `http://127.0.0.1:${address.port.toString()}`,
        requests,
        close: () =>
            new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            }),
    };
}

/** Load the named fixtures and start a server replaying them in order. */
export async function serveFixtures(...names: string[]): Promise<FixtureServer> {
    const fixtures = await Promise.all(names.map(loadFixture));
    return startFixtureServer(fixtures);
}
