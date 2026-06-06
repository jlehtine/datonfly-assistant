import type { ITool } from "@datonfly-assistant/core";

import { McpClient, type McpConnectionOptions, type McpServerConfig, type McpStdioServerConfig } from "./mcp-client.js";

/**
 * A lifecycle-managed set of MCP server connections for a single session or job.
 *
 * Aggregates the tools of every connected server into one {@link ITool} list to
 * hand to the agent, and closes all underlying connections together. Tool-name
 * collisions across servers are the caller's responsibility (the agent keys
 * tools by name).
 */
export class McpServerSet {
    private constructor(
        private readonly clients: McpClient[],
        /** The combined tools of every connected server, in connection order. */
        readonly tools: ITool[],
    ) {}

    /** Build a server set from already-connected clients. */
    static fromClients(clients: McpClient[]): McpServerSet {
        return new McpServerSet(
            clients,
            clients.flatMap((client) => client.tools),
        );
    }

    /**
     * Connect to every configured server (stdio, HTTP, or SSE), aggregating
     * their tools.
     *
     * If any connection fails, all connections already established are closed
     * before the error is re-thrown, so no server is left dangling.
     */
    static async connect(configs: McpServerConfig[], options: McpConnectionOptions = {}): Promise<McpServerSet> {
        const clients: McpClient[] = [];
        try {
            for (const config of configs) {
                clients.push(await McpClient.connectServer(config, options));
            }
        } catch (error) {
            await Promise.allSettled(clients.map((client) => client.close()));
            throw error;
        }
        return McpServerSet.fromClients(clients);
    }

    /**
     * Connect to every configured stdio server, aggregating their tools.
     *
     * Convenience wrapper around {@link McpServerSet.connect} for stdio-only
     * sets.
     */
    static connectStdio(configs: McpStdioServerConfig[], options: McpConnectionOptions = {}): Promise<McpServerSet> {
        return McpServerSet.connect(configs, options);
    }

    /** Close every server connection in the set. */
    async close(): Promise<void> {
        await Promise.allSettled(this.clients.map((client) => client.close()));
    }
}
