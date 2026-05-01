import { expect, test } from "@playwright/test";

import { composerInput, composerSendButton, sendAndWaitForReply } from "./helpers";

test("send hello and receive assistant response", async ({ page }) => {
    await page.goto("/");

    // Wait for auth (fake mode auto-authenticates) and connection
    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    const response = await sendAndWaitForReply(page, "Hello!");
    expect(response.trim().length).toBeGreaterThan(0);
});

test("keeps markdown soft breaks and paragraph spacing", async ({ page }) => {
    await page.goto("/");
    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    // Use sendAndWaitForReply so the send button is re-enabled before the second send.
    await sendAndWaitForReply(page, "Hi!\nHow are you?");

    const singleBreakBubble = page.locator(".datonfly-message-human").last();
    await expect(singleBreakBubble).toContainText(/Hi!\s+How are you\?/);
    expect(await singleBreakBubble.locator("br").count()).toBe(0);

    await composer.fill("Hi!\n\nHow are you?");
    await composerSendButton(page).click();

    const doubleBreakBubble = page.locator(".datonfly-message-human").last();
    await expect(doubleBreakBubble).toBeVisible({ timeout: 5_000 });
    expect(await doubleBreakBubble.locator("p").count()).toBe(2);

    const secondParagraphMarginTop = await doubleBreakBubble
        .locator("p")
        .nth(1)
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).marginTop));
    expect(secondParagraphMarginTop).toBeGreaterThan(0);
});
