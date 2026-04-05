import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import jsonwebtoken from "jsonwebtoken";
import * as client from "openid-client";

import type { AuthUser, IPersistenceProvider } from "@verbal-assistant/core";

export interface AuthConfig {
    mode: "fake" | "oidc";
    jwtSecret: string;
    /** Frontend origin URL, used for OIDC callback redirects. */
    frontendUrl?: string | undefined;
    /** Optional persistence provider for user upsert (stable IDs). */
    persistence?: IPersistenceProvider | undefined;
    /** Only required when mode === "oidc" */
    oidc?:
        | {
              issuerUrl: string;
              clientId: string;
              clientSecret: string;
              redirectUri: string;
          }
        | undefined;
    /** If set, only emails ending with this domain are allowed (e.g. "example.com"). */
    allowedEmailDomain?: string | undefined;
    /** Only used when mode === "fake" */
    fakeUser?:
        | {
              email: string;
              name: string;
          }
        | undefined;
}

interface PkceSession {
    codeVerifier: string;
    state: string;
    nonce: string;
}

@Injectable()
export class AuthService {
    private readonly config: AuthConfig;
    private oidcConfig: client.Configuration | null = null;
    /** Maps state → PKCE session data. */
    private readonly pkceSessions = new Map<string, PkceSession>();
    /** Resolved fake user (DB-backed when persistence is available). */
    private resolvedFakeUser: AuthUser | null = null;

    constructor(config: AuthConfig) {
        this.config = config;
    }

    // ── Lifecycle ──

    async initialize(): Promise<void> {
        if (this.config.mode === "fake") {
            console.log("AUTH_MODE=fake — using fake authentication (no login required)");
        }

        if (this.config.mode === "oidc") {
            const oidc = this.config.oidc;
            if (!oidc) {
                throw new Error("OIDC config is required when AUTH_MODE=oidc");
            }
            this.oidcConfig = await client.discovery(new URL(oidc.issuerUrl), oidc.clientId, oidc.clientSecret);
        }

        // Upsert fake user to DB at startup for stable IDs
        if (this.config.mode === "fake" && this.config.persistence) {
            const fakeUser = this.config.fakeUser ?? { email: "dev@localhost", name: "Dev User" };
            const dbUser = await this.config.persistence.upsertUser({
                id: "00000000-0000-0000-0000-000000000000",
                email: fakeUser.email,
                name: fakeUser.name,
                lastLoginAt: new Date(),
            });
            this.resolvedFakeUser = {
                id: dbUser.id,
                email: dbUser.email,
                name: dbUser.name,
                avatarUrl: dbUser.avatarUrl,
            };
        }
    }

    // ── Public API (mode-agnostic) ──

    async getLoginUrl(): Promise<string> {
        if (this.config.mode === "fake") return "/";
        return this.buildOidcLoginUrl();
    }

    async handleCallback(callbackUrl: URL): Promise<string> {
        if (this.config.mode === "fake") return "/";

        const { accessToken } = await this.performOidcCallback(callbackUrl);
        const frontendUrl = this.config.frontendUrl ?? "http://localhost:5173";
        return `${frontendUrl}/#token=${accessToken}`;
    }

    authenticateRequest(authorizationHeader: string | undefined): AuthUser | null {
        if (this.config.mode === "fake") return this.getFakeUser();
        return this.verifyBearerHeader(authorizationHeader);
    }

    getAuthInfo(authorizationHeader: string | undefined): { user: AuthUser; token: string } | null {
        if (this.config.mode === "fake") {
            const user = this.getFakeUser();
            return { user, token: this.signToken(user) };
        }
        if (!authorizationHeader?.startsWith("Bearer ")) return null;
        const token = authorizationHeader.slice(7);
        const user = this.verifyToken(token);
        if (!user) return null;
        return { user, token };
    }

    authenticateToken(token: string): AuthUser | null {
        if (this.config.mode === "fake") return this.getFakeUser();
        return this.verifyToken(token);
    }

