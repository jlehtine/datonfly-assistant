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
        const drawer = page.locator('[role="presentation"]');
        const bobItem = drawer.locator("li", { hasText: "Fake Bob" });
        await expect(bobItem).toBeVisible({ timeout: 5_000 });
        await expect(bobItem.getByText("Owner")).not.toBeVisible();

        // Alice promotes Bob to owner
        await page.getByRole("button", { name: "Actions for Fake Bob" }).click();
        await page.getByRole("menuitem", { name: "Promote to Owner" }).click();

        // Bob should now show the Owner chip
        await expect(bobItem.getByText("Owner")).toBeVisible({ timeout: 10_000 });
    });

    test("owner demotes another owner to member and Owner chip disappears", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob, then promotes Bob
        await loginAsFakeUser(page, 1);
        await createThreadAndSend(page, "Demote test", "demote");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Promote Bob first
        await page.getByRole("button", { name: "Actions for Fake Bob" }).click();
        await page.getByRole("menuitem", { name: "Promote to Owner" }).click();

        const drawer = page.locator('[role="presentation"]');
        const bobItem = drawer.locator("li", { hasText: "Fake Bob" });
        await expect(bobItem.getByText("Owner")).toBeVisible({ timeout: 10_000 });

        // Now demote Bob
        await page.getByRole("button", { name: "Actions for Fake Bob" }).click();
        await page.getByRole("menuitem", { name: "Demote to Member" }).click();

        // Owner chip should disappear
        await expect(bobItem.getByText("Owner")).not.toBeVisible({ timeout: 10_000 });
    });

    test("owner removes a member from the thread", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Remove test", "remove-member");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Verify 2 members
        const drawer = page.locator('[role="presentation"]');
        await expect(drawer.getByText("Members (2)")).toBeVisible({ timeout: 5_000 });

        // Alice removes Bob
        await page.getByRole("button", { name: "Actions for Fake Bob" }).click();
        await page.getByRole("menuitem", { name: "Remove from Thread" }).click();

        // Confirmation dialog appears
        await expect(page.getByText("Are you sure you want to remove Fake Bob from this thread?")).toBeVisible({
            timeout: 5_000,
        });
        await page.getByRole("button", { name: "Remove" }).click();

        // Member count should drop to 1
        await expect(drawer.getByText("Members (1)")).toBeVisible({ timeout: 10_000 });
        await expect(drawer.locator("li", { hasText: "Fake Bob" })).not.toBeVisible();

        // Bob should no longer see the thread in their sidebar
        const pageB = await createSecondUser(browser, 2);
        await expect(pageB.locator(".datonfly-thread-item").filter({ hasText: title })).not.toBeVisible({
            timeout: 10_000,
        });

        await pageB.context().close();
    });

    test("non-owner member leaves the thread", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Leave test", "leave-thread");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Close Alice's drawer
        await page.getByRole("button", { name: "Close members" }).click();

        // Bob opens the thread and opens the member drawer
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });
        await openMemberDrawer(pageB);

        // Bob sees his own action menu with "Leave Thread"
        await pageB.getByRole("button", { name: "Actions for Fake Bob" }).click();
        await pageB.getByRole("menuitem", { name: "Leave Thread" }).click();

        // Confirmation dialog
        await expect(pageB.getByText("Are you sure you want to leave this thread?")).toBeVisible({ timeout: 5_000 });
        await pageB.getByRole("button", { name: "Leave" }).click();

        // Thread should disappear from Bob's sidebar
        await expect(pageB.locator(".datonfly-thread-item").filter({ hasText: title })).not.toBeVisible({
            timeout: 15_000,
        });

        // Alice's drawer should show 1 member
        await openMemberDrawer(page);
        const drawerA = page.locator('[role="presentation"]');
        await expect(drawerA.getByText("Members (1)")).toBeVisible({ timeout: 10_000 });

        await pageB.context().close();
    });

    test("owner has no action menu for themselves", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob (so there's another member)
        await loginAsFakeUser(page, 1);
        await createThreadAndSend(page, "Self no-action test", "self-no-action");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Alice should NOT have an action button next to her own name
        const drawer = page.locator('[role="presentation"]');
        await expect(drawer.locator("li", { hasText: "Fake Alice" })).toBeVisible({ timeout: 5_000 });
        await expect(page.getByRole("button", { name: "Actions for Fake Alice" })).not.toBeVisible();
    });

    test("non-owner member cannot see actions for other members", async ({ page, browser }) => {
        // Alice creates a thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "No-action for non-owner", "non-owner-actions");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");
        await page.getByRole("button", { name: "Close members" }).click();

        // Bob opens the thread and the member drawer
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });
        await openMemberDrawer(pageB);

        const drawerB = pageB.locator('[role="presentation"]');

        // Bob should see both members
        await expect(drawerB.getByText("Members (2)")).toBeVisible({ timeout: 10_000 });

        // Bob should NOT see action button for Alice (he's not an owner)
        await expect(pageB.getByRole("button", { name: "Actions for Fake Alice" })).not.toBeVisible();

        // Bob SHOULD see his own action button (leave)
        await expect(pageB.getByRole("button", { name: "Actions for Fake Bob" })).toBeVisible();

        await pageB.context().close();
    });
});
