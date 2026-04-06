import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactElement } from "react";

import { useComposer } from "@datonfly-assistant/chat-client/react";

import type { InputTool, InputToolContext, InputToolResult } from "./InputTool.js";

function ToolPopoverContent({
    tool,
    ctx,
    onDone,
}: {
    tool: InputTool;
    ctx: InputToolContext;
    onDone: (result: InputToolResult | null) => void;
}): ReactElement {
    return <>{tool.onActivate(ctx, onDone)}</>;
}

/** Props passed to a custom composer input component. */
export interface ComposerInputProps {
    /** Current text value. */
    value: string;
    /** Callback to update the text value. */
    onChange: (value: string) => void;
    /** Keyboard event handler (used to detect Enter-to-send). */
    onKeyDown: (e: KeyboardEvent) => void;
    /** Placeholder text shown when the input is empty. */
    placeholder: string;
    /** Whether the input should be non-interactive. */
    disabled: boolean;
    /** Whether the input should receive focus on mount. */
    autoFocus: boolean;
    /** Optional input tools (e.g. emoji picker) to render alongside the input. */
    inputTools?: InputTool[] | undefined;
    /** Maximum number of visible rows before the textarea scrolls. */
    maxRows?: number | undefined;
}

/** Props for the {@link Composer} component. */
export interface ComposerProps {
    /** Callback invoked with the trimmed message text when the user submits. */
    onSend: (text: string) => void;
    /** When `true`, the send button and input are disabled. */
    disabled?: boolean | undefined;
    /** Override the built-in plain-text input with a custom component. */
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
    /** Optional input tools (e.g. emoji picker) to attach to the default input. */
    inputTools?: InputTool[] | undefined;
    /** Maximum number of visible rows in the textarea before it scrolls. */
    maxRows?: number | undefined;
}

function DefaultInput({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    autoFocus,
    inputTools,
    maxRows,
}: ComposerInputProps): ReactElement {
    const inputRef = useRef<HTMLInputElement>(null);
    const selectionRef = useRef({ start: 0, end: 0 });
    const [activeTool, setActiveTool] = useState<InputTool | null>(null);
    const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const [toolCtx, setToolCtx] = useState({ text: "", selectionStart: 0, selectionEnd: 0 });

    useEffect(() => {
        if (autoFocus) {
            inputRef.current?.focus();
        }
    }, [autoFocus]);

    const handleDone = (result: InputToolResult | null): void => {
        if (result) {
            onChange(result.text);
            setTimeout(() => {
                const input = inputRef.current;
                if (input) {
                    input.setSelectionRange(result.selectionStart, result.selectionEnd);
                    input.focus();
                }
            }, 0);
        }
        setActiveTool(null);
    };

    const snapshotToolCtx = (): void => {
        setToolCtx({
            text: value,
            selectionStart: selectionRef.current.start,
            selectionEnd: selectionRef.current.end,
        });
    };

    const hasMultipleTools = (inputTools?.length ?? 0) > 1;

    return (
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5 }}>
            {hasMultipleTools ? (
                <IconButton
                    size="small"
                    aria-label="Tools"
                    onClick={(e) => {
                        setMenuAnchor(e.currentTarget);
                        setToolsMenuOpen(true);
                    }}
                    sx={{ mb: 0.5 }}
                >
                    <ToolsMenuIcon />
                </IconButton>
            ) : (
                inputTools?.map((tool) => (
                    <IconButton
                        key={tool.name}
                        size="small"
                        aria-label={tool.name}
                        onClick={(e) => {
                            setAnchorEl(e.currentTarget);
                            snapshotToolCtx();
                            setActiveTool(tool);
                        }}
                        sx={{ mb: 0.5 }}
                    >
                        {tool.icon}
                    </IconButton>
                ))
            )}
            <TextField
                inputRef={inputRef}
                multiline
                maxRows={maxRows ?? 4}
                placeholder={placeholder}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                }}
                onKeyDown={onKeyDown}
                onSelect={(e) => {
                    const target = e.target as HTMLTextAreaElement;
                    selectionRef.current = { start: target.selectionStart, end: target.selectionEnd };
                }}
                disabled={disabled}
                size="small"
                className="datonfly-composer-input"
                sx={{ flex: 1 }}
            />
            {hasMultipleTools && menuAnchor && (
                <Popover
                    open={toolsMenuOpen}
                    anchorEl={menuAnchor}
                    onClose={() => {
                        setToolsMenuOpen(false);
                    }}
                    anchorOrigin={{ vertical: "top", horizontal: "left" }}
                    transformOrigin={{ vertical: "bottom", horizontal: "left" }}
                >
                    <Box sx={{ display: "flex", gap: 0.5, p: 0.5 }}>
                        {inputTools?.map((tool) => (
                            <IconButton
                                key={tool.name}
                                size="small"
                                aria-label={tool.name}
                                onClick={(e) => {
                                    setToolsMenuOpen(false);
                                    setAnchorEl(e.currentTarget);
                                    snapshotToolCtx();
                                    setActiveTool(tool);
                                }}
                            >
                                {tool.icon}
                            </IconButton>
                        ))}
                    </Box>
                </Popover>
            )}
            {activeTool && anchorEl && (
                <Popover
                    open
                    anchorEl={anchorEl}
                    onClose={() => {
                        setActiveTool(null);
                    }}
                    anchorOrigin={{ vertical: "top", horizontal: "left" }}
                    transformOrigin={{ vertical: "bottom", horizontal: "left" }}
                >
                    <ToolPopoverContent tool={activeTool} ctx={toolCtx} onDone={handleDone} />
                </Popover>
            )}
        </Box>
    );
}

function ToolsMenuIcon(): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
        </svg>
    );
}

/**
 * Message input bar with a send button.
 *
 * Delegates text state management to {@link useComposer} and supports an
 * optional custom input component for rich-text editing.
 */
export function Composer({
    onSend,
    disabled,
    inputComponent: InputComponent,
    inputTools,
    maxRows,
}: ComposerProps): ReactElement {
    const { text, setText, submit } = useComposer(onSend);
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
        inputTools,
        maxRows,
    };

    const ActiveInput = InputComponent ?? DefaultInput;

    return (
        <Box sx={{ display: "flex", gap: 1, p: 2, borderTop: 1, borderColor: "divider", alignItems: "flex-end" }}>
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

function SendIcon(): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
    );
}
