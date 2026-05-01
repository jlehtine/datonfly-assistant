import { expect, test } from "@playwright/test";

import { composerInput } from "./helpers";

test.describe("alias settings", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });
    });

    test("set alias via sidebar settings cog", async ({ page }) => {
        // Open the settings popover from the ThreadListPanel cog icon
        await page.locator(".datonfly-thread-settings-button").click();

        // The AI Alias field should appear
        const aliasInput = page.locator(".datonfly-alias-input");
        await expect(aliasInput).toBeVisible({ timeout: 5_000 });

        // Type a new alias and save
        await aliasInput.click();
        await aliasInput.fill("");
        await aliasInput.pressSequentially("SidebarAlias");
        await page.locator(".datonfly-alias-save-button").click();

        // Popover should close after save
        await expect(aliasInput).toBeHidden({ timeout: 5_000 });

        // Re-open and verify the alias persisted
        await page.locator(".datonfly-thread-settings-button").click();
        const reopenedInput = page.locator(".datonfly-alias-input");
        await expect(reopenedInput).toBeVisible({ timeout: 5_000 });
        await expect(reopenedInput).toHaveValue("SidebarAlias");
    });

    test("set alias via user menu Chat Settings", async ({ page }) => {
        // Open user menu
        await page.locator(".datonfly-user-menu-button").click();

        // Click chat settings
        await page.locator(".datonfly-chat-settings-menuitem").click();

        // The AI Alias field should appear inside the dialog
        const aliasInput = page.locator(".datonfly-alias-input");
        await expect(aliasInput).toBeVisible({ timeout: 5_000 });

        // Type a new alias and save
        await aliasInput.click();
        await aliasInput.fill("");
        await aliasInput.pressSequentially("MenuAlias");
        await page.locator(".datonfly-alias-save-button").click();

        // Dialog should close after save
        await expect(aliasInput).toBeHidden({ timeout: 5_000 });

        // Re-open via user menu and verify
        await page.locator(".datonfly-user-menu-button").click();
        await page.locator(".datonfly-chat-settings-menuitem").click();
        const reopenedInput = page.locator(".datonfly-alias-input");
        await expect(reopenedInput).toBeVisible({ timeout: 5_000 });
        await expect(reopenedInput).toHaveValue("MenuAlias");
    });
});
