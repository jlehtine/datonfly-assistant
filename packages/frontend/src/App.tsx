import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useCallback, useRef, useState, type ReactElement } from "react";

import { ChatEmbed } from "@verbal-assistant/chat-ui-mui";
import { emojiPickerTool } from "@verbal-assistant/chat-ui-mui/emoji";
import { highlightComponents } from "@verbal-assistant/chat-ui-mui/highlight";
import { RichInput } from "@verbal-assistant/chat-ui-mui/rich";

import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";

const BACKEND_URL = window.location.origin;

export function App(): ReactElement {
    const { user, loading, login, logout, getToken } = useAuth();
    const isDesktop = useMediaQuery("(min-height:768px)");
    const maxRows = isDesktop ? 10 : 4;
    const [threadId, setThreadId] = useState<string | null>(null);
    const pendingCreateRef = useRef<Promise<string> | null>(null);

    const ensureThread = useCallback(async (): Promise<string> => {
        if (threadId) return threadId;
        if (pendingCreateRef.current) return pendingCreateRef.current;

        const promise = (async () => {
            const token = getToken();
            const res = await fetch(`${BACKEND_URL}/threads`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            });
            if (!res.ok) {
                throw new Error(`Failed to create thread: ${res.statusText}`);
            }
            const thread = (await res.json()) as { id: string };
            setThreadId(thread.id);
            pendingCreateRef.current = null;
            return thread.id;
        })();

        pendingCreateRef.current = promise;
        return promise;
    }, [threadId, getToken]);

    if (loading) {
        return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!user) {
        return (
            <Box sx={{ height: "100vh" }}>
                <LoginPage onLogin={login} />
            </Box>
        );
    }

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
            <AppBar position="static" elevation={0}>
                <Toolbar>
                    <Typography variant="h6" sx={{ flexGrow: 1 }}>
                        Verbal Assistant
                    </Typography>
                    <Typography variant="body2" sx={{ mr: 2 }}>
                        {user.name}
                    </Typography>
                    <Button color="inherit" size="small" onClick={logout}>
                        Sign out
                    </Button>
                </Toolbar>
            </AppBar>
            <Box sx={{ flex: 1, overflow: "hidden" }}>
                <ChatEmbed
                    config={{
                        url: BACKEND_URL,
                        getToken,
                        threadId: threadId ?? undefined,
                        onBeforeSend: ensureThread,
                        inputComponent: RichInput,
                        inputTools: [emojiPickerTool],
                        maxRows,
                        messageComponents: highlightComponents,
                    }}
                />
            </Box>
        </Box>
    );
}
