import type Anthropic from "@anthropic-ai/sdk";

import {
    classifyAttachmentMimeType,
    type AgentMessage,
    type AttachmentContentPart,
    type OpaqueContentPart,
} from "@datonfly-assistant/core";

import { PROVIDER_ID } from "./config.js";

/** Payload carried by an Anthropic compaction opaque part. */
interface CompactionOpaqueData {
    type: "compaction";
    content: string;
}

/**
 * Whether an opaque part carries this provider's compaction block.
 *
 * The persisted encoding is `{ provider: "anthropic", data: { type: "compaction", content } }`
 * and must stay byte-compatible: live deployments hold threads recorded with it.
 */
export function isCompactionPart(part: OpaqueContentPart): part is OpaqueContentPart & { data: CompactionOpaqueData } {
    if (part.provider !== PROVIDER_ID) return false;
    const data: unknown = part.data;
    return (
        typeof data === "object" &&
        data !== null &&
        (data as { type?: unknown }).type === "compaction" &&
        typeof (data as { content?: unknown }).content === "string"
    );
}

/** Wrap a compaction block from the API as a persistable opaque part. */
export function compactionBlockToOpaquePart(block: Anthropic.Beta.BetaCompactionBlock): OpaqueContentPart {
    return {
        type: "opaque",
        provider: PROVIDER_ID,
        data: { type: "compaction", content: block.content ?? "" } satisfies CompactionOpaqueData,
    };
}

/**
 * Build an Anthropic content block for a resolved attachment part.
 *
 * Images map to `image` blocks, PDFs to `document` blocks, and everything else
 * is decoded as UTF-8 text and emitted as a labeled `text` block. Returns
 * `null` when the attachment has no resolved bytes (`data`) — e.g. on the
 * title-generation or compaction paths, where bytes are never loaded.
 */
export function attachmentToContentBlock(part: AttachmentContentPart): Anthropic.Beta.BetaContentBlockParam | null {
    if (part.data === undefined) return null;
    const kind = classifyAttachmentMimeType(part.mimeType);
    switch (kind) {
        case "image":
            return {
                type: "image",
                source: {
                    type: "base64",
                    media_type: part.mimeType as Anthropic.Beta.BetaBase64ImageSource["media_type"],
                    data: part.data,
                },
            };
        case "pdf":
            return {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: part.data },
            };
        default: {
            const text = Buffer.from(part.data, "base64").toString("utf-8");
            return { type: "text", text: `[Attachment: ${part.name}]\n\n${text}` };
        }
    }
}

/** The Anthropic request shape derived from a conversation. */
export interface ConversationParams {
    /** Hoisted system prompt blocks, or `undefined` when the conversation has none. */
    system: Anthropic.Beta.BetaTextBlockParam[] | undefined;
    /** Alternating user/assistant turns. */
    messages: Anthropic.Beta.BetaMessageParam[];
}

/** Drop content blocks the API rejects, such as empty text. */
function isNonEmptyBlock(block: Anthropic.Beta.BetaContentBlockParam): boolean {
    return block.type !== "text" || block.text.length > 0;
}

/**
 * Convert an assistant message's parts into request blocks.
 *
 * Thinking parts are deliberately not replayed here. Anthropic requires
 * `thinking` blocks in the latest assistant turn to be byte-identical to the
 * original response, including their signature, which a part reconstructed from
 * persistence cannot guarantee. Within a single tool-calling loop the exact
 * blocks are replayed from the live response instead (see `stream.ts`).
 */
function assistantBlocks(message: AgentMessage): Anthropic.Beta.BetaContentBlockParam[] {
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const part of message.content) {
        switch (part.type) {
            case "text":
                blocks.push({ type: "text", text: part.text });
                break;
            case "tool-call":
                blocks.push({ type: "tool_use", id: part.toolCallId, name: part.toolName, input: part.args });
                break;
            case "opaque":
                if (isCompactionPart(part)) {
                    blocks.push({ type: "compaction", content: part.data.content });
                }
                break;
            default:
                break;
        }
    }
    return blocks.filter(isNonEmptyBlock);
}

