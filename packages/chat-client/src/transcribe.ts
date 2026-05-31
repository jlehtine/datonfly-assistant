import { TRANSCRIBE_PATH, transcriptionResponseSchema } from "@datonfly-assistant/core";

import type { ChatClient } from "./client.js";
import { typedFetch } from "./fetch.js";

/**
 * Transcribe recorded audio to text via the server transcription endpoint.
 *
 * The audio is uploaded as multipart form data and is never persisted by the
 * server; only the returned transcript is. Callers typically send the returned
 * text as a normal chat message.
 *
 * @param client - The chat client providing `basePath`.
 * @param audio - The recorded audio blob.
 * @param fileName - File name for the upload (extension hints the audio format).
 * @param signal - Optional abort signal for cancellation.
 * @returns The transcribed text.
 */
export async function transcribeAudio(
    client: ChatClient,
    audio: Blob,
    fileName = "recording.webm",
    signal?: AbortSignal,
): Promise<string> {
    const formData = new FormData();
    formData.append("audio", audio, fileName);

    const response = await typedFetch(client, TRANSCRIBE_PATH, transcriptionResponseSchema, {
        method: "POST",
        body: formData,
        ...(signal ? { signal } : {}),
    });

    return response.text;
}
