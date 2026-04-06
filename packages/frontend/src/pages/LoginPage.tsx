import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";

export interface LoginPageProps {
    onLogin: () => void;
}

export function LoginPage({ onLogin }: LoginPageProps): ReactElement {
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
            <Typography variant="h4">Datonfly Assistant</Typography>
            <Typography variant="body1" color="text.secondary">
                Sign in to continue
            </Typography>
            <Button variant="contained" size="large" onClick={onLogin}>
                Sign in
            </Button>
        </Box>
    );
}