/** Convert an assistant message's tool results into the user turn that answers it. */
function toolResultBlocks(message: AgentMessage): Anthropic.Beta.BetaContentBlockParam[] {
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const part of message.content) {
        if (part.type !== "tool-result") continue;
        blocks.push({
            type: "tool_result",
            tool_use_id: part.toolCallId,
            content: typeof part.result === "string" ? part.result : JSON.stringify(part.result),
            ...(part.isError === true ? { is_error: true } : {}),
        });
    }
    return blocks;
}

/** Convert a human message's parts into request blocks. */
function humanBlocks(message: AgentMessage): Anthropic.Beta.BetaContentBlockParam[] {
    const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
    const attachments = message.content
        .filter((part): part is AttachmentContentPart => part.type === "attachment")
        .map(attachmentToContentBlock)
        .filter((block): block is Anthropic.Beta.BetaContentBlockParam => block !== null);
    return [{ type: "text", text } as Anthropic.Beta.BetaContentBlockParam, ...attachments].filter(isNonEmptyBlock);
}

/**
 * Merge consecutive turns of the same role.
 *
 * The Messages API requires user and assistant turns to alternate, but a
 * multi-user thread routinely produces several consecutive human messages.
 */
function mergeAdjacentRoles(messages: Anthropic.Beta.BetaMessageParam[]): Anthropic.Beta.BetaMessageParam[] {
    const merged: Anthropic.Beta.BetaMessageParam[] = [];
    for (const message of messages) {
        const previous = merged[merged.length - 1];
        if (previous?.role === message.role) {
            previous.content = [
                ...(previous.content as Anthropic.Beta.BetaContentBlockParam[]),
                ...(message.content as Anthropic.Beta.BetaContentBlockParam[]),
            ];
            continue;
        }
        merged.push(message);
    }
    return merged;
}

/**
 * Convert framework-agnostic {@link AgentMessage} instances into Anthropic
 * request parameters.
 *
 * System messages are hoisted into the top-level `system` parameter, since the
 * Messages API has no system role. Tool results recorded on an assistant
 * message become the user turn that answers it, matching the wire protocol.
 */
export function agentMessagesToParams(messages: AgentMessage[]): ConversationParams {
    const systemTexts: string[] = [];
    const turns: Anthropic.Beta.BetaMessageParam[] = [];

    for (const message of messages) {
        switch (message.role) {
            case "system": {
                const text = message.content
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("");
                if (text.length > 0) systemTexts.push(text);
                break;
            }
            case "human": {
                const content = humanBlocks(message);
                if (content.length > 0) turns.push({ role: "user", content });
                break;
            }
            case "ai": {
                const content = assistantBlocks(message);
                if (content.length > 0) turns.push({ role: "assistant", content });
                const results = toolResultBlocks(message);
                if (results.length > 0) turns.push({ role: "user", content: results });
                break;
            }
        }
    }

    return {
        system: systemTexts.length > 0 ? systemTexts.map((text) => ({ type: "text", text })) : undefined,
        messages: mergeAdjacentRoles(turns),
    };
}

/**
 * Trim messages before the latest compaction block.
 *
 * The Anthropic API ignores all content preceding a compaction block, so
 * sending it would only waste bandwidth. System messages are always preserved.
 */
export function trimBeforeCompaction(messages: AgentMessage[]): AgentMessage[] {
    let compactionIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.role === "ai" && message.content.some((p) => p.type === "opaque" && isCompactionPart(p))) {
            compactionIndex = i;
            break;
        }
    }
    if (compactionIndex <= 0) return messages;
    const system = messages.filter((message, i) => i < compactionIndex && message.role === "system");
    return [...system, ...messages.slice(compactionIndex)];
}
