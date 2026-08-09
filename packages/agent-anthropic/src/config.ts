import type Anthropic from "@anthropic-ai/sdk";

import type { AgentConfig } from "@datonfly-assistant/core";

/** The opaque block provider identifier used by this agent. */
export const PROVIDER_ID = "anthropic";

/** Default context window assumed when the caller does not specify one. */
export const DEFAULT_CONTEXT_WINDOW_SIZE = 200_000;

/** Default response token budget. */
export const DEFAULT_MAX_TOKENS = 4096;

/** Default number of model turns allowed in a tool-calling loop. */
export const DEFAULT_MAX_TOOL_ITERATIONS = 10;

/** Anthropic-specific knobs, kept out of the vendor-neutral {@link AgentConfig}. */
export interface AnthropicProviderOptions {
    /** Enable the Anthropic server-side code execution tool (`code_execution_20260120`). */
    enableCodeExecution?: boolean | undefined;
    /**
     * Enable the Anthropic server-side web search tool (`web_search_20260209`).
     *
     * Requires {@link enableCodeExecution} to also be `true` (the 2026 version
     * uses code execution for dynamic result filtering).
     */
    enableWebSearch?: boolean | undefined;
    /** Maximum number of web searches per request. Defaults to unlimited when omitted. */
    webSearchMaxUses?: number | undefined;
    /**
     * Enable the Anthropic server-side web fetch tool (`web_fetch_20260209`).
     *
     * Allows the agent to retrieve full content from URLs provided in the
     * conversation. The `20260209` version supports dynamic filtering when
     * {@link enableCodeExecution} is also `true`.
     */
    enableWebFetch?: boolean | undefined;
    /** Maximum number of web fetches per request. Defaults to unlimited when omitted. */
    webFetchMaxUses?: number | undefined;
    /** Maximum content length (in tokens) for fetched pages. Defaults to unlimited when omitted. */
    webFetchMaxContentTokens?: number | undefined;
    /**
     * Anthropic thinking mode. When omitted, thinking stays disabled.
     *
     * Only `"adaptive"` exists: the Claude 5 generation dropped the manual
     * `"enabled"` budget mode in favour of adaptive thinking plus
     * {@link thinkingEffort}.
     */
    thinkingType?: "adaptive" | undefined;
    /** Anthropic thinking display mode. */
    thinkingDisplay?: "summarized" | "omitted" | undefined;
    /** Optional output effort level used with adaptive thinking. */
    thinkingEffort?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
    /** Enable Anthropic provider-side context compaction. Defaults to `true`. */
    enableCompaction?: boolean | undefined;
    /**
     * Input token threshold at which the Anthropic API triggers compaction.
     * Defaults to `contextWindowSize * 0.6`.
     */
    compactionTriggerTokens?: number | undefined;
    /**
     * Number of trailing conversation messages kept outside the prompt cache.
     *
     * A cache breakpoint is placed before these messages, so the stable prefix
     * of a growing conversation is reused across turns while the volatile tail
     * stays uncached. Defaults to {@link DEFAULT_CACHE_TAIL_MESSAGES}.
     */
    cacheTailMessages?: number | undefined;
    /** Lifetime of prompt cache entries. Defaults to `"5m"`. */
    cacheTtl?: "5m" | "1h" | undefined;
    /** Disable prompt caching entirely. */
    disableCaching?: boolean | undefined;
    /** Number of automatic SDK retries for transient failures. Defaults to the SDK's own default. */
    maxRetries?: number | undefined;
    /** Per-request timeout in milliseconds. Defaults to the SDK's own default. */
    timeoutMs?: number | undefined;
}

/**
 * Number of trailing messages left uncached by default.
 *
 * Just the incoming user turn. Everything up to and including the previous
 * assistant turn is stable in a linear conversation, so caching it maximises
 * the prefix the next request can reuse. Caches match by prefix, so a tail that
 * later turns out to be wrong (a retry that drops an unpersisted assistant
 * turn) simply stops hitting at the divergence point rather than costing
 * anything — which is why a larger hedge is not worth the lost reuse.
 *
 * Raise this if the UI ever gains restore points or branch-from-here editing,
 * which would make trailing turns genuinely volatile.
 */
export const DEFAULT_CACHE_TAIL_MESSAGES = 1;

/**
 * Configuration options for the Anthropic agent.
 *
 * The neutral fields come from {@link AgentConfig}; everything Anthropic-only
 * lives under {@link providerOptions}.
 */
export interface AnthropicAgentConfig extends AgentConfig {
    /** Anthropic-only configuration. */
    providerOptions?: AnthropicProviderOptions | undefined;
}

/**
 * Beta features this agent relies on.
 *
 * Context management, adaptive thinking effort, and the 2026 server tools are
 * only exposed through the beta Messages API, so every request goes through
 * `client.beta.messages` with these headers rather than maintaining two code
 * paths for one feature set.
 */
export const REQUIRED_BETAS = ["context-management-2025-06-27"] as const;

/** Build the Anthropic thinking parameter, or `undefined` when thinking is off. */
export function buildThinkingParam(
    options: AnthropicProviderOptions,
): Anthropic.Beta.BetaThinkingConfigParam | undefined {
    if (!options.thinkingType) return undefined;
    return {
        type: "adaptive",
        ...(options.thinkingDisplay ? { display: options.thinkingDisplay } : {}),
    } as Anthropic.Beta.BetaThinkingConfigParam;
}

/**
 * Build the output configuration (thinking effort), or `undefined` when unset.
 *
 * SDK 0.74 types `effort` without `"xhigh"`, which the API accepts; the value is
 * validated at the configuration boundary, so it is passed through as authored.
 */
export function buildOutputConfig(options: AnthropicProviderOptions): Anthropic.Beta.BetaOutputConfig | undefined {
    if (!options.thinkingEffort) return undefined;
    return { effort: options.thinkingEffort } as Anthropic.Beta.BetaOutputConfig;
}

/** Build the provider-side context management config, or `undefined` when compaction is off. */
export function buildContextManagement(
    options: AnthropicProviderOptions,
    contextWindowSize: number,
): Anthropic.Beta.BetaContextManagementConfig | undefined {
    if (options.enableCompaction === false) return undefined;
    return {
        edits: [
            {
                type: "compact_20260112",
                trigger: {
                    type: "input_tokens",
                    value: options.compactionTriggerTokens ?? Math.round(contextWindowSize * 0.6),
                },
            },
        ],
    } as Anthropic.Beta.BetaContextManagementConfig;
}
