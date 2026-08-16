/**
 * Pacing for replayed fixtures.
 *
 * A fixture recorded with {@link RecordedExchange.response.frames} replays with
 * its own real timing. One without them (every fixture committed so far, since
 * `recording-proxy.ts` only started capturing timing after this module existed)
 * is paced by the synthesized model below instead, grounded in a handful of
 * observational captures against the deployment's own model (`claude-opus-5`)
 * via `pnpm --filter @datonfly-assistant/agent-anthropic experiment:timing`.
 * Re-run that experiment and adjust the constants below if the deployment's
 * model changes or the numbers drift — this is a small, order-of-magnitude
 * model from a couple of runs, not a statistically rigorous one.
 */

/** One paced write: the raw text to send, and how long to wait before sending it. */
export interface TimedFrame {
    text: string;
    delayMs: number;
}

/** A fixture response shape carrying its own recorded timing, if any. */
export interface TimedResponse {
    body: string;
    frames?: { atMs: number; text: string }[] | undefined;
}

/** Split an SSE body into one chunk per `event: ...\ndata: ...\n\n` block. */
export function splitSseEvents(body: string): string[] {
    const events: string[] = [];
    let rest = body;
    while (rest.length > 0) {
        const boundary = rest.indexOf("\n\n");
        if (boundary === -1) {
            events.push(rest);
            break;
        }
        events.push(rest.slice(0, boundary + 2));
        rest = rest.slice(boundary + 2);
    }
    return events.filter((event) => event.length > 0);
}

/**
 * A small model of typical streaming pacing, by SSE event kind, grounded in
 * `experiment:timing` captures against `claude-opus-5`:
 *
 * - Time to first byte (`message_start`) was ~800-1000ms, not the tens of
 *   milliseconds a co-located mock server would suggest.
 * - Opus-class generation streams answer text in chunks roughly 600-800ms
 *   apart — genuinely slower per chunk than a smaller/faster model, not a
 *   measurement artefact (confirmed against raw per-chunk timestamps).
 * - A thinking block's own reasoning happens silently before anything is
 *   visible: a long pause preceded the first `thinking_delta` (~2s observed),
 *   after which the visible summary arrived in a fast burst (~10-20ms between
 *   deltas). The two phases need different constants; folding them into one
 *   "thinking is slower" number (the original placeholder's assumption) would
 *   get both phases wrong.
 */
function syntheticDelayMs(eventChunk: string): number {
    if (eventChunk.startsWith("event: message_start")) return 700 + Math.random() * 400;
    if (eventChunk.startsWith("event: content_block_start")) {
        const thinking = eventChunk.includes('"type":"thinking"');
        return thinking ? 1200 + Math.random() * 800 : 50 + Math.random() * 100;
    }
    if (eventChunk.startsWith("event: content_block_delta")) {
        if (eventChunk.includes("thinking_delta")) return 10 + Math.random() * 15;
        return 500 + Math.random() * 350;
    }
    if (eventChunk.startsWith("event: ping")) return 5;
    return 5 + Math.random() * 10;
}

/** Build the paced frames for a fixture response, recorded or synthesized. */
export function buildFrames(response: TimedResponse): TimedFrame[] {
    if (response.frames && response.frames.length > 0) {
        let previousAtMs = 0;
        return response.frames.map((frame) => {
            const delayMs = Math.max(0, frame.atMs - previousAtMs);
            previousAtMs = frame.atMs;
            return { text: frame.text, delayMs };
        });
    }
    return splitSseEvents(response.body).map((text) => ({ text, delayMs: syntheticDelayMs(text) }));
}
