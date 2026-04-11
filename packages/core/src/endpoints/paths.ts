/** Unique path prefix for all Datonfly Assistant endpoints. */
export const API_PREFIX = "/datonfly-assistant";

/** Socket.io transport path. */
export const WS_PATH = `${API_PREFIX}/socket.io`;

/** Path for the threads collection. */
export const THREADS_PATH = `${API_PREFIX}/threads`;

/** Path for a single thread by ID. */
export function threadPath(threadId: string): string {
    return `${THREADS_PATH}/${threadId}`;
}

/** Path for messages within a thread. */
export function threadMessagesPath(threadId: string): string {
    return `${THREADS_PATH}/${threadId}/messages`;
}

/** Path for members of a thread. */
export function threadMembersPath(threadId: string): string {
    return `${THREADS_PATH}/${threadId}/members`;
}

/** Path for the user search endpoint. */
export const USERS_SEARCH_PATH = `${API_PREFIX}/users/search`;

/** Path for the authenticated user's profile. */
export const USERS_ME_PATH = `${API_PREFIX}/users/me`;
