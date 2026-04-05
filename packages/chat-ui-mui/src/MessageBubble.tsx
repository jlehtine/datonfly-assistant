import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { ReactElement } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatMessage } from "@verbal-assistant/chat-hooks";

export interface MessageBubbleProps {
    message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps): ReactElement {
    const isUser = message.role === "user";

    return (
        <Box sx={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", mb: 1 }}>
            <Paper
                elevation={1}
                sx={{
                    px: 2,
                    py: 1,
                    maxWidth: "75%",
                    bgcolor: isUser ? "primary.main" : "action.hover",
                    color: isUser ? "primary.contrastText" : "text.primary",
                    borderRadius: 2,
                    "& p": { m: 0 },
                    "& pre": {
                        bgcolor: "grey.900",
                        color: "grey.100",
                        p: 1.5,
                        borderRadius: 1,
                        overflow: "auto",
                    },
                    "& code": {
                        fontSize: "0.875em",
                    },
                }}
            >
                {isUser ? (
                    <Typography variant="body1">{message.text}</Typography>
                ) : (
                    <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                )}
                {message.streaming && (
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                        ●
                    </Typography>
                )}
            </Paper>
        </Box>
    );
}
