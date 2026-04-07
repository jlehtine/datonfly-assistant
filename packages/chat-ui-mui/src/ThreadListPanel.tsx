import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import type { Thread } from "@datonfly-assistant/core";

import { formatTimestamp } from "./formatTimestamp.js";

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
    /** Whether more threads can be loaded. */
    hasMore?: boolean | undefined;
    /** Called when the user scrolls near the bottom of the list. */
    onLoadMore?: (() => void) | undefined;
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
    hasMore = false,
    onLoadMore,
}: ThreadListPanelProps): ReactElement {
    const [filter, setFilter] = useState<ThreadFilter>("active");
    const scrollRef = useRef<HTMLDivElement>(null);

    const filtered = threads.filter((t) => (filter === "archived" ? !!t.archivedAt : !t.archivedAt));

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el || !hasMore || !onLoadMore) return;
        // Trigger when scrolled within 100px of the bottom.
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
            onLoadMore();
        }
    }, [hasMore, onLoadMore]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", handleScroll);
        };
    }, [handleScroll]);

    // If the content doesn't fill the container (no scrollbar), keep loading.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !hasMore || !onLoadMore || loading) return;
        if (el.scrollHeight <= el.clientHeight) {
            onLoadMore();
        }
    }, [hasMore, onLoadMore, loading, filtered.length]);

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
                            <AddIcon fontSize="small" />
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
            <Box ref={scrollRef} sx={{ flex: 1, overflow: "auto" }}>
                {loading && threads.length === 0 ? (
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
                        {loading && (
                            <Box sx={{ display: "flex", justifyContent: "center", py: 1 }}>
                                <CircularProgress size={20} />
                            </Box>
                        )}
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
    const relativeTime = formatTimestamp(thread.updatedAt);

    return (
        <ListItemButton
            className="datonfly-thread-item"
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
                    {isArchived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                </IconButton>
            </Tooltip>
        </ListItemButton>
    );
}
