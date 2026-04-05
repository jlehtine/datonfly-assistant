import { useTheme } from "@mui/material/styles";
import MDEditor, { commands } from "@uiw/react-md-editor";
import type { ReactElement, KeyboardEvent as ReactKeyboardEvent } from "react";

import type { ComposerInputProps } from "./Composer.js";

const editorCommands = [
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

export function RichInput({
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled,
    autoFocus,
}: ComposerInputProps): ReactElement {
    const theme = useTheme();
    const colorMode = theme.palette.mode === "dark" ? "dark" : "light";

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        if (e.key === "Enter" && !e.shiftKey) {
            onKeyDown(e as unknown as ReactKeyboardEvent);
        }
    };

    return (
        <div data-color-mode={colorMode}>
            <MDEditor
                value={value}
                onChange={(val) => {
                    onChange(val ?? "");
                }}
                preview="edit"
                commands={editorCommands}
                extraCommands={[]}
                visibleDragbar={false}
                hideToolbar={false}
                height={120}
                textareaProps={{
                    placeholder,
                    disabled,
                    autoFocus,
                    onKeyDown: handleKeyDown as unknown as React.KeyboardEventHandler<HTMLTextAreaElement>,
                }}
            />
        </div>
    );
}
