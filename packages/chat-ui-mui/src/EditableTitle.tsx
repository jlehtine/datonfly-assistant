import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import SvgIcon from "@mui/material/SvgIcon";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";

/** Props for the {@link EditableTitle} component. */
export interface EditableTitleProps {
    /** Current title text. */
    title: string;
    /** Called when the user commits a new title. */
    onSave: (title: string) => void;
}

/**
 * Click-to-edit inline title. Displays the title as static text with a subtle
 * pencil icon on hover; clicking switches to an editable input field.
 *
 * - **Enter** or **blur** commits the change (if it differs from the original).
 * - **Escape** cancels and reverts to the original title.
 */
export function EditableTitle({ title, onSave }: EditableTitleProps): ReactElement {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(title);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync draft when the title prop changes externally (e.g. auto-generated title).
    useEffect(() => {
        if (!editing) {
            setDraft(title);
        }
    }, [title, editing]);

    const startEditing = useCallback(() => {
        setDraft(title);
        setEditing(true);
    }, [title]);

    const commit = useCallback(() => {
        setEditing(false);
        const trimmed = draft.trim();
        if (trimmed && trimmed !== title) {
            onSave(trimmed);
        }
    }, [draft, title, onSave]);

    const cancel = useCallback(() => {
        setEditing(false);
        setDraft(title);
    }, [title]);

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                commit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
            }
        },
        [commit, cancel],
    );

    // Auto-focus and select all when entering edit mode.
    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    if (editing) {
        return (
            <InputBase
                inputRef={inputRef}
                value={draft}
                onChange={(e) => {
                    setDraft(e.target.value);
                }}
                onBlur={commit}
                onKeyDown={handleKeyDown}
                inputProps={{ maxLength: 200 }}
                sx={{
                    flex: 1,
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    py: 0,
                    "& input": { py: 0 },
                }}
            />
        );
    }

    return (
        <Box
            onClick={startEditing}
            sx={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                cursor: "pointer",
                minWidth: 0,
                "&:hover .edit-icon": { opacity: 1 },
            }}
        >
            <Typography variant="subtitle2" noWrap sx={{ flex: 1 }}>
                {title}
            </Typography>
            <IconButton
                className="edit-icon"
                size="small"
                aria-label="Edit title"
                sx={{ opacity: 0, transition: "opacity 0.15s", p: 0.25 }}
                onClick={(e) => {
                    e.stopPropagation();
                    startEditing();
                }}
            >
                <SvgIcon sx={{ fontSize: 16 }}>
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 000-1.42l-2.34-2.34a1.003 1.003 0 00-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
                </SvgIcon>
            </IconButton>
        </Box>
    );
}
