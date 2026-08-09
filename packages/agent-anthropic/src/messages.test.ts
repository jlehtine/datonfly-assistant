import { describe, expect, it } from "vitest";

import type { AgentMessage, ContentPart, OpaqueContentPart } from "@datonfly-assistant/core";

import {
    agentMessagesToParams,
    compactionBlockToOpaquePart,
    isCompactionPart,
    trimBeforeCompaction,
} from "./messages.js";

const COMPACTION_PART: OpaqueContentPart = {
    type: "opaque",
    provider: "anthropic",
    data: { type: "compaction", content: "earlier conversation summary" },
};

/**
 * Opaque part shape found in live data, written by an earlier design that
 * persisted signed thinking blocks for verbatim replay. Threads containing it
 * still load, so it has to survive the mapping without being mistaken for
 * compaction.
 */
const LEGACY_THINKING_OPAQUE_PART: OpaqueContentPart = {
    type: "opaque",
    provider: "anthropic",
    data: {
        type: "thinking",
        index: 0,
        thinking: " The user is asking me to use extended thinking.",
        signature: "EoQCClkIDRgCKkBlorqWS+gRHZD1zc7uEeWg8a9uRaof3xoovuecUzooQNkq",
    },
};

describe("agentMessagesToParams", () => {
    it("maps an image attachment to an image block", () => {
        const messages: AgentMessage[] = [
            {
                role: "human",
                content: [
                    { type: "text", text: "What is this?" },
                    {
                        type: "attachment",
                        attachmentId: "a1",
                        name: "photo.png",
                        mimeType: "image/png",
                        size: 3,
                        data: "aGk=",
                    },
                ],
            },
        ];

        const { messages: turns } = agentMessagesToParams(messages);
        expect(turns[0]?.content).toEqual([
            { type: "text", text: "What is this?" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "aGk=" } },
        ]);
    });

    it("maps a PDF attachment to a document block", () => {
        const messages: AgentMessage[] = [
            {
                role: "human",
                content: [
                    { type: "text", text: "Summarise." },
                    {
                        type: "attachment",
                        attachmentId: "a2",
                        name: "doc.pdf",
                        mimeType: "application/pdf",
                        size: 3,
                        data: "aGk=",
                    },
                ],
            },
        ];

        const blocks = agentMessagesToParams(messages).messages[0]?.content as { type: string }[];
        expect(blocks[1]).toEqual({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: "aGk=" },
        });
    });

    it("inlines a text attachment as a labelled text block", () => {
        const messages: AgentMessage[] = [
            {
                role: "human",
                content: [
                    { type: "text", text: "Review." },
                    {
                        type: "attachment",
                        attachmentId: "a3",
                        name: "notes.txt",
                        mimeType: "text/plain",
                        size: 5,
                        data: Buffer.from("hello").toString("base64"),
                    },
                ],
            },
        ];

        const blocks = agentMessagesToParams(messages).messages[0]?.content as { type: string; text: string }[];
        expect(blocks[1]).toEqual({ type: "text", text: "[Attachment: notes.txt]\n\nhello" });
    });

    it("skips attachments whose bytes were never resolved", () => {
        const messages: AgentMessage[] = [
            {
                role: "human",
                content: [
                    { type: "text", text: "Hi." },
                    { type: "attachment", attachmentId: "a4", name: "x.png", mimeType: "image/png", size: 1 },
                ],
            },
        ];

        expect(agentMessagesToParams(messages).messages[0]?.content).toEqual([{ type: "text", text: "Hi." }]);
    });

    it("turns tool results into the user turn that answers the assistant", () => {
        const messages: AgentMessage[] = [
            { role: "human", content: [{ type: "text", text: "Add 2 and 3." }] },
            {
                role: "ai",
                content: [
                    { type: "tool-call", toolCallId: "t1", toolName: "adder", args: { a: 2, b: 3 } },
                    { type: "tool-result", toolCallId: "t1", toolName: "adder", result: "5" },
                ],
            },
        ];

        const { messages: turns } = agentMessagesToParams(messages);
        expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
        expect(turns[1]?.content).toEqual([{ type: "tool_use", id: "t1", name: "adder", input: { a: 2, b: 3 } }]);
        expect(turns[2]?.content).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "5" }]);
    });

    it("marks failed tool results as errors", () => {
        const messages: AgentMessage[] = [
            {
                role: "ai",
                content: [
                    { type: "tool-call", toolCallId: "t1", toolName: "adder", args: {} },
                    { type: "tool-result", toolCallId: "t1", toolName: "adder", result: "boom", isError: true },
                ],
            },
        ];

        const turns = agentMessagesToParams(messages).messages;
        expect(turns[1]?.content).toEqual([
            { type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true },
        ]);
    });

    it("round-trips a persisted compaction block", () => {
        const messages: AgentMessage[] = [{ role: "ai", content: [COMPACTION_PART] }];

        const turns = agentMessagesToParams(messages).messages;
        expect(turns[0]?.content).toEqual([{ type: "compaction", content: "earlier conversation summary" }]);
        expect(compactionBlockToOpaquePart({ type: "compaction", content: "earlier conversation summary" })).toEqual(
            COMPACTION_PART,
        );
    });

    it("does not replay persisted thinking parts", () => {
        const messages: AgentMessage[] = [
            {
                role: "ai",
                content: [
                    { type: "thinking", text: "internal reasoning" },
                    { type: "text", text: "The answer." },
                ],
            },
        ];

        expect(agentMessagesToParams(messages).messages[0]?.content).toEqual([{ type: "text", text: "The answer." }]);
    });

    it("drops empty text so the API does not reject the turn", () => {
        const messages: AgentMessage[] = [
            { role: "human", content: [{ type: "text", text: "" }] },
            { role: "ai", content: [{ type: "text", text: "" }] },
        ];

        expect(agentMessagesToParams(messages).messages).toEqual([]);
    });
});

