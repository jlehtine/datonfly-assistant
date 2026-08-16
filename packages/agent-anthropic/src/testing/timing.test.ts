import { describe, expect, it } from "vitest";

import { buildFrames } from "./timing.js";

const SSE_BODY =
    'event: message_start\ndata: {"type":"message_start"}\n\n' +
    'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n' +
    'event: message_stop\ndata: {"type":"message_stop"}\n\n';

describe("buildFrames", () => {
    it("replays recorded frames using the gaps between their timestamps", () => {
        const frames = buildFrames({
            body: SSE_BODY,
            frames: [
                { atMs: 100, text: "a" },
                { atMs: 150, text: "b" },
                { atMs: 400, text: "c" },
            ],
        });
        expect(frames.map((f) => f.text)).toEqual(["a", "b", "c"]);
        expect(frames.map((f) => f.delayMs)).toEqual([100, 50, 250]);
    });

    it("synthesizes one frame per SSE event when no recording exists", () => {
        const frames = buildFrames({ body: SSE_BODY });
        expect(frames).toHaveLength(3);
        expect(frames[0]?.text.startsWith("event: message_start")).toBe(true);
        expect(frames[1]?.text.startsWith("event: content_block_delta")).toBe(true);
        expect(frames[2]?.text.startsWith("event: message_stop")).toBe(true);
        for (const frame of frames) {
            expect(frame.delayMs).toBeGreaterThanOrEqual(0);
        }
    });
});
