import {
    type CanActivate,
    type ExecutionContext,
    Injectable,
    SetMetadata,
    UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import type { UserIdentity } from "@datonfly-assistant/core";

import { AuthService } from "../auth/auth.service.js";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly authService: AuthService,
        private readonly reflector: Reflector,
    ) {}

    canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const request = context.switchToHttp().getRequest<Request>();
        const user = this.authService.authenticateRequest(request.headers.authorization);
        if (!user) {
            throw new UnauthorizedException("Missing or invalid Authorization header");
        }

        (request as Request & { user: UserIdentity }).user = user;
        return true;
    }
}
