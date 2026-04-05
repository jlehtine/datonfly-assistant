import {
    type CanActivate,
    type ExecutionContext,
    Injectable,
    SetMetadata,
    UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import type { AuthUser } from "@verbal-assistant/core";

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

        if (this.authService.isFakeMode) {
            (request as Request & { user: AuthUser }).user = this.authService.getFakeUser();
            return true;
        }

        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            throw new UnauthorizedException("Missing or invalid Authorization header");
        }

        const token = authHeader.slice(7);
        const user = this.authService.verifyToken(token);
        if (!user) {
            throw new UnauthorizedException("Invalid token");
        }

        (request as Request & { user: AuthUser }).user = user;
        return true;
    }
}
