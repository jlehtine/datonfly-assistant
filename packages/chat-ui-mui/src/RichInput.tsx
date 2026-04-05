import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import { useTheme } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import MDEditor, { commands, type ICommand, type TextAreaTextApi } from "@uiw/react-md-editor";
import { useEffect, useRef, useState, type ReactElement, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { ComposerInputProps } from "./Composer.js";
import type { InputTool, InputToolContext, InputToolResult } from "./InputTool.js";

const LINE_HEIGHT = 21;
const TOOLBAR_HEIGHT = 37;

const editorCommands: ICommand[] = [
    commands.bold,
    commands.italic,
    commands.strikethrough,
    commands.divider,
    commands.code,
    commands.codeBlock,
    commands.divider,
    commands.unorderedListCommand,
    commands.orderedListCommand,
    commands.divider,
    commands.link,
];

function ExpandToolbarIcon(): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
        </svg>
    );
}

function CollapseToolbarIcon(): ReactElement {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
        </svg>
    );
}

/**
 * Rich-text composer input backed by `@uiw/react-md-editor`.
 *
 * Implements the {@link ComposerInputProps} contract so it can be passed
 * directly as the `inputComponent` prop of {@link Composer} or {@link ChatEmbed}.
 * Includes a toggle button to switch between a plain textarea and a full
 * Markdown editor with a formatting toolbar.
 */
export function RichInput({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    autoFocus: _autoFocus,
    inputTools,
    maxRows,
}: ComposerInputProps): ReactElement {
    const theme = useTheme();
    const colorMode = theme.palette.mode === "dark" ? "dark" : "light";
    const resolvedMaxRows = maxRows ?? 6;
    const [expanded, setExpanded] = useState(false);
    const [activeTool, setActiveTool] = useState<InputTool | null>(null);
    const anchorElRef = useRef<HTMLElement | null>(null);
    const textApiRef = useRef<TextAreaTextApi | null>(null);
    const textFieldRef = useRef<HTMLInputElement>(null);
    const editorWrapRef = useRef<HTMLDivElement>(null);
    const selectionRef = useRef({ start: 0, end: 0 });

    useEffect(() => {
        const sel = selectionRef.current;
        if (expanded) {
            const textarea = editorWrapRef.current?.querySelector<HTMLTextAreaElement>("textarea");
            if (textarea) {
                textarea.focus();
                textarea.setSelectionRange(sel.start, sel.end);
            }
        } else {
            const input = textFieldRef.current;
            if (input) {
                input.focus();
                input.setSelectionRange(sel.start, sel.end);
            }
        }
    }, [expanded]);

    const handleKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === "Enter" && !e.shiftKey) {
            onKeyDown(e as unknown as ReactKeyboardEvent);
        }
    };

    const handleDone = (result: InputToolResult | null): void => {
        if (result) {
            onChange(result.text);
            selectionRef.current = { start: result.selectionStart, end: result.selectionEnd };
            if (expanded && textApiRef.current) {
                const api = textApiRef.current;
                setTimeout(() => {
                    api.setSelectionRange({ start: result.selectionStart, end: result.selectionEnd });
                }, 0);
            } else {
                setTimeout(() => {
                    const input = textFieldRef.current;
                    if (input) {
                        input.setSelectionRange(result.selectionStart, result.selectionEnd);
                        input.focus();
                    }
                }, 0);
            }
        }
        setActiveTool(null);
    };

    const ctx: InputToolContext = {
        text: value,
        selectionStart: selectionRef.current.start,
        selectionEnd: selectionRef.current.end,
    };

    const toolCommands: ICommand[] = (inputTools ?? []).map(
        (tool): ICommand => ({
            name: tool.name,
            keyCommand: tool.name,
            icon: tool.icon,
            execute: (_state, api) => {
                textApiRef.current = api;
                anchorElRef.current = document.querySelector<HTMLElement>(`[data-name="${tool.name}"]`);
                setActiveTool(tool);
            },
            buttonProps: { "data-name": tool.name } as React.ButtonHTMLAttributes<HTMLButtonElement>,
        }),
    );

    const mainCommands = [...editorCommands, ...(toolCommands.length > 0 ? [commands.divider, ...toolCommands] : [])];
    const editorHeight = TOOLBAR_HEIGHT + resolvedMaxRows * LINE_HEIGHT;

    return (
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5 }}>
            <IconButton
                size="small"
                onClick={() => {
                    if (!expanded && textFieldRef.current) {
                        selectionRef.current = {
                            start: textFieldRef.current.selectionStart ?? 0,
                            end: textFieldRef.current.selectionEnd ?? 0,
                        };
                    } else if (expanded) {
                        const textarea = editorWrapRef.current?.querySelector<HTMLTextAreaElement>("textarea");
                        if (textarea) {
                            selectionRef.current = {
                                start: textarea.selectionStart,
                                end: textarea.selectionEnd,
                            };
                        }
                    }
                    setExpanded((prev) => !prev);
                }}
                color="default"
                aria-label="Toggle formatting"
                sx={{ mb: 0.5 }}
            >
                {expanded ? <CollapseToolbarIcon /> : <ExpandToolbarIcon />}
            </IconButton>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                {expanded ? (
                    <Box ref={editorWrapRef} data-color-mode={colorMode}>
                        <MDEditor
                            value={value}
                            onChange={(val) => {
                                onChange(val ?? "");
                            }}
                            preview="edit"
                            commands={mainCommands}
                            extraCommands={[]}
                            visibleDragbar={false}
                            height={editorHeight}
                            textareaProps={{
                                placeholder,
                                disabled,
                                autoFocus: true,
                                onKeyDown: handleKeyDown as unknown as React.KeyboardEventHandler<HTMLTextAreaElement>,
                                onSelect: ((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
                                    const target = e.target as HTMLTextAreaElement;
                                    selectionRef.current = { start: target.selectionStart, end: target.selectionEnd };
                                }) as unknown as React.ReactEventHandler<HTMLTextAreaElement>,
                            }}
                        />
                    </Box>
                ) : (
                    <TextField
                        inputRef={textFieldRef}
                        fullWidth
                        multiline
                        maxRows={resolvedMaxRows}
                        placeholder={placeholder}
                        value={value}
                        onChange={(e) => {
                            onChange(e.target.value);
                        }}
                        onKeyDown={handleKeyDown}
                        onSelect={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            selectionRef.current = { start: target.selectionStart, end: target.selectionEnd };
                        }}
                        disabled={disabled}
                        size="small"
                    />
                )}
                {activeTool && anchorElRef.current && (
                    <Popover
                        open
                        anchorEl={anchorElRef.current}
                        onClose={() => {
                            setActiveTool(null);
                        }}
                        anchorOrigin={{ vertical: "top", horizontal: "left" }}
                        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
                    >
                        {activeTool.onActivate(ctx, handleDone)}
                    </Popover>
                )}
            </Box>
        </Box>
    );
}
