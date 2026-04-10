import type { Server } from "socket.io";

import type { IPersistenceProvider, User } from "@datonfly-assistant/core";

/** Default time-to-live for inactive rooms: 15 minutes. */
const DEFAULT_ROOM_TTL_MS = 15 * 60 * 1000;

/** Metadata tracked for each on-demand room. */
interface RoomEntry {
    /** User IDs that are members of this thread (cached from DB at init time). */
    memberUserIds: Set<string>;
    /** Timestamp (ms) of the last event emitted to this room. */
    lastActivityAt: number;
}

/** Socket.io room name for a thread. */
function roomName(threadId: string): string {
    return `thread:${threadId}`;
}

/**
 * Manages on-demand Socket.io rooms for chat threads.
 *
 * Rooms are created lazily on the first emit targeting a thread.  When a room
 * is initialized the current thread members are queried from the database and
 * all connected sockets of those members are joined to the room.  Subsequent
 * emits use the room directly with no DB queries.
 *
 * Stale rooms (no activity for {@link roomTtlMs}) are cleaned up whenever a
 * new room is initialized.
 */
export class ThreadRoomManager {
    /** Active rooms keyed by thread ID. */
    private readonly rooms = new Map<string, RoomEntry>();

    /**
     * Per-thread init mutex: stores a promise while room initialization is
     * in-flight so concurrent callers wait for the same init.
     */
    private readonly initPromises = new Map<string, Promise<void>>();

    constructor(
        private readonly server: Server,
        private readonly persistence: IPersistenceProvider,
        private readonly roomTtlMs: number = DEFAULT_ROOM_TTL_MS,
    ) {}

    /**
     * Ensure the Socket.io room for `threadId` is initialized.
     *
     * If the room already exists its activity timestamp is refreshed.
     * Otherwise the room is created: members are queried from the database,
     * connected sockets of those members are joined, and stale rooms are
     * cleaned up.
     */
    async ensureRoom(threadId: string): Promise<void> {
        const existing = this.rooms.get(threadId);
        if (existing) {
            existing.lastActivityAt = Date.now();
            return;
        }

        // Deduplicate concurrent inits for the same thread.
        let pending = this.initPromises.get(threadId);
        if (pending) {
            await pending;
            return;
        }

        pending = this.initRoom(threadId);
        this.initPromises.set(threadId, pending);
        try {
            await pending;
        } finally {
            this.initPromises.delete(threadId);
        }
    }

    /**
     * Add a member to an active room (e.g. after an invite).
     *
     * If the room is not active this is a no-op — the member will be picked up
     * on the next {@link ensureRoom} call.
     */
    async addMember(threadId: string, userId: string): Promise<void> {
        const entry = this.rooms.get(threadId);
        if (!entry) return;

        entry.memberUserIds.add(userId);
        entry.lastActivityAt = Date.now();

        // Join any currently connected sockets of this user.
        const sockets = await this.server.fetchSockets();
        const name = roomName(threadId);
        for (const socket of sockets) {
            const user = (socket.data as { user?: User | undefined }).user;
            if (user?.id === userId) {
                socket.join(name);
            }
        }
    }

    /**
     * Called when a new socket connects.  Joins the socket to any active rooms
     * where the user is a member.
     *
     * Only iterates the (small) set of recently-active rooms — not all-time
     * thread history.
     */
    joinActiveRooms(socket: { id: string; join: (room: string) => void; data: unknown }): void {
        const user = (socket.data as { user?: User | undefined }).user;
        if (!user) return;

        for (const [threadId, entry] of this.rooms) {
            if (entry.memberUserIds.has(user.id)) {
                socket.join(roomName(threadId));
            }
        }
    }

    // ─── Internal ───

    private async initRoom(threadId: string): Promise<void> {
        const members = await this.persistence.listMembers(threadId);
        const memberUserIds = new Set(members.map((m) => m.userId));

        // Join all currently connected sockets of these members.
        const sockets = await this.server.fetchSockets();
        const name = roomName(threadId);
        for (const socket of sockets) {
            const user = (socket.data as { user?: User | undefined }).user;
            if (user && memberUserIds.has(user.id)) {
                socket.join(name);
            }
        }

        this.rooms.set(threadId, {
            memberUserIds,
            lastActivityAt: Date.now(),
        });

        this.cleanupStaleRooms();
    }

    private cleanupStaleRooms(): void {
        const now = Date.now();
        for (const [threadId, entry] of this.rooms) {
            if (now - entry.lastActivityAt > this.roomTtlMs) {
                this.server.in(roomName(threadId)).socketsLeave(roomName(threadId));
                this.rooms.delete(threadId);
            }
        }
    }
}
