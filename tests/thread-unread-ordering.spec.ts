import { expect, test } from "@playwright/test";

import { composerInput, createThreadAndSend, sendAndWaitForReply, threadItemByTitle } from "./helpers";

test.describe("thread unread count and ordering", () => {
    test("thread moves to top of list when a new message is sent while viewing it", async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto("/");
        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        // ── Create thread A (will be the older one) ──
        const titleA = await createThreadAndSend(page, "Say exactly: hello from thread A", "OlderThread");

        // ── Create thread B (newer — starts a new conversation) ──
        await page.locator(".datonfly-new-conversation-button").click();
        await expect(page.locator(".datonfly-message-ai")).toHaveCount(0, { timeout: 5_000 });
        const titleB = await createThreadAndSend(page, "Say exactly: hello from thread B", "NewerThread");

        // Thread B should be above thread A (most recently updated among the two).
        await expect
            .poll(
                async () => {
                    const titles = await page
                        .locator(".datonfly-thread-item")
                        .evaluateAll((items) => items.map((i) => i.getAttribute("data-thread-title") ?? ""));
                    const indexA = titles.indexOf(titleA);
                    const indexB = titles.indexOf(titleB);
                    return indexA >= 0 && indexB >= 0 && indexB < indexA;
                },
                { timeout: 10_000 },
            )
            .toBeTruthy();

        // ── Switch to thread A and send a new message ──
        await threadItemByTitle(page, titleA).click();
        await expect(page.locator(".datonfly-message-human").first()).toBeVisible({ timeout: 10_000 });

        await sendAndWaitForReply(page, "Say exactly: second message in thread A");

        // Thread A should now be above thread B.
        await expect
            .poll(
                async () => {
                    const titles = await page
                        .locator(".datonfly-thread-item")
                        .evaluateAll((items) => items.map((i) => i.getAttribute("data-thread-title") ?? ""));
                    const indexA = titles.indexOf(titleA);
                    const indexB = titles.indexOf(titleB);
                    return indexA >= 0 && indexB >= 0 && indexA < indexB;
                },
                { timeout: 15_000 },
            )
            .toBeTruthy();
    });

    test("no unread badge on a thread whose reply arrived while the thread was open", async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto("/");
        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        // ── Create thread and get initial reply while viewing ──
        const title = await createThreadAndSend(page, "Say exactly: first reply", "UnreadTest");

        // Send another message while still viewing the same thread.
        await sendAndWaitForReply(page, "Say exactly: second reply");

        // ── Navigate away to a new conversation ──
        await page.locator(".datonfly-new-conversation-button").click();
        await expect(page.locator(".datonfly-message-ai")).toHaveCount(0, { timeout: 5_000 });

        // ── Verify the original thread has no unread badge ──
        const threadItem = threadItemByTitle(page, title);
        await expect(threadItem).toBeVisible({ timeout: 5_000 });
        const badge = threadItem.locator(".datonfly-unread-badge");
        await expect(badge).toHaveCount(0, { timeout: 5_000 });
    });

    test("no unread badge after page refresh for thread that had reply while open", async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto("/");
        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        // ── Create thread and receive replies while viewing ──
        const title = await createThreadAndSend(page, "Say exactly: hello", "RefreshTest");
        await sendAndWaitForReply(page, "Say exactly: world");

        // ── Navigate away, then reload to fetch fresh unread counts from the server ──
        await page.locator(".datonfly-new-conversation-button").click();
        await page.reload();
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        // The old thread should not have an unread badge after reload
        // (this tests that lastReadAt was persisted on the server).
        const threadItem = threadItemByTitle(page, title);
        await expect(threadItem).toBeVisible({ timeout: 10_000 });
        const badge = threadItem.locator(".datonfly-unread-badge");
        await expect(badge).toHaveCount(0, { timeout: 5_000 });
    });
});
