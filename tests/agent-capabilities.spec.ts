import { expect, test } from "@playwright/test";

import { composerInput, sendAndWaitForReply } from "./helpers";

/**
 * These specs exercise agent capabilities that are otherwise expensive or
 * flaky to test against the real Anthropic API: extended reasoning, the
 * server-side tools (web search, web fetch, code execution), and mid-turn
 * context compaction. All three run against the fixture playback harness
 * (see `packages/agent-anthropic/test/fixtures/`), which is selected by
 * matching the outgoing request against known trigger prompts — see
 * `packages/agent-anthropic/src/testing/scenario-registry.ts`.
 *
 * Compaction in particular becomes trivial to test this way: the fake API
 * decides when to emit a `compaction` block based on which prompt it sees,
 * so there is no need to seed a real 120k-token thread (and no API cost).
 * Note that the compaction block itself is a provider-internal continuation
 * mechanism — `thread.controller.ts` and `chat.gateway.ts` both strip
 * `opaque` content parts before anything reaches the client — so this spec
 * can only assert on the user-visible outcome (a normal, complete reply),
 * not on the compaction block directly. The provider-level mechanics are
 * covered by `agent.test.ts`'s unit tests instead.
 */

test.describe("reasoning", () => {
    test("shows visible thinking content for a reasoning prompt", async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });

        const reply = await sendAndWaitForReply(
            page,
            "Think it through and show your reasoning: a farmer has 17 sheep; all but 9 run away. How many are left?",
        );
        expect(reply).toContain("9 sheep are left");

        const thinking = page.locator(".datonfly-message-ai").last().locator(".datonfly-message-thinking");
        await expect(thinking).toBeVisible();
        await expect(thinking).toContainText("Let me work through this");
    });
});

test.describe("server-side tools", () => {
    test("web search", async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });

        const reply = await sendAndWaitForReply(
            page,
            "Search the web for the current stable Node.js LTS version and cite your source.",
        );
        expect(reply).toContain("24.14.0");
    });

    test("web fetch", async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });

        const reply = await sendAndWaitForReply(page, "Fetch https://example.com and quote its heading.");
        expect(reply).toContain("Example Domain");
    });

    test("code execution", async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });

        const reply = await sendAndWaitForReply(page, "Use code execution to compute the 20th Fibonacci number.");
        expect(reply).toContain("6765");
    });
});

test.describe("compaction", () => {
    test("completes a turn that triggers mid-stream context compaction", async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });

        // sendAndWaitForReply already waits for the streaming indicator to
        // clear, which is the meaningful assertion here: the compaction
        // round trip (a paused turn resumed with a compaction summary,
        // transparent to the client) must not hang or error.
        const reply = await sendAndWaitForReply(page, "How many log batches did I send?");
        expect(reply).toContain("You sent 6 log batches.");
    });
});
