/**
 * Strategy that controls how member-invite user search behaves.
 *
 * - `"default"` – any registered user can be discovered by partial name/email match.
 * - `"limited-visibility"` – search only returns users who already share a thread
 *   with the searcher. Users not found via search can still be invited by exact email.
 */
export type MemberSearchStrategy = "default" | "limited-visibility";
