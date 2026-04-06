import { expect, test } from "@playwright/test";

import { composerInput, sendAndWaitForReply } from "./helpers";

test("input is focused on page load", async ({ page }) => {
    await page.goto("/");

    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });
    await expect(composer).toBeFocused({ timeout: 5_000 });
});

test("input is re-focused after assistant response", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto("/");

    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    await sendAndWaitForReply(page, "Hello!");

    // After the response completes, the input should be focused again
    await expect(composer).toBeFocused({ timeout: 5_000 });
});
