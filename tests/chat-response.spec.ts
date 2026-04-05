import { expect, test } from "@playwright/test";

import { sendAndWaitForReply } from "./helpers";

test("send hello and receive assistant response", async ({ page }) => {
    await page.goto("/");

    // Wait for auth (fake mode auto-authenticates) and connection
    const composer = page.getByPlaceholder("Type a message...");
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    const response = await sendAndWaitForReply(page, "Hello!");
    expect(response.trim().length).toBeGreaterThan(0);
});
