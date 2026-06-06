import { describe, expect, it, vi } from "vitest";

import { EnvReader, loadBackendConfig, type EnvSource } from "./config.js";

/** Minimal environment that satisfies the required variables. */
function validEnv(overrides: Record<string, string | undefined> = {}): EnvSource {
    return {
        DF_DATABASE_URL: "postgres://localhost/test",
        DF_ANTHROPIC_MODEL: "claude-test",
        ...overrides,
    };
}

describe("EnvReader", () => {
    it("prefers the DF_-prefixed value over the legacy name", () => {
        const reader = new EnvReader({ DF_FOO: "new", FOO: "old" });
        expect(reader.prefixed("FOO")).toBe("new");
    });

    it("falls back to the legacy name and warns once", () => {
        const warn = vi.fn();
        const reader = new EnvReader({ FOO: "old" }, warn);
        expect(reader.prefixed("FOO")).toBe("old");
        expect(reader.prefixed("FOO")).toBe("old");
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('Environment variable "FOO" is deprecated; use "DF_FOO" instead.');
    });

    it("does not warn for permanent legacy fallbacks", () => {
        const warn = vi.fn();
        const reader = new EnvReader({ PORT: "8080" }, warn);
        expect(reader.prefixed("PORT", "permanent")).toBe("8080");
        expect(warn).not.toHaveBeenCalled();
    });

    it("does not warn when the prefixed name is present", () => {
        const warn = vi.fn();
        const reader = new EnvReader({ DF_FOO: "new", FOO: "old" }, warn);
        expect(reader.prefixed("FOO")).toBe("new");
        expect(warn).not.toHaveBeenCalled();
    });

    it("reads canonical names without a prefix", () => {
        const reader = new EnvReader({ ANTHROPIC_API_KEY: "sk-test", DF_ANTHROPIC_API_KEY: "ignored" });
        expect(reader.canonical("ANTHROPIC_API_KEY")).toBe("sk-test");
    });
});

describe("loadBackendConfig", () => {
    it("loads a minimal valid configuration", () => {
        const config = loadBackendConfig(validEnv());
        expect(config.databaseUrl).toBe("postgres://localhost/test");
        expect(config.agent.modelName).toBe("claude-test");
        expect(config.port).toBe(3000);
        expect(config.auth.mode).toBe("fake");
        expect(config.log).toEqual({ level: "info", format: "pretty" });
    });

    it("reads the canonical Anthropic API key", () => {
        const config = loadBackendConfig(validEnv({ ANTHROPIC_API_KEY: "sk-test" }));
        expect(config.anthropicApiKey).toBe("sk-test");
    });

    it("accepts legacy unprefixed names and warns", () => {
        const warn = vi.fn();
        const config = loadBackendConfig(
            { DATABASE_URL: "postgres://localhost/legacy", ANTHROPIC_MODEL: "claude-legacy" },
            warn,
        );
        expect(config.databaseUrl).toBe("postgres://localhost/legacy");
        expect(config.agent.modelName).toBe("claude-legacy");
        // ANTHROPIC_MODEL is deprecated and warns; DATABASE_URL is permanent and does not.
        expect(warn).toHaveBeenCalledWith(
            'Environment variable "ANTHROPIC_MODEL" is deprecated; use "DF_ANTHROPIC_MODEL" instead.',
        );
        expect(warn).not.toHaveBeenCalledWith(
            'Environment variable "DATABASE_URL" is deprecated; use "DF_DATABASE_URL" instead.',
        );
    });

    it("throws when the database URL is missing", () => {
        expect(() => loadBackendConfig({ DF_ANTHROPIC_MODEL: "claude-test" })).toThrow(
            "DF_DATABASE_URL environment variable is required",
        );
    });

    it("throws when the model name is missing", () => {
        expect(() => loadBackendConfig({ DF_DATABASE_URL: "postgres://localhost/test" })).toThrow(
            "DF_ANTHROPIC_MODEL environment variable is required",
        );
    });

    it("throws on a malformed port", () => {
        expect(() => loadBackendConfig(validEnv({ DF_PORT: "not-a-port" }))).toThrow(
            'DF_PORT must be an integer between 1 and 65535, got "not-a-port"',
        );
    });

    it("throws on invalid MCP server JSON", () => {
        expect(() => loadBackendConfig(validEnv({ DF_MCP_SERVERS: "{ not json" }))).toThrow(
            /DF_MCP_SERVERS must be valid JSON/,
        );
    });

    it("requires OIDC client credentials in oidc mode", () => {
        expect(() => loadBackendConfig(validEnv({ DF_AUTH_MODE: "oidc" }))).toThrow(
            "DF_OIDC_CLIENT_ID is required when DF_AUTH_MODE=oidc",
        );
    });

    it("parses configured MCP servers", () => {
        const config = loadBackendConfig(
            validEnv({
                DF_MCP_SERVERS: JSON.stringify([{ name: "local", command: "node", args: ["server.js"] }]),
            }),
        );
        expect(config.mcp.servers).toHaveLength(1);
        expect(config.mcp.servers[0]).toMatchObject({ transport: "stdio", name: "local", command: "node" });
    });
});
