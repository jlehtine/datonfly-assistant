import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useCallback, useRef, useState, type ComponentType, type ReactElement } from "react";
import type { Components } from "react-markdown";

import { useThreadList } from "@verbal-assistant/chat-hooks";
import type { Thread, ThreadUpdatedEvent } from "@verbal-assistant/core";

import { ChatEmbed } from "./ChatEmbed.js";
import type { ComposerInputProps } from "./Composer.js";
import type { InputTool } from "./InputTool.js";
import { ThreadListPanel } from "./ThreadListPanel.js";

/** Configuration options for {@link ChatHistoryEmbed}. */
export interface ChatHistoryEmbedConfig {
    /** WebSocket and REST server base URL. */
    url: string;
    /** Optional callback that returns a JWT for authentication, or `null` to connect anonymously. */
    getToken?: (() => string | null) | undefined;
    /** Override the default plain-text input with a custom component. */
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
    /** Optional input tools (e.g. emoji picker) to attach to the composer. */
    inputTools?: InputTool[] | undefined;
    /** Maximum number of visible rows in the composer textarea before it scrolls. */
    maxRows?: number | undefined;
    /**
     * Optional custom element renderers for message markdown.
     * Pass `highlightComponents` from `@verbal-assistant/chat-ui-mui/highlight`
     * to enable syntax highlighting for code blocks in completed messages.
     */
    messageComponents?: Components | undefined;
    /**
     * Optional async callback invoked before the very first message send when no thread
     * is selected yet; must resolve to the thread ID to use.
     * If omitted, a new thread is created automatically via `POST /threads`.
     */
    onBeforeSend?: (() => Promise<string>) | undefined;
}

/** Props for the {@link ChatHistoryEmbed} component. */
export interface ChatHistoryEmbedProps {
    /** Chat history configuration object. */
    config: ChatHistoryEmbedConfig;
}

/**
 * Composite chat widget that combines a {@link ThreadListPanel} sidebar with a
 * {@link ChatEmbed} area.
 *
 * Manages the selected thread, archive/unarchive operations, and automatic
 * thread creation on first send. On narrow viewports the sidebar is hidden.
 */
export function ChatHistoryEmbed({ config }: ChatHistoryEmbedProps): ReactElement {
    const { url, getToken, inputComponent, inputTools, maxRows, messageComponents, onBeforeSend } = config;

    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const pendingCreateRef = useRef<Promise<string> | null>(null);

    // Always load all threads (active + archived); ThreadListPanel handles client-side filtering.
    const { threads, loading, setArchived, renameThread, updateThreadTitle, refresh } = useThreadList({
        url,
        getToken,
        includeArchived: true,
    });

    // Find the full Thread object for the currently selected thread.
    const selectedThread = threads.find((t) => t.id === selectedThreadId);

    // Create a new thread via the REST API if none is selected yet.
    const ensureThread = useCallback(async (): Promise<string> => {
        if (selectedThreadId) return selectedThreadId;
        if (pendingCreateRef.current) return pendingCreateRef.current;

        const promise = (async () => {
            const token = getToken?.();
            const res = await fetch(`${url}/threads`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            });
            if (!res.ok) {
                throw new Error(`Failed to create thread: ${res.statusText}`);
            }
            const thread = (await res.json()) as Thread;
            setSelectedThreadId(thread.id);
            pendingCreateRef.current = null;
            refresh();
            return thread.id;
        })();

        pendingCreateRef.current = promise;
        return promise;
    }, [selectedThreadId, getToken, url, refresh]);

    const handleArchiveToggleFromPanel = useCallback(
        (threadId: string, archived: boolean) => {
            void setArchived(threadId, archived).then(() => {
                // If the archived/unarchived thread was selected, deselect it when archiving
                if (archived && threadId === selectedThreadId) {
                    setSelectedThreadId(null);
                }
            });
        },
        [setArchived, selectedThreadId],
    );

    const handleSelectThread = useCallback((threadId: string) => {
        setSelectedThreadId(threadId);
        pendingCreateRef.current = null;
    }, []);

    const handleNewThread = useCallback(() => {
        setSelectedThreadId(null);
        pendingCreateRef.current = null;
    }, []);

    const handleRenameThread = useCallback(
        (title: string) => {
            if (!selectedThreadId) return;
            void renameThread(selectedThreadId, title);
        },
        [selectedThreadId, renameThread],
    );

    const handleThreadUpdated = useCallback(
        (event: ThreadUpdatedEvent) => {
            if (event.title !== undefined) {
                updateThreadTitle(event.threadId, event.title);
            }
        },
        [updateThreadTitle],
    );

    const isNarrow = useMediaQuery("(max-width:640px)");
    const [drawerOpen, setDrawerOpen] = useState(false);

    const handleSelectThreadMobile = useCallback(
        (threadId: string) => {
            handleSelectThread(threadId);
            setDrawerOpen(false);
        },
        [handleSelectThread],
    );

    return (
        <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>
            {!isNarrow && (
                <ThreadListPanel
                    threads={threads}
                    selectedThreadId={selectedThreadId}
                    onSelectThread={handleSelectThread}
                    onArchiveToggle={handleArchiveToggleFromPanel}
                    onNewThread={handleNewThread}
                    loading={loading}
                />
            )}
            {isNarrow && (
                <Drawer
                    open={drawerOpen}
                    onClose={() => {
                        setDrawerOpen(false);
                    }}
                >
                    <ThreadListPanel
                        threads={threads}
                        selectedThreadId={selectedThreadId}
                        onSelectThread={handleSelectThreadMobile}
                        onArchiveToggle={handleArchiveToggleFromPanel}
                        onNewThread={() => {
                            handleNewThread();
                            setDrawerOpen(false);
                        }}
                        loading={loading}
                    />
                </Drawer>
            )}
            <Box sx={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
                <ChatEmbed
                    config={{
                        url,
                        getToken,
                        threadId: selectedThreadId ?? undefined,
                        onBeforeSend: onBeforeSend ?? ensureThread,
                        inputComponent,
                        inputTools,
                        maxRows,
                        messageComponents,
                        thread: selectedThread,
                        onRenameThread: selectedThread ? handleRenameThread : undefined,
                        onThreadUpdated: handleThreadUpdated,
                        onOpenThreadList: isNarrow
                            ? () => {
                                  setDrawerOpen(true);
                              }
                            : undefined,
                    }}
                />
            </Box>
        </Box>
    );
}
