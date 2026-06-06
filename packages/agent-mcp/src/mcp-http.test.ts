import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { McpClient } from "./mcp-client.js";
import { McpServerSet } from "./mcp-server-set.js";

interface RunningServer {
    url: string;
    /** Authorization header observed on the most recent request, if any. */
    lastAuthHeader: () => string | undefined;
    close: () => Promise<void>;
}

/** Read a request body fully and parse it as JSON (empty body → undefined). */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw.length > 0 ? (JSON.parse(raw) as unknown) : undefined;
}

/**
 * Start an in-process MCP server over the real Streamable HTTP transport,
 * backed by a Node HTTP server bound to an ephemeral port. Exposes an `echo`
 * tool and records the latest `Authorization` header for header-forwarding
 * assertions.
 */
async function startHttpServer(): Promise<RunningServer> {
    const mcp = new McpServer({ name: "http-mock", version: "1.0.0" });
    mcp.registerTool("echo", { description: "Echo text", inputSchema: { text: z.string() } }, ({ text }) => ({
        content: [{ type: "text", text }],
    }));

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
    });
    await mcp.connect(transport);

    let lastAuth: string | undefined;
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
        lastAuth = req.headers.authorization;
        void readJsonBody(req).then((body) => transport.handleRequest(req, res, body));
    };
    const server: Server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    return {
        url: `http://127.0.0.1:${port.toString()}/mcp`,
        lastAuthHeader: () => lastAuth,
        close: async () => {
            await transport.close();
            await mcp.close();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        },
    };
}

describe("McpClient over Streamable HTTP", () => {
    let servers: RunningServer[] = [];
    let clients: McpClient[] = [];

    afterEach(async () => {
        await Promise.allSettled(clients.map((client) => client.close()));
        await Promise.allSettled(servers.map((server) => server.close()));
        servers = [];
        clients = [];
    });

    async function connect(headers?: Record<string, string>): Promise<{ client: McpClient; server: RunningServer }> {
        const server = await startHttpServer();
        servers.push(server);
        const client = await McpClient.connectHttp({
            transport: "http",
            name: "http-mock",
            url: server.url,
            ...(headers !== undefined ? { headers } : {}),
        });
        clients.push(client);
        return { client, server };
    }

    it("lists and invokes tools over HTTP", async () => {
        const { client } = await connect();

        expect(client.tools.map((tool) => tool.name)).toEqual(["echo"]);
        const echo = client.tools.find((tool) => tool.name === "echo");
        await expect(echo?.execute({ text: "hello" })).resolves.toBe("hello");
    });

    it("forwards configured headers to the server", async () => {
        const { client, server } = await connect({ Authorization: "Bearer test-token" });

        const echo = client.tools.find((tool) => tool.name === "echo");
        await echo?.execute({ text: "x" });
        expect(server.lastAuthHeader()).toBe("Bearer test-token");
    });

    it("surfaces a connection failure as a thrown error", async () => {
        // Reserve a port, then close it so nothing is listening.
        const probe = createServer();
        await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
        const { port } = probe.address() as AddressInfo;
        await new Promise<void>((resolve) =>
            probe.close(() => {
                resolve();
            }),
        );

        await expect(
            McpClient.connectHttp({ transport: "http", name: "dead", url: `http://127.0.0.1:${port.toString()}/mcp` }),
        ).rejects.toThrow();
    });

    it("aggregates HTTP servers in an McpServerSet via connect()", async () => {
        const a = await startHttpServer();
        const b = await startHttpServer();
        servers.push(a, b);

        const set = await McpServerSet.connect([
            { transport: "http", name: "a", url: a.url },
            { transport: "http", name: "b", url: b.url },
        ]);

        expect(set.tools.map((tool) => tool.name)).toEqual(["echo", "echo"]);
        await set.close();
    });
});
