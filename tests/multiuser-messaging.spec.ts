import { expect, test } from "@playwright/test";

import {
    composerInput,
    composerSendButton,
    createSecondUser,
    createThreadAndSend,
    ensureFakeUserExists,
    inviteMember,
    loginAsFakeUser,
    openMemberDrawer,
    openThread,
    threadItemByTitle,
    waitForMessage,
} from "./helpers";

test.describe("multi-user messaging", () => {
    test.setTimeout(180_000);

    test("invited user sees thread in their thread list", async ({ page, browser }) => {
        // User A (Alice, fakeid=1) creates a thread
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Hello from Alice!", "invite-visible");

        // Invite Bob
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // User B (Bob, fakeid=2) should see the thread
        const pageB = await createSecondUser(browser, 2);
        await expect(threadItemByTitle(pageB, title)).toBeVisible({ timeout: 15_000 });

        await pageB.context().close();
    });

    test("member drawer shows all members after invite", async ({ page, browser }) => {
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Testing members drawer", "member-drawer");

        // Invite Bob
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Close and reopen drawer to verify members
        await page.locator(".datonfly-member-drawer-close").click();
        await openMemberDrawer(page);

        // Both members should be listed
        await expect(page.locator(".datonfly-member-count")).toHaveAttribute("data-member-count", "2");
        await expect(page.locator('.datonfly-member-item[data-member-email="fake.alice@dev.invalid"]')).toBeVisible({
            timeout: 5_000,
        });
        await expect(page.locator('.datonfly-member-item[data-member-email="fake.bob@dev.invalid"]')).toBeVisible({
            timeout: 5_000,
        });

        // Verify User B sees the same thing
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);

        // Wait for thread to load then open drawer
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });
        await openMemberDrawer(pageB);
        await expect(pageB.locator(".datonfly-member-count")).toHaveAttribute("data-member-count", "2", {
            timeout: 10_000,
        });

        await pageB.context().close();
    });

    test("User A sends message, User B sees it in real time", async ({ page, browser }) => {
        // Alice creates thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Initial message", "cross-msg");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");

        // Close the member drawer
        await page.locator(".datonfly-member-drawer-close").click();

        // Bob opens the thread
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });

        // Alice sends a new message
        const aliceMsg = "Hello Bob, can you see this?";
        const composerA = composerInput(page);
        await composerA.fill(aliceMsg);
        await composerSendButton(page).click();

        // Bob should see Alice's message in real time
        await waitForMessage(pageB, aliceMsg, "human");

        await pageB.context().close();
    });

    test("User B sends message, User A sees it left-aligned with author name", async ({ page, browser }) => {
        // Alice creates thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Setup message", "b-sends");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");
        await page.locator(".datonfly-member-drawer-close").click();

        // Bob opens the thread and sends a message
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });

        const bobMsg = "Hi Alice, this is Bob!";
        const composerB = composerInput(pageB);
        await composerB.fill(bobMsg);
        await composerSendButton(pageB).click();

        // Alice should see Bob's message
        await waitForMessage(page, bobMsg, "human");

        // Verify the message shows as another user's message from Bob
        await expect(page.locator('.datonfly-message-human[data-message-author="Fake Bob"]')).toBeVisible({
            timeout: 5_000,
        });

        await pageB.context().close();
    });

    test("both users see AI response after a message", async ({ page, browser }) => {
        // Alice creates thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Warm-up message", "both-ai");
        await ensureFakeUserExists(browser, 2);
        await inviteMember(page, "Fake Bob");
        await page.locator(".datonfly-member-drawer-close").click();

        // Bob opens the thread
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });

        // Count existing AI messages on both sides
        // Wait for Bob's page to load existing messages first
        const aiMsgsA = page.locator(".datonfly-message-ai");
        const aiMsgsB = pageB.locator(".datonfly-message-ai");
        const countBeforeA = await aiMsgsA.count();
        // Bob needs time to load the thread's existing messages
        await expect(aiMsgsB).toHaveCount(countBeforeA, { timeout: 10_000 });
        const countBeforeB = await aiMsgsB.count();

        // Bob sends a question
        const composerB = composerInput(pageB);
        await composerB.fill("What is 2 + 2?");
        await composerSendButton(pageB).click();

        // Both should see a new AI response
        await expect(aiMsgsA).toHaveCount(countBeforeA + 1, { timeout: 30_000 });
        await expect(aiMsgsB).toHaveCount(countBeforeB + 1, { timeout: 30_000 });

        // Wait for streaming to finish on both sides
        await expect(aiMsgsA.last().locator(".datonfly-message-streaming-indicator")).toHaveCount(0, {
            timeout: 30_000,
        });
        await expect(aiMsgsB.last().locator(".datonfly-message-streaming-indicator")).toHaveCount(0, {
            timeout: 30_000,
        });

        // Both should have non-empty AI content
        const textA = await aiMsgsA.last().innerText();
        const textB = await aiMsgsB.last().innerText();
        expect(textA.trim().length).toBeGreaterThan(0);
        expect(textB.trim().length).toBeGreaterThan(0);

        await pageB.context().close();
    });
});
