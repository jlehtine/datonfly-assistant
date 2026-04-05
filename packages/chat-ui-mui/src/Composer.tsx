import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactElement } from "react";

import { useComposer } from "@verbal-assistant/chat-hooks";

export interface ComposerInputProps {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (e: KeyboardEvent) => void;
    placeholder: string;
    disabled: boolean;
    autoFocus: boolean;
}

export interface ComposerProps {
    onSend: (text: string) => void;
    disabled?: boolean | undefined;
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
}

function DefaultInput({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    autoFocus,
}: ComposerInputProps): ReactElement {
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (autoFocus) {
            inputRef.current?.focus();
        }
    }, [autoFocus]);

    return (
        <TextField
            inputRef={inputRef}
            fullWidth
            multiline
            maxRows={4}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
                onChange(e.target.value);
            }}
            onKeyDown={onKeyDown}
            disabled={disabled}
            size="small"
        />
    );
}

export function Composer({ onSend, disabled, inputComponent: InputComponent }: ComposerProps): ReactElement {
    const { text, setText, submit } = useComposer(onSend);
    const [richMode, setRichMode] = useState(false);
    const isDisabled = disabled ?? false;

    const handleKeyDown = (e: KeyboardEvent): void => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    const inputProps: ComposerInputProps = {
        value: text,
        onChange: setText,
        onKeyDown: handleKeyDown,
        placeholder: "Type a message...",
        disabled: isDisabled,
        autoFocus: !isDisabled,
    };

    const ActiveInput = richMode && InputComponent ? InputComponent : DefaultInput;

    return (
        <Box sx={{ display: "flex", gap: 1, p: 2, borderTop: 1, borderColor: "divider", alignItems: "flex-end" }}>
            {InputComponent && (
                <IconButton
                    onClick={() => {
                        setRichMode((prev) => !prev);
                    }}
                    size="small"
                    color={richMode ? "primary" : "default"}
                    aria-label="Toggle formatting"
                    sx={{ mb: 0.5 }}
                >
                    <FormatIcon />
                </IconButton>
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <ActiveInput {...inputProps} />
            </Box>
            <IconButton
                onClick={submit}
                disabled={isDisabled || !text.trim()}
                color="primary"
                aria-label="Send"
                sx={{ mb: 0.5 }}
            >
                <SendIcon />
            </IconButton>
        </Box>
    );
}

function FormatIcon(): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M5 17v2h14v-2H5zm4.5-4.2h5l.9 2.2h2.1L12.75 4h-1.5L6.5 15h2.1l.9-2.2zM12 5.98L13.87 11h-3.74L12 5.98z" />
        </svg>
    );
}

function SendIcon(): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
    );
}
