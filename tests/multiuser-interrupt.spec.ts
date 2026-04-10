import { expect, test } from "@playwright/test";

import {
    composerInput,
    createSecondUser,
    createThreadAndSend,
    inviteMember,
    loginAsFakeUser,
    openThread,
} from "./helpers";

test.describe("multi-user interrupt", () => {
    test.setTimeout(180_000);

    test("message sent during AI streaming interrupts and restarts", async ({ page, browser }) => {
        // Alice creates thread, invites Bob
        await loginAsFakeUser(page, 1);
        const title = await createThreadAndSend(page, "Warm-up message", "interrupt");
        await inviteMember(page, "Fake Bob");
        await page.getByRole("button", { name: "Close members" }).click();

        // Bob opens the thread
        const pageB = await createSecondUser(browser, 2);
        await openThread(pageB, title);
        await expect(composerInput(pageB)).toBeEnabled({ timeout: 10_000 });

        // Track AI message count before the long prompt
        const aiMsgsA = page.locator(".datonfly-message-ai");
        const aiMsgsB = pageB.locator(".datonfly-message-ai");
        const countBefore = await aiMsgsA.count();

        // Alice sends a prompt likely to produce a long response
        const composerA = composerInput(page);
        await composerA.fill(
            "Explain the theory of relativity in great detail. " +
                "Cover both special and general relativity, the key experiments, " +
                "the mathematical foundations, and the implications for modern physics.",
        );
        await page.getByRole("button", { name: "Send", exact: true }).click();

        // Wait for streaming to start: a new AI bubble appears AND the streaming indicator shows
        await expect(aiMsgsA).toHaveCount(countBefore + 1, { timeout: 20_000 });
        const streamingBubble = aiMsgsA.last();
        await expect(streamingBubble.getByText("●")).toBeVisible({ timeout: 10_000 });

        // Also wait for some AI text content to appear (not just the indicator)
        await expect
            .poll(
                async () => {
                    const text = await streamingBubble.innerText();
                    // Strip the ● indicator and check there's meaningful content
                    return text.replace("●", "").trim().length;
                },
                { timeout: 20_000 },
            )
            .toBeGreaterThan(10);

        // Bob interrupts by sending a message mid-stream
        const composerB = composerInput(pageB);
        await composerB.fill("What is 1 + 1?");
        await pageB.getByRole("button", { name: "Send", exact: true }).click();

        // After interruption, a new (second) AI response should start for Bob's question
        // That means we should eventually have countBefore + 2 AI messages
        await expect(aiMsgsA).toHaveCount(countBefore + 2, { timeout: 60_000 });
        await expect(aiMsgsB).toHaveCount(countBefore + 2, { timeout: 60_000 });

        // Wait for the new AI response to finish streaming
        const newAiA = aiMsgsA.last();
        const newAiB = aiMsgsB.last();
        await expect(newAiA.getByText("●")).toBeHidden({ timeout: 30_000 });
        await expect(newAiB.getByText("●")).toBeHidden({ timeout: 30_000 });

        // Both users should see Bob's message
        await expect(page.locator(".datonfly-message-human", { hasText: "What is 1 + 1?" })).toBeVisible();
        await expect(pageB.locator(".datonfly-message-human", { hasText: "What is 1 + 1?" })).toBeVisible();

        // The new AI response should have meaningful content
        const responseA = await newAiA.innerText();
        const responseB = await newAiB.innerText();
        expect(responseA.trim().length).toBeGreaterThan(0);
        expect(responseB.trim().length).toBeGreaterThan(0);

        await pageB.context().close();
    });
});
