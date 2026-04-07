import AccountCircle from "@mui/icons-material/AccountCircle";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useCallback, useState, type ReactElement } from "react";

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
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const handleMenuOpen = useCallback((e: React.MouseEvent<HTMLElement>) => { setAnchorEl(e.currentTarget); }, []);
    const handleMenuClose = useCallback(() => { setAnchorEl(null); }, []);
    const handleLogout = useCallback(() => {
        handleMenuClose();
        logout();
    }, [handleMenuClose, logout]);

    if (loading) {
        return (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "var(--app-height)" }}>
                <CircularProgress />
            </Box>
        );
    }

    if (!user) {
        return (
            <Box sx={{ height: "var(--app-height)" }}>
                <LoginPage onLogin={login} />
            </Box>
        );
    }

    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "var(--app-height)" }}>
            <AppBar position="static" elevation={0}>
                <Toolbar sx={{ maxWidth: "80rem", width: "100%", mx: "auto" }}>
                    <Typography variant="h6" sx={{ flexGrow: 1 }}>
                        Datonfly Assistant
                    </Typography>
                    <IconButton color="inherit" onClick={handleMenuOpen} aria-label="User menu">
                        <AccountCircle />
                    </IconButton>
                    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
                        <MenuItem disabled>
                            <ListItemText primary={user.name} />
                        </MenuItem>
                        <MenuItem onClick={handleLogout}>
                            <ListItemText primary="Sign out" />
                        </MenuItem>
                    </Menu>
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
