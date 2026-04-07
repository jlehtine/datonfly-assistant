import {
    type CanActivate,
    type ExecutionContext,
    Injectable,
    SetMetadata,
    UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PinoLogger } from "nestjs-pino";

import type { UserIdentity } from "@datonfly-assistant/core";

import { AuthService } from "../auth/auth.service.js";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly authService: AuthService,
        private readonly reflector: Reflector,
        private readonly logger: PinoLogger,
    ) {
        this.logger.setContext("JwtAuthGuard");
    }

    canActivate(context: ExecutionContext): boolean {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const request = context.switchToHttp().getRequest<Request>();
        const cookieToken = (request.cookies as Record<string, string> | undefined)?.dfa_token;
        const user = this.authService.authenticateRequest(cookieToken);
        if (!user) {
            this.logger.error({ audit: true, op: "auth.rejected", error: "Invalid or missing token" });
            throw new UnauthorizedException("Missing or invalid authentication");
        }

        (request as Request & { user: UserIdentity }).user = user;
        return true;
    }
}
