import { createHash } from "node:crypto";

// Fixed at random. Never change this: doing so would change every derived id, silently
// orphaning previously indexed points instead of upserting in place.
const NAMESPACE_BYTES = Buffer.from("6f2f9b8e6c3e4b8a9e3a9f7f6f6a0b1a", "hex");

/**
 * Derive a deterministic UUIDv5 point id from a name.
 *
 * Used for search index points that are regenerated in place (e.g. a thread's
 * topic or thread-card points) rather than created fresh each time — the same
 * name always yields the same id, so re-indexing upserts instead of
 * accumulating duplicates. Qdrant point ids must be a UUID or an unsigned
 * integer, which rules out a plain natural key.
 */
export function derivePointId(name: string): string {
    const hash = createHash("sha1").update(NAMESPACE_BYTES).update(name, "utf8").digest();
    const bytes = Array.from(hash.subarray(0, 16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant
    const hex = Buffer.from(bytes).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
