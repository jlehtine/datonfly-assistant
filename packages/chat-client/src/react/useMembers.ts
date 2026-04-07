import { useCallback, useEffect, useState } from "react";

import {
    threadMemberInfoListWireSchema,
    threadMembersPath,
    type MemberJoinedEvent,
    type MemberLeftEvent,
    type ThreadMemberInfo,
} from "@datonfly-assistant/core";

import { typedFetch } from "../fetch.js";
import { useChatClient } from "./context.js";

/** Return value of {@link useMembers}. */
export interface UseMembersResult {
    /** Current members of the thread (with display info). */
    members: ThreadMemberInfo[];
    /** `true` while members are being fetched. */
    isLoading: boolean;
    /** Invite a user to the current thread by email. */
    inviteMember: (email: string) => void;
}

/**
 * Fetch and reactively track members of a thread.
 *
 * Loads the member list via REST on mount / thread change and listens for
 * `member-joined` / `member-left` WebSocket events to keep the list up to date.
 *
 * @param threadId - The thread to track, or `null` when no thread is selected.
 */
export function useMembers(threadId: string | null): UseMembersResult {
    const client = useChatClient();
    const [members, setMembers] = useState<ThreadMemberInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // Fetch member list when threadId changes
    useEffect(() => {
        setMembers([]);
        if (!threadId) return;

        setIsLoading(true);
        void typedFetch(client, threadMembersPath(threadId), threadMemberInfoListWireSchema)
            .then((data) => {
                setMembers(data);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [client, threadId]);

    // Listen for real-time member events
    useEffect(() => {
        if (!threadId) return;

        const handleJoined = (event: MemberJoinedEvent): void => {
            if (event.threadId !== threadId) return;
            // Re-fetch to get the full user info for the new member
            void typedFetch(client, threadMembersPath(threadId), threadMemberInfoListWireSchema).then((data) => {
                setMembers(data);
            });
        };

        const handleLeft = (event: MemberLeftEvent): void => {
            if (event.threadId !== threadId) return;
            setMembers((prev) => prev.filter((m) => m.userId !== event.userId));
        };

        client.on("member-joined", handleJoined);
        client.on("member-left", handleLeft);
        return () => {
            client.off("member-joined", handleJoined);
            client.off("member-left", handleLeft);
        };
    }, [client, threadId]);

    const inviteMember = useCallback(
        (email: string): void => {
            if (!threadId) return;
            client.inviteMember(threadId, email);
        },
        [client, threadId],
    );

    return { members, isLoading, inviteMember };
}
