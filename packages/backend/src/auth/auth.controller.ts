import { Controller, Get, Query, Redirect, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";

import { AuthService } from "./auth.service.js";

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    @Get("login")
    @Redirect()
    async login(): Promise<{ url: string }> {
        if (this.authService.isFakeMode) {
            return { url: "/" };
        }
        const url = await this.authService.buildLoginUrl();
        return { url };
    }

    @Get("callback")
    async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
        if (this.authService.isFakeMode) {
            res.redirect("/");
            return;
        }

        const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
        const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
        const callbackUrl = new URL(`${String(protocol)}://${String(host)}${req.originalUrl}`);

        try {
            const { accessToken } = await this.authService.handleCallback(callbackUrl);

            // Redirect to frontend with token as a URL fragment (never sent to server)
            const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
            res.redirect(`${frontendUrl}/#token=${accessToken}`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Authentication failed";
            throw new UnauthorizedException(message);
        }
    }

    @Get("me")
    me(@Query("mode") _mode: string, @Req() req: Request): object {
        if (this.authService.isFakeMode) {
            return {
                user: this.authService.getFakeUser(),
                token: this.authService.getFakeToken(),
            };
        }

        // In OIDC mode, validate the Bearer token
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            throw new UnauthorizedException("Missing or invalid Authorization header");
        }

        const token = authHeader.slice(7);
        const user = this.authService.verifyToken(token);
        if (!user) {
            throw new UnauthorizedException("Invalid token");
        }

        return { user, token };
    }
}
