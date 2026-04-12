import { useMemo, type ReactElement } from "react";

import { ChatClient } from "@datonfly-assistant/chat-client";
import { ChatClientContext } from "@datonfly-assistant/chat-client/react";

import { ChatUserSettings, type ChatUserSettingsProps } from "./ChatUserSettings.js";
import { AssistantI18nProvider } from "./i18n/index.js";

/** Configuration options for {@link ChatUserSettingsEmbed}. */
export interface ChatUserSettingsEmbedConfig {
    /** Server base URL. */
    url: string;
    /**
     * Optional path prefix prepended to all endpoint paths.
     * @see ChatClientConfig.basePath
     */
    basePath?: string | undefined;
    /** BCP 47 language tag (e.g. `"en"`, `"fi"`). Falls back to `navigator.language`. */
    locale?: string | undefined;
}

/** Props for the {@link ChatUserSettingsEmbed} component. */
export interface ChatUserSettingsEmbedProps extends ChatUserSettingsProps {
    /** Settings embed configuration object. */
    config: ChatUserSettingsEmbedConfig;
}

/**
 * Self-contained settings widget that wraps {@link ChatUserSettings} with
 * the required providers (i18n + ChatClient context).
 *
 * Drop-in replacement when rendering the settings form outside a
 * {@link ChatEmbed} or {@link ChatHistoryEmbed}.
 */
export function ChatUserSettingsEmbed({ config, ...rest }: ChatUserSettingsEmbedProps): ReactElement {
    const client = useMemo(
        () => new ChatClient({ url: config.url, basePath: config.basePath }),
        [config.url, config.basePath],
    );

    return (
        <AssistantI18nProvider locale={config.locale}>
            <ChatClientContext.Provider value={client}>
                <ChatUserSettings {...rest} />
            </ChatClientContext.Provider>
        </AssistantI18nProvider>
    );
}
