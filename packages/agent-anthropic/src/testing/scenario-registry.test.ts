import { describe, expect, it } from "vitest";

import { loadFileFixtures, loadScenarios, selectFixture, selectNonStreamingFixture } from "./scenario-registry.js";

describe("loadScenarios", () => {
    it("groups a multi-exchange scenario by its numeric suffix, in order", async () => {
        const scenarios = await loadScenarios();
        const toolLoop = scenarios.find((s) => s.name === "tool-loop");
        expect(toolLoop?.fixtures.map((f) => f.scenario)).toEqual(["tool-loop", "tool-loop", "tool-loop"]);
        expect(toolLoop?.fixtures).toHaveLength(3);
    });

    it("derives a scenario's trigger from its own first recorded prompt", async () => {
        const scenarios = await loadScenarios();
        const webSearch = scenarios.find((s) => s.name === "web-search");
        expect(webSearch?.trigger).toBe(
            "Search the web for the current stable Node.js LTS version and cite your source.",
        );
    });

    it("does not assign a trigger to non-streaming scenarios (title, triage)", async () => {
        const scenarios = await loadScenarios();
        expect(scenarios.find((s) => s.name === "title")?.trigger).toBeUndefined();
        expect(scenarios.find((s) => s.name === "triage")?.trigger).toBeUndefined();
    });

    it("keeps status-code fixtures as separate scenarios rather than grouping them", async () => {
        const scenarios = await loadScenarios();
        // Only a two-digit sequence suffix groups exchanges, so `error-400` and
        // friends stay distinct instead of collapsing into one `error` scenario.
        expect(scenarios.map((s) => s.name)).toEqual(expect.arrayContaining(["error-400", "error-429", "error-529"]));
        expect(scenarios.find((s) => s.name === "error")).toBeUndefined();
    });
});

describe("loadFileFixtures", () => {
    it("keyes committed Files API fixtures by their request path", async () => {
        const fileFixtures = await loadFileFixtures();
        const metadata = fileFixtures.get("/v1/files/file_01FCiZjrYi2AHg9qV2XqhHXL");
        expect(metadata?.response.status).toBe(200);
        expect(metadata?.response.body).toContain("fibonacci.py");

        const content = fileFixtures.get("/v1/files/file_01FCiZjrYi2AHg9qV2XqhHXL/content");
        expect(content?.response.body).toContain("def fib(n):");
    });

    it("returns an empty map for a fixture directory with no files/ subdirectory", async () => {
        const fileFixtures = await loadFileFixtures("/nonexistent-fixture-dir");
        expect(fileFixtures.size).toBe(0);
    });
});

describe("selectFixture", () => {
    it("matches a scenario whose trigger appears anywhere in the request, even under a header prefix", async () => {
        const scenarios = await loadScenarios();
        const fixture = selectFixture(scenarios, [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "[Alice] @ 2026-04-10T14:30+02:00\n\nSearch the web for the current stable Node.js LTS version and cite your source.",
                    },
                ],
            },
        ]);
        expect(fixture.scenario).toBe("web-search");
    });

    it("picks the exchange matching the number of assistant turns already in the request", async () => {
        const scenarios = await loadScenarios();
        const trigger = "Add 2 and 3 using the adder tool, then add 10 to that result using the same tool.";

        const first = selectFixture(scenarios, [{ role: "user", content: trigger }]);
        const second = selectFixture(scenarios, [
            { role: "user", content: trigger },
            { role: "assistant", content: [{ type: "text", text: "ok" }] },
            { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "5" }] },
        ]);

        expect(first.scenario).toBe("tool-loop");
        expect(second.scenario).toBe("tool-loop");
        // Different exchanges of the same scenario carry different recorded content.
        expect(first.response.body).not.toBe(second.response.body);
    });

    it("falls back to plain-text when nothing matches", async () => {
        const scenarios = await loadScenarios();
        const fixture = selectFixture(scenarios, [{ role: "user", content: "Something nobody recorded." }]);
        expect(fixture.scenario).toBe("plain-text");
    });

    it("ignores assistant turns from earlier, unrelated exchanges when indexing", async () => {
        const scenarios = await loadScenarios();
        // A scenario triggered partway through a thread must still start at its
        // own first exchange; counting the whole conversation's assistant turns
        // would skip past it and silently fall back.
        const fixture = selectFixture(scenarios, [
            { role: "user", content: [{ type: "text", text: "Warm-up message" }] },
            { role: "assistant", content: [{ type: "text", text: "hello from the fixture" }] },
            { role: "user", content: [{ type: "text", text: "Say exactly: routing render check" }] },
        ]);
        expect(fixture.scenario).toBe("routing-render");
    });

    it("falls back to plain-text once a matched scenario's own exchanges are exhausted", async () => {
        const scenarios = await loadScenarios();
        const fixture = selectFixture(scenarios, [
            { role: "user", content: "Explain how a bicycle derailleur works." },
            { role: "assistant", content: [{ type: "text", text: "salvaged partial" }] },
            { role: "user", content: "continuation instruction" },
        ]);
        expect(fixture.scenario).toBe("plain-text");
    });
});

describe("selectNonStreamingFixture", () => {
    it("routes a forced record_decision tool call to the triage fixture", async () => {
        const scenarios = await loadScenarios();
        const fixture = selectNonStreamingFixture(scenarios, {
            tool_choice: { type: "tool", name: "record_decision" },
        });
        expect(fixture?.scenario).toBe("triage");
    });

    it("routes any other non-streaming call to the title fixture", async () => {
        const scenarios = await loadScenarios();
        const fixture = selectNonStreamingFixture(scenarios, {});
        expect(fixture?.scenario).toBe("title");
    });
});
