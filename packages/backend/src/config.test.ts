import { describe, expect, it } from "vitest";

import { EnvReader, loadBackendConfig, type EnvSource } from "./config.js";

/** Minimal environment that satisfies the required variables. */
function validEnv(overrides: Record<string, string | undefined> = {}): EnvSource {
    return {
        DF_DATABASE_URL: "postgres://localhost/test",
        DF_AGENT_MODEL: "claude-test",
        ...overrides,
    };
}

describe("EnvReader", () => {
    it("reads the DF_-prefixed value", () => {
        const reader = new EnvReader({ DF_FOO: "new" });
        expect(reader.prefixed("FOO")).toBe("new");
    });

    it("ignores the unprefixed name", () => {
        const reader = new EnvReader({ FOO: "old" });
        expect(reader.prefixed("FOO")).toBeUndefined();
    });

    it("falls back to the unprefixed name only where a canonical fallback is declared", () => {
        const reader = new EnvReader({ PORT: "8080" });
        expect(reader.prefixedWithCanonicalFallback("PORT")).toBe("8080");
    });

    it("prefers the prefixed name over the canonical fallback", () => {
        const reader = new EnvReader({ DF_PORT: "9090", PORT: "8080" });
        expect(reader.prefixedWithCanonicalFallback("PORT")).toBe("9090");
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

    it("reads the vendor-neutral agent model variables", () => {
        const config = loadBackendConfig(
            validEnv({ DF_AGENT_TRIAGE_MODEL: "claude-triage", DF_AGENT_TITLE_MODEL: "claude-title" }),
        );
        expect(config.agent.triageModelName).toBe("claude-triage");
        expect(config.agent.titleModelName).toBe("claude-title");
    });

    it("reads the Anthropic-namespaced server-tool toggles", () => {
        const config = loadBackendConfig(
            validEnv({
                DF_ANTHROPIC_ENABLE_COMPACTION: "false",
                DF_ANTHROPIC_ENABLE_CODE_EXECUTION: "false",
                DF_ANTHROPIC_ENABLE_WEB_SEARCH: "false",
                DF_ANTHROPIC_ENABLE_WEB_FETCH: "false",
            }),
        );
        expect(config.agent.anthropic).toMatchObject({
            enableCompaction: false,
            enableCodeExecution: false,
            enableWebSearch: false,
            enableWebFetch: false,
        });
    });

    it("defaults the Anthropic server-tool toggles to enabled", () => {
        const config = loadBackendConfig(validEnv());
        expect(config.agent.anthropic).toMatchObject({
            enableCompaction: true,
            enableCodeExecution: true,
            enableWebSearch: true,
            enableWebFetch: true,
        });
    });

    it("ignores unprefixed legacy names", () => {
        expect(() =>
            loadBackendConfig({ DATABASE_URL: "postgres://localhost/legacy", AGENT_MODEL: "claude-legacy" }),
        ).toThrow("DF_AGENT_MODEL environment variable is required");
    });

    it("ignores the pre-rename Anthropic model name", () => {
        expect(() =>
            loadBackendConfig({ DF_DATABASE_URL: "postgres://localhost/test", DF_ANTHROPIC_MODEL: "claude-old" }),
        ).toThrow("DF_AGENT_MODEL environment variable is required");
    });

    it("accepts the unprefixed DATABASE_URL as a permanent fallback", () => {
        const config = loadBackendConfig({
            DATABASE_URL: "postgres://localhost/platform",
            DF_AGENT_MODEL: "claude-test",
        });
        expect(config.databaseUrl).toBe("postgres://localhost/platform");
    });

    it("accepts the unprefixed PORT as a permanent fallback", () => {
        const config = loadBackendConfig(validEnv({ PORT: "8080" }));
        expect(config.port).toBe(8080);
    });

    it("throws when the database URL is missing", () => {
        expect(() => loadBackendConfig({ DF_AGENT_MODEL: "claude-test" })).toThrow(
            "DF_DATABASE_URL environment variable is required",
        );
    });

    it("throws when the model name is missing", () => {
        expect(() => loadBackendConfig({ DF_DATABASE_URL: "postgres://localhost/test" })).toThrow(
            "DF_AGENT_MODEL environment variable is required",
        );
    });

    it("rejects the withdrawn manual thinking mode", () => {
        expect(() => loadBackendConfig(validEnv({ DF_ANTHROPIC_THINKING_TYPE: "enabled" }))).toThrow(
            'DF_ANTHROPIC_THINKING_TYPE must be one of adaptive|disabled, got "enabled"',
        );
    });

    it("accepts thinking being switched off explicitly", () => {
        const config = loadBackendConfig(validEnv({ DF_ANTHROPIC_THINKING_TYPE: "disabled" }));
        expect(config.agent.anthropic.thinkingType).toBe("disabled");
    });

    it("accepts adaptive thinking with an effort level", () => {
        const config = loadBackendConfig(
            validEnv({ DF_ANTHROPIC_THINKING_TYPE: "adaptive", DF_ANTHROPIC_THINKING_EFFORT: "high" }),
        );
        expect(config.agent.anthropic).toMatchObject({ thinkingType: "adaptive", thinkingEffort: "high" });
    });

    it("leaves the traffic dump directory undefined by default", () => {
        const config = loadBackendConfig(validEnv());
        expect(config.agent.anthropic.trafficDumpDir).toBeUndefined();
    });

    it("reads the Anthropic traffic dump directory", () => {
        const config = loadBackendConfig(validEnv({ DF_ANTHROPIC_TRAFFIC_DUMP_DIR: "/tmp/df-traffic" }));
        expect(config.agent.anthropic.trafficDumpDir).toBe("/tmp/df-traffic");
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

    describe("rate limiting", () => {
        it("defaults to enabled with no factor or expected-users override", () => {
            const config = loadBackendConfig(validEnv());
            expect(config.rateLimit).toEqual({ enabled: true, factor: undefined, expectedUsers: undefined });
        });

        it("can be disabled", () => {
            const config = loadBackendConfig(validEnv({ DF_RATE_LIMIT_ENABLED: "false" }));
            expect(config.rateLimit.enabled).toBe(false);
        });

        it("parses the factor and expected-users knobs", () => {
            const config = loadBackendConfig(
                validEnv({ DF_RATE_LIMIT_FACTOR: "2.5", DF_RATE_LIMIT_EXPECTED_USERS: "100" }),
            );
            expect(config.rateLimit.factor).toBe(2.5);
            expect(config.rateLimit.expectedUsers).toBe(100);
        });

        it("throws on a non-positive factor", () => {
            expect(() => loadBackendConfig(validEnv({ DF_RATE_LIMIT_FACTOR: "0" }))).toThrow(
                'DF_RATE_LIMIT_FACTOR must be a positive number, got "0"',
            );
        });

        it("throws on a non-integer expected-users", () => {
            expect(() => loadBackendConfig(validEnv({ DF_RATE_LIMIT_EXPECTED_USERS: "1.5" }))).toThrow(
                'DF_RATE_LIMIT_EXPECTED_USERS must be a positive integer, got "1.5"',
            );
        });
    });
});
