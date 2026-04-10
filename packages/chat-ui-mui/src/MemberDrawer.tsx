import CloseIcon from "@mui/icons-material/Close";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemAvatar from "@mui/material/ListItemAvatar";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useCallback, useState, type ReactElement } from "react";

import type { ThreadMemberInfo, ThreadMemberRole } from "@datonfly-assistant/core";

import { InviteAutocomplete } from "./InviteAutocomplete.js";

/** Props for the {@link MemberDrawer} component. */
export interface MemberDrawerProps {
    /** Whether the drawer is open. */
    open: boolean;
    /** Called when the drawer should close. */
    onClose: () => void;
    /** Current thread members. */
    members: ThreadMemberInfo[];
    /** The current authenticated user's ID. */
    currentUserId: string | null;
    /** Called when the user selects a person to invite. */
    onInvite: (email: string) => void;
    /** Called when a member should be removed from the thread. */
    onRemoveMember: (userId: string) => void;
    /** Called when a member's role should change. */
    onUpdateMemberRole: (userId: string, role: ThreadMemberRole) => void;
}

/**
 * Side/bottom drawer showing the current thread members and an invite autocomplete.
 *
 * On desktop (≥900px / `md`) the drawer slides in from the right; on mobile it
 * appears from the bottom.
 */
export function MemberDrawer({
    open,
    onClose,
    members,
    currentUserId,
    onInvite,
    onRemoveMember,
    onUpdateMemberRole,
}: MemberDrawerProps): ReactElement {
    const isDesktop = useMediaQuery("(min-width:900px)");
    const excludeUserIds = members.map((m) => m.userId);
    const currentUserRole = members.find((m) => m.userId === currentUserId)?.role ?? null;

    // Action menu state
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const [menuMember, setMenuMember] = useState<ThreadMemberInfo | null>(null);

    const handleOpenMenu = useCallback((event: React.MouseEvent<HTMLElement>, member: ThreadMemberInfo) => {
        setMenuAnchor(event.currentTarget);
        setMenuMember(member);
    }, []);

    const handleCloseMenu = useCallback(() => {
        setMenuAnchor(null);
        setMenuMember(null);
    }, []);

    // Confirmation dialog state
    const [confirmAction, setConfirmAction] = useState<{ type: "remove" | "leave"; member: ThreadMemberInfo } | null>(
        null,
    );

    const handleConfirmAction = useCallback(() => {
        if (confirmAction) {
            onRemoveMember(confirmAction.member.userId);
        }
        setConfirmAction(null);
    }, [confirmAction, onRemoveMember]);

    const handleCancelConfirm = useCallback(() => {
        setConfirmAction(null);
    }, []);

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
                {members.map((member) => {
                    const isSelf = member.userId === currentUserId;
                    const hasActions =
                        (currentUserRole === "owner" && !isSelf) || (currentUserRole === "member" && isSelf);

                    return (
                        <ListItem
                            key={member.userId}
                            secondaryAction={
                                hasActions ? (
                                    <IconButton
                                        size="small"
                                        aria-label={`Actions for ${member.name}`}
                                        onClick={(e) => {
                                            handleOpenMenu(e, member);
                                        }}
                                    >
                                        <MoreVertIcon fontSize="small" />
                                    </IconButton>
                                ) : undefined
                            }
                        >
                            <ListItemAvatar>
                                <Avatar src={member.avatarUrl} sx={{ width: 36, height: 36 }}>
                                    {member.name.charAt(0).toUpperCase()}
                                </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                                primary={
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                        <Typography variant="body2">{member.name}</Typography>
                                        {member.role === "owner" && (
                                            <Chip label="Owner" size="small" variant="outlined" />
                                        )}
                                    </Box>
                                }
                                secondary={member.email}
                                slotProps={{ secondary: { variant: "caption" } }}
                            />
                        </ListItem>
                    );
                })}
            </List>

            {/* Context menu for member actions */}
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleCloseMenu}>
                {menuMember &&
                    currentUserRole === "owner" &&
                    menuMember.userId !== currentUserId && [
                        menuMember.role === "member" ? (
                            <MenuItem
                                key="promote"
                                onClick={() => {
                                    onUpdateMemberRole(menuMember.userId, "owner");
                                    handleCloseMenu();
                                }}
                            >
                                Promote to Owner
                            </MenuItem>
                        ) : (
                            <MenuItem
                                key="demote"
                                onClick={() => {
                                    onUpdateMemberRole(menuMember.userId, "member");
                                    handleCloseMenu();
                                }}
                            >
                                Demote to Member
                            </MenuItem>
                        ),
                        <MenuItem
                            key="remove"
                            onClick={() => {
                                setConfirmAction({ type: "remove", member: menuMember });
                                handleCloseMenu();
                            }}
                            sx={{ color: "error.main" }}
                        >
                            Remove from Thread
                        </MenuItem>,
                    ]}
                {menuMember && currentUserRole === "member" && menuMember.userId === currentUserId && (
                    <MenuItem
                        onClick={() => {
                            setConfirmAction({ type: "leave", member: menuMember });
                            handleCloseMenu();
                        }}
                        sx={{ color: "error.main" }}
                    >
                        Leave Thread
                    </MenuItem>
                )}
            </Menu>

            {/* Confirmation dialog for destructive actions */}
            <Dialog open={Boolean(confirmAction)} onClose={handleCancelConfirm}>
                <DialogTitle>{confirmAction?.type === "leave" ? "Leave Thread" : "Remove Member"}</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {confirmAction?.type === "leave"
                            ? "Are you sure you want to leave this thread? You will no longer see messages in this thread."
                            : `Are you sure you want to remove ${confirmAction?.member.name ?? "this member"} from this thread?`}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelConfirm}>Cancel</Button>
                    <Button onClick={handleConfirmAction} color="error" variant="contained">
                        {confirmAction?.type === "leave" ? "Leave" : "Remove"}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );

    return (
        <Drawer anchor={isDesktop ? "right" : "bottom"} open={open} onClose={onClose}>
            {content}
        </Drawer>
    );
}
