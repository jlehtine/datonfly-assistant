import { Controller, Get, HttpCode, Post, Redirect, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { PinoLogger } from "nestjs-pino";

import { Public } from "../guards/jwt-auth.guard.js";

import { AuthService, SESSION_COOKIE_NAME } from "./auth.service.js";

@Controller("auth")
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly logger: PinoLogger,
    ) {
        this.logger.setContext("AuthController");
    }

    @Public()
    @Get("login")
    @Redirect()
    async login(): Promise<{ url: string }> {
        const url = await this.authService.getLoginUrl();
        return { url };
    }

    @Public()
    @Get("callback")
    async callback(@Req() req: Request, @Res() res: Response): Promise<void> {
        const callbackUrl = this.authService.buildCallbackUrl(req.originalUrl);

        try {
            const { redirectUrl, token } = await this.authService.handleCallback(callbackUrl);
            if (token) {
                res.cookie(SESSION_COOKIE_NAME, token, this.authService.getCookieOptions());
            }
            res.redirect(redirectUrl);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Authentication failed";
            this.logger.error({ audit: true, op: "auth.callback.failed", error: message });
            throw new UnauthorizedException(message);
        }
    }

    @Get("me")
    me(@Req() req: Request, @Res({ passthrough: true }) res: Response): object {
        const cookieToken = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
        const info = this.authService.getAuthInfo(cookieToken);
        if (!info) {
            this.logger.error({ audit: true, op: "auth.rejected", error: "Invalid or missing token" });
            throw new UnauthorizedException("Missing or invalid authentication");
        }
        // Ensure the cookie is always set (e.g. for fake mode on first visit)
        res.cookie(SESSION_COOKIE_NAME, info.token, this.authService.getCookieOptions());
        return { user: info.user };
    }

    @Public()
    @Post("logout")
    @HttpCode(200)
    logout(@Res({ passthrough: true }) res: Response): object {
        res.clearCookie(SESSION_COOKIE_NAME, this.authService.getClearCookieOptions());
        return { ok: true };
    }
}
