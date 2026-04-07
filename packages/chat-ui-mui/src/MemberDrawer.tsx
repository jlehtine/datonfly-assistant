import CloseIcon from "@mui/icons-material/Close";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { ReactElement } from "react";

import type { ThreadMemberInfo } from "@datonfly-assistant/core";

import { InviteAutocomplete } from "./InviteAutocomplete.js";

/** Props for the {@link MemberDrawer} component. */
export interface MemberDrawerProps {
    /** Whether the drawer is open. */
    open: boolean;
    /** Called when the drawer should close. */
    onClose: () => void;
    /** Current thread members. */
    members: ThreadMemberInfo[];
    /** Called when the user selects a person to invite. */
    onInvite: (email: string) => void;
}

/**
 * Side/bottom drawer showing the current thread members and an invite autocomplete.
 *
 * On desktop (≥900px / `md`) the drawer slides in from the right; on mobile it
 * appears from the bottom.
 */
export function MemberDrawer({ open, onClose, members, onInvite }: MemberDrawerProps): ReactElement {
    const isDesktop = useMediaQuery("(min-width:900px)");

    const excludeUserIds = members.map((m) => m.userId);

    const content = (
        <Box
            sx={{
                width: isDesktop ? 320 : "auto",
                maxHeight: isDesktop ? "100%" : "70vh",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1.5 }}>
                <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600 }}>
                    Members ({members.length})
                </Typography>
                <IconButton size="small" onClick={onClose} aria-label="Close members">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Box>
            <Divider />
            <Box sx={{ px: 2, py: 1 }}>
                <InviteAutocomplete excludeUserIds={excludeUserIds} onInvite={onInvite} />
            </Box>
            <Divider />
            <List sx={{ flex: 1, overflow: "auto" }}>
                {members.map((member) => (
                    <ListItem key={member.userId}>
                        <ListItemAvatar>
                            <Avatar src={member.avatarUrl} sx={{ width: 36, height: 36 }}>
                                {member.name.charAt(0).toUpperCase()}
                            </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                            primary={
                                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                    <Typography variant="body2">{member.name}</Typography>
                                    {member.role === "owner" && <Chip label="Owner" size="small" variant="outlined" />}
                                </Box>
                            }
                            secondary={member.email}
                            slotProps={{ secondary: { variant: "caption" } }}
                        />
                    </ListItem>
                ))}
            </List>
        </Box>
    );

    return (
        <Drawer anchor={isDesktop ? "right" : "bottom"} open={open} onClose={onClose}>
            {content}
        </Drawer>
    );
}
