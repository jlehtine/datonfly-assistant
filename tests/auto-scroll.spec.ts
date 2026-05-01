import { expect, test, type Page } from "@playwright/test";

import { composerInput, sendAndWaitForReply } from "./helpers";

/**
 * Returns true when the message list scroll container is scrolled to the bottom
 * (within a small tolerance for sub-pixel rounding).
 */
async function isScrolledToBottom(page: Page): Promise<boolean> {
    return page.locator(".datonfly-message-list").evaluate((el) => {
        const tolerance = 30;
        return el.scrollHeight - el.scrollTop - el.clientHeight <= tolerance;
    });
}

/**
 * Wait for smooth scroll to settle at the bottom, polling with a timeout.
 */
async function expectScrolledToBottom(page: Page, timeout = 10_000): Promise<void> {
    await expect
        .poll(() => isScrolledToBottom(page), { timeout, message: "Expected message list to be scrolled to bottom" })
        .toBe(true);
}

test.describe("auto-scroll to bottom", () => {
    test("scrolls to bottom during live chat when messages fill the screen", async ({ page }) => {
        test.setTimeout(120_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        // Send multiple messages until the container becomes scrollable
        const messageList = page.locator(".datonfly-message-list");
        let iteration = 0;
        const maxIterations = 8;

        while (iteration < maxIterations) {
            iteration++;
            await sendAndWaitForReply(
                page,
                `Message ${String(iteration)}: Please respond with a few sentences about the number ${String(iteration)}.`,
            );

            const isScrollable = await messageList.evaluate((el) => el.scrollHeight > el.clientHeight);
            if (isScrollable) break;
        }

        // Verify the container is actually scrollable (messages overflowed)
        const isScrollable = await messageList.evaluate((el) => el.scrollHeight > el.clientHeight);
        expect(isScrollable, "Expected message list to be scrollable after multiple messages").toBe(true);

        // After the last response, the list should be scrolled to the bottom
        await expectScrolledToBottom(page);

        // Send one more message and confirm it still auto-scrolls
        await sendAndWaitForReply(page, "One more message to confirm scrolling.");
        await expectScrolledToBottom(page);
    });

    test("scrolls to bottom when selecting an existing long thread from history", async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        // Build a long conversation so it overflows
        const messageList = page.locator(".datonfly-message-list");
        let iteration = 0;
        const maxIterations = 8;

        while (iteration < maxIterations) {
            iteration++;
            await sendAndWaitForReply(
                page,
                `Message ${String(iteration)}: Write a few sentences about the number ${String(iteration)}.`,
            );

            const isScrollable = await messageList.evaluate((el) => el.scrollHeight > el.clientHeight);
            if (isScrollable) break;
        }

        const isScrollable = await messageList.evaluate((el) => el.scrollHeight > el.clientHeight);
        expect(isScrollable, "Expected message list to be scrollable").toBe(true);

        // Start a new conversation so the old thread is deselected
        await page.locator(".datonfly-new-conversation-button").click();

        // Wait for the message list to clear (no assistant messages in the new thread)
        await expect(page.locator(".datonfly-message-ai")).toHaveCount(0, { timeout: 5_000 });

        // Click the first thread in the sidebar to re-open the long conversation
        const firstThread = page.locator(".datonfly-thread-item").first();
        await expect(firstThread).toBeVisible({ timeout: 5_000 });
        await firstThread.click();

        // Wait for messages to load in the re-selected thread
        await expect(page.locator(".datonfly-message-ai").first()).toBeVisible({ timeout: 10_000 });

        // The message list should be scrolled to the bottom (poll to allow smooth scroll to finish)
        await expectScrolledToBottom(page);
    });
});
