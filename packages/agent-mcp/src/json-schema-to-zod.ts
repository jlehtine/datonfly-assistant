import { z } from "zod";

/**
 * Convert a JSON Schema object (as published by an MCP server's tool
 * `inputSchema`) into a Zod schema usable as an {@link ITool} schema.
 *
 * MCP servers describe tool inputs with JSON Schema, but the agent's tool
 * contract (`@datonfly-assistant/core` `ITool`) is expressed with Zod so the
 * model receives an accurate parameter schema and arguments can be validated
 * before dispatch. This converter handles the JSON Schema subset MCP tools
 * realistically emit (objects, primitives, arrays, enums, nullability,
 * descriptions); anything unrecognised degrades gracefully to `z.unknown()`,
 * deferring authoritative validation to the MCP server.
 */
export function jsonSchemaToZod(schema: unknown): z.ZodType {
    return convert(schema);
}

/** Narrow an unknown value to a plain JSON-Schema-like record. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrow an unknown value to an `unknown[]` (avoids `Array.isArray` widening to `any[]`). */
function isArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

/** Attach a `.describe()` annotation when the schema carries a string description. */
function withDescription(zodType: z.ZodType, description: unknown): z.ZodType {
    return typeof description === "string" ? zodType.describe(description) : zodType;
}

/** Build a Zod literal for a primitive enum value, or `z.unknown()` otherwise. */
function literalSchema(value: unknown): z.ZodType {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return z.literal(value);
    }
    return z.unknown();
}

/** Build a schema for a JSON Schema `enum` constraint. */
function enumSchema(values: unknown[]): z.ZodType {
    const literals = values.map(literalSchema);
    if (literals.length === 1) {
        return literals[0] ?? z.unknown();
    }
    return z.union(literals as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

/** Build a schema for a JSON Schema `object` node. */
function objectSchema(schema: Record<string, unknown>): z.ZodType {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(
        isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [],
    );
    const shape: Record<string, z.ZodType> = {};
    for (const [key, value] of Object.entries(properties)) {
        const propertySchema = convert(value);
        shape[key] = required.has(key) ? propertySchema : propertySchema.optional();
    }
    return z.object(shape);
}

/** Resolve the `items` schema of an array node (tuple `items` arrays collapse to unknown). */
function arrayItemSchema(items: unknown): z.ZodType {
    return isArray(items) ? z.unknown() : convert(items);
}

/** Recursively convert a single JSON Schema node into a Zod schema. */
function convert(schema: unknown): z.ZodType {
    if (!isRecord(schema)) {
        return z.unknown();
    }

    if (isArray(schema.enum) && schema.enum.length > 0) {
        return withDescription(enumSchema(schema.enum), schema.description);
    }

    const rawType = schema.type;
    const types = isArray(rawType) ? rawType : rawType === undefined ? [] : [rawType];
    const primaryType = types.find((type) => type !== "null");

    let zodType: z.ZodType;
    switch (primaryType) {
        case "string":
            zodType = z.string();
            break;
        case "number":
            zodType = z.number();
            break;
        case "integer":
            zodType = z.number().int();
            break;
        case "boolean":
            zodType = z.boolean();
            break;
        case "array":
            zodType = z.array(arrayItemSchema(schema.items));
            break;
        case "object":
            zodType = objectSchema(schema);
            break;
        default:
            zodType = z.unknown();
    }

    if (types.includes("null")) {
        zodType = zodType.nullable();
    }

    return withDescription(zodType, schema.description);
}
