import Autocomplete from "@mui/material/Autocomplete";
import Avatar from "@mui/material/Avatar";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";

import { useUserSearch, type UseUserSearchResult } from "@datonfly-assistant/chat-client/react";
import type { UserSearchResultWire } from "@datonfly-assistant/core";

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
 */
export function InviteAutocomplete({ excludeUserIds, onInvite }: InviteAutocompleteProps): ReactElement {
    const { t } = useTranslation();
    const { results, isSearching, search, clear }: UseUserSearchResult = useUserSearch(excludeUserIds);
    const [inputValue, setInputValue] = useState("");

    const handleInputChange = useCallback(
        (_event: unknown, value: string): void => {
            setInputValue(value);
            search(value);
        },
        [search],
    );

    const handleChange = useCallback(
        (_event: unknown, value: UserSearchResultWire | null): void => {
            if (value) {
                onInvite(value.email);
                setInputValue("");
                clear();
            }
        },
        [onInvite, clear],
    );

    return (
        <Autocomplete<UserSearchResultWire>
            options={results}
            loading={isSearching}
            inputValue={inputValue}
            onInputChange={handleInputChange}
            onChange={handleChange}
            getOptionLabel={(option) => option.name}
            getOptionKey={(option) => option.id}
            filterOptions={(x) => x}
            noOptionsText={inputValue ? t("noUsersFound") : t("typeToSearch")}
            renderOption={(props, option) => (
                <ListItem {...props} key={option.id}>
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
            )}
            renderInput={(params) => (
                <TextField {...params} placeholder={t("searchUsersToInvite")} size="small" variant="outlined" />
            )}
            size="small"
            sx={{ mt: 1 }}
        />
    );
}
