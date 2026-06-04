import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import type { ReactElement } from "react";

import type { InputTool } from "./InputTool.js";

/**
 * Renders the host-managed icon button for an {@link InputTool} placed in the
 * plain text field's end adornment. When the tool defines a `tooltip`, the
 * button is wrapped in a {@link Tooltip} (with a `span` so the tooltip still
 * shows while the button is disabled).
 */
export function AdornmentToolButton({
    tool,
    disabled,
    onActivate,
}: {
    tool: InputTool;
    disabled: boolean;
    onActivate: (anchor: HTMLElement) => void;
}): ReactElement {
    const button = (
        <IconButton
            size="small"
            edge="end"
            aria-label={tool.name}
            disabled={disabled}
            onClick={(e) => {
                onActivate(e.currentTarget);
            }}
        >
            {tool.icon}
        </IconButton>
    );

    if (tool.tooltip === undefined) return button;

    return (
        <Tooltip title={tool.tooltip}>
            <span style={{ display: "inline-flex" }}>{button}</span>
        </Tooltip>
    );
}
