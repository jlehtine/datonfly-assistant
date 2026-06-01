import {
    attachmentInfoSchema,
    attachmentPath,
    ATTACHMENTS_PATH,
    type AttachmentInfoWire,
} from "@datonfly-assistant/core";

import type { ChatClient } from "./client.js";
import { typedFetch } from "./fetch.js";

/**
 * Upload a file as a context-input attachment.
 *
 * The file is uploaded as multipart form data. The server validates the MIME
 * type and size, stores the bytes, and returns the attachment metadata. The
 * returned reference is later sent with a chat message via
 * {@link ChatClient.sendMessage}.
 *
 * @param client - The chat client providing `basePath`.
 * @param file - The file to upload.
 * @param signal - Optional abort signal for cancellation.
 * @returns Metadata for the stored attachment.
 */
export async function uploadAttachment(
    client: ChatClient,
    file: File,
    signal?: AbortSignal,
): Promise<AttachmentInfoWire> {
    const formData = new FormData();
    formData.append("file", file, file.name);

    return typedFetch(client, ATTACHMENTS_PATH, attachmentInfoSchema, {
        method: "POST",
        body: formData,
        ...(signal ? { signal } : {}),
    });
}

/**
 * Delete an uploaded attachment that has not yet been sent with a message.
 *
 * Only the uploader may delete, and only while the attachment is unassociated.
 *
 * @param client - The chat client providing `basePath`.
 * @param id - The attachment ID to delete.
 */
export async function deleteAttachment(client: ChatClient, id: string): Promise<void> {
    await typedFetch(client, attachmentPath(id), null, { method: "DELETE" });
}

/**
 * Build the absolute download URL for an attachment.
 *
 * @param client - The chat client providing `basePath`.
 * @param id - The attachment ID.
 * @returns The URL from which the attachment can be downloaded.
 */
export function attachmentDownloadUrl(client: ChatClient, id: string): string {
    return client.basePath + attachmentPath(id);
}
