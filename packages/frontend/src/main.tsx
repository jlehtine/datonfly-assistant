import CssBaseline from "@mui/material/CssBaseline";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { StrictMode, useMemo, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
// Initialize i18next before rendering.
import "./i18n/instance.js";

function Root(): ReactElement {
    const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
    const theme = useMemo(() => createTheme({ palette: { mode: prefersDark ? "dark" : "light" } }), [prefersDark]);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <App />
        </ThemeProvider>
    );
}

const root = document.getElementById("root");
if (root) {
    createRoot(root).render(
        <StrictMode>
            <Root />
        </StrictMode>,
    );
}
