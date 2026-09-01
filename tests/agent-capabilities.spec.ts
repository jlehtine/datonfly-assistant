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

    test("renders a later thinking block below earlier text, not hoisted above it", async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });

        // Fixture: thinking -> text -> code_execution -> thinking -> text,
        // within one turn. Confirming a tool result rarely reopens thinking; this
        // prompt manufactures a discrepancy the model must reconcile, which does.
        const reply = await sendAndWaitForReply(
            page,
            "State the first five Fibonacci numbers from memory, but for this exercise deliberately get the " +
                "fourth one wrong. Then run the real computation in the execution environment. Comparing the " +
                "two, think it through carefully to identify exactly which value was wrong and why the " +
                "recurrence relation produces that value, before giving me the corrected list.",
        );
        expect(reply).toContain("position 4");

        const lastAiMessage = page.locator(".datonfly-message-ai").last();
        await expect(lastAiMessage.locator(".datonfly-message-thinking")).toHaveCount(2);

        // The true order is thinking -> text -> thinking -> text. If thinking
        // were still hoisted above all text (the bug this fixes), both thinking
        // boxes would read before either text block in the rendered output.
        const bubbleText = await lastAiMessage.innerText();
        const firstThinkingIndex = bubbleText.indexOf("intentionally flub");
        const firstTextIndex = bubbleText.indexOf("From memory");
        const secondThinkingIndex = bubbleText.indexOf("flag the inconsistency");
        const secondTextIndex = bubbleText.indexOf("Comparison and diagnosis");

        expect(firstThinkingIndex).toBeGreaterThanOrEqual(0);
        expect(firstTextIndex).toBeGreaterThan(firstThinkingIndex);
        expect(secondThinkingIndex).toBeGreaterThan(firstTextIndex);
        expect(secondTextIndex).toBeGreaterThan(secondThinkingIndex);
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

test.describe("generated files", () => {
    test("attaches a file the assistant saved to $OUTPUT_DIR, downloadable with its real content", async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });

        await sendAndWaitForReply(
            page,
            "Write a minimal Python script that outputs Fibonacci numbers sequence and share it with me.",
        );

        const lastAiMessage = page.locator(".datonfly-message-ai").last();
        const attachment = lastAiMessage.locator(".datonfly-message-attachment").last();
        await expect(attachment).toBeVisible({ timeout: 10_000 });
        await expect(attachment).toHaveAttribute("data-attachment-id", /.+/);

        // Generated files are placed at end of turn (D2): the attachment now
        // follows the assistant's text rather than preceding it.
        const introText = lastAiMessage.getByText("I'll write the script", { exact: false });
        await expect(introText).toBeVisible();
        const introBox = await introText.boundingBox();
        const attachmentBox = await attachment.boundingBox();
        expect(introBox).not.toBeNull();
        expect(attachmentBox?.y).toBeGreaterThan(introBox?.y ?? Infinity);

        const downloadHref = await attachment.evaluate((el) => {
            const anchor = el.matches("a") ? el : el.querySelector("a");
            return anchor?.getAttribute("href") ?? "";
        });
        expect(downloadHref).toContain("/datonfly-assistant/attachments/");

        const bytes = await page.evaluate(async (url: string) => {
            const res = await fetch(url, { credentials: "include" });
            if (!res.ok) throw new Error(`download failed: ${res.status.toString()}`);
            return res.text();
        }, downloadHref);
        expect(bytes).toContain("def fib(n):");
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
