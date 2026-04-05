import { Controller, Get, Redirect, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";

import { Public } from "../guards/jwt-auth.guard.js";

import { AuthService } from "./auth.service.js";

@Controller("auth")
export class AuthController {
    constructor(private readonly authService: AuthService) {}

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
        const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
        const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
        const callbackUrl = new URL(`${String(protocol)}://${String(host)}${req.originalUrl}`);

        try {
            const redirectUrl = await this.authService.handleCallback(callbackUrl);
            res.redirect(redirectUrl);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Authentication failed";
            throw new UnauthorizedException(message);
        }
    }

    @Get("me")
    me(@Req() req: Request): object {
        const info = this.authService.getAuthInfo(req.headers.authorization);
        if (!info) {
            throw new UnauthorizedException("Missing or invalid Authorization header");
        }
        return info;
    }
}
