import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Optional,
    UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

import { ADMIN_IPS, ADMIN_SECRET } from "../constants.js";

/**
 * NestJS guard that protects admin endpoints with a shared secret and IP allowlist.
 *
 * Both `ADMIN_SECRET` and `ADMIN_IPS` must be configured (non-null) for any
 * admin endpoint to be accessible. The guard checks:
 *
 * 1. `Authorization: Bearer <secret>` matches the configured secret.
 * 2. The request IP falls within one of the configured CIDR ranges or exact addresses.
 */
@Injectable()
export class AdminGuard implements CanActivate {
    constructor(
        @Optional() @Inject(ADMIN_SECRET) private readonly secret: string | null,
        @Optional() @Inject(ADMIN_IPS) private readonly allowedIps: string[] | null,
    ) {}

    canActivate(context: ExecutionContext): boolean {
        // Both must be configured for admin access to be available.
        if (!this.secret || !this.allowedIps || this.allowedIps.length === 0) {
            throw new ForbiddenException("Admin access is not configured");
        }

        const request = context.switchToHttp().getRequest<Request>();

        // Check Bearer token.
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            throw new UnauthorizedException("Missing or invalid Authorization header");
        }
        const token = authHeader.slice(7);
        if (token !== this.secret) {
            throw new UnauthorizedException("Invalid admin secret");
        }

        // Check IP.
        const requestIp = request.ip ?? request.socket.remoteAddress ?? "";
        if (!this.isIpAllowed(requestIp)) {
            throw new ForbiddenException("Request IP not in admin allowlist");
        }

        return true;
    }

    private isIpAllowed(ip: string): boolean {
        // Normalize IPv6-mapped IPv4 (e.g. "::ffff:127.0.0.1" → "127.0.0.1").
        const normalizedIp = ip.startsWith("::ffff:") ? ip.slice(7) : ip;

        for (const entry of this.allowedIps ?? []) {
            if (entry.includes("/")) {
                if (this.matchesCidr(normalizedIp, entry)) return true;
            } else {
                const normalizedEntry = entry.startsWith("::ffff:") ? entry.slice(7) : entry;
                if (normalizedIp === normalizedEntry) return true;
            }
        }
        return false;
    }

    private matchesCidr(ip: string, cidr: string): boolean {
        const [range, prefixStr] = cidr.split("/");
        if (!range || !prefixStr) return false;

        const normalizedRange = range.startsWith("::ffff:") ? range.slice(7) : range;
        const prefix = parseInt(prefixStr, 10);

        // Only handle IPv4 CIDR for now.
        const ipNum = this.ipv4ToNumber(ip);
        const rangeNum = this.ipv4ToNumber(normalizedRange);
        if (ipNum === null || rangeNum === null) return false;

        const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
        return (ipNum & mask) === (rangeNum & mask);
    }

    private ipv4ToNumber(ip: string): number | null {
        const parts = ip.split(".");
        if (parts.length !== 4) return null;
        let num = 0;
        for (const part of parts) {
            const octet = parseInt(part, 10);
            if (isNaN(octet) || octet < 0 || octet > 255) return null;
            num = (num << 8) | octet;
        }
        return num >>> 0;
    }
}
