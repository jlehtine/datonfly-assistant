import { randomUUID } from "node:crypto";

import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

import type { IPersistenceProvider, User, UserIdentity } from "@datonfly-assistant/core";

import { PERSISTENCE_PROVIDER } from "../constants.js";

/**
 * NestJS guard that enforces the middleware-injected identity contract.
 *
 * 1. Checks that `req.user` contains a {@link UserIdentity} (populated by the
 *    host application's authentication middleware/guard).
 * 2. Resolves the identity to a full {@link User} record via the persistence
 *    provider (find-or-create by email).
 * 3. Caches the resolved {@link User} on `req.resolvedUser` so downstream
 *    handlers and the `@ResolvedUser()` decorator can access it without
 *    additional DB lookups.
 */
@Injectable()
export class RequireUserGuard implements CanActivate {
    constructor(@Inject(PERSISTENCE_PROVIDER) private readonly persistence: IPersistenceProvider) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        const identity = (request as Request & { user?: UserIdentity | undefined }).user;

        if (!identity?.email) {
            throw new UnauthorizedException("User identity not provided");
        }

        // Resolve identity → User record (cached per request)
        const extended = request as Request & { resolvedUser?: User };
        extended.resolvedUser ??= await this.persistence.upsertUser({
            id: randomUUID(),
            email: identity.email,
            name: identity.name,
            avatarUrl: identity.avatarUrl,
            lastLoginAt: new Date(),
        });

        return true;
    }
}
