/** Authenticated user payload extracted from a JWT or fake auth. */
export interface AuthUser {
    /** Unique user identifier (UUID). */
    id: string;
    /** User's email address. */
    email: string;
    /** Display name. */
    name: string;
    /** URL to the user's profile picture, if available. */
    avatarUrl?: string | undefined;
}