    // ── Internal helpers ──

    private getFakeUser(): AuthUser {
        if (this.resolvedFakeUser) return this.resolvedFakeUser;
        const fakeUser = this.config.fakeUser ?? { email: "dev@localhost", name: "Dev User" };
        return {
            id: "00000000-0000-0000-0000-000000000000",
            email: fakeUser.email,
            name: fakeUser.name,
        };
    }

    private signToken(user: AuthUser): string {
        return jsonwebtoken.sign(
            {
                sub: user.id,
                email: user.email,
                name: user.name,
                avatarUrl: user.avatarUrl,
            },
            this.config.jwtSecret,
            { expiresIn: "24h" },
        );
    }

    private verifyToken(token: string): AuthUser | null {
        try {
            const payload = jsonwebtoken.verify(token, this.config.jwtSecret) as jsonwebtoken.JwtPayload;
            return {
                id: payload.sub ?? "",
                email: (payload.email as string | undefined) ?? "",
                name: (payload.name as string | undefined) ?? "",
                avatarUrl: (payload.avatarUrl as string | undefined) ?? undefined,
            };
        } catch {
            return null;
        }
    }

    private verifyBearerHeader(authorizationHeader: string | undefined): AuthUser | null {
        if (!authorizationHeader?.startsWith("Bearer ")) return null;
        return this.verifyToken(authorizationHeader.slice(7));
    }

    private async buildOidcLoginUrl(): Promise<string> {
        const oidc = this.config.oidc;
        const config = this.oidcConfig;
        if (!oidc || !config) {
            throw new Error("OIDC config is required when AUTH_MODE=oidc");
        }

        const codeVerifier = client.randomPKCECodeVerifier();
        const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
        const state = client.randomState();
        const nonce = client.randomNonce();

        this.pkceSessions.set(state, { codeVerifier, state, nonce });

        const url = client.buildAuthorizationUrl(config, {
            redirect_uri: oidc.redirectUri,
            scope: "openid email profile",
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            state,
            nonce,
        });

        return url.href;
    }

    private async performOidcCallback(callbackUrl: URL): Promise<{ accessToken: string; user: AuthUser }> {
        const config = this.oidcConfig;
        if (!config) {
            throw new Error("OIDC config is required when AUTH_MODE=oidc");
        }

        const state = callbackUrl.searchParams.get("state");
        if (!state) {
            throw new Error("Missing state parameter");
        }

        const session = this.pkceSessions.get(state);
        if (!session) {
            throw new Error("Invalid or expired state parameter");
        }
        this.pkceSessions.delete(state);

        const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
            pkceCodeVerifier: session.codeVerifier,
            expectedState: session.state,
            expectedNonce: session.nonce,
        });

        const claims = tokens.claims();
        if (!claims) {
            throw new Error("No ID token claims returned");
        }

        const email = (claims.email as string | undefined) ?? "";

        if (this.config.allowedEmailDomain) {
            const domain = email.split("@")[1];
            if (domain?.toLowerCase() !== this.config.allowedEmailDomain.toLowerCase()) {
                throw new Error(`Email domain not allowed. Expected @${this.config.allowedEmailDomain}, got ${email}`);
            }
        }

        let user: AuthUser = {
            id: randomUUID(),
            email,
            name: (claims.name as string | undefined) ?? (email || "Unknown"),
            avatarUrl: (claims.picture as string | undefined) ?? undefined,
        };

        // Upsert to DB for stable IDs across logins
        if (this.config.persistence) {
            const dbUser = await this.config.persistence.upsertUser({
                id: user.id,
                email: user.email,
                name: user.name,
                avatarUrl: user.avatarUrl,
                lastLoginAt: new Date(),
            });
            user = {
                id: dbUser.id,
                email: dbUser.email,
                name: dbUser.name,
                avatarUrl: dbUser.avatarUrl,
            };
        }

        const accessToken = this.signToken(user);
        return { accessToken, user };
    }
}
