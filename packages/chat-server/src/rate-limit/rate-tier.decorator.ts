import { SetMetadata, type CustomDecorator, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

import type { RateLimitTier } from "./tiers.js";

/** Reflector metadata key carrying a route's explicit {@link RateLimitTier}. */
export const RATE_TIER_KEY = "df_rate_tier";

/**
 * Assign an explicit rate-limit {@link RateLimitTier} to a controller or route
 * handler. Routes without this decorator fall back to `read` (safe methods) or
 * `mutation` (all other methods).
 */
export const RateTier = (tier: RateLimitTier): CustomDecorator => SetMetadata(RATE_TIER_KEY, tier);

/** HTTP methods treated as side-effect-free reads. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Resolve the rate-limit tier for an HTTP request: an explicit `@RateTier`
 * (route over class), otherwise `read` for safe methods and `mutation`
 * otherwise.
 */
export function resolveHttpTier(context: ExecutionContext, reflector: Reflector): RateLimitTier {
    const explicit = reflector.getAllAndOverride<RateLimitTier | undefined>(RATE_TIER_KEY, [
        context.getHandler(),
        context.getClass(),
    ]);
    if (explicit) {
        return explicit;
    }
    const req = context.switchToHttp().getRequest<{ method?: string }>();
    const method = req.method?.toUpperCase() ?? "GET";
    return SAFE_METHODS.has(method) ? "read" : "mutation";
}
