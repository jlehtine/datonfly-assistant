import { expect, test, type Page } from "@playwright/test";

import { composerInput, sendAndWaitForReply } from "./helpers";

// Narrow enough to trigger ChatEmbed/ChatHistoryEmbed/App's merged mobile
// header (breakpoint is max-width:640px), short enough to be phone-sized.
const VIEWPORT = { width: 390, height: 670 };

/** Send messages until the message list overflows its container. */
async function fillMessageListUntilScrollable(page: Page): Promise<void> {
    const messageList = page.locator(".datonfly-message-list");
    const maxIterations = 8;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
        await sendAndWaitForReply(
            page,
            `Message ${String(iteration)}: Write a few sentences about the number ${String(iteration)}.`,
        );
        if (await messageList.evaluate((el) => el.scrollHeight > el.clientHeight)) return;
    }
    expect(
        await messageList.evaluate((el) => el.scrollHeight > el.clientHeight),
        "expected message list to overflow after several messages",
    ).toBe(true);
}

test.describe("mobile chat header", () => {
    test.use({ viewport: VIEWPORT });

    test("top bar stays within the viewport, stays compact, and stays functional after the list scrolls", async ({
        page,
    }) => {
        test.setTimeout(120_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        await fillMessageListUntilScrollable(page);

        // Regression guard for the document-scroll bug: however much the message
        // list itself scrolls, the document must never become scrollable.
        const docScroll = await page.evaluate(() => {
            const el = document.scrollingElement;
            return { scrollHeight: el?.scrollHeight, clientHeight: el?.clientHeight };
        });
        expect(docScroll.scrollHeight).toBe(docScroll.clientHeight);

        const viewportSize = page.viewportSize() ?? VIEWPORT;

        // All header controls remain inside the viewport bounding box and
        // clickable, even though the message list is scrolled to the bottom.
        const openThreadListButton = page.locator(".datonfly-open-thread-list-button");
        const accountButton = page.locator(".datonfly-user-menu-button");
        for (const button of [openThreadListButton, accountButton]) {
            await expect(button).toBeVisible();
            const box = await button.boundingBox();
            expect(box).not.toBeNull();
            const y = box?.y ?? -1;
            const bottom = y + (box?.height ?? 0);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(bottom).toBeLessThanOrEqual(viewportSize.height);
        }

        // The bar itself must not eat too much of a short viewport.
        const headerBox = await page.locator(".datonfly-chat-header").boundingBox();
        expect(headerBox).not.toBeNull();
        expect(headerBox?.height ?? Infinity).toBeLessThan(viewportSize.height / 3);

        // Functional: the hamburger still opens the thread list after scrolling.
        await openThreadListButton.click();
        await expect(page.locator(".datonfly-new-conversation-button")).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press("Escape");

        // Functional: the account menu button (merged from the app's own AppBar
        // on narrow viewports) still opens its menu after scrolling.
        await accountButton.click();
        await expect(page.locator(".datonfly-chat-settings-menuitem")).toBeVisible({ timeout: 5_000 });
        await page.keyboard.press("Escape");
    });
});
