import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { readGeneratedFileChunks } from "./stream.js";

/** Build a minimal completed assistant message carrying only the given content blocks. */
function messageOf(content: unknown[]): Anthropic.Beta.BetaMessage {
    return { content } as unknown as Anthropic.Beta.BetaMessage;
}

describe("readGeneratedFileChunks", () => {
    it("extracts a file ID from a bash result that copied a file into $OUTPUT_DIR", () => {
        const message = messageOf([
            {
                type: "bash_code_execution_tool_result",
                tool_use_id: "srvtoolu_1",
                content: {
                    type: "bash_code_execution_result",
                    stdout: "",
                    stderr: "",
                    return_code: 0,
                    content: [{ type: "bash_code_execution_output", file_id: "file_abc" }],
                },
            },
        ]);

        expect(readGeneratedFileChunks(message)).toEqual([{ type: "generated-file", fileRef: "file_abc" }]);
    });

    it("returns nothing for a bash result with no exported files", () => {
        const message = messageOf([
            {
                type: "bash_code_execution_tool_result",
                tool_use_id: "srvtoolu_1",
                content: {
                    type: "bash_code_execution_result",
                    stdout: "",
                    stderr: "",
                    return_code: 0,
                    content: [],
                },
            },
        ]);

        expect(readGeneratedFileChunks(message)).toEqual([]);
    });

    it("returns nothing for an error result block", () => {
        const message = messageOf([
            {
                type: "bash_code_execution_tool_result",
                tool_use_id: "srvtoolu_1",
                content: {
                    type: "bash_code_execution_tool_result_error",
                    error_code: "unavailable",
                },
            },
        ]);

        expect(readGeneratedFileChunks(message)).toEqual([]);
    });

    it("ignores unrelated block types, e.g. text and text-editor results", () => {
        const message = messageOf([
            { type: "text", text: "here you go" },
            {
                type: "text_editor_code_execution_tool_result",
                tool_use_id: "srvtoolu_2",
                content: { type: "text_editor_code_execution_create_result", is_file_update: false },
            },
        ]);

        expect(readGeneratedFileChunks(message)).toEqual([]);
    });

    it("deduplicates repeated file IDs across multiple bash results", () => {
        const message = messageOf([
            {
                type: "bash_code_execution_tool_result",
                tool_use_id: "srvtoolu_1",
                content: {
                    type: "bash_code_execution_result",
                    stdout: "",
                    stderr: "",
                    return_code: 0,
                    content: [{ type: "bash_code_execution_output", file_id: "file_dup" }],
                },
            },
            {
                type: "bash_code_execution_tool_result",
                tool_use_id: "srvtoolu_2",
                content: {
                    type: "bash_code_execution_result",
                    stdout: "",
                    stderr: "",
                    return_code: 0,
                    content: [{ type: "bash_code_execution_output", file_id: "file_dup" }],
                },
            },
        ]);

        // readGeneratedFileChunks itself does not dedupe across separate blocks
        // (that happens once per turn, across the whole stream) — both are
        // reported here, and higher-level dedup collapses them.
        expect(readGeneratedFileChunks(message)).toEqual([
            { type: "generated-file", fileRef: "file_dup" },
            { type: "generated-file", fileRef: "file_dup" },
        ]);
    });

    it("ignores malformed content that isn't a well-formed result object", () => {
        const message = messageOf([
            {
                type: "bash_code_execution_tool_result",
                tool_use_id: "srvtoolu_1",
                content: "unexpected string content",
            },
        ]);

        expect(readGeneratedFileChunks(message)).toEqual([]);
    });
});
