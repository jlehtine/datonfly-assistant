/**
 * Pass-through HTTP proxy that records raw Anthropic API traffic.
 *
 * LangChain wraps the Anthropic transport, so the only reliable place to
 * capture the wire format is in front of it: the client is pointed at this
 * proxy via `AnthropicAgentConfig.baseUrl`, and every request/response pair is
 * written to a fixture while being streamed through untouched.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";

const UPSTREAM = "https://api.anthropic.com";

/** Options for {@link startRecordingProxy}. */
export interface RecordingProxyOptions {
    /** Real API key, injected into upstream requests and never recorded. */
    apiKey: string;
    /** Upstream base URL. Defaults to the Anthropic API; overridden in tests. */
    upstream?: string;
}

/** Request headers never written to a fixture. */
const SECRET_REQUEST_HEADERS = new Set(["x-api-key", "authorization", "proxy-authorization", "cookie"]);

/** The only response headers kept; everything else is deployment-specific noise. */
const KEPT_RESPONSE_HEADERS = new Set(["content-type", "retry-after"]);

/** Patterns of secret-looking material, scrubbed from every recorded byte. */
const SECRET_PATTERNS: RegExp[] = [/sk-ant-[A-Za-z0-9_-]+/g, /\bBearer\s+[A-Za-z0-9._-]+/gi];

/** A single recorded request/response exchange. */
export interface RecordedExchange {
    scenario: string;
    request: {
        method: string;
        path: string;
        headers: Record<string, string>;
        body: unknown;
    };
    response: {
        status: number;
        headers: Record<string, string>;
        /** Raw response body, verbatim SSE for streaming calls. */
        body: string;
    };
}

/** Replace anything matching a secret pattern with a visible placeholder. */
export function scrubSecrets(text: string): string {
    return SECRET_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "<REDACTED>"), text);
}

/** Copy request headers, dropping credentials and per-hop noise. */
function sanitizeRequestHeaders(headers: IncomingMessage["headers"]): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined || SECRET_REQUEST_HEADERS.has(name) || name === "host") {
            continue;
        }
        result[name] = Array.isArray(value) ? value.join(", ") : value;
    }
    return result;
}

/** Keep only the response headers a replay needs. */
function sanitizeResponseHeaders(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, name) => {
        if (KEPT_RESPONSE_HEADERS.has(name)) {
            result[name] = value;
        }
    });
    return result;
}

/** Read a request body fully into a string. */
async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks).toString("utf-8");
}

/** Parse a JSON body, falling back to the raw string when it is not JSON. */
function parseBody(raw: string): unknown {
    if (raw === "") return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

/** A running recording proxy. */
export interface RecordingProxy {
    /** Base URL to hand to `AnthropicAgentConfig.baseUrl`. */
    readonly url: string;
    /** Name applied to exchanges recorded from now on. */
    setScenario(name: string): void;
    /** Write every exchange recorded for `scenario`, then forget them. */
    flush(scenario: string, outputDir: string): Promise<string[]>;
    close(): Promise<void>;
}

/**
 * Start a recording proxy on an ephemeral localhost port.
 *
 * The upstream response is streamed straight back to the caller while being
 * accumulated, so streaming and mid-stream aborts behave as they do against the
 * real API.
 */
export async function startRecordingProxy(options: RecordingProxyOptions): Promise<RecordingProxy> {
    const { apiKey, upstream: upstreamBase = UPSTREAM } = options;
    const exchanges: RecordedExchange[] = [];
    let scenario = "unnamed";

    const proxyRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const requestBody = await readBody(req);
        const path = req.url ?? "/";

        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
            if (value === undefined || name === "host" || name === "content-length") continue;
            headers.set(name, Array.isArray(value) ? value.join(", ") : value);
        }
        headers.set("x-api-key", apiKey);

        const upstream = await fetch(`${upstreamBase}${path}`, {
            method: req.method ?? "POST",
            headers,
            ...(requestBody === "" ? {} : { body: requestBody }),
        });

        res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));

        const captured: string[] = [];
        if (upstream.body) {
            const decoder = new TextDecoder();
            for await (const chunk of upstream.body) {
                const bytes = chunk as Uint8Array;
                captured.push(decoder.decode(bytes, { stream: true }));
                res.write(bytes);
            }
            captured.push(decoder.decode());
        }
        res.end();

        exchanges.push({
            scenario,
            request: {
                method: req.method ?? "POST",
                path,
                headers: sanitizeRequestHeaders(req.headers),
                body: parseBody(scrubSecrets(requestBody)),
            },
            response: {
                status: upstream.status,
                headers: sanitizeResponseHeaders(upstream.headers),
                body: scrubSecrets(captured.join("")),
            },
        });
    };

    const server: Server = createServer((req, res) => {
        proxyRequest(req, res).catch((error: unknown) => {
            if (!res.headersSent) {
                res.writeHead(502, { "content-type": "application/json" });
            }
            res.end(JSON.stringify({ error: error instanceof Error ? error.message : "proxy failure" }));
        });
    });
    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("Recording proxy failed to bind an ephemeral port.");
    }

    return {
        url: `http://127.0.0.1:${address.port.toString()}`,
        setScenario(name: string): void {
            scenario = name;
        },
        async flush(name: string, outputDir: string): Promise<string[]> {
            const recorded = exchanges.filter((exchange) => exchange.scenario === name);
            exchanges.length = 0;
            if (recorded.length === 0) return [];
            await mkdir(outputDir, { recursive: true });
            const written: string[] = [];
            for (const [index, exchange] of recorded.entries()) {
                const suffix = recorded.length > 1 ? `-${(index + 1).toString().padStart(2, "0")}` : "";
                const file = join(outputDir, `${name}${suffix}.json`);
                await writeFile(file, `${JSON.stringify(exchange, null, 2)}\n`, "utf-8");
                written.push(file);
            }
            return written;
        },
        close(): Promise<void> {
            return new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        },
    };
}
