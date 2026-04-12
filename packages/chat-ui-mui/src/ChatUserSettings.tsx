import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { typedFetch } from "@datonfly-assistant/chat-client";
import { useChatClient } from "@datonfly-assistant/chat-client/react";
import { userProfileWireSchema, USERS_ME_PATH } from "@datonfly-assistant/core";

/** Props for the {@link ChatUserSettings} component. */
export interface ChatUserSettingsProps {
    /** Called after the user's profile has been saved successfully. */
    onSaved?: (() => void) | undefined;
}

/**
 * Inline settings form that lets the user configure their AI alias —
 * the name visible to the AI assistant in group conversations.
 *
 * Fetches the current alias on mount and submits changes via
 * `PATCH /datonfly-assistant/users/me`.
 */
export function ChatUserSettings({ onSaved }: ChatUserSettingsProps): ReactElement {
    const { t } = useTranslation();
    const client = useChatClient();

    const [alias, setAlias] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void typedFetch(client, USERS_ME_PATH, userProfileWireSchema).then((profile) => {
            if (cancelled) return;
            setAlias(profile.agentAlias ?? "");
            setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [client]);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setAlias(e.target.value);
        setDirty(true);
    }, []);

    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            await typedFetch(client, USERS_ME_PATH, userProfileWireSchema, {
                method: "PATCH",
                body: { agentAlias: alias || null },
            });
            setDirty(false);
            onSaved?.();
        } finally {
            setSaving(false);
        }
    }, [client, alias, onSaved]);

    if (loading) {
        return (
            <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                <CircularProgress size={24} />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5, minWidth: 240 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Typography variant="subtitle2">{t("displayNameForAI")}</Typography>
                <Tooltip title={t("displayNameForAITooltip")} arrow>
                    <HelpOutlineIcon fontSize="small" color="action" sx={{ cursor: "help" }} />
                </Tooltip>
            </Box>
            <TextField
                size="small"
                placeholder={t("unidentifiedUser")}
                value={alias}
                onChange={handleChange}
                slotProps={{ htmlInput: { maxLength: 100 } }}
                fullWidth
            />
            <Button variant="contained" size="small" disabled={!dirty || saving} onClick={() => void handleSave()}>
                {saving ? t("saving") : t("save")}
            </Button>
        </Box>
    );
}
