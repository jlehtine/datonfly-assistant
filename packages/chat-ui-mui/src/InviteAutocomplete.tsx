import PersonAddIcon from "@mui/icons-material/PersonAdd";
import Autocomplete from "@mui/material/Autocomplete";
import Avatar from "@mui/material/Avatar";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { useUserSearch, type UseUserSearchResult } from "@datonfly-assistant/chat-client/react";
import type { UserSearchResultWire } from "@datonfly-assistant/core";

/** Synthetic option representing an invite-by-email entry. */
interface EmailInviteOption {
    kind: "email-invite";
    email: string;
}

/** Union of option types shown in the autocomplete dropdown. */
type InviteOption = (UserSearchResultWire & { kind?: undefined }) | EmailInviteOption;

/** Loose email check — intentionally permissive (server validates with Zod). */
const looksLikeEmail = (v: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** Props for the {@link InviteAutocomplete} component. */
export interface InviteAutocompleteProps {
    /** User IDs to exclude from search results (e.g. existing members). */
    excludeUserIds: string[];
    /** Called when the user selects a person to invite. */
    onInvite: (email: string) => void;
}

/**
 * Autocomplete input for searching users and inviting them to a thread.
 *
 * Performs a debounced search via {@link useUserSearch} and renders results
 * with avatar, name, and email. On selection the `onInvite` callback is fired
 * and the input is cleared.
 *
 * When the input looks like an email address and no search result matches that
 * exact email, a synthetic "Invite {email}" option is prepended so the user
 * can invite by exact email even when the person is not discoverable via search.
 */
export function InviteAutocomplete({ excludeUserIds, onInvite }: InviteAutocompleteProps): ReactElement {
    const { t } = useTranslation();
    const { results, isSearching, search, clear }: UseUserSearchResult = useUserSearch(excludeUserIds);
    const [inputValue, setInputValue] = useState("");

    const options: InviteOption[] = useMemo(() => {
        const trimmed = inputValue.trim();
        if (looksLikeEmail(trimmed) && !results.some((r) => r.email.toLowerCase() === trimmed.toLowerCase())) {
            return [{ kind: "email-invite" as const, email: trimmed }, ...results];
        }
        return results;
    }, [inputValue, results]);

    const handleInputChange = useCallback(
        (_event: unknown, value: string, reason: string): void => {
            // After a selection MUI tries to fill the input with the option label — ignore it.
            if (reason === "reset") return;
            setInputValue(value);
            search(value);
        },
        [search],
    );

    const handleChange = useCallback(
        (_event: unknown, value: InviteOption | null): void => {
            if (value) {
                onInvite(value.email);
            }
            setInputValue("");
            clear();
        },
        [onInvite, clear],
    );

    const getOptionLabel = useCallback(
        (option: InviteOption): string =>
            option.kind === "email-invite" ? t("inviteByEmail", { email: option.email }) : option.name,
        [t],
    );

    const getOptionKey = useCallback(
        (option: InviteOption): string => (option.kind === "email-invite" ? `email:${option.email}` : option.id),
        [],
    );

    return (
        <Autocomplete<InviteOption>
            options={options}
            value={null}
            loading={isSearching}
            inputValue={inputValue}
            onInputChange={handleInputChange}
            onChange={handleChange}
            getOptionLabel={getOptionLabel}
            getOptionKey={getOptionKey}
            filterOptions={(x) => x}
            noOptionsText={inputValue ? t("noUsersFound") : t("typeToSearch")}
            renderOption={(props, option) =>
                option.kind === "email-invite" ? (
                    <ListItem
                        {...props}
                        key={`email:${option.email}`}
                        className="datonfly-invite-option"
                        data-invite-email={option.email}
                    >
                        <ListItemAvatar>
                            <Avatar sx={{ width: 32, height: 32 }}>
                                <PersonAddIcon fontSize="small" />
                            </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                            primary={t("inviteByEmail", { email: option.email })}
                            slotProps={{ primary: { variant: "body2" } }}
                        />
                    </ListItem>
                ) : (
                    <ListItem
                        {...props}
                        key={option.id}
                        className="datonfly-invite-option"
                        data-invite-user-id={option.id}
                        data-invite-user-email={option.email}
                    >
                        <ListItemAvatar>
                            <Avatar src={option.avatarUrl ?? undefined} sx={{ width: 32, height: 32 }}>
                                {option.name.charAt(0).toUpperCase()}
                            </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                            primary={option.name}
                            secondary={option.email}
                            slotProps={{
                                primary: { variant: "body2" },
                                secondary: { variant: "caption" },
                            }}
                        />
                    </ListItem>
                )
            }
            renderInput={(params) => (
                <TextField
                    {...params}
                    placeholder={t("searchUsersToInvite")}
                    size="small"
                    variant="outlined"
                    className="datonfly-invite-search"
                    slotProps={{
                        htmlInput: {
                            ...params.inputProps,
                            className: "datonfly-invite-search-input",
                        },
                    }}
                />
            )}
            size="small"
            sx={{ mt: 1 }}
        />
    );
}
