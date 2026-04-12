/** Machine-readable error code for programmatic error handling. */
export type ErrorCode =
    | "auth_required"
    | "invalid_token"
    | "user_resolution_failed"
    | "internal_error"
    | "invalid_message"
    | "not_member"
    | "duplicate_message"
    | "invalid_request"
    | "user_not_found"
    | "already_member"
    | "owner_cannot_self_remove"
    | "only_owners_can_remove"
    | "not_a_member_target"
    | "only_owners_can_change_roles"
    | "cannot_change_own_role"
    | "thread_not_found"
    | "not_thread_owner"
    | "user_identity_not_provided"
    | "client_error"
    | "unspecified";

/** Runtime constant mapping each {@link ErrorCode} to itself, useful for autocomplete and iteration. */
export const ERROR_CODES = {
    auth_required: "auth_required",
    invalid_token: "invalid_token",
    user_resolution_failed: "user_resolution_failed",
    internal_error: "internal_error",
    invalid_message: "invalid_message",
    not_member: "not_member",
    duplicate_message: "duplicate_message",
    invalid_request: "invalid_request",
    user_not_found: "user_not_found",
    already_member: "already_member",
    owner_cannot_self_remove: "owner_cannot_self_remove",
    only_owners_can_remove: "only_owners_can_remove",
    not_a_member_target: "not_a_member_target",
    only_owners_can_change_roles: "only_owners_can_change_roles",
    cannot_change_own_role: "cannot_change_own_role",
    thread_not_found: "thread_not_found",
    not_thread_owner: "not_thread_owner",
    user_identity_not_provided: "user_identity_not_provided",
    client_error: "client_error",
    unspecified: "unspecified",
} as const satisfies Record<ErrorCode, ErrorCode>;
