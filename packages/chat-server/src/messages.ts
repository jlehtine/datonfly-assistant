import type {
    AgentMessage,
    ContentPart,
    IPersistenceProvider,
    ThreadMemberInfo,
    ThreadMessage,
} from "@datonfly-assistant/core";

/**
 * Alias used for a member who has not configured one.
 *
 * Members are anonymous to the agent by default: real names are never sent, so
 * an unaliased member is deliberately indistinguishable rather than falling back
 * to their display name.
 */
const DEFAULT_ALIAS = "Unidentified user";

/**
 * Extract the concatenated text from an array of content parts, ignoring tool
 * calls, results, and opaque parts.
 *
 * Joined with a blank line: a single AI message routinely carries several text
 * parts now (one per run before/after a tool call or thinking block — see
 * `stream.ts`), so a plain `\n` would run unrelated paragraphs together.
 */
export function extractText(content: ContentPart[]): string {
    return content
        .filter((part): part is Extract<ContentPart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n\n");
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
 * Guidance confirming the platform's own `$OUTPUT_DIR` convention for
 * delivering files, rather than inventing one. The model already follows this
 * unprompted; this just keeps it honest about what actually got exported.
 */
const GENERATED_FILES_GUIDANCE =
    "If you use code execution to create a file for the user, copy it into $OUTPUT_DIR — only files placed " +
    "there become downloadable attachments on your message; anything else stays in the sandbox. Never claim " +
    "to have saved or attached a file you didn't export this way.";

/**
 * Build the system prompt prepended to every agent invocation.
 *
 * Single-user threads get a personal assistant prompt; multi-user threads
 * get a group conversation prompt with participant aliases and engagement
 * guidelines.
 *
 * @param generatedFilesEnabled - Whether to append {@link GENERATED_FILES_GUIDANCE}.
 *   Omit the guidance entirely when the feature is off, so a deployment
 *   without it never advertises the capability.
 */
export function buildSystemPrompt(authorAliases: Map<string, string>, generatedFilesEnabled = false): AgentMessage {
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
                        "Use the timestamp to understand when messages were sent relative to each other." +
                        (generatedFilesEnabled ? `\n\n${GENERATED_FILES_GUIDANCE}` : ""),
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
                    "- When responding, you may reference what specific users said by name" +
                    (generatedFilesEnabled ? `\n\n${GENERATED_FILES_GUIDANCE}` : ""),
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
 * @param generatedFilesEnabled - Forwarded to {@link buildSystemPrompt}.
 */
export function threadMessagesToAgentMessages(
    messages: ThreadMessage[],
    authorAliases: Map<string, string>,
    generatedFilesEnabled = false,
): AgentMessage[] {
    const result: AgentMessage[] = [buildSystemPrompt(authorAliases, generatedFilesEnabled)];

    for (const [i, msg] of messages.entries()) {
        const text = extractText(msg.content);
        switch (msg.role) {
            case "human": {
                const alias = (msg.authorId && authorAliases.get(msg.authorId)) ?? DEFAULT_ALIAS;
                const header = `[${alias}] @ ${formatTimestamp(msg.createdAt)}`;
                const attachments = msg.content.filter(
                    (part): part is Extract<ContentPart, { type: "attachment" }> => part.type === "attachment",
                );
                result.push({
                    role: "human",
                    content: [{ type: "text", text: `${header}\n\n${text}` }, ...attachments],
                });
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
                result.push({ role: "ai", content: parts, replayData: msg.replayData });
                break;
            }
        }
    }

    return result;
}

/**
 * Resolve attachment bytes into the given agent messages in place.
 *
 * Loads the raw bytes for every `attachment` content part referenced in human
 * messages and sets the transient base64 `data` field so the agent can build
 * multimodal content blocks. This is invoked only on the agent-stream path —
 * never for title generation or compaction — so bytes are read lazily and kept
 * strictly server-side.
 *
 * @param messages - Agent messages to enrich (mutated in place).
 * @param persistence - Provider used to load attachment bytes.
 */
export async function resolveAttachmentData(
    messages: AgentMessage[],
    persistence: IPersistenceProvider,
): Promise<void> {
    for (const message of messages) {
        if (message.role !== "human") continue;
        for (const part of message.content) {
            if (part.type !== "attachment" || part.data !== undefined) continue;
            const data = await persistence.loadAttachmentData(part.attachmentId);
            if (data) {
                part.data = Buffer.from(data.bytes).toString("base64");
            }
        }
    }
}
