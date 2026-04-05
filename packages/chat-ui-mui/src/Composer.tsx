import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import { useEffect, useRef, type KeyboardEvent, type ReactElement } from "react";

import { useComposer } from "@verbal-assistant/chat-hooks";

export interface ComposerProps {
    onSend: (text: string) => void;
    disabled?: boolean | undefined;
}

export function Composer({ onSend, disabled }: ComposerProps): ReactElement {
    const { text, setText, submit } = useComposer(onSend);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!disabled) {
            inputRef.current?.focus();
        }
    }, [disabled]);

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    return (
        <Box sx={{ display: "flex", gap: 1, p: 2, borderTop: 1, borderColor: "divider" }}>
            <TextField
                inputRef={inputRef}
                fullWidth
                multiline
                maxRows={4}
                placeholder="Type a message..."
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                }}
                onKeyDown={handleKeyDown}
                disabled={disabled ?? false}
                size="small"
            />
            <IconButton onClick={submit} disabled={disabled === true || !text.trim()} color="primary" aria-label="Send">
                <SendIcon />
            </IconButton>
        </Box>
    );
}

function SendIcon(): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
    );
}
