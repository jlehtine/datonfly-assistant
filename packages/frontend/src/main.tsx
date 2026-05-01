import CssBaseline from "@mui/material/CssBaseline";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { StrictMode, useMemo, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
// Initialize i18next before rendering.
import "./i18n/instance.js";

// eslint-disable-next-line react-refresh/only-export-components -- entry point, not a module with exports
function Root(): ReactElement {
    const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
    const theme = useMemo(() => createTheme({ palette: { mode: prefersDark ? "dark" : "light" } }), [prefersDark]);

    return (
        <BrowserRouter>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <App />
            </ThemeProvider>
        </BrowserRouter>
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
