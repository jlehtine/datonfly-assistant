import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

export interface LoginPageProps {
    onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps): ReactElement {
    const { t } = useTranslation();
    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 3,
            }}
        >
            <Typography variant="h4">{t("appTitle")}</Typography>
            <Typography variant="body1" color="text.secondary">
                {t("signInToContinue")}
            </Typography>
            <Button variant="contained" size="large" onClick={onLogin}>
                {t("signIn")}
            </Button>
        </Box>
    );
}
