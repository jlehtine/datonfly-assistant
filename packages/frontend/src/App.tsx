import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { ReactElement } from "react";

import { ChatHistoryEmbed } from "@datonfly-assistant/chat-ui-mui";
import { emojiPickerTool } from "@datonfly-assistant/chat-ui-mui/emoji";
import { highlightComponents } from "@datonfly-assistant/chat-ui-mui/highlight";
import { RichInput } from "@datonfly-assistant/chat-ui-mui/rich";

import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";

const BACKEND_URL = window.location.origin;

export function App(): ReactElement {
    const { user, loading, login, logout } = useAuth();
    const isDesktop = useMediaQuery("(min-height:768px)");
    const maxRows = isDesktop ? 10 : 4;

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
                <Toolbar sx={{ maxWidth: "80rem", width: "100%", mx: "auto" }}>
                    <Typography variant="h6" sx={{ flexGrow: 1 }}>
                        Datonfly Assistant
                    </Typography>
                    <Typography variant="body2" sx={{ mr: 2 }}>
                        {user.name}
                    </Typography>
                    <Button color="inherit" size="small" onClick={logout}>
                        Sign out
                    </Button>
                </Toolbar>
            </AppBar>
            <Box sx={{ flex: 1, overflow: "hidden", display: "flex", justifyContent: "center" }}>
                <Box sx={{ width: "100%", maxWidth: "80rem" }}>
                    <ChatHistoryEmbed
                        config={{
                            url: BACKEND_URL,
                            inputComponent: RichInput,
                            inputTools: [emojiPickerTool],
                            maxRows,
                            messageComponents: highlightComponents,
                        }}
                    />
                </Box>
            </Box>
        </Box>
    );
}
