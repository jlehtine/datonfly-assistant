export type MessageRole = "user" | "assistant" | "system";

export interface TextContentPart {
    type: "text";
    text: string;
}

export interface ToolCallContentPart {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}

export interface ToolResultContentPart {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError?: boolean | undefined;
}

export type ContentPart = TextContentPart | ToolCallContentPart | ToolResultContentPart;

export interface ThreadMessage {
    id: string;
    threadId: string;
    role: MessageRole;
    content: ContentPart[];
    authorId: string | null;
    createdAt: Date;
    metadata?: Record<string, unknown> | undefined;
}
