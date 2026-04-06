import { Injectable } from "@nestjs/common";
import jsonwebtoken from "jsonwebtoken";
import * as client from "openid-client";

import type { UserIdentity } from "@datonfly-assistant/core";

export interface AuthConfig {
    mode: "fake" | "oidc";
    jwtSecret: string;
    /** Frontend origin URL, used for OIDC callback redirects. */
    frontendUrl?: string | undefined;
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
    createdAt: number;
}

/** Maximum number of concurrent PKCE sessions to prevent memory exhaustion. */
const MAX_PKCE_SESSIONS = 1000;
/** PKCE session time-to-live in milliseconds (10 minutes). */
const PKCE_SESSION_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class AuthService {
    private readonly config: AuthConfig;
    private oidcConfig: client.Configuration | null = null;
    /** Maps state → PKCE session data. */
    private readonly pkceSessions = new Map<string, PkceSession>();

    constructor(config: AuthConfig) {
        this.config = config;
    }

    // ── Lifecycle ──

    async initialize(): Promise<void> {
        if (this.config.mode === "fake") {
            // Logged at startup via NestJS logger in main.ts bootstrap.
        }

        if (this.config.mode === "oidc") {
            const oidc = this.config.oidc;
            if (!oidc) {
                throw new Error("OIDC config is required when AUTH_MODE=oidc");
            }
            this.oidcConfig = await client.discovery(new URL(oidc.issuerUrl), oidc.clientId, oidc.clientSecret);
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

    authenticateRequest(authorizationHeader: string | undefined): UserIdentity | null {
        if (this.config.mode === "fake") return this.getFakeUser();
        return this.verifyBearerHeader(authorizationHeader);
    }

    getAuthInfo(authorizationHeader: string | undefined): { user: UserIdentity; token: string } | null {
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

    authenticateToken(token: string): UserIdentity | null {
        if (this.config.mode === "fake") return this.getFakeUser();
        return this.verifyToken(token);
    }

    // ── Internal helpers ──

    private getFakeUser(): UserIdentity {
        const fakeUser = this.config.fakeUser ?? { email: "dev@localhost", name: "Dev User" };
        return {
            email: fakeUser.email,
            name: fakeUser.name,
        };
    }

    private signToken(user: UserIdentity): string {
        return jsonwebtoken.sign(
            {
                email: user.email,
                name: user.name,
                avatarUrl: user.avatarUrl,
            },
            this.config.jwtSecret,
            { expiresIn: "24h" },
        );
    }

    private verifyToken(token: string): UserIdentity | null {
        try {
            const payload = jsonwebtoken.verify(token, this.config.jwtSecret) as jsonwebtoken.JwtPayload;
            const email = (payload.email as string | undefined) ?? "";
            if (!email) return null;
            return {
                email,
                name: (payload.name as string | undefined) ?? "",
                avatarUrl: (payload.avatarUrl as string | undefined) ?? undefined,
            };
        } catch {
            return null;
        }
    }

    private verifyBearerHeader(authorizationHeader: string | undefined): UserIdentity | null {
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

        this.pkceSessions.set(state, { codeVerifier, state, nonce, createdAt: Date.now() });
        this.evictExpiredPkceSessions();

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

    private async performOidcCallback(callbackUrl: URL): Promise<{ accessToken: string; user: UserIdentity }> {
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

        if (Date.now() - session.createdAt > PKCE_SESSION_TTL_MS) {
            throw new Error("PKCE session expired");
        }

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

        if (!email) {
            throw new Error("No email address returned from OIDC provider");
        }

        if (this.config.allowedEmailDomain) {
            const domain = email.split("@")[1];
            if (domain?.toLowerCase() !== this.config.allowedEmailDomain.toLowerCase()) {
                throw new Error(`Email domain not allowed. Expected @${this.config.allowedEmailDomain}, got ${email}`);
            }
        }

        const user: UserIdentity = {
            email,
            name: (claims.name as string | undefined) ?? (email || "Unknown"),
            avatarUrl: (claims.picture as string | undefined) ?? undefined,
        };

        const accessToken = this.signToken(user);
        return { accessToken, user };
    }

    private evictExpiredPkceSessions(): void {
        const now = Date.now();
        for (const [key, session] of this.pkceSessions) {
            if (now - session.createdAt > PKCE_SESSION_TTL_MS) {
                this.pkceSessions.delete(key);
            }
        }
        // Enforce hard cap: drop oldest entries if over the limit
        while (this.pkceSessions.size > MAX_PKCE_SESSIONS) {
            const firstKey = this.pkceSessions.keys().next().value;
            if (firstKey !== undefined) {
                this.pkceSessions.delete(firstKey);
            }
        }
    }
}
