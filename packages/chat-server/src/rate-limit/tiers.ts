/**
 * Rate-limiting tier model and limit computation.
 *
 * This module is intentionally free of NestJS and `@nestjs/throttler` imports so
 * the limit arithmetic can be unit-tested in isolation. Endpoints are grouped
 * into a small number of tiers with different cost profiles; a single
 * dimensionless `factor` scales every tier up or down.
 */

/** Logical rate-limit tier. Each endpoint group maps to exactly one tier. */
export type RateLimitTier = "read" | "mutation" | "auth" | "message" | "transcribe" | "search" | "upload" | "admin";

/** A single tier's window length and request allowance. */
export interface TierLimit {
    /** Sliding-window length in milliseconds. */
    ttlMs: number;
    /** Maximum requests permitted per window for one keying subject. */
    limit: number;
}

/** One-minute window shared by all tiers. */
const MINUTE_MS = 60_000;

/**
 * Default per-subject limits before the `factor` multiplier is applied.
 *
 * These are sized for a standalone deployment with tens of simultaneous users.
 * They are fixed in code; operators tune the deployment via `factor` (and the
 * optional `expectedUsers` ceiling) rather than per-tier knobs.
 */
export const RATE_LIMIT_TIER_DEFAULTS: Record<RateLimitTier, TierLimit> = {
    read: { ttlMs: MINUTE_MS, limit: 300 },
    mutation: { ttlMs: MINUTE_MS, limit: 60 },
    auth: { ttlMs: MINUTE_MS, limit: 10 },
    message: { ttlMs: MINUTE_MS, limit: 20 },
    transcribe: { ttlMs: MINUTE_MS, limit: 10 },
    search: { ttlMs: MINUTE_MS, limit: 30 },
    upload: { ttlMs: MINUTE_MS, limit: 30 },
    admin: { ttlMs: MINUTE_MS, limit: 5 },
};

/**
 * Tiers that draw on the shared, most-expensive external resource pool
 * (LLM agent runs and audio transcription). The optional global ceiling bounds
 * the combined load these tiers place on the upstream provider.
 */
export const EXPENSIVE_TIERS: readonly RateLimitTier[] = ["message", "transcribe"];

/** HTTP tiers enforced by the throttler guard. `message` is WebSocket-only. */
export const HTTP_TIERS: readonly RateLimitTier[] = [
    "read",
    "mutation",
    "auth",
    "transcribe",
    "search",
    "upload",
    "admin",
];

/** Options accepted from the host application to tune rate limiting. */
export interface RateLimitOptions {
    /** Master switch. When `false`, no limits are enforced. Defaults to `true`. */
    enabled?: boolean | undefined;
    /** Multiplies every tier's default limit. Defaults to `1`. Must be `> 0`. */
    factor?: number | undefined;
    /**
     * Optional expected number of simultaneous users. When set, sizes an
     * aggregate ceiling on the expensive resource pool. Omitted ⇒ no ceiling.
     */
    expectedUsers?: number | undefined;
}

/** Fully resolved, validated rate-limit configuration. */
export interface ResolvedRateLimitConfig {
    enabled: boolean;
    factor: number;
    expectedUsers: number | undefined;
    /** Effective per-subject limits after `factor` scaling. */
    tiers: Record<RateLimitTier, TierLimit>;
    /** Aggregate ceiling for the expensive pool, or `undefined` when no ceiling. */
    globalCeiling: TierLimit | undefined;
}

/** Scale a single tier's allowance by `factor`, clamped to a minimum of 1. */
export function computeTierLimit(base: TierLimit, factor: number): TierLimit {
    return { ttlMs: base.ttlMs, limit: Math.max(1, Math.round(base.limit * factor)) };
}

/**
 * Resolve raw {@link RateLimitOptions} into a validated configuration with all
 * effective limits computed.
 *
 * @throws If `factor` or `expectedUsers` is not a positive number.
 */
export function resolveRateLimitConfig(options: RateLimitOptions = {}): ResolvedRateLimitConfig {
    const enabled = options.enabled ?? true;

    const factor = options.factor ?? 1;
    if (!Number.isFinite(factor) || factor <= 0) {
        throw new Error(`rate limit factor must be a positive number, got "${String(options.factor)}"`);
    }

    const expectedUsers = options.expectedUsers;
    if (expectedUsers !== undefined && (!Number.isInteger(expectedUsers) || expectedUsers < 1)) {
        throw new Error(`rate limit expectedUsers must be a positive integer, got "${String(expectedUsers)}"`);
    }

    const tiers = Object.fromEntries(
        (Object.keys(RATE_LIMIT_TIER_DEFAULTS) as RateLimitTier[]).map((tier) => [
            tier,
            computeTierLimit(RATE_LIMIT_TIER_DEFAULTS[tier], factor),
        ]),
    ) as Record<RateLimitTier, TierLimit>;

    let globalCeiling: TierLimit | undefined;
    if (expectedUsers !== undefined) {
        const perUserExpensive = EXPENSIVE_TIERS.reduce((sum, tier) => sum + tiers[tier].limit, 0);
        globalCeiling = { ttlMs: MINUTE_MS, limit: Math.max(1, perUserExpensive * expectedUsers) };
    }

    return { enabled, factor, expectedUsers, tiers, globalCeiling };
}
