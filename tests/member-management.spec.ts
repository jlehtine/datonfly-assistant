import { expect, test } from "@playwright/test";

import {
    composerInput,
    createSecondUser,
    createThreadAndSend,
    ensureFakeUserExists,
    inviteMember,
    loginAsFakeUser,
    openMemberDrawer,
    openThread,
    threadItemByTitle,
} from "./helpers";

test.describe("member management", () => {
    test.setTimeout(180_000);

    test("owner promotes member to owner and Owner chip appears", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob
        await loginAsFakeUser(page, 1);
        await createThreadAndSend(page, "Promote test", "promote");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Bob should be listed as a regular member (no Owner chip next to his name)
        const bobItem = page.locator('.datonfly-member-item[data-member-email="fake.bob@dev.invalid"]');
        await expect(bobItem).toBeVisible({ timeout: 5_000 });
        await expect(bobItem.locator(".datonfly-member-owner-chip")).toHaveCount(0);

        // Alice promotes Bob to owner
        await bobItem.locator(".datonfly-member-actions-button").click();
        await page.locator(".datonfly-member-action-promote").click();

        // Bob should now show the Owner chip
        await expect(bobItem.locator(".datonfly-member-owner-chip")).toHaveCount(1, { timeout: 10_000 });
    });

    test("owner demotes another owner to member and Owner chip disappears", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob, then promotes Bob
        await loginAsFakeUser(page, 1);
        await createThreadAndSend(page, "Demote test", "demote");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Promote Bob first
        const bobItem = page.locator('.datonfly-member-item[data-member-email="fake.bob@dev.invalid"]');
        await bobItem.locator(".datonfly-member-actions-button").click();
        await page.locator(".datonfly-member-action-promote").click();

        await expect(bobItem.locator(".datonfly-member-owner-chip")).toHaveCount(1, { timeout: 10_000 });

        // Now demote Bob
        await bobItem.locator(".datonfly-member-actions-button").click();
        await page.locator(".datonfly-member-action-demote").click();

        // Owner chip should disappear
        await expect(bobItem.locator(".datonfly-member-owner-chip")).toHaveCount(0, { timeout: 10_000 });
    });

    test("owner removes a member from the thread", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Remove test", "remove-member");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Verify 2 members
        const memberCount = page.locator(".datonfly-member-count");
        await expect(memberCount).toHaveAttribute("data-member-count", "2", { timeout: 5_000 });

        // Alice removes Bob
        const bobItem = page.locator('.datonfly-member-item[data-member-email="fake.bob@dev.invalid"]');
        await bobItem.locator(".datonfly-member-actions-button").click();
        await page.locator(".datonfly-member-action-remove").click();

        // Confirmation dialog appears
        await expect(page.locator('.datonfly-member-confirm-dialog[data-confirm-action="remove"]')).toBeVisible({
            timeout: 5_000,
        });
        await page.locator(".datonfly-member-confirm-submit").click();

        // Member count should drop to 1
        await expect(memberCount).toHaveAttribute("data-member-count", "1", { timeout: 10_000 });
        await expect(page.locator('.datonfly-member-item[data-member-email="fake.bob@dev.invalid"]')).toHaveCount(0);

        // Bob should no longer see the thread in their sidebar
        const pageB = await createSecondUser(browser, 2);
        await expect(threadItemByTitle(pageB, title)).toHaveCount(0, { timeout: 10_000 });

        await pageB.context().close();
    });

    test("non-owner member leaves the thread", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Leave test", "leave-thread");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Close Alice's drawer
        await page.locator(".datonfly-member-drawer-close").click();

        // Bob opens the thread and opens the member drawer
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });
        await openMemberDrawer(pageB);

        // Bob sees his own action menu with "Leave Thread"
        await pageB
            .locator('.datonfly-member-item[data-member-email="fake.bob@dev.invalid"] .datonfly-member-actions-button')
            .click();
        await pageB.locator(".datonfly-member-action-leave").click();

        // Confirmation dialog
        await expect(pageB.locator('.datonfly-member-confirm-dialog[data-confirm-action="leave"]')).toBeVisible({
            timeout: 5_000,
        });
        await pageB.locator(".datonfly-member-confirm-submit").click();

        // Thread should disappear from Bob's sidebar
        await expect(threadItemByTitle(pageB, title)).toHaveCount(0, { timeout: 15_000 });

        // Alice's drawer should show 1 member
        await openMemberDrawer(page);
        await expect(page.locator(".datonfly-member-count")).toHaveAttribute("data-member-count", "1", {
            timeout: 10_000,
        });

        await pageB.context().close();
    });

    test("owner has no action menu for themselves", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob (so there's another member)
        await loginAsFakeUser(page, 1);
        await createThreadAndSend(page, "Self no-action test", "self-no-action");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Alice should NOT have an action button next to her own name
        const aliceItem = page.locator('.datonfly-member-item[data-member-email="fake.alice@dev.invalid"]');
        await expect(aliceItem).toBeVisible({ timeout: 5_000 });
        await expect(aliceItem.locator(".datonfly-member-actions-button")).toHaveCount(0);
    });

    test("non-owner member cannot see actions for other members", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "No-action for non-owner", "non-owner-actions");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");
        await page.locator(".datonfly-member-drawer-close").click();

        // Bob opens the thread and the member drawer
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });
        await openMemberDrawer(pageB);

        // Bob should see both members
        await expect(pageB.locator(".datonfly-member-count")).toHaveAttribute("data-member-count", "2", {
            timeout: 10_000,
        });

        // Bob should NOT see action button for Alice (he's not an owner)
        await expect(
            pageB.locator(
                '.datonfly-member-item[data-member-email="fake.alice@dev.invalid"] .datonfly-member-actions-button',
            ),
        ).toHaveCount(0);

        // Bob SHOULD see his own action button (leave)
        await expect(
            pageB.locator(
                '.datonfly-member-item[data-member-email="fake.bob@dev.invalid"] .datonfly-member-actions-button',
            ),
        ).toHaveCount(1);

        await pageB.context().close();
    });
});
