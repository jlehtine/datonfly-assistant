import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { McpClient } from "./mcp-client.js";
import { McpServerSet } from "./mcp-server-set.js";

interface MockServer {
    client: McpClient;
    server: McpServer;
}

/** A schema exercising the JSON Schema constructs the removed Zod converter used to drop. */
const RICH_INPUT_SCHEMA = {
    type: "object" as const,
    properties: {
        target: { $ref: "#/$defs/target" },
        when: { type: "string", format: "date-time" },
        depth: { type: "integer", minimum: 1, maximum: 10 },
        selector: { oneOf: [{ type: "string" }, { type: "number" }] },
    },
    required: ["target"],
    additionalProperties: false,
    $defs: { target: { type: "string", minLength: 1 } },
};

/** Spawn an in-process MCP server exposing `add` and `boom` tools, with a connected {@link McpClient}. */
async function startMockServer(): Promise<MockServer> {
    const server = new McpServer({ name: "mock", version: "1.0.0" });
    server.registerTool(
        "add",
        { description: "Add two numbers", inputSchema: { a: z.number(), b: z.number() } },
        ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
    );
    server.registerTool("boom", { description: "Always fails" }, () => ({
        content: [{ type: "text", text: "kaboom" }],
        isError: true,
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = await McpClient.connect(clientTransport, "mock", { callTimeoutMs: 2000 });
    return { client, server };
}

/**
 * Spawn an MCP server publishing {@link RICH_INPUT_SCHEMA} verbatim and
 * recording the arguments each call receives.
 *
 * The high-level `McpServer` helper only accepts Zod shapes for tool inputs, so
 * this uses the low-level protocol server the SDK reserves for exactly such
 * advanced cases.
 */
/* eslint-disable @typescript-eslint/no-deprecated */
async function startRawSchemaServer(): Promise<{ client: McpClient; server: Server; received: unknown[] }> {
    const received: unknown[] = [];
    const server = new Server({ name: "raw", version: "1.0.0" }, { capabilities: { tools: {} } });
    /* eslint-enable @typescript-eslint/no-deprecated */
    server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [{ name: "inspect", description: "Inspects a target.", inputSchema: RICH_INPUT_SCHEMA }],
    }));
    server.setRequestHandler(CallToolRequestSchema, (request) => {
        received.push(request.params.arguments);
        return { content: [{ type: "text", text: "ok" }] };
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = await McpClient.connect(clientTransport, "raw");
    return { client, server, received };
}

/** Close both halves of a mock server connection. */
async function stop({ client, server }: MockServer): Promise<void> {
    await client.close();
    await server.close();
}

describe("McpClient", () => {
    let active: MockServer[] = [];

    afterEach(async () => {
        await Promise.allSettled(active.map(stop));
        active = [];
    });

    async function mock(): Promise<MockServer> {
        const server = await startMockServer();
        active.push(server);
        return server;
    }

    it("lists server tools as ITools", async () => {
        const { client } = await mock();

        const names = client.tools.map((tool) => tool.name).sort();
        expect(names).toEqual(["add", "boom"]);
        expect(client.tools.find((tool) => tool.name === "add")?.description).toBe("Add two numbers");
    });

    it("proxies a tool call and returns its text result", async () => {
        const { client } = await mock();

        const add = client.tools.find((tool) => tool.name === "add");
        await expect(add?.execute({ a: 2, b: 3 })).resolves.toBe("5");
    });

    it("exposes the server's input schema unmodified", async () => {
        const { client } = await mock();

        const add = client.tools.find((tool) => tool.name === "add");
        expect(add?.inputSchema).toMatchObject({
            type: "object",
            properties: { a: { type: "number" }, b: { type: "number" } },
        });
        // The server owns validation, so no reconstructed schema is applied before dispatch.
        expect(add?.validate).toBeUndefined();
    });

    it("surfaces MCP isError results as thrown tool errors", async () => {
        const { client } = await mock();

        const boom = client.tools.find((tool) => tool.name === "boom");
        await expect(boom?.execute({})).rejects.toThrow(/kaboom/);
    });

    it("surfaces transport failures as tool errors instead of crashing", async () => {
        const { client } = await mock();

        const add = client.tools.find((tool) => tool.name === "add");
        await client.close();
        await expect(add?.execute({ a: 1, b: 1 })).rejects.toThrow(/failed/);
    });

    it("passes a rich published schema through to the tool definition unmodified", async () => {
        const { client, server } = await startRawSchemaServer();

        const inspect = client.tools.find((tool) => tool.name === "inspect");
        expect(inspect?.inputSchema).toEqual(RICH_INPUT_SCHEMA);

        await client.close();
        await server.close();
    });

    it("dispatches arguments outside the old converter's subset without stripping them", async () => {
        const { client, server, received } = await startRawSchemaServer();

        const inspect = client.tools.find((tool) => tool.name === "inspect");
        const args = { target: "thing", when: "2026-08-08T00:00:00Z", depth: 3, selector: 7 };
        await expect(inspect?.execute(args)).resolves.toBe("ok");
        expect(received).toEqual([args]);

        await client.close();
        await server.close();
    });
});

describe("McpServerSet", () => {
    it("aggregates tools across servers and closes them together", async () => {
        const a = await startMockServer();
        const b = await startMockServer();
        const set = McpServerSet.fromClients([a.client, b.client]);

        expect(set.tools.length).toBe(a.client.tools.length + b.client.tools.length);

        await set.close();
        await a.server.close();
        await b.server.close();

        const add = set.tools.find((tool) => tool.name === "add");
        await expect(add?.execute({ a: 1, b: 1 })).rejects.toThrow();
    });
});
