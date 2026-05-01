import type { AgentMessage, ContentPart, ThreadMemberInfo, ThreadMessage } from "@datonfly-assistant/core";

/** Default alias used when a member has not configured an agent alias. */
const DEFAULT_ALIAS = "Unidentified user";

/** Extract the concatenated text from an array of content parts, ignoring tool calls, results, and opaque parts. */
export function extractText(content: ContentPart[]): string {
    return content
        .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}

function formatTimestamp(date: Date): string {
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absOffset / 60);
    const offsetMins = absOffset % 60;
    return (
        `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}` +
        `${sign}${pad(offsetHours)}:${pad(offsetMins)}`
    );
}

/** Build a `Map<authorId, alias>` from a list of thread members. */
export function buildAuthorAliases(members: ThreadMemberInfo[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const m of members) {
        map.set(m.userId, m.agentAlias ?? DEFAULT_ALIAS);
    }
    return map;
}

/**
 * Build the system prompt prepended to every agent invocation.
 *
 * Single-user threads get a personal assistant prompt; multi-user threads
 * get a group conversation prompt with participant aliases and engagement
 * guidelines.
 */
export function buildSystemPrompt(authorAliases: Map<string, string>): AgentMessage {
    if (authorAliases.size <= 1) {
        return {
            role: "system",
            content: [
                {
                    type: "text",
                    text:
                        "You are a personal AI assistant in a one-on-one conversation. Each of the user's " +
                        "messages includes a header line with their name and timestamp, for example:\n\n" +
                        "[Alice] @ 2026-04-10T14:30+02:00\n\n" +
                        "How do I fix this bug?\n\n" +
                        "Use the timestamp to understand when messages were sent relative to each other.",
                },
            ],
        };
    }

    const participantList = [...authorAliases.values()].join(", ");
    return {
        role: "system",
        content: [
            {
                type: "text",
                text:
                    "You are an AI assistant participating in a group conversation with multiple " +
                    "users. Each human message includes a header line with the sender's name and " +
                    "timestamp, for example:\n\n" +
                    "[Alice] @ 2026-04-10T14:30+02:00\n\n" +
                    "Can you explain how this works?\n\n" +
                    `Current participants: ${participantList}\n\n` +
                    "Guidelines:\n" +
                    '- Respond when directly addressed by name or by a general reference to "the assistant" / "AI"\n' +
                    "- Respond when asked a question that no specific human is addressed to answer\n" +
                    "- Respond when you can add meaningful value (e.g. factual information, analysis, code help)\n" +
                    "- Do NOT respond when users are clearly talking to each other about personal/social matters\n" +
                    "- Do NOT respond to every message — only when your input is relevant\n" +
                    "- When responding, you may reference what specific users said by name",
            },
        ],
    };
}

/**
 * Convert an array of persisted {@link ThreadMessage} objects to
 * {@link AgentMessage} instances suitable for agent invocation.
 *
 * Every human message is prefixed with a header line containing the sender's
 * alias and timestamp: `[alias] @ timestamp`. A system prompt is prepended
 * describing the conversation context.
 *
 * @param messages - Persisted thread messages in chronological order.
 * @param authorAliases - Map from author user ID to display alias.
 */
export function threadMessagesToAgentMessages(
    messages: ThreadMessage[],
    authorAliases: Map<string, string>,
): AgentMessage[] {
    const result: AgentMessage[] = [buildSystemPrompt(authorAliases)];

    for (const [i, msg] of messages.entries()) {
        // Skip messages that have been compacted (replaced by a summary).
        if (msg.metadata?.compacted === true) continue;

        // Compaction summaries are inserted as human messages so they don't
        // violate the single-system-message constraint. content_at places
        // them before preserved messages, right after the system prompt.
        if (msg.metadata?.compactionSummary === true) {
            const text = extractText(msg.content);
            result.push({
                role: "human",
                content: [{ type: "text", text: `[Summary of previous conversation]\n\n${text}` }],
            });
            continue;
        }

        const text = extractText(msg.content);
        switch (msg.role) {
            case "human": {
                const alias = (msg.authorId && authorAliases.get(msg.authorId)) ?? DEFAULT_ALIAS;
                const header = `[${alias}] @ ${formatTimestamp(msg.createdAt)}`;
                result.push({ role: "human", content: [{ type: "text", text: `${header}\n\n${text}` }] });
                break;
            }
            case "ai": {
                let parts: ContentPart[] = [...msg.content];
                const hasThinkingPart = parts.some((part) => part.type === "thinking");
                if (msg.metadata?.interrupted === true && !hasThinkingPart) {
                    const next = messages[i + 1];
                    const byAlias =
                        next?.role === "human" && next.authorId
                            ? (authorAliases.get(next.authorId) ?? DEFAULT_ALIAS)
                            : undefined;
                    const tag = byAlias ? `[interrupted by ${byAlias}]` : "[interrupted]";
                    // Append the interrupted tag to the last text part, or add a new text part.
                    let lastTextIdx = -1;
                    for (let j = parts.length - 1; j >= 0; j--) {
                        if (parts[j]?.type === "text") {
                            lastTextIdx = j;
                            break;
                        }
                    }
                    if (lastTextIdx >= 0) {
                        const lastText = parts[lastTextIdx] as Extract<ContentPart, { type: "text" }>;
                        parts = [
                            ...parts.slice(0, lastTextIdx),
                            { type: "text", text: `${lastText.text}\n\n${tag}` },
                            ...parts.slice(lastTextIdx + 1),
                        ];
                    } else {
                        parts = [...parts, { type: "text", text: tag }];
                    }
                }
                result.push({ role: "ai", content: parts });
                break;
            }
        }
    }

    return result;
}