describe("content part round-trip", () => {
    it("preserves every persisted part variant through the request mapping", () => {
        const parts: ContentPart[] = [
            { type: "text", text: "answer" },
            { type: "tool-call", toolCallId: "t1", toolName: "adder", args: { a: 1 } },
            { type: "tool-result", toolCallId: "t1", toolName: "adder", result: "1" },
            COMPACTION_PART,
        ];

        const { messages: turns } = agentMessagesToParams([{ role: "ai", content: parts }]);
        const assistant = turns[0]?.content as { type: string }[];
        const user = turns[1]?.content as { type: string }[];

        expect(assistant.map((block) => block.type)).toEqual(["text", "tool_use", "compaction"]);
        expect(user.map((block) => block.type)).toEqual(["tool_result"]);
    });
});

describe("isCompactionPart", () => {
    it("accepts this provider's compaction encoding", () => {
        expect(isCompactionPart(COMPACTION_PART)).toBe(true);
    });

    it("rejects opaque parts from another provider or shape", () => {
        expect(isCompactionPart({ type: "opaque", provider: "openai", data: COMPACTION_PART.data })).toBe(false);
        expect(isCompactionPart({ type: "opaque", provider: "anthropic", data: { type: "other" } })).toBe(false);
        expect(isCompactionPart({ type: "opaque", provider: "anthropic", data: null })).toBe(false);
    });

    it("rejects the legacy signed-thinking opaque part found in live data", () => {
        expect(isCompactionPart(LEGACY_THINKING_OPAQUE_PART)).toBe(false);
    });
});

describe("legacy persisted data", () => {
    it("drops legacy signed-thinking opaque parts from the request", () => {
        const messages: AgentMessage[] = [
            { role: "human", content: [{ type: "text", text: "Explain." }] },
            { role: "ai", content: [LEGACY_THINKING_OPAQUE_PART, { type: "text", text: "The answer." }] },
            { role: "human", content: [{ type: "text", text: "Go on." }] },
        ];

        const { messages: turns } = agentMessagesToParams(messages);
        expect(turns.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
        expect(turns[1]?.content).toEqual([{ type: "text", text: "The answer." }]);
    });

    it("does not treat a legacy opaque part as a compaction boundary", () => {
        const messages: AgentMessage[] = [
            { role: "human", content: [{ type: "text", text: "old" }] },
            { role: "ai", content: [LEGACY_THINKING_OPAQUE_PART] },
            { role: "human", content: [{ type: "text", text: "new" }] },
        ];

        expect(trimBeforeCompaction(messages)).toBe(messages);
    });
});

describe("trimBeforeCompaction", () => {
    it("drops messages preceding the latest compaction block but keeps system messages", () => {
        const messages: AgentMessage[] = [
            { role: "system", content: [{ type: "text", text: "Be terse." }] },
            { role: "human", content: [{ type: "text", text: "old" }] },
            { role: "ai", content: [COMPACTION_PART] },
            { role: "human", content: [{ type: "text", text: "new" }] },
        ];

        const trimmed = trimBeforeCompaction(messages);
        expect(trimmed).toHaveLength(3);
        expect(trimmed[0]?.role).toBe("system");
        expect(trimmed[1]?.content[0]).toEqual(COMPACTION_PART);
    });

    it("leaves a conversation without compaction untouched", () => {
        const messages: AgentMessage[] = [{ role: "human", content: [{ type: "text", text: "hi" }] }];
        expect(trimBeforeCompaction(messages)).toBe(messages);
    });
});
