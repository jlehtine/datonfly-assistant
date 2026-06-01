/**
 * Shared attachment classification, limits, and metadata types.
 *
 * These helpers form the single source of truth for which uploaded files are
 * accepted as model context input and how each file maps onto an AI model
 * content block (image / document / text). They are consumed by the upload
 * endpoint (validation), the client (early validation + UI), and the agent
 * provider (content-block conversion).
 */

/**
 * How an accepted attachment maps onto AI-model content.
 *
 * - `image` — sent to the model as an image block.
 * - `pdf` — sent to the model as a document block.
 * - `text` — decoded as UTF-8 text and sent as a labeled text block.
 * - `unsupported` — the model cannot read the bytes; rejected at upload time.
 */
export type AttachmentKind = "image" | "pdf" | "text" | "unsupported";

/** Descriptive metadata for a stored attachment, as returned by the upload endpoint. */
export interface AttachmentInfo {
    /** Stored attachment ID. */
    id: string;
    /** Original file name. */
    name: string;
    /** MIME type of the attachment. */
    mimeType: string;
    /** Size of the attachment in bytes. */
    size: number;
}

/** Limits applied to context-input attachments, advertised to clients via the welcome event. */
export interface AttachmentLimits {
    /** Maximum accepted size of a single attachment, in bytes. */
    maxFileBytes: number;
    /** Maximum number of attachments allowed on a single message. */
    maxPerMessage: number;
}

/** Default attachment limits enforced by the server and advertised to clients. */
export const ATTACHMENT_LIMITS: AttachmentLimits = {
    maxFileBytes: 20 * 1024 * 1024,
    maxPerMessage: 10,
};

/** Image MIME types natively understood by the model as image blocks. */
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Application MIME types that are text-based despite not using the `text/` prefix. */
const TEXT_APPLICATION_MIME_TYPES = new Set([
    "application/json",
    "application/xml",
    "application/javascript",
    "application/typescript",
    "application/x-typescript",
    "application/ecmascript",
    "application/x-yaml",
    "application/yaml",
    "application/x-sh",
    "application/x-httpd-php",
    "application/csv",
    "application/markdown",
    "application/x-ndjson",
]);

/** Strip parameters (e.g. `; charset=utf-8`) and normalize a MIME type to lower case. */
export function normalizeMimeType(mimeType: string): string {
    return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

/** Whether a MIME type denotes UTF-8-decodable text content. */
function isTextMimeType(mimeType: string): boolean {
    const mt = normalizeMimeType(mimeType);
    if (mt.startsWith("text/")) return true;
    if (TEXT_APPLICATION_MIME_TYPES.has(mt)) return true;
    // Structured-syntax suffixes such as application/ld+json.
    return mt.endsWith("+json") || mt.endsWith("+xml") || mt.endsWith("+yaml");
}

/**
 * Classify an attachment by MIME type alone.
 *
 * Returns `unsupported` for types the model cannot read directly. Callers may
 * still treat an `unsupported` upload as `text` when its bytes decode as valid
 * UTF-8 (see {@link isValidUtf8}).
 */
export function classifyAttachmentMimeType(mimeType: string): AttachmentKind {
    const mt = normalizeMimeType(mimeType);
    if (IMAGE_MIME_TYPES.has(mt)) return "image";
    if (mt === "application/pdf") return "pdf";
    if (isTextMimeType(mt)) return "text";
    return "unsupported";
}

/** Whether the model can read an attachment of the given MIME type (image, PDF, or text). */
export function isModelReadableMimeType(mimeType: string): boolean {
    return classifyAttachmentMimeType(mimeType) !== "unsupported";
}

/** Whether the given bytes are valid UTF-8 (used to accept text files with generic MIME types). */
export function isValidUtf8(bytes: Uint8Array): boolean {
    let i = 0;
    const len = bytes.length;
    while (i < len) {
        const byte = bytes[i] ?? 0;
        if (byte <= 0x7f) {
            i += 1;
            continue;
        }
        let extraBytes: number;
        let codePoint: number;
        let lowerBound: number;
        if (byte >= 0xc2 && byte <= 0xdf) {
            extraBytes = 1;
            codePoint = byte & 0x1f;
            lowerBound = 0x80;
        } else if (byte >= 0xe0 && byte <= 0xef) {
            extraBytes = 2;
            codePoint = byte & 0x0f;
            lowerBound = 0x800;
        } else if (byte >= 0xf0 && byte <= 0xf4) {
            extraBytes = 3;
            codePoint = byte & 0x07;
            lowerBound = 0x10000;
        } else {
            return false;
        }
        if (i + extraBytes >= len) {
            return false;
        }
        for (let j = 1; j <= extraBytes; j += 1) {
            const cont = bytes[i + j] ?? 0;
            if ((cont & 0xc0) !== 0x80) {
                return false;
            }
            codePoint = (codePoint << 6) | (cont & 0x3f);
        }
        if (codePoint < lowerBound || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
            return false;
        }
        i += extraBytes + 1;
    }
    return true;
}
