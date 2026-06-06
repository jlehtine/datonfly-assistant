import { Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Throttler guard that keys limits by authenticated user (falling back to client
 * IP) and ignores non-HTTP execution contexts.
 *
 * Tier selection is handled by the per-throttler `skipIf` predicates configured
 * in {@link ChatModule}: every registered throttler is skipped except the one
 * matching the request's resolved tier, so each route is bound by exactly one
 * tier. WebSocket message handlers are rate-limited separately in the gateway.
 */
@Injectable()
export class TieredThrottlerGuard extends ThrottlerGuard {
    /** Skip everything that is not an HTTP request (e.g. WebSocket events). */
    protected override shouldSkip(context: ExecutionContext): Promise<boolean> {
        return Promise.resolve(context.getType() !== "http");
    }

    /**
     * Key by authenticated identity when available, otherwise by client IP.
     *
     * `resolvedUser` is populated by `RequireUserGuard`, and `user` by the host
     * application's authentication guard. The IP is taken from `req.ip`, which
     * honours the configured Express `trust proxy` setting.
     */
    protected override getTracker(req: Record<string, unknown>): Promise<string> {
        const resolvedUser = req.resolvedUser as { id?: string } | undefined;
        if (resolvedUser?.id) {
            return Promise.resolve(`user:${resolvedUser.id}`);
        }
        const user = req.user as { email?: string } | undefined;
        if (user?.email) {
            return Promise.resolve(`user:${user.email}`);
        }
        const socket = req.socket as { remoteAddress?: string } | undefined;
        const ip = (req.ip as string | undefined) ?? socket?.remoteAddress ?? "unknown";
        return Promise.resolve(`ip:${ip}`);
    }
}
