import { expect, test } from "@playwright/test";

import { composerInput } from "./helpers";

test.describe("alias settings", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/");
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });
    });

    test("set alias via sidebar settings cog", async ({ page }) => {
        // Open the settings popover from the ThreadListPanel cog icon
        await page.getByRole("button", { name: "Settings" }).click();

        // The AI Alias field should appear
        const aliasInput = page.getByPlaceholder("Unidentified user");
        await expect(aliasInput).toBeVisible({ timeout: 5_000 });

        // Type a new alias and save
        await aliasInput.click();
        await aliasInput.fill("");
        await aliasInput.pressSequentially("SidebarAlias");
        await page.getByRole("button", { name: "Save" }).click();

        // Popover should close after save
        await expect(aliasInput).toBeHidden({ timeout: 5_000 });

        // Re-open and verify the alias persisted
        await page.getByRole("button", { name: "Settings" }).click();
        const reopenedInput = page.getByPlaceholder("Unidentified user");
        await expect(reopenedInput).toBeVisible({ timeout: 5_000 });
        await expect(reopenedInput).toHaveValue("SidebarAlias");
    });

    test("set alias via user menu Chat Settings", async ({ page }) => {
        // Open user menu
        await page.getByRole("button", { name: "User menu" }).click();

        // Click "Chat Settings"
        await page.getByRole("menuitem", { name: "Chat Settings" }).click();

        // The AI Alias field should appear inside the dialog
        const aliasInput = page.getByPlaceholder("Unidentified user");
        await expect(aliasInput).toBeVisible({ timeout: 5_000 });

        // Type a new alias and save
        await aliasInput.click();
        await aliasInput.fill("");
        await aliasInput.pressSequentially("MenuAlias");
        await page.getByRole("button", { name: "Save" }).click();

        // Dialog should close after save
        await expect(aliasInput).toBeHidden({ timeout: 5_000 });

        // Re-open via user menu and verify
        await page.getByRole("button", { name: "User menu" }).click();
        await page.getByRole("menuitem", { name: "Chat Settings" }).click();
        const reopenedInput = page.getByPlaceholder("Unidentified user");
        await expect(reopenedInput).toBeVisible({ timeout: 5_000 });
        await expect(reopenedInput).toHaveValue("MenuAlias");
    });
});
