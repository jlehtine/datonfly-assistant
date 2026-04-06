import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

import type { User } from "@datonfly-assistant/core";

/**
 * Parameter decorator that extracts the resolved {@link User} record from the
 * request.  The `RequireUserGuard` must run before this decorator so that
 * `req.resolvedUser` is populated.
 */
export const ResolvedUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as Request & { resolvedUser: User }).resolvedUser;
});
