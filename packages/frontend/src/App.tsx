import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";

import { ChatEmbed } from "@verbal-assistant/chat-ui-mui";

const BACKEND_URL = window.location.origin;

export function App(): ReactElement {
    return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
            <AppBar position="static" elevation={0}>
                <Toolbar>
                    <Typography variant="h6">Verbal Assistant</Typography>
                </Toolbar>
            </AppBar>
            <Box sx={{ flex: 1, overflow: "hidden" }}>
                <ChatEmbed config={{ url: BACKEND_URL }} />
            </Box>
        </Box>
    );
}
