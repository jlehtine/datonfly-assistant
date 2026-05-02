import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import SettingsIcon from "@mui/icons-material/Settings";
import UnarchiveIcon from "@mui/icons-material/Unarchive";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Select from "@mui/material/Select";
import { alpha } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import type { Thread, ThreadSearchResultWire } from "@datonfly-assistant/core";

import { ChatUserSettings } from "./ChatUserSettings.js";
import { formatTimestamp, type FormatTimestampLabels } from "./formatTimestamp.js";

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
    /** Current search query text. When non-empty, the panel enters search mode. */
    searchQuery?: string | undefined;
    /** Called when the user changes the search input. */
    onSearchQueryChange?: ((query: string) => void) | undefined;
    /** Search results to display when in search mode. */
    searchResults?: ThreadSearchResultWire[] | undefined;
    /** `true` while a search request is in-flight. */
    isSearching?: boolean | undefined;
    /** Called to clear the search and return to the thread list. */
    onClearSearch?: (() => void) | undefined;
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
    searchQuery = "",
    onSearchQueryChange,
    searchResults,
    isSearching = false,
    onClearSearch,
}: ThreadListPanelProps): ReactElement {
    const { t, i18n } = useTranslation();
    const [filter, setFilter] = useState<ThreadFilter>("active");
    const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const inSearchMode = searchOpen || searchQuery.length > 0;

    const handleSelectSearchResult = useCallback(
        (threadId: string) => {
            setSearchOpen(false);
            onSelectThread(threadId);
        },
        [onSelectThread],
    );

    const handleOpenSearch = useCallback(() => {
        setSearchOpen(true);
        // Focus after render
        setTimeout(() => searchInputRef.current?.focus(), 0);
    }, []);

    const handleCloseSearch = useCallback(() => {
        setSearchOpen(false);
        onClearSearch?.();
    }, [onClearSearch]);

    const handleSearchKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Escape") {
                handleCloseSearch();
            }
        },
        [handleCloseSearch],
    );

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
            <Box sx={{ px: 1.5, pt: 1.5, pb: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    {onNewThread && (
                        <Tooltip title={t("newConversation")}>
                            <IconButton
                                size="small"
                                onClick={onNewThread}
                                aria-label={t("newConversation")}
                                className="datonfly-new-conversation-button"
                            >
                                <AddIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                    {!inSearchMode && (
                        <Select
                            value={filter}
                            onChange={(e) => {
                                setFilter(e.target.value as ThreadFilter);
                            }}
                            size="small"
                            variant="outlined"
                            sx={{ flex: 1, fontSize: "0.8125rem" }}
                            className="datonfly-thread-filter-select"
                        >
                            <MenuItem
                                value="active"
                                className="datonfly-thread-filter-option"
                                data-thread-filter="active"
                            >
                                {t("active")}
                            </MenuItem>
                            <MenuItem
                                value="archived"
                                className="datonfly-thread-filter-option"
                                data-thread-filter="archived"
                            >
                                {t("archived")}
                            </MenuItem>
                        </Select>
                    )}
                    {inSearchMode && <Box sx={{ flex: 1 }} />}
                    {onSearchQueryChange && (
                        <Tooltip title={t("searchThreads")}>
                            <IconButton
                                size="small"
                                onClick={inSearchMode ? handleCloseSearch : handleOpenSearch}
                                aria-label={t("searchThreads")}
                                color={inSearchMode ? "primary" : "default"}
                            >
                                {inSearchMode ? <ClearIcon fontSize="small" /> : <SearchIcon fontSize="small" />}
                            </IconButton>
                        </Tooltip>
                    )}
                    <Tooltip title={t("settings")}>
                        <IconButton
                            size="small"
                            onClick={(e) => {
                                setSettingsAnchor(e.currentTarget);
                            }}
                            aria-label={t("settings")}
                            className="datonfly-thread-settings-button"
                        >
                            <SettingsIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Popover
                        open={Boolean(settingsAnchor)}
                        anchorEl={settingsAnchor}
                        onClose={() => {
                            setSettingsAnchor(null);
                        }}
                        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                    >
                        <ChatUserSettings
                            onSaved={() => {
                                setSettingsAnchor(null);
                            }}
                        />
                    </Popover>
                </Box>
                {inSearchMode && (
                    <TextField
                        inputRef={searchInputRef}
                        value={searchQuery}
                        onChange={(e) => onSearchQueryChange?.(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder={t("searchThreads")}
                        size="small"
                        fullWidth
                        autoFocus
                        slotProps={{
                            input: {
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" color="action" />
                                    </InputAdornment>
                                ),
                                endAdornment: searchQuery ? (
                                    <InputAdornment position="end">
                                        <IconButton
                                            size="small"
                                            onClick={handleCloseSearch}
                                            aria-label={t("clearSearch")}
                                            edge="end"
                                        >
                                            <ClearIcon fontSize="small" />
                                        </IconButton>
                                    </InputAdornment>
                                ) : undefined,
                            },
                        }}
                    />
                )}
            </Box>
            <Divider />
            <Box ref={scrollRef} sx={{ flex: 1, overflow: "auto" }}>
                {inSearchMode ? (
                    <>
                        {isSearching && <LinearProgress />}
                        {!isSearching && searchQuery.length >= 2 && searchResults?.length === 0 && (
                            <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                                {t("noSearchResults")}
                            </Typography>
                        )}
                        {searchResults && searchResults.length > 0 && (
                            <List dense disablePadding>
                                {searchResults.map((result) => (
                                    <SearchResultItem
                                        key={result.threadId}
                                        result={result}
                                        onSelect={handleSelectSearchResult}
                                        locale={i18n.language}
                                        tsLabels={{ justNow: t("justNow"), yesterday: t("yesterday") }}
                                    />
                                ))}
                            </List>
                        )}
                    </>
                ) : loading && threads.length === 0 ? (
                    <Box sx={{ display: "flex", justifyContent: "center", pt: 3 }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : filtered.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: "center" }}>
                        {filter === "archived" ? t("noArchivedConversations") : t("noConversationsYet")}
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
                                locale={i18n.language}
                                tsLabels={{ justNow: t("justNow"), yesterday: t("yesterday") }}
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
    locale: string | undefined;
    tsLabels: FormatTimestampLabels;
}

function ThreadListItem({
    thread,
    selected,
    onSelect,
    onArchiveToggle,
    locale,
    tsLabels,
}: ThreadListItemProps): ReactElement {
    const { t } = useTranslation();
    const isArchived = !!thread.archivedAt;
    const relativeTime = formatTimestamp(thread.updatedAt, undefined, locale, tsLabels);
    const unread = thread.unreadCount ?? 0;

    return (
        <ListItemButton
            className="datonfly-thread-item"
            data-thread-id={thread.id}
            data-thread-title={thread.title}
            data-thread-archived={String(isArchived)}
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
                        fontWeight: unread > 0 ? 600 : undefined,
                    },
                    secondary: {
                        variant: "caption",
                    },
                }}
            />
            {unread > 0 && (
                <Badge
                    className="datonfly-unread-badge"
                    badgeContent={unread > 99 ? "99+" : unread}
                    color="primary"
                    sx={{ mx: 1, flexShrink: 0 }}
                />
            )}
            <Tooltip title={isArchived ? t("unarchive") : t("archive")}>
                <IconButton
                    className="datonfly-thread-archive-toggle"
                    data-thread-id={thread.id}
                    data-thread-action={isArchived ? "unarchive" : "archive"}
                    size="small"
                    onClick={(e) => {
                        e.stopPropagation();
                        onArchiveToggle(thread.id, !isArchived);
                    }}
                    aria-label={isArchived ? t("unarchive") : t("archive")}
                    sx={{ ml: 0.5, flexShrink: 0 }}
                >
                    {isArchived ? <UnarchiveIcon fontSize="small" /> : <ArchiveIcon fontSize="small" />}
                </IconButton>
            </Tooltip>
        </ListItemButton>
    );
}

interface SearchResultItemProps {
    result: ThreadSearchResultWire;
    onSelect: (threadId: string) => void;
    locale: string | undefined;
    tsLabels: FormatTimestampLabels;
}

function SearchResultItem({ result, onSelect, locale, tsLabels }: SearchResultItemProps): ReactElement {
    const relativeTime = formatTimestamp(result.updatedAt, undefined, locale, tsLabels);
    const snippet = result.snippet.length > 80 ? `${result.snippet.slice(0, 80)}…` : result.snippet;
    const scorePercent = Math.max(0, Math.min(100, result.score * 100));

    return (
        <ListItemButton
            onClick={() => {
                onSelect(result.threadId);
            }}
            sx={{ pr: 1, pt: 1.5, pb: 0, flexDirection: "column", alignItems: "stretch" }}
        >
            <ListItemText
                primary={result.title}
                secondary={
                    <>
                        {snippet && (
                            <Typography
                                component="span"
                                variant="caption"
                                color="text.secondary"
                                sx={{
                                    display: "block",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                }}
                            >
                                {snippet}
                            </Typography>
                        )}
                        <Typography component="span" variant="caption" color="text.disabled">
                            {relativeTime}
                        </Typography>
                    </>
                }
                slotProps={{
                    primary: {
                        noWrap: true,
                        variant: "body2",
                    },
                }}
            />
            <LinearProgress
                variant="determinate"
                value={scorePercent}
                sx={{
                    height: 2,
                    borderRadius: 0,
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.15),
                    "& .MuiLinearProgress-bar": {
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.55),
                    },
                }}
            />
        </ListItemButton>
    );
}
