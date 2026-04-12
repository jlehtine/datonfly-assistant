import type en from "./en.js";

/** Finnish translations for the frontend demo shell. */
const fi: Record<keyof typeof en, string> = {
    appTitle: "Datonfly-avustaja",
    signIn: "Kirjaudu sisään",
    signInToContinue: "Kirjaudu sisään jatkaaksesi",
    chatSettings: "Keskusteluasetukset",
    signOut: "Kirjaudu ulos",
    userMenu: "Käyttäjävalikko",
    switchUser: "Vaihda käyttäjää",
} as const;

export default fi;
