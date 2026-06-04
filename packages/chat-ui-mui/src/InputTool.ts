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
    /**
     * When `true`, the composer submits `text` immediately instead of writing it
     * to the input for further editing.
     */
    submit?: boolean | undefined;
}

/** Props passed to an {@link InputTool} that renders its own self-managed button. */
export interface InputToolButtonProps {
    /** Read the current composer state on demand (text and selection are live). */
    getContext: () => InputToolContext;
    /** Apply a result to the composer (updates text/selection, or submits when `submit` is set). */
    done: (result: InputToolResult | null) => void;
    /** Whether the composer is currently non-interactive (e.g. a message is sending). */
    disabled: boolean;
}

/** A pluggable toolbar action that can modify the composer text. */
export interface InputTool {
    /** Unique name used as a React key and accessible label. */
    name: string;
    /** Icon element rendered inside the toolbar button. */
    icon: ReactElement;
    /**
     * Optional tooltip text shown on hover for the host-rendered button. When
     * omitted, no tooltip is shown. Tools that render their own button via
     * {@link InputTool.renderButton} are responsible for their own tooltips.
     */
    tooltip?: string | undefined;
    /**
     * Where the tool button is rendered.
     *
     * - `"toolbar"` (default) — alongside the other formatting/tool buttons
     *   (only visible in the expanded Markdown editor).
     * - `"input-end"` — as an end adornment inside the plain (non-expanded) text
     *   field only (hidden when the editor is expanded).
     * - `"action"` — a non-formatting action available in every mode: shown in
     *   the input-end adornment while collapsed and in the formatting toolbar
     *   while expanded.
     */
    placement?: "toolbar" | "input-end" | "action" | undefined;
    /**
     * Called when the user activates the tool via the host-rendered button.
     *
     * Provide either `onActivate` (host renders a button that opens this panel in
     * a popover) or {@link InputTool.renderButton} (the tool renders its own
     * self-managed button), but not both.
     *
     * @param ctx - Current composer state.
     * @param done - Callback to call with the updated text and selection, or `null` to cancel.
     * @returns A React element (typically a popover panel) to render while the tool is active.
     */
    onActivate?: ((ctx: InputToolContext, done: (result: InputToolResult | null) => void) => ReactElement) | undefined;
    /**
     * Render a fully self-managed button for this tool. Use this when the tool
     * needs its own interactive/stateful control (e.g. a recording toggle) rather
     * than the default icon button that opens an {@link InputTool.onActivate} popover.
     */
    renderButton?: ((props: InputToolButtonProps) => ReactElement) | undefined;
}

/**
 * Order the tools rendered inside the plain text field's end adornment so that
 * `"action"` tools (e.g. attachment) precede `"input-end"` tools (e.g. audio
 * recording), grouping the persistent action buttons before mode-specific ones.
 */
export function orderAdornmentTools(tools: InputTool[]): InputTool[] {
    const rank = (tool: InputTool): number => (tool.placement === "action" ? 0 : 1);
    return [...tools].sort((a, b) => rank(a) - rank(b));
}
