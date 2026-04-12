import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.js";
import fi from "./locales/fi.js";

void i18next.use(initReactI18next).init({
    lng: navigator.language,
    fallbackLng: "en",
    ns: ["app"],
    defaultNS: "app",
    interpolation: { escapeValue: false },
    resources: {
        en: { app: en },
        fi: { app: fi },
    },
});

export default i18next;
