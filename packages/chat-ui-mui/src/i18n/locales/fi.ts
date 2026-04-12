import type en from "./en.js";

type FlatKeys<T> = {
    [K in keyof T]: T[K] extends Record<string, string> ? Record<keyof T[K], string> : string;
};

/** Finnish translation strings for the assistant UI. */
const fi: FlatKeys<typeof en> = {
    // ── ChatEmbed ──
    openConversations: "Avaa keskustelut",
    inviteMember: "Kutsu jäsen",
    connecting: "Yhdistetään...",

    // ── ChatUserSettings ──
    displayNameForAI: "Tekoälylle näytettävä nimi",
    displayNameForAITooltip:
        "Tekoälyavustaja tuntee sinut tällä nimellä kaikissa keskusteluissa. Se on erityisen hyödyllinen ryhmäkeskusteluissa, joissa jokaisen osallistujan viestit merkitään, jotta tekoäly tietää kuka sanoi mitäkin. Jos nimeä ei ole asetettu, olet 'Tunnistamaton käyttäjä'.",
    unidentifiedUser: "Tunnistamaton käyttäjä",
    saving: "Tallennetaan…",
    save: "Tallenna",

    // ── Composer ──
    tools: "Työkalut",
    typeAMessage: "Kirjoita viesti...",
    send: "Lähetä",

    // ── MessageList ──
    assistantIsThinking: "Avustaja ajattelee",

    // ── formatTimestamp ──
    justNow: "Juuri nyt",
    yesterday: "Eilen, {{time}}",

    // ── ThreadListPanel ──
    newConversation: "Uusi keskustelu",
    active: "Aktiiviset",
    archived: "Arkistoidut",
    settings: "Asetukset",
    noArchivedConversations: "Ei arkistoituja keskusteluja.",
    noConversationsYet: "Ei vielä keskusteluja.",

    // ── EditableTitle ──
    editTitle: "Muokkaa otsikkoa",

    // ── MemberDrawer ──
    membersCount: "Jäsenet ({{count}})",
    closeMembers: "Sulje jäsenlista",
    owner: "Omistaja",
    promoteToOwner: "Ylennä omistajaksi",
    demoteToMember: "Alenna jäseneksi",
    removeFromThread: "Poista keskustelusta",
    leaveThread: "Poistu keskustelusta",
    removeMember: "Poista jäsen",
    leaveThreadConfirmation: "Haluatko varmasti poistua tästä keskustelusta? Et näe enää tämän keskustelun viestejä.",
    removeMemberConfirmation: "Haluatko varmasti poistaa käyttäjän {{name}} tästä keskustelusta?",
    removeMemberConfirmationUnnamed: "Haluatko varmasti poistaa tämän jäsenen keskustelusta?",
    cancel: "Peruuta",
    leave: "Poistu",
    remove: "Poista",

    // ── InviteAutocomplete ──
    noUsersFound: "Käyttäjiä ei löytynyt",
    typeToSearch: "Kirjoita hakeaksesi",
    searchUsersToInvite: "Hae kutsuttavia käyttäjiä...",

    // ── RichInput ──
    toggleFormatting: "Vaihda muotoilu",

    // ── MessageBubble (interruption indicator) ──
    responseInterrupted: "Vastaus keskeytettiin",

    // ── Status codes ──
    status: {
        tool_code_execution: "Suoritetaan koodia…",
        tool_web_search: "Haetaan verkosta…",
        unspecified: "Työskentelee…",
    },

    // ── Error codes ──
    error: {
        auth_required: "Kirjautuminen vaaditaan.",
        invalid_token: "Virheellinen tai vanhentunut tunniste.",
        user_resolution_failed: "Käyttäjätiliä ei voitu selvittää.",
        internal_error: "Sisäinen virhe tapahtui.",
        invalid_message: "Viestiä ei voitu käsitellä.",
        not_member: "Et ole tämän keskustelun jäsen.",
        duplicate_message: "Tämä viesti on jo lähetetty.",
        invalid_request: "Virheellinen pyyntö.",
        user_not_found: "Käyttäjää ei löytynyt.",
        already_member: "Käyttäjä on jo tämän keskustelun jäsen.",
        owner_cannot_self_remove: "Keskustelun omistajat eivät voi poistaa itseään.",
        only_owners_can_remove: "Vain keskustelun omistajat voivat poistaa jäseniä.",
        not_a_member_target: "Määritetty käyttäjä ei ole tämän keskustelun jäsen.",
        only_owners_can_change_roles: "Vain keskustelun omistajat voivat muuttaa rooleja.",
        cannot_change_own_role: "Et voi muuttaa omaa rooliasi.",
        thread_not_found: "Keskustelua ei löytynyt.",
        not_thread_owner: "Vain keskustelun omistaja voi suorittaa tämän toiminnon.",
        user_identity_not_provided: "Käyttäjätietoja ei annettu.",
        client_error: "Yhteys palvelimeen epäonnistui.",
        unspecified: "Odottamaton virhe tapahtui.",
    },
} as const;

export default fi;
