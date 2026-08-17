/**
 * Dumps raw Anthropic API traffic (requests, responses, and streamed bytes) to
 * disk, so an occasional failure that isn't recovered automatically can be
 * inspected — and replayed — after the fact.
 *
 * Wraps the SDK's own `fetch` hook rather than a network proxy: it runs
 * in-process, needs no extra port, and sees the exact bytes the SDK sends and
 * receives. Each dumped file uses the same shape as `testing/fixture-server.ts`
 * expects (`{ scenario, request, response }`), so a captured failure can be fed
 * straight into `startFixtureServer()` to replay it.
 *
 * Dumped files contain full, unredacted conversation content — only
 * credentials are stripped. Only enable this for as long as needed to capture
 * a failure, and treat the output directory as sensitive.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Matches the SDK's own `fetch` option signature (`internal/builtin-types.ts`), not exported from the package root. */
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Request headers never written to disk. */
const SECRET_REQUEST_HEADERS = new Set(["x-api-key", "authorization", "proxy-authorization", "cookie"]);

/** Response headers kept on the dumped exchange; everything else is deployment-specific noise. */
const KEPT_RESPONSE_HEADERS = new Set(["content-type", "retry-after"]);

/**
 * Headers that describe the upstream *transfer* rather than the payload.
 *
 * `fetch` decodes and re-frames the body before exposing it, so relaying these
 * on the reconstructed `Response` would describe bytes the caller never
 * receives (see the identical concern in `fixtures/recording-proxy.ts`).
 */
const TRANSFER_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

function sanitizeRequestHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, name) => {
        if (!SECRET_REQUEST_HEADERS.has(name)) result[name] = value;
    });
    return result;
}

function keptResponseHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, name) => {
        if (KEPT_RESPONSE_HEADERS.has(name)) result[name] = value;
    });
    return result;
}

function passThroughHeaders(headers: Headers): Headers {
    const result = new Headers();
    headers.forEach((value, name) => {
        if (!TRANSFER_HEADERS.has(name)) result.set(name, value);
    });
    return result;
}

/** Parse a JSON request body, falling back to the raw string when it is not JSON. */
function parseBody(raw: string | undefined): unknown {
    if (!raw) return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/** One recorded request/response exchange, in the shape `testing/fixture-server.ts` replays. */
interface TrafficDump {
    capturedAt: string;
    scenario: "live-traffic-dump";
    request: { method: string; path: string; headers: Record<string, string>; body: unknown };
    response: {
        status: number;
        headers: Record<string, string>;
        body: string;
        frames?: { atMs: number; text: string }[];
    };
}

/** Read a streamed response body to completion, recording per-chunk arrival timing relative to `startedAt`. */
async function captureBody(
    stream: ReadableStream<Uint8Array>,
    startedAt: number,
): Promise<{ body: string; frames: { atMs: number; text: string }[] }> {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    const frames: { atMs: number; text: string }[] = [];
    let body = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        body += text;
        if (text.length > 0) frames.push({ atMs: Date.now() - startedAt, text });
    }
    const tail = decoder.decode();
    body += tail;
    if (tail.length > 0) frames.push({ atMs: Date.now() - startedAt, text: tail });
    return { body, frames };
}

let sequence = 0;

/** Write one captured exchange to `dir`. Logged, never thrown: a dump failure must not break the API call it observed. */
async function writeDump(dir: string, entry: TrafficDump): Promise<void> {
    try {
        await mkdir(dir, { recursive: true });
        const stamp = entry.capturedAt.replace(/[:.]/g, "-");
        const file = join(dir, `${stamp}-${String(sequence++).padStart(4, "0")}.json`);
        await writeFile(file, JSON.stringify(entry, null, 2), "utf-8");
    } catch (error) {
        process.stderr.write(`traffic dump failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
}

/**
 * Wrap `fetch` so every call the Anthropic SDK makes through it is captured to
 * `dir` before being handed back to the caller untouched.
 *
 * The response body is tee'd rather than re-read, so streaming and mid-stream
 * aborts behave exactly as they do without the dumper attached.
 */
export function createTrafficDumpingFetch(dir: string, baseFetch: Fetch = fetch): Fetch {
    return async (input, init) => {
        const startedAt = Date.now();
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        const requestHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const requestBody = typeof init?.body === "string" ? init.body : undefined;

        const request = {
            method,
            path: url.pathname + url.search,
            headers: sanitizeRequestHeaders(requestHeaders),
            body: parseBody(requestBody),
        };

        const response = await baseFetch(input, init);

        if (!response.body) {
            void writeDump(dir, {
                capturedAt: new Date(startedAt).toISOString(),
                scenario: "live-traffic-dump",
                request,
                response: { status: response.status, headers: keptResponseHeaders(response.headers), body: "" },
            });
            return response;
        }

        const [forCaller, forDump] = response.body.tee();
        void captureBody(forDump, startedAt).then(
            (captured) =>
                writeDump(dir, {
                    capturedAt: new Date(startedAt).toISOString(),
                    scenario: "live-traffic-dump",
                    request,
                    response: {
                        status: response.status,
                        headers: keptResponseHeaders(response.headers),
                        body: captured.body,
                        ...(captured.frames.length > 0 ? { frames: captured.frames } : {}),
                    },
                }),
            () => {
                // The caller's own consumption of `forCaller` surfaces the real
                // error; failing to capture the dump side of the tee is not
                // worth a second report.
            },
        );

        return new Response(forCaller, {
            status: response.status,
            statusText: response.statusText,
            headers: passThroughHeaders(response.headers),
        });
    };
}
