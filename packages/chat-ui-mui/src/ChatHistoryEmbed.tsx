import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";

import { typedFetch } from "@datonfly-assistant/chat-client";
import {
    ChatClientContext,
    CurrentUserIdContext,
    useChatClient,
    useChatConnection,
    useThreadList,
    useThreadSearch,
} from "@datonfly-assistant/chat-client/react";
import { THREADS_PATH, threadWireSchema, type ThreadUpdatedEvent } from "@datonfly-assistant/core";

import { ChatEmbed } from "./ChatEmbed.js";
import type { ComposerInputProps } from "./Composer.js";
import { AssistantI18nProvider } from "./i18n/index.js";
import type { InputTool } from "./InputTool.js";
import { ThreadListPanel } from "./ThreadListPanel.js";

/** Configuration options for {@link ChatHistoryEmbed}. */
export interface ChatHistoryEmbedConfig {
    /** WebSocket and REST server base URL. */
    url: string;
    /**
     * Optional path prefix prepended to all endpoint paths.
     * @see ChatClientConfig.basePath
     */
    basePath?: string | undefined;
    /** BCP 47 language tag (e.g. `"en"`, `"fi"`). Falls back to `navigator.language`. */
    locale?: string | undefined;
    /** Override the default plain-text input with a custom component. */
    inputComponent?: ComponentType<ComposerInputProps> | undefined;
    /** Optional input tools (e.g. emoji picker) to attach to the composer. */
    inputTools?: InputTool[] | undefined;
    /** Maximum number of visible rows in the composer textarea before it scrolls. */
    maxRows?: number | undefined;
    /**
     * Optional custom element renderers for message markdown.
     * Pass `highlightComponents` from `@datonfly-assistant/chat-ui-mui/highlight`
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
    const { url, basePath } = config;
    const { client, userId, features } = useChatConnection({ url, basePath });

    return (
        <AssistantI18nProvider locale={config.locale}>
            <ChatClientContext.Provider value={client}>
                <CurrentUserIdContext.Provider value={userId}>
                    <ChatHistoryInner config={config} searchEnabled={features.search === true} />
                </CurrentUserIdContext.Provider>
            </ChatClientContext.Provider>
        </AssistantI18nProvider>
    );
}

function ChatHistoryInner({ config, searchEnabled }: ChatHistoryEmbedProps & { searchEnabled: boolean }): ReactElement {
    const { url, basePath, inputComponent, inputTools, maxRows, messageComponents, onBeforeSend } = config;
    const { t } = useTranslation();

    const client = useChatClient();

    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const pendingCreateRef = useRef<Promise<string> | null>(null);

    // Track Page Visibility API so we only mark threads as read when the tab
    // is actually visible.
    const [tabVisible, setTabVisible] = useState(
        () => typeof document !== "undefined" && document.visibilityState === "visible",
    );
    useEffect(() => {
        const handler = (): void => {
            setTabVisible(document.visibilityState === "visible");
        };
        document.addEventListener("visibilitychange", handler);
        return () => {
            document.removeEventListener("visibilitychange", handler);
        };
    }, []);

    const activelyViewingThreadId = tabVisible && selectedThreadId ? selectedThreadId : null;

    // Always load all threads (active + archived); ThreadListPanel handles client-side filtering.
    const { threads, loading, setArchived, markRead, renameThread, updateThreadTitle, refresh, hasMore, loadMore } =
        useThreadList({
            includeArchived: true,
            activelyViewingThreadId,
        });

    const {
        query: searchQuery,
        setQuery: setSearchQuery,
        results: searchResults,
        isSearching,
        clearSearch,
    } = useThreadSearch();

    // Mark the thread as read when selected + tab visible.
    useEffect(() => {
        if (activelyViewingThreadId) {
            markRead(activelyViewingThreadId);
        }
    }, [activelyViewingThreadId, markRead]);

    // Find the full Thread object for the currently selected thread.
    const selectedThread = threads.find((t) => t.id === selectedThreadId);

    // Create a new thread via the REST API if none is selected yet.
    const ensureThread = useCallback(async (): Promise<string> => {
        if (selectedThreadId) {
            // Defensively mark as read on message send.
            markRead(selectedThreadId);
            return selectedThreadId;
        }
        if (pendingCreateRef.current) return pendingCreateRef.current;

        const promise = (async () => {
            const thread = await typedFetch(client, THREADS_PATH, threadWireSchema, {
                method: "POST",
                body: { title: t("newConversation") },
            });
            setSelectedThreadId(thread.id);
            pendingCreateRef.current = null;
            refresh();
            return thread.id;
        })();

        pendingCreateRef.current = promise;
        return promise;
    }, [selectedThreadId, client, t, refresh, markRead]);

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

    const handleSelectThread = useCallback(
        (threadId: string) => {
            setSelectedThreadId(threadId);
            pendingCreateRef.current = null;
            clearSearch();
        },
        [clearSearch],
    );

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

    // Thread-updated events from the ChatEmbed's own listener (onThreadUpdated prop)
    // are title-only updates from the title generator. The useThreadList hook handles
    // all other thread-updated fields (archive, unreadCount, memoryEnabled) via its
    // own WS listener.
    const handleThreadUpdated = useCallback(
        (event: ThreadUpdatedEvent) => {
            if (event.title !== undefined) {
                updateThreadTitle(event.threadId, event.title, event.titleManuallySet ?? false);
            }
        },
        [updateThreadTitle],
    );

    const handleLeftThread = useCallback(() => {
        setSelectedThreadId(null);
        refresh();
    }, [refresh]);

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
                    hasMore={hasMore}
                    onLoadMore={loadMore}
                    {...(searchEnabled
                        ? {
                              searchQuery,
                              onSearchQueryChange: setSearchQuery,
                              searchResults,
                              isSearching,
                              onClearSearch: clearSearch,
                          }
                        : {})}
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
                        hasMore={hasMore}
                        onLoadMore={loadMore}
                        {...(searchEnabled
                            ? {
                                  searchQuery,
                                  onSearchQueryChange: setSearchQuery,
                                  searchResults,
                                  isSearching,
                                  onClearSearch: clearSearch,
                              }
                            : {})}
                    />
                </Drawer>
            )}
            <Box sx={{ flex: 1, overflow: "hidden", minWidth: 0 }}>
                <ChatEmbed
                    config={{
                        url,
                        basePath,
                        locale: config.locale,
                        threadId: selectedThreadId ?? undefined,
                        onBeforeSend: onBeforeSend ?? ensureThread,
                        inputComponent,
                        inputTools,
                        maxRows,
                        messageComponents,
                        thread: selectedThread,
                        onRenameThread: selectedThread ? handleRenameThread : undefined,
                        onThreadUpdated: handleThreadUpdated,
                        onLeftThread: handleLeftThread,
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
