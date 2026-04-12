/** English translation strings for the assistant UI. */
const en = {
    // ── ChatEmbed ──
    openConversations: "Open conversations",
    inviteMember: "Invite member",
    connecting: "Connecting...",

    // ── ChatUserSettings ──
    displayNameForAI: "Display name for AI",
    displayNameForAITooltip:
        "This name identifies you to the AI assistant in all conversations. It is especially useful in group chats, where each participant's messages are labeled so the AI can follow who said what. If not set, you appear as 'Unidentified user'.",
    unidentifiedUser: "Unidentified user",
    saving: "Saving…",
    save: "Save",

    // ── Composer ──
    tools: "Tools",
    typeAMessage: "Type a message...",
    send: "Send",

    // ── MessageList ──
    assistantIsThinking: "Assistant is thinking",

    // ── formatTimestamp ──
    justNow: "Just now",
    yesterday: "Yesterday, {{time}}",

    // ── ThreadListPanel ──
    newConversation: "New conversation",
    active: "Active",
    archived: "Archived",
    settings: "Settings",
    noArchivedConversations: "No archived conversations.",
    noConversationsYet: "No conversations yet.",

    // ── EditableTitle ──
    editTitle: "Edit title",

    // ── MemberDrawer ──
    membersCount: "Members ({{count}})",
    closeMembers: "Close members",
    owner: "Owner",
    promoteToOwner: "Promote to Owner",
    demoteToMember: "Demote to Member",
    removeFromThread: "Remove from Thread",
    leaveThread: "Leave Thread",
    removeMember: "Remove Member",
    leaveThreadConfirmation:
        "Are you sure you want to leave this thread? You will no longer see messages in this thread.",
    removeMemberConfirmation: "Are you sure you want to remove {{name}} from this thread?",
    removeMemberConfirmationUnnamed: "Are you sure you want to remove this member from this thread?",
    cancel: "Cancel",
    leave: "Leave",
    remove: "Remove",

    // ── InviteAutocomplete ──
    noUsersFound: "No users found",
    typeToSearch: "Type to search",
    searchUsersToInvite: "Search users to invite...",

    // ── RichInput ──
    toggleFormatting: "Toggle formatting",

    // ── MessageBubble (interruption indicator) ──
    responseInterrupted: "Response was interrupted",

    // ── Status codes ──
    status: {
        tool_code_execution: "Running code…",
        tool_web_search: "Searching the web…",
        unspecified: "Working…",
    },

    // ── Error codes ──
    error: {
        auth_required: "Authentication required.",
        invalid_token: "Invalid or expired token.",
        user_resolution_failed: "Could not resolve your user account.",
        internal_error: "An internal error occurred.",
        invalid_message: "The message could not be processed.",
        not_member: "You are not a member of this thread.",
        duplicate_message: "This message was already sent.",
        invalid_request: "Invalid request.",
        user_not_found: "User not found.",
        already_member: "User is already a member of this thread.",
        owner_cannot_self_remove: "Thread owners cannot remove themselves.",
        only_owners_can_remove: "Only thread owners can remove members.",
        not_a_member_target: "The specified user is not a member of this thread.",
        only_owners_can_change_roles: "Only thread owners can change member roles.",
        cannot_change_own_role: "You cannot change your own role.",
        thread_not_found: "Thread not found.",
        not_thread_owner: "Only the thread owner can perform this action.",
        user_identity_not_provided: "User identity not provided.",
        client_error: "Failed to communicate with the server.",
        unspecified: "An unexpected error occurred.",
    },
} as const;

export default en;
