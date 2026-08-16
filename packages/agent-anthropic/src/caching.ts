import type Anthropic from "@anthropic-ai/sdk";

import { DEFAULT_CACHE_TAIL_MESSAGES, type AnthropicProviderOptions } from "./config.js";

/**
 * Anthropic allows at most four cache breakpoints per request. We spend them on
 * the three longest-lived prefixes, leaving one unused as headroom.
 */
const MAX_BREAKPOINTS = 4;

/** Request pieces a cache breakpoint can be attached to. */
export interface CacheableRequest {
    system?: Anthropic.Beta.BetaTextBlockParam[] | undefined;
    tools?: Anthropic.Beta.BetaToolUnion[] | undefined;
    messages: Anthropic.Beta.BetaMessageParam[];
}

function cacheControl(options: AnthropicProviderOptions): Anthropic.Beta.BetaCacheControlEphemeral {
    return {
        type: "ephemeral",
        ...(options.cacheTtl ? { ttl: options.cacheTtl } : {}),
    };
}

/**
 * Place prompt-cache breakpoints on the stable prefix of a request.
 *
 * A blanket `cache_control` on the whole prompt bills every token as cache
 * creation and never reads anything back, which also starves the input-token
 * trigger that provider-side compaction keys on. Breakpoints instead mark the
 * boundary between what repeats across turns — the system prompt, the tool
 * definitions, and all but the last few messages — and the volatile tail.
 *
 * Marks blocks in place, so the caller's arrays carry the breakpoints.
 */
export function applyCacheBreakpoints(request: CacheableRequest, options: AnthropicProviderOptions): void {
    if (options.disableCaching === true) return;

    let remaining = MAX_BREAKPOINTS - 1;
    const control = cacheControl(options);

    const lastSystem = request.system?.[request.system.length - 1];
    if (lastSystem && remaining > 0) {
        lastSystem.cache_control = control;
        remaining--;
    }

    const lastTool = request.tools?.[request.tools.length - 1];
    if (lastTool && remaining > 0) {
        (lastTool as { cache_control?: Anthropic.Beta.BetaCacheControlEphemeral }).cache_control = control;
        remaining--;
    }

    const tail = options.cacheTailMessages ?? DEFAULT_CACHE_TAIL_MESSAGES;
    const boundary = request.messages.length - tail - 1;
    const boundaryMessage = boundary >= 0 ? request.messages[boundary] : undefined;
    if (boundaryMessage && remaining > 0 && Array.isArray(boundaryMessage.content)) {
        const lastBlock = boundaryMessage.content[boundaryMessage.content.length - 1];
        if (lastBlock && "type" in lastBlock) {
            (lastBlock as { cache_control?: Anthropic.Beta.BetaCacheControlEphemeral }).cache_control = control;
        }
    }
}
