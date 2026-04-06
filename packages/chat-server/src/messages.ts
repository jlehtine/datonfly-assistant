import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";

import type { ContentPart, ThreadMessage } from "@datonfly-assistant/core";

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Extract the concatenated text from an array of content parts, ignoring tool calls and results. */
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

/**
 * Convert an array of persisted {@link ThreadMessage} objects to LangChain
 * {@link BaseMessage} instances suitable for agent invocation.
 *
 * Inserts a timestamp system message whenever more than one hour has elapsed
 * between consecutive messages.
 */
export function threadMessagesToBaseMessages(messages: ThreadMessage[]): BaseMessage[] {
    const result: BaseMessage[] = [];
    let lastTimestamp: Date | null = null;

    for (const msg of messages) {
        const messageTimestamp = msg.createdAt;
        let needsTimestamp = false;
        if (lastTimestamp === null || messageTimestamp.getTime() - lastTimestamp.getTime() >= ONE_HOUR_MS) {
            needsTimestamp = true;
            lastTimestamp = messageTimestamp;
        }
        const text = extractText(msg.content);
        switch (msg.role) {
            case "user": {
                const body = needsTimestamp ? `@ ${formatTimestamp(messageTimestamp)}\n\n${text}` : text;
                result.push(new HumanMessage(body));
                break;
            }
            case "assistant":
                result.push(new AIMessage(text));
                break;
            case "system":
                result.push(new SystemMessage(text));
                break;
        }
    }

    return result;
}
