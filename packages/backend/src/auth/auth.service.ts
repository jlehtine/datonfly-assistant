import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import jsonwebtoken from "jsonwebtoken";
import * as client from "openid-client";

import type { AuthUser } from "@verbal-assistant/core";

export interface AuthConfig {
    mode: "fake" | "oidc";
    jwtSecret: string;
    /** Only required when mode === "oidc" */
    oidc?:
        | {
              issuerUrl: string;
              clientId: string;
              clientSecret: string;
              redirectUri: string;
          }
        | undefined;
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

    constructor(config: AuthConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        if (this.config.mode === "oidc") {
            const oidc = this.config.oidc;
            if (!oidc) {
                throw new Error("OIDC config is required when AUTH_MODE=oidc");
            }
            this.oidcConfig = await client.discovery(new URL(oidc.issuerUrl), oidc.clientId, oidc.clientSecret);
        }
    }

    async buildLoginUrl(): Promise<string> {
        if (this.config.mode === "fake") {
            throw new Error("Login URL not available in fake auth mode");
        }

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

    async handleCallback(callbackUrl: URL): Promise<{ accessToken: string; user: AuthUser }> {
        if (this.config.mode === "fake") {
            throw new Error("Callback not available in fake auth mode");
        }

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

        const user: AuthUser = {
            id: randomUUID(),
            email: (claims.email as string | undefined) ?? "",
            name: (claims.name as string | undefined) ?? (claims.email as string | undefined) ?? "Unknown",
            avatarUrl: (claims.picture as string | undefined) ?? undefined,
        };

        const accessToken = this.signToken(user);
        return { accessToken, user };
    }

    getFakeUser(): AuthUser {
        const fakeUser = this.config.fakeUser ?? { email: "dev@localhost", name: "Dev User" };
        return {
            id: "00000000-0000-0000-0000-000000000000",
            email: fakeUser.email,
            name: fakeUser.name,
        };
    }

    getFakeToken(): string {
        return this.signToken(this.getFakeUser());
    }

    signToken(user: AuthUser): string {
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

    verifyToken(token: string): AuthUser | null {
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

    get isFakeMode(): boolean {
        return this.config.mode === "fake";
    }
}
