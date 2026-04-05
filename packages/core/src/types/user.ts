/** A registered user of the platform. */
export interface User {
    /** Unique user identifier (UUID). */
    id: string;
    /** User's email address, sourced from the OIDC provider. */
    email: string;
    /** Display name. */
    name: string;
    /** URL to the user's profile picture, if available. */
    avatarUrl?: string | undefined;
    /** Timestamp when the user record was created. */
    createdAt: Date;
}
