import { useMemo, type ReactElement, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { createAssistantI18n } from "./instance.js";

/** Props for {@link AssistantI18nProvider}. */
export interface AssistantI18nProviderProps {
    /** BCP 47 language tag. When omitted, defaults to `navigator.language`. */
    locale?: string | undefined;
    children: ReactNode;
}

/**
 * Provides an isolated i18next instance to the assistant UI tree.
 *
 * A new instance is created whenever the `locale` prop changes.
 */
export function AssistantI18nProvider({ locale, children }: AssistantI18nProviderProps): ReactElement {
    const i18n = useMemo(() => createAssistantI18n(locale), [locale]);

    return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
