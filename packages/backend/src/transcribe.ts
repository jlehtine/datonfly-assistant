import OpenAI, { toFile } from "openai";

import type { TranscribeFn } from "@datonfly-assistant/chat-server";

/** Options for {@link createOpenAITranscribeFn}. */
export interface OpenAITranscribeOptions {
    /** OpenAI API key. */
    apiKey: string;
    /** Transcription model name (e.g. `gpt-4o-mini-transcribe`). */
    model: string;
}

/**
 * Build a {@link TranscribeFn} backed by the OpenAI audio transcription API.
 *
 * Language is auto-detected (no `language` or `prompt` parameters). The audio
 * buffer is sent directly to OpenAI and is never persisted.
 */
export function createOpenAITranscribeFn({ apiKey, model }: OpenAITranscribeOptions): TranscribeFn {
    const client = new OpenAI({ apiKey });
    return async (audio: Buffer, mimeType: string, fileName: string): Promise<string> => {
        const file = await toFile(audio, fileName, { type: mimeType });
        const result = await client.audio.transcriptions.create({ file, model });
        return result.text;
    };
}
