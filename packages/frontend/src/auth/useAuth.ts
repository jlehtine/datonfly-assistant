import { useCallback, useEffect, useState } from "react";

import type { UserIdentity } from "@datonfly-assistant/core";

interface AuthState {
    user: UserIdentity | null;
    loading: boolean;
    authMode?: "fake" | "oidc" | undefined;
}

export interface UseAuthResult {
    user: UserIdentity | null;
    loading: boolean;
    authMode?: "fake" | "oidc" | undefined;
    login: () => void;
    logout: () => void;
}

const BACKEND_URL = window.location.origin;

export function useAuth(): UseAuthResult {
    const [state, setState] = useState<AuthState>({ user: null, loading: true });

    useEffect(() => {
        const abort = new AbortController();

        async function authenticate(): Promise<void> {
            try {
                const res = await fetch(`${BACKEND_URL}/auth/me`, {
                    credentials: "include",
                    signal: abort.signal,
                });

                if (!res.ok) {
                    setState({ user: null, loading: false });
                    return;
                }

                const data = (await res.json()) as { user: UserIdentity; authMode?: "fake" | "oidc" };

                setState({ user: data.user, loading: false, authMode: data.authMode });
            } catch {
                if (!abort.signal.aborted) {
                    setState({ user: null, loading: false });
                }
            }
        }

        void authenticate();

        return () => {
            abort.abort();
        };
    }, []);

    const login = useCallback(() => {
        window.location.href = `${BACKEND_URL}/auth/login`;
    }, []);

    const logout = useCallback(() => {
        void fetch(`${BACKEND_URL}/auth/logout`, {
            method: "POST",
            credentials: "include",
        }).finally(() => {
            setState({ user: null, loading: false });
        });
    }, []);

    return {
        user: state.user,
        loading: state.loading,
        authMode: state.authMode,
        login,
        logout,
    };
}
