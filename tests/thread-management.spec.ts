import { expect, test } from "@playwright/test";

import { composerInput, renameCurrentThread, sendAndWaitForReply, threadItemByTitle, uniqueTitle } from "./helpers";

test.describe("thread list management", () => {
    test("create chats, switch, archive, unarchive, and verify content", async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        const threadItems = page.locator(".datonfly-thread-item");

        // ── Chat 1: send a message and rename with a unique title ──
        const chat1Keyword = "Bioluminescence";
        const chat1Title = uniqueTitle("Chat1");
        await sendAndWaitForReply(
            page,
            `Tell me one interesting fact about ${chat1Keyword}. Keep it to two sentences.`,
        );

        // Wait for the thread to appear in the sidebar
        await expect(threadItems.first()).toBeVisible({ timeout: 15_000 });

        // Rename the thread to our unique title
        await renameCurrentThread(page, chat1Title);

        // Verify the unique title appears in the thread list
        await expect(threadItems.filter({ hasText: chat1Title })).toBeVisible({ timeout: 10_000 });

        // ── Chat 2: start a new conversation and rename it too ──
        await page.locator(".datonfly-new-conversation-button").click();
        await expect(page.locator(".datonfly-message-ai")).toHaveCount(0, { timeout: 5_000 });

        const chat2Keyword = "Quantum entanglement";
        const chat2Title = uniqueTitle("Chat2");
        await sendAndWaitForReply(
            page,
            `Tell me one interesting fact about ${chat2Keyword}. Keep it to two sentences.`,
        );

        // Wait for new thread to appear and rename it
        await expect(threadItems.filter({ has: page.locator(".Mui-selected") }).or(threadItems.first())).toBeVisible({
            timeout: 15_000,
        });

        // Wait briefly for any auto-title to arrive before we overwrite it,
        // otherwise the auto-title WebSocket event may race with our rename.
        await page.waitForTimeout(2_000);

        await renameCurrentThread(page, chat2Title);
        await expect(threadItemByTitle(page, chat2Title)).toBeVisible({ timeout: 10_000 });

        // ── Switch back to chat 1 by matching its unique title ──
        const chat1Item = threadItemByTitle(page, chat1Title);
        await chat1Item.click();

        // Verify the original message content is displayed
        const chat1UserMsg = page.locator(".datonfly-message-human", { hasText: chat1Keyword });
        await expect(chat1UserMsg).toBeVisible({ timeout: 10_000 });

        // ── Archive chat 2 ──
        const chat2Item = threadItemByTitle(page, chat2Title);
        await expect(chat2Item).toBeVisible({ timeout: 5_000 });

        // Click archive button on chat 2
        await chat2Item.locator('.datonfly-thread-archive-toggle[data-thread-action="archive"]').click();

        // Chat 2 should disappear from the active thread list
        await expect(threadItemByTitle(page, chat2Title)).toHaveCount(0, { timeout: 5_000 });

        // ── Switch to archived view ──
        const filterSelect = page.locator(".datonfly-thread-filter-select");
        await filterSelect.click();
        await page.locator('.datonfly-thread-filter-option[data-thread-filter="archived"]').click();

        // Chat 2 should appear in the archived list
        const archivedChat2 = threadItemByTitle(page, chat2Title);
        await expect(archivedChat2).toBeVisible({ timeout: 5_000 });

        // ── Unarchive chat 2 ──
        await archivedChat2.locator('.datonfly-thread-archive-toggle[data-thread-action="unarchive"]').click();

        // Chat 2 should disappear from the archived view
        await expect(threadItemByTitle(page, chat2Title)).toHaveCount(0, { timeout: 5_000 });

        // ── Switch back to active view ──
        await filterSelect.click();
        await page.locator('.datonfly-thread-filter-option[data-thread-filter="active"]').click();

        // Both chats should be visible in the active list
        await expect(threadItemByTitle(page, chat1Title)).toBeVisible({ timeout: 5_000 });
        await expect(threadItemByTitle(page, chat2Title)).toBeVisible({ timeout: 5_000 });

        // ── Select chat 2 and verify its content loads ──
        await threadItemByTitle(page, chat2Title).click();
        const chat2UserMsg = page.locator(".datonfly-message-human", { hasText: chat2Keyword });
        await expect(chat2UserMsg).toBeVisible({ timeout: 10_000 });
    });
});
