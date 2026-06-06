import { describe, expect, it } from "vitest";

import { jsonSchemaToZod } from "./json-schema-to-zod.js";

describe("jsonSchemaToZod", () => {
    it("maps an object schema with required and optional properties", () => {
        const schema = jsonSchemaToZod({
            type: "object",
            properties: { a: { type: "string" }, b: { type: "number" } },
            required: ["a"],
        });

        expect(schema.parse({ a: "x" })).toEqual({ a: "x" });
        expect(schema.parse({ a: "x", b: 2 })).toEqual({ a: "x", b: 2 });
        expect(() => schema.parse({ b: 2 })).toThrow();
    });

    it("strips unknown keys for object schemas", () => {
        const schema = jsonSchemaToZod({ type: "object", properties: { a: { type: "string" } }, required: ["a"] });

        expect(schema.parse({ a: "x", extra: 1 })).toEqual({ a: "x" });
    });

    it("maps string enums to a constrained union", () => {
        const schema = jsonSchemaToZod({ type: "string", enum: ["red", "green"] });

        expect(schema.parse("red")).toBe("red");
        expect(() => schema.parse("blue")).toThrow();
    });

    it("rejects non-integers for integer schemas", () => {
        const schema = jsonSchemaToZod({ type: "integer" });

        expect(schema.parse(2)).toBe(2);
        expect(() => schema.parse(1.5)).toThrow();
    });

    it("maps boolean schemas", () => {
        const schema = jsonSchemaToZod({ type: "boolean" });

        expect(schema.parse(true)).toBe(true);
        expect(() => schema.parse("nope")).toThrow();
    });

    it("maps arrays of a typed item", () => {
        const schema = jsonSchemaToZod({ type: "array", items: { type: "string" } });

        expect(schema.parse(["a", "b"])).toEqual(["a", "b"]);
        expect(() => schema.parse([1])).toThrow();
    });

    it("honours nullable union types", () => {
        const schema = jsonSchemaToZod({ type: ["string", "null"] });

        expect(schema.parse(null)).toBeNull();
        expect(schema.parse("x")).toBe("x");
        expect(() => schema.parse(5)).toThrow();
    });

    it("accepts an empty object schema and strips everything", () => {
        const schema = jsonSchemaToZod({ type: "object" });

        expect(schema.parse({ anything: true })).toEqual({});
    });

    it("falls back to an accept-all schema for unknown property types", () => {
        const schema = jsonSchemaToZod({
            type: "object",
            properties: { opaque: {} },
            required: ["opaque"],
        });

        expect(schema.parse({ opaque: { nested: 1 } })).toEqual({ opaque: { nested: 1 } });
    });
});
