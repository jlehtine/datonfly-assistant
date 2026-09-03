import { expect, test, type Page } from "@playwright/test";

import { composerInput, composerSendButton, sendAndWaitForReply } from "./helpers";

// Matches packages/agent-anthropic/test/fixtures/long-response.json, which
// replays a long, multi-chunk streamed reply — giving tests a window to
// interact with the list while content is still arriving.
const LONG_RESPONSE_PROMPT =
    "Explain the theory of relativity in great detail. " +
    "Cover both special and general relativity, the key experiments, " +
    "the mathematical foundations, and the implications for modern physics.";

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

/** Scroll the message list up by hovering it and sending an upward wheel gesture. */
async function scrollUp(page: Page, amount = 400): Promise<void> {
    const messageList = page.locator(".datonfly-message-list");
    const box = await messageList.boundingBox();
    if (!box) throw new Error("message list is not visible");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -amount);
}

/** Locate the jump-to-bottom button shown while auto-scroll is suspended. */
function jumpToBottomButton(page: Page) {
    return page.locator(".datonfly-scroll-to-bottom");
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

test.describe("suspending and resuming auto-scroll", () => {
    test("scrolling up during a streaming reply suspends auto-scroll and shows a jump-to-bottom button", async ({
        page,
    }) => {
        test.setTimeout(90_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        // Build up enough content that the long reply's own streaming has room
        // to overflow the viewport as it arrives, not just once it's complete.
        const messageList = page.locator(".datonfly-message-list");
        for (let i = 1; i <= 4; i++) {
            await sendAndWaitForReply(page, `Filler message ${String(i)} to build up scroll height.`);
            if (await messageList.evaluate((el) => el.scrollHeight > el.clientHeight)) break;
        }

        await composer.fill(LONG_RESPONSE_PROMPT);
        await composerSendButton(page).click();

        // Wait for streaming to start and produce enough content to overflow the viewport.
        const streamingBubble = page.locator(".datonfly-message-ai").last();
        await expect(streamingBubble.locator(".datonfly-message-streaming-indicator")).toBeVisible({
            timeout: 10_000,
        });
        await expect
            .poll(async () => messageList.evaluate((el) => el.scrollHeight > el.clientHeight), { timeout: 20_000 })
            .toBe(true);

        await scrollUp(page);
        await expect(jumpToBottomButton(page)).toBeVisible();
        const distanceAfterScrollUp = await messageList.evaluate(
            (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
        );
        expect(distanceAfterScrollUp).toBeGreaterThan(30);

        // Auto-scroll must stay suspended while more content streams in.
        await expect
            .poll(async () => messageList.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight), {
                timeout: 5_000,
            })
            .toBeGreaterThan(30);

        // ...and once streaming has finished.
        await expect(streamingBubble.locator(".datonfly-message-streaming-indicator")).toHaveCount(0, {
            timeout: 30_000,
        });
        expect(await isScrolledToBottom(page)).toBe(false);
        await expect(jumpToBottomButton(page)).toBeVisible();
    });

    test("clicking the jump-to-bottom button resumes auto-scroll", async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });
        await sendAndWaitForReply(page, LONG_RESPONSE_PROMPT);

        await scrollUp(page);
        await expect(jumpToBottomButton(page)).toBeVisible();

        await jumpToBottomButton(page).click();
        await expectScrolledToBottom(page);
        await expect(jumpToBottomButton(page)).toBeHidden();

        // Auto-scroll resumed: the next reply keeps the view pinned to the bottom.
        await sendAndWaitForReply(page, "One more message to confirm auto-scroll resumed.");
        await expectScrolledToBottom(page);
    });

    test("scrolling back near the bottom manually resumes auto-scroll", async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });
        await sendAndWaitForReply(page, LONG_RESPONSE_PROMPT);

        await scrollUp(page);
        await expect(jumpToBottomButton(page)).toBeVisible();

        // Scroll back down near the bottom by hand, without using the button.
        const messageList = page.locator(".datonfly-message-list");
        await messageList.evaluate((el) => {
            el.scrollTop = el.scrollHeight - el.clientHeight;
        });
        await messageList.dispatchEvent("scroll");
        await expect(jumpToBottomButton(page)).toBeHidden();

        await sendAndWaitForReply(page, "One more message to confirm auto-scroll resumed.");
        await expectScrolledToBottom(page);
    });

    test("sending a message while suspended jumps back to the bottom", async ({ page }) => {
        test.setTimeout(60_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });
        await sendAndWaitForReply(page, LONG_RESPONSE_PROMPT);

        await scrollUp(page);
        await expect(jumpToBottomButton(page)).toBeVisible();

        await sendAndWaitForReply(page, "Sending this should jump back to the bottom.");
        await expectScrolledToBottom(page);
        await expect(jumpToBottomButton(page)).toBeHidden();
    });
});
