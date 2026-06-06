import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { McpClient } from "./mcp-client.js";
import { McpServerSet } from "./mcp-server-set.js";

interface MockServer {
    client: McpClient;
    server: McpServer;
}

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

    it("validates arguments via the converted schema", async () => {
        const { client } = await mock();

        const add = client.tools.find((tool) => tool.name === "add");
        expect(add?.schema.parse({ a: 2, b: 3 })).toEqual({ a: 2, b: 3 });
        expect(() => add?.schema.parse({ a: "x" })).toThrow();
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
