import { Inject, Injectable, Optional } from "@nestjs/common";
import { ThrottlerStorage } from "@nestjs/throttler";

import { RATE_LIMIT_CONFIG } from "../constants.js";
import type { ResolvedRateLimitConfig } from "./tiers.js";

/** Outcome of a rate-limit consumption attempt. */
export interface RateDecision {
    /** Whether the request is permitted. */
    allowed: boolean;
    /** Seconds until the limit resets, when `allowed` is `false`. */
    retryAfterSeconds: number;
}

const ALLOWED: RateDecision = { allowed: true, retryAfterSeconds: 0 };

/** Fixed storage key for the shared expensive-resource ceiling. */
const EXPENSIVE_POOL_KEY = "df:rate:expensive-pool";

/**
 * Programmatic rate limiting for code paths outside the HTTP guard.
 *
 * Used by the WebSocket gateway to throttle agent-invoking `send-message`
 * events and by the transcription endpoint to enforce the shared expensive-pool
 * ceiling. When rate limiting is disabled (or no storage is configured), every
 * call is allowed.
 */
@Injectable()
export class RateLimitService {
    constructor(
        @Inject(RATE_LIMIT_CONFIG) private readonly config: ResolvedRateLimitConfig,
        @Optional() @Inject(ThrottlerStorage) private readonly storage: ThrottlerStorage | null,
    ) {}

    /** Whether rate-limit enforcement is active. */
    get enabled(): boolean {
        return this.config.enabled && this.storage !== null;
    }

    /**
     * Consume one unit of the per-subject `message` tier (a WebSocket agent
     * run), then the shared expensive-pool ceiling. Returns the first denial.
     */
    async consumeMessage(subject: string): Promise<RateDecision> {
        if (!this.enabled) {
            return ALLOWED;
        }
        const tier = this.config.tiers.message;
        const perUser = await this.increment(`df:rate:message:${subject}`, tier.ttlMs, tier.limit, "message");
        if (!perUser.allowed) {
            return perUser;
        }
        return this.consumeExpensivePool();
    }

    /**
     * Consume one unit of the shared expensive-resource ceiling (agent runs and
     * transcription combined). A no-op that always allows when no ceiling is
     * configured (`expectedUsers` unset).
     */
    async consumeExpensivePool(): Promise<RateDecision> {
        const ceiling = this.config.globalCeiling;
        if (!this.enabled || !ceiling) {
            return ALLOWED;
        }
        return this.increment(EXPENSIVE_POOL_KEY, ceiling.ttlMs, ceiling.limit, "expensive-pool");
    }

    /** Increment a storage counter and translate the record into a decision. */
    private async increment(key: string, ttlMs: number, limit: number, name: string): Promise<RateDecision> {
        if (!this.storage) {
            // Callers gate on `this.enabled`, which already implies a storage.
            return ALLOWED;
        }
        const record = await this.storage.increment(key, ttlMs, limit, ttlMs, name);
        if (record.isBlocked || record.totalHits > limit) {
            return { allowed: false, retryAfterSeconds: Math.max(1, record.timeToBlockExpire) };
        }
        return ALLOWED;
    }
}
