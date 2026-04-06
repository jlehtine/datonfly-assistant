import { useCallback, useEffect, useState } from "react";

import type { UserIdentity } from "@datonfly-assistant/core";

interface AuthState {
    user: UserIdentity | null;
    token: string | null;
    loading: boolean;
}

export interface UseAuthResult {
    user: UserIdentity | null;
    token: string | null;
    loading: boolean;
    login: () => void;
    logout: () => void;
    getToken: () => string | null;
}

const BACKEND_URL = window.location.origin;

function consumeHashToken(): string | null {
    const hash = window.location.hash;
    if (hash.startsWith("#token=")) {
        const token = hash.slice("#token=".length);
        window.history.replaceState(null, "", window.location.pathname);
        return token;
    }
    return null;
}

export function useAuth(): UseAuthResult {
    // useState initializer runs exactly once, even under StrictMode double-mount,
    // so the hash token is consumed safely before any effect fires.
    const [hashToken] = useState(consumeHashToken);
    const [state, setState] = useState<AuthState>({ user: null, token: null, loading: true });

    useEffect(() => {
        const abort = new AbortController();

        async function authenticate(): Promise<void> {
            try {
                const headers: Record<string, string> = {};
                if (hashToken) {
                    headers.Authorization = `Bearer ${hashToken}`;
                }

                const res = await fetch(`${BACKEND_URL}/auth/me`, { headers, signal: abort.signal });

                if (!res.ok) {
                    setState({ user: null, token: null, loading: false });
                    return;
                }

                const data = (await res.json()) as { user: UserIdentity; token: string };

                setState({ user: data.user, token: data.token, loading: false });
            } catch {
                if (!abort.signal.aborted) {
                    setState({ user: null, token: null, loading: false });
                }
            }
        }

        void authenticate();

        return () => {
            abort.abort();
        };
    }, [hashToken]);

    const login = useCallback(() => {
        window.location.href = `${BACKEND_URL}/auth/login`;
    }, []);

    const logout = useCallback(() => {
        setState({ user: null, token: null, loading: false });
    }, []);

    const getToken = useCallback(() => state.token, [state.token]);

    return {
        user: state.user,
        token: state.token,
        loading: state.loading,
        login,
        logout,
        getToken,
    };
}
