import AccountCircle from "@mui/icons-material/AccountCircle";
import SettingsIcon from "@mui/icons-material/Settings";
import SwitchAccountIcon from "@mui/icons-material/SwitchAccount";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";

import { ChatHistoryEmbed, ChatUserSettingsEmbed } from "@datonfly-assistant/chat-ui-mui";
import { emojiPickerTool } from "@datonfly-assistant/chat-ui-mui/emoji";
import { highlightComponents } from "@datonfly-assistant/chat-ui-mui/highlight";
import { RichInput } from "@datonfly-assistant/chat-ui-mui/rich";

import { useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";

const BACKEND_URL = window.location.origin;

/** Fake user identities — must match FAKE_USERS in auth.service.ts. */
const FAKE_USERS = [
    { id: 1, name: "Fake Alice" },
    { id: 2, name: "Fake Bob" },
    { id: 3, name: "Fake Charlie" },
    { id: 4, name: "Fake Diana" },
    { id: 5, name: "Fake Eve" },
];

export function App(): ReactElement {
    const { t, i18n } = useTranslation();
    const { user, loading, authMode, login, logout } = useAuth();
    const isDesktop = useMediaQuery("(min-height:768px)");
    const maxRows = isDesktop ? 10 : 4;
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [switchAnchorEl, setSwitchAnchorEl] = useState<null | HTMLElement>(null);
    const handleMenuOpen = useCallback((e: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(e.currentTarget);
    }, []);
    const handleMenuClose = useCallback(() => {
        setAnchorEl(null);
    }, []);
    const handleSwitchOpen = useCallback((e: React.MouseEvent<HTMLElement>) => {
        setSwitchAnchorEl(e.currentTarget);
    }, []);
    const handleSwitchClose = useCallback(() => {
        setSwitchAnchorEl(null);
    }, []);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const handleSettingsOpen = useCallback(() => {
        handleMenuClose();
        setSettingsOpen(true);
    }, [handleMenuClose]);
    const handleSettingsClose = useCallback(() => {
        setSettingsOpen(false);
    }, []);
    const handleLogout = useCallback(() => {
        handleMenuClose();
        logout();
    }, [handleMenuClose, logout]);
    const handleSwitchUser = useCallback(
        (fakeid: number) => {
            handleSwitchClose();
            handleMenuClose();
            window.location.href = `${BACKEND_URL}/auth/login?fakeid=${String(fakeid)}`;
        },
        [handleSwitchClose, handleMenuClose],
    );

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
                        {t("appTitle")}
                    </Typography>
                    <IconButton
                        className="datonfly-user-menu-button"
                        color="inherit"
                        onClick={handleMenuOpen}
                        aria-label={t("userMenu")}
                    >
                        <AccountCircle />
                    </IconButton>
                    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
                        <MenuItem disabled>
                            <ListItemText primary={user.name} />
                        </MenuItem>
                        {authMode === "fake" && (
                            <MenuItem onClick={handleSwitchOpen}>
                                <ListItemIcon>
                                    <SwitchAccountIcon fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary={t("switchUser")} />
                            </MenuItem>
                        )}
                        <MenuItem className="datonfly-chat-settings-menuitem" onClick={handleSettingsOpen}>
                            <ListItemIcon>
                                <SettingsIcon fontSize="small" />
                            </ListItemIcon>
                            <ListItemText primary={t("chatSettings")} />
                        </MenuItem>
                        <Divider />
                        <MenuItem onClick={handleLogout}>
                            <ListItemText primary={t("signOut")} />
                        </MenuItem>
                    </Menu>
                    {authMode === "fake" && (
                        <Menu anchorEl={switchAnchorEl} open={Boolean(switchAnchorEl)} onClose={handleSwitchClose}>
                            {FAKE_USERS.map((fu) => (
                                <MenuItem
                                    key={fu.id}
                                    selected={fu.name === user.name}
                                    onClick={() => {
                                        handleSwitchUser(fu.id);
                                    }}
                                >
                                    <ListItemText primary={fu.name} />
                                </MenuItem>
                            ))}
                        </Menu>
                    )}
                    <Dialog className="datonfly-chat-settings-dialog" open={settingsOpen} onClose={handleSettingsClose}>
                        <ChatUserSettingsEmbed
                            config={{ url: BACKEND_URL, locale: i18n.language }}
                            onSaved={handleSettingsClose}
                        />
                    </Dialog>
                </Toolbar>
            </AppBar>
            <Box sx={{ flex: 1, overflow: "hidden", display: "flex", justifyContent: "center" }}>
                <Box sx={{ width: "100%", maxWidth: "80rem" }}>
                    <Routes>
                        <Route
                            path="/"
                            element={<ChatPage locale={i18n.language} maxRows={maxRows} selectedThreadId={null} />}
                        />
                        <Route
                            path="/threads/:threadId"
                            element={<ChatPageWithParam locale={i18n.language} maxRows={maxRows} />}
                        />
                        <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                </Box>
            </Box>
        </Box>
    );
}

interface ChatPageProps {
    locale: string;
    maxRows: number;
    selectedThreadId: string | null;
}

function ChatPage({ locale, maxRows, selectedThreadId }: ChatPageProps): ReactElement {
    const navigate = useNavigate();

    const handleThreadIdChange = useCallback(
        (threadId: string | null) => {
            if (threadId === null) {
                void navigate("/");
            } else {
                void navigate(`/threads/${threadId}`);
            }
        },
        [navigate],
    );

    return (
        <ChatHistoryEmbed
            config={{
                url: BACKEND_URL,
                locale,
                inputComponent: RichInput,
                inputTools: [emojiPickerTool],
                maxRows,
                messageComponents: highlightComponents,
                selectedThreadId,
                onSelectedThreadIdChange: handleThreadIdChange,
            }}
        />
    );
}

function ChatPageWithParam({ locale, maxRows }: Omit<ChatPageProps, "selectedThreadId">): ReactElement {
    const { threadId } = useParams<{ threadId: string }>();
    return <ChatPage locale={locale} maxRows={maxRows} selectedThreadId={threadId ?? null} />;
}
