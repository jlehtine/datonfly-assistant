import i18next, { type i18n } from "i18next";

import en from "./locales/en.js";
import fi from "./locales/fi.js";

/**
 * Create an isolated i18next instance for the assistant UI.
 *
 * Each call returns a new instance so multiple embeds on the same page
 * can use independent locales without interfering with each other or
 * with the host application's own i18n setup.
 *
 * @param locale - BCP 47 language tag (e.g. `"en"`, `"fi"`). Falls back to
 *   `navigator.language` when omitted in a browser environment, or `"en"` on
 *   the server.
 */
export function createAssistantI18n(locale?: string): i18n {
    const instance = i18next.createInstance();
    void instance.init({
        lng: locale ?? (typeof navigator !== "undefined" ? navigator.language : "en"),
        fallbackLng: "en",
        ns: ["assistant"],
        defaultNS: "assistant",
        interpolation: { escapeValue: false },
        resources: {
            en: { assistant: en },
            fi: { assistant: fi },
        },
    });
    return instance;
}
