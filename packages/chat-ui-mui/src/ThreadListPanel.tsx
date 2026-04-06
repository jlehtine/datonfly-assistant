import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import SvgIcon from "@mui/material/SvgIcon";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { formatDistanceToNow } from "date-fns";
import { useState, type ReactElement } from "react";

import type { Thread } from "@datonfly-assistant/core";

/** Archive inbox icon (Material Design path). */
function ArchiveIcon(): ReactElement {
    return (
        <SvgIcon fontSize="small">
            <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.93 1H5.12z" />
        </SvgIcon>
    );
}

/** Unarchive icon (Material Design path). */
function UnarchiveIcon(): ReactElement {
    return (
        <SvgIcon fontSize="small">
            <path d="M20.55 5.22l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.22C3.17 5.57 3 6.01 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.49-.17-.93-.45-1.28zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.82-1h12l.93 1H5.12z" />
        </SvgIcon>
    );
}

/** New-conversation icon (Material Design "edit square" / create). */
function NewConversationIcon(): ReactElement {
    return (
        <SvgIcon fontSize="small">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z" />
        </SvgIcon>
    );
}

export interface ThreadListPanelProps {
    /** The list of threads to display. */
    threads: Thread[];
    /** ID of the currently selected thread, or `null`. */
    selectedThreadId: string | null;
    /** Called when the user clicks on a thread to switch to it. */
    onSelectThread: (threadId: string) => void;
    /** Called when the user toggles the archived state of a thread. */
    onArchiveToggle: (threadId: string, archived: boolean) => void;
    /** Called when the user clicks the new-conversation button. */
    onNewThread?: (() => void) | undefined;
    /** `true` while threads are being loaded. */
    loading?: boolean | undefined;
}

type ThreadFilter = "active" | "archived";

/**
 * Scrollable panel listing threads with an active/archived filter toggle.
 *
 * Each item shows the thread title, a relative timestamp, and an icon button
 * to archive or unarchive the thread.
 */
export function ThreadListPanel({
    threads,
    selectedThreadId,
    onSelectThread,
    onArchiveToggle,
    onNewThread,
    loading = false,
}: ThreadListPanelProps): ReactElement {
    const [filter, setFilter] = useState<ThreadFilter>("active");

    const filtered = threads.filter((t) => (filter === "archived" ? !!t.archivedAt : !t.archivedAt));

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                borderRight: 1,
                borderColor: "divider",
                width: 260,
                minWidth: 220,
                maxWidth: 320,
                bgcolor: "background.default",
            }}
        >
            <Box sx={{ px: 1.5, pt: 1.5, pb: 1, display: "flex", alignItems: "center", gap: 1 }}>
                {onNewThread && (
                    <Tooltip title="New conversation">
                        <IconButton size="small" onClick={onNewThread} aria-label="New conversation">
                            <NewConversationIcon />
                        </IconButton>
                    </Tooltip>
                )}
                <Select
                    value={filter}
                    onChange={(e) => {
                        setFilter(e.target.value as ThreadFilter);
                    }}
                    size="small"
                    variant="outlined"
                    sx={{ flex: 1, fontSize: "0.8125rem" }}
                >
                    <MenuItem value="active">Active</MenuItem>
                    <MenuItem value="archived">Archived</MenuItem>
                </Select>
            </Box>
            <Divider />
            <Box sx={{ flex: 1, overflow: "auto" }}>
                {loading ? (
                    <Box sx={{ display: "flex", justifyContent: "center", pt: 3 }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : filtered.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                        {filter === "archived" ? "No archived conversations." : "No conversations yet."}
                    </Typography>
                ) : (
                    <List dense disablePadding>
                        {filtered.map((thread) => (
                            <ThreadListItem
                                key={thread.id}
                                thread={thread}
                                selected={thread.id === selectedThreadId}
                                onSelect={onSelectThread}
                                onArchiveToggle={onArchiveToggle}
                            />
                        ))}
                    </List>
                )}
            </Box>
        </Box>
    );
}

interface ThreadListItemProps {
    thread: Thread;
    selected: boolean;
    onSelect: (threadId: string) => void;
    onArchiveToggle: (threadId: string, archived: boolean) => void;
}

function ThreadListItem({ thread, selected, onSelect, onArchiveToggle }: ThreadListItemProps): ReactElement {
    const isArchived = !!thread.archivedAt;
    const relativeTime = formatDistanceToNow(thread.updatedAt, { addSuffix: true });

    return (
        <ListItemButton
            selected={selected}
            onClick={() => {
                onSelect(thread.id);
            }}
            sx={{ pr: 1 }}
        >
            <ListItemText
                primary={thread.title}
                secondary={relativeTime}
                slotProps={{
                    primary: {
                        noWrap: true,
                        variant: "body2",
                    },
                    secondary: {
                        variant: "caption",
                    },
                }}
            />
            <Tooltip title={isArchived ? "Unarchive" : "Archive"}>
                <IconButton
                    size="small"
                    onClick={(e) => {
                        e.stopPropagation();
                        onArchiveToggle(thread.id, !isArchived);
                    }}
                    aria-label={isArchived ? "Unarchive conversation" : "Archive conversation"}
                    sx={{ ml: 0.5, flexShrink: 0 }}
                >
                    {isArchived ? <UnarchiveIcon /> : <ArchiveIcon />}
                </IconButton>
            </Tooltip>
        </ListItemButton>
    );
}
