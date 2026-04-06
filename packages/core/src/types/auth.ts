/**
 * User identity injected into the request context by the host application's
 * authentication middleware.  Contains only the claims needed to identify the
 * user — the resolved database record (with UUID, timestamps, etc.) is looked
 * up by `chat-server` via the persistence provider.
 */
export interface UserIdentity {
    /** User's email address (used as the lookup key). */
    email: string;
    /** Display name. */
    name: string;
    /** URL to the user's profile picture, if available. */
    avatarUrl?: string | undefined;
}
