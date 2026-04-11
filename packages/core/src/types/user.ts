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
    /** Name shown to the AI agent in place of the user's real name. */
    agentAlias?: string | undefined;
    /** Timestamp when the user record was created. */
    createdAt: Date;
    /** Timestamp of the user's most recent successful authentication. */
    lastLoginAt?: Date | undefined;
    /** Timestamp of logical deletion (soft-delete). `undefined` means the user is active. */
    deletedAt?: Date | undefined;
}
