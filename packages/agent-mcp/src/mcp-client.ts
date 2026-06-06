import { URL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import type { ITool } from "@datonfly-assistant/core";

import { jsonSchemaToZod } from "./json-schema-to-zod.js";

/** Connection parameters for an MCP server reached over the **stdio** transport. */
export interface McpStdioServerConfig {
    /** Transport discriminator (defaults to stdio when omitted). */
    transport?: "stdio";
    /** Stable, human-readable name used in diagnostics and tool error messages. */
    name: string;
    /** Executable to spawn for the MCP server process. */
    command: string;
    /** Arguments passed to {@link McpStdioServerConfig.command}. */
    args?: string[];
    /** Environment variables for the spawned process. */
    env?: Record<string, string>;
    /** Working directory for the spawned process. */
    cwd?: string;
}

/**
 * Connection parameters for a **remote** MCP server reached over the modern
 * **Streamable HTTP** transport (a single endpoint that upgrades to SSE
 * internally only when streaming is required).
 *
 * The legacy HTTP+SSE transport (MCP spec `2024-11-05`) is intentionally not
 * supported; Streamable HTTP supersedes it and is what current remote servers
 * use.
 */
export interface McpHttpServerConfig {
    /** Transport discriminator selecting the Streamable HTTP transport. */
    transport: "http";
    /** Stable, human-readable name used in diagnostics and tool error messages. */
    name: string;
    /** Endpoint URL of the remote MCP server. */
    url: string;
    /** Extra HTTP headers (e.g. `Authorization`) attached to every request. */
    headers?: Record<string, string>;
}

/** Any supported MCP server connection configuration. */
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

/** Options governing an MCP client connection and its proxied tool calls. */
export interface McpConnectionOptions {
    /** Per tool-call timeout in milliseconds (defaults to the SDK default). */
    callTimeoutMs?: number;
    /** Client name reported to the MCP server during initialisation. */
    clientName?: string;
    /** Client version reported to the MCP server during initialisation. */
    clientVersion?: string;
}

/** Narrow an unknown value to a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract a human-readable message from an unknown thrown value. */
function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
}

/** Join the text blocks of an MCP tool result, falling back to a JSON dump. */
function extractText(content: unknown[]): string {
    const texts: string[] = [];
    for (const block of content) {
        if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
            texts.push(block.text);
        }
    }
    return texts.length > 0 ? texts.join("\n") : JSON.stringify(content);
}

/** A single MCP-published tool description, as returned by `listTools`. */
interface McpToolDescription {
    name: string;
    description?: string | undefined;
    inputSchema: unknown;
}

/** Wrap one MCP tool as an {@link ITool} that proxies calls to the server. */
function createProxyTool(
    client: Client,
    serverName: string,
    mcpTool: McpToolDescription,
    callTimeoutMs?: number,
): ITool {
    const requestOptions = callTimeoutMs !== undefined ? { timeout: callTimeoutMs } : undefined;
    return {
        name: mcpTool.name,
        description: mcpTool.description ?? "",
        schema: jsonSchemaToZod(mcpTool.inputSchema),
        execute: async (input) => {
            let result: Awaited<ReturnType<Client["callTool"]>>;
            try {
                result = await client.callTool(
                    { name: mcpTool.name, arguments: isRecord(input) ? input : {} },
                    undefined,
                    requestOptions,
                );
            } catch (error) {
                throw new Error(`MCP tool "${mcpTool.name}" on server "${serverName}" failed: ${errorMessage(error)}`, {
                    cause: error,
                });
            }

            const content = "content" in result && Array.isArray(result.content) ? result.content : [];
            const text = extractText(content);
            if ("isError" in result && result.isError === true) {
                throw new Error(text || `MCP tool "${mcpTool.name}" on server "${serverName}" reported an error.`);
            }
            return text;
        },
    };
}

/**
 * A connected MCP server, exposing its tools as {@link ITool}s.
 *
 * The client lists the server's tools once at connect time and wraps each as an
 * `ITool` whose `execute()` proxies the call back to the server. Tool calls are
 * bounded by an optional per-call timeout, and transport/connection failures are
 * surfaced as thrown tool errors (which the agent's tool loop reports to the
 * model as `isError` results) rather than crashing the caller.
 *
 * Out of scope (deferred): MCP resources/prompts and dynamic
 * `tools/list_changed` notifications — the tool list is captured at connect time.
 */
export class McpClient {
    private constructor(
        private readonly client: Client,
        /** The configured name of the connected server. */
        readonly serverName: string,
        /** The server's tools, adapted to the vendor-neutral {@link ITool} contract. */
        readonly tools: ITool[],
    ) {}

    /**
     * Connect to an MCP server over an already-constructed transport.
     *
     * Primarily useful for tests (e.g. an in-memory transport pair); production
     * callers usually prefer {@link McpClient.connectStdio}.
     */
    static async connect(
        transport: Transport,
        serverName: string,
        options: McpConnectionOptions = {},
    ): Promise<McpClient> {
        const client = new Client({
            name: options.clientName ?? "datonfly-agent-mcp",
            version: options.clientVersion ?? "0.0.1",
        });
        await client.connect(transport);
        const { tools } = await client.listTools();
        const adapted = tools.map((tool) => createProxyTool(client, serverName, tool, options.callTimeoutMs));
        return new McpClient(client, serverName, adapted);
    }

    /** Spawn and connect to an MCP server over the stdio transport. */
    static connectStdio(config: McpStdioServerConfig, options: McpConnectionOptions = {}): Promise<McpClient> {
        const transport = new StdioClientTransport({
            command: config.command,
            ...(config.args !== undefined ? { args: config.args } : {}),
            ...(config.env !== undefined ? { env: config.env } : {}),
            ...(config.cwd !== undefined ? { cwd: config.cwd } : {}),
        });
        return McpClient.connect(transport, config.name, options);
    }

    /**
     * Connect to a remote MCP server over the Streamable HTTP transport.
     *
     * Configured headers are attached to every outgoing request (including the
     * SSE event stream the transport opens internally for streaming responses).
     */
    static connectHttp(config: McpHttpServerConfig, options: McpConnectionOptions = {}): Promise<McpClient> {
        const url = new URL(config.url);
        const opts = config.headers !== undefined ? { requestInit: { headers: config.headers } } : {};
        // The transport class exposes `sessionId: string | undefined` via a
        // getter, which trips `exactOptionalPropertyTypes` against `Transport`'s
        // `sessionId?: string`; the class implements `Transport`, so the
        // assertion is sound.
        const transport = new StreamableHTTPClientTransport(url, opts) as Transport;
        return McpClient.connect(transport, config.name, options);
    }

    /** Connect to an MCP server described by any supported {@link McpServerConfig}. */
    static connectServer(config: McpServerConfig, options: McpConnectionOptions = {}): Promise<McpClient> {
        return config.transport === "http"
            ? McpClient.connectHttp(config, options)
            : McpClient.connectStdio(config, options);
    }

    /** Close the connection and terminate the underlying transport. */
    async close(): Promise<void> {
        await this.client.close();
    }
}
