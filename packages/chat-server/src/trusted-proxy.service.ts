import { Inject, Injectable, Optional } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";

import { TRUSTED_REVERSE_PROXY } from "./constants.js";

export type TrustedReverseProxy = boolean | number | string | string[];

interface ProxyConfigurableApp {
    set: (name: "trust proxy", value: TrustedReverseProxy) => void;
}

function isProxyConfigurableApp(value: unknown): value is ProxyConfigurableApp {
    return typeof value === "object" && value !== null && "set" in value && typeof value.set === "function";
}

/**
 * Applies the trusted reverse-proxy configuration to the underlying HTTP adapter.
 *
 * This enables Express `req.ip` to resolve client IPs from proxy headers only
 * when the configured upstream proxy chain is trusted.
 */
@Injectable()
export class TrustedProxyService implements OnModuleInit {
    constructor(
        private readonly httpAdapterHost: HttpAdapterHost,
        @Optional() @Inject(TRUSTED_REVERSE_PROXY) private readonly trustedReverseProxy: TrustedReverseProxy | null,
    ) {}

    onModuleInit(): void {
        if (this.trustedReverseProxy === null) {
            return;
        }

        const httpAdapter = this.httpAdapterHost.httpAdapter as { getInstance: () => unknown };
        const app = httpAdapter.getInstance();
        if (isProxyConfigurableApp(app)) {
            app.set("trust proxy", this.trustedReverseProxy);
        }
    }
}
