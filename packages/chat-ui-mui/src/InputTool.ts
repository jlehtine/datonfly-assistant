import type { ReactElement } from "react";

/** Snapshot of the composer input state passed to an {@link InputTool} when it activates. */
export interface InputToolContext {
    /** Full current text of the composer input. */
    text: string;
    /** Start of the current text selection (caret position when nothing is selected). */
    selectionStart: number;
    /** End of the current text selection (same as `selectionStart` when nothing is selected). */
    selectionEnd: number;
}

/** Updated text and selection returned by an {@link InputTool} after the user makes a choice. */
export interface InputToolResult {
    /** New full text to write back to the composer input. */
    text: string;
    /** Caret start position to restore after the text is updated. */
    selectionStart: number;
    /** Caret end position to restore after the text is updated. */
    selectionEnd: number;
}

/** A pluggable toolbar action that can modify the composer text. */
export interface InputTool {
    /** Unique name used as a React key and accessible label. */
    name: string;
    /** Icon element rendered inside the toolbar button. */
    icon: ReactElement;
    /**
     * Called when the user activates the tool.
     *
     * @param ctx - Current composer state.
     * @param done - Callback to call with the updated text and selection, or `null` to cancel.
     * @returns A React element (typically a popover panel) to render while the tool is active.
     */
    onActivate: (ctx: InputToolContext, done: (result: InputToolResult | null) => void) => ReactElement;
}
