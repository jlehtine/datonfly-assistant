import { describe, expect, it } from "vitest";

import { computeTierLimit, RATE_LIMIT_TIER_DEFAULTS, resolveRateLimitConfig, type RateLimitTier } from "./tiers.js";

describe("computeTierLimit", () => {
    it("scales the limit by the factor and keeps the ttl", () => {
        expect(computeTierLimit({ ttlMs: 60_000, limit: 20 }, 2)).toEqual({ ttlMs: 60_000, limit: 40 });
    });

    it("rounds to the nearest integer", () => {
        expect(computeTierLimit({ ttlMs: 60_000, limit: 5 }, 0.5)).toEqual({ ttlMs: 60_000, limit: 3 });
    });

    it("clamps to a minimum of 1", () => {
        expect(computeTierLimit({ ttlMs: 60_000, limit: 5 }, 0.01)).toEqual({ ttlMs: 60_000, limit: 1 });
    });
});

describe("resolveRateLimitConfig", () => {
    it("applies defaults: enabled, factor 1, no ceiling", () => {
        const config = resolveRateLimitConfig();
        expect(config.enabled).toBe(true);
        expect(config.factor).toBe(1);
        expect(config.expectedUsers).toBeUndefined();
        expect(config.globalCeiling).toBeUndefined();
        expect(config.tiers).toEqual(RATE_LIMIT_TIER_DEFAULTS);
    });

    it("scales every tier by the factor", () => {
        const config = resolveRateLimitConfig({ factor: 2 });
        for (const tier of Object.keys(RATE_LIMIT_TIER_DEFAULTS) as RateLimitTier[]) {
            expect(config.tiers[tier].limit).toBe(RATE_LIMIT_TIER_DEFAULTS[tier].limit * 2);
        }
    });

    it("can be disabled", () => {
        expect(resolveRateLimitConfig({ enabled: false }).enabled).toBe(false);
    });

    it("sizes the expensive-pool ceiling from expectedUsers", () => {
        // message (20) + transcribe (10) = 30 per user at factor 1.
        const config = resolveRateLimitConfig({ expectedUsers: 50 });
        expect(config.globalCeiling).toEqual({ ttlMs: 60_000, limit: 30 * 50 });
    });

    it("scales the expensive-pool ceiling with the factor", () => {
        const config = resolveRateLimitConfig({ factor: 2, expectedUsers: 10 });
        // (40 + 20) per user × 10 users.
        expect(config.globalCeiling?.limit).toBe(60 * 10);
    });

    it("throws on a non-positive factor", () => {
        expect(() => resolveRateLimitConfig({ factor: 0 })).toThrow(/factor must be a positive number/);
        expect(() => resolveRateLimitConfig({ factor: -1 })).toThrow(/factor must be a positive number/);
    });

    it("throws on an invalid expectedUsers", () => {
        expect(() => resolveRateLimitConfig({ expectedUsers: 0 })).toThrow(/expectedUsers must be a positive integer/);
        expect(() => resolveRateLimitConfig({ expectedUsers: 1.5 })).toThrow(
            /expectedUsers must be a positive integer/,
        );
    });
});
