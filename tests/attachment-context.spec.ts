import { expect, test } from "@playwright/test";

import { composerInput, composerSendButton } from "./helpers";

test("upload a text attachment, preview it, send, and render with a download link", async ({ page }) => {
    await page.goto("/");

    // Wait for auth (fake mode auto-authenticates) and connection.
    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    // The attachment action lives in the formatting toolbar next to the emoji
    // picker; expand the editor to reveal it.
    await page.getByRole("button", { name: "Toggle formatting" }).click();
    await expect(page.locator('[data-name="emoji"]')).toBeVisible();
    // Attachment follows emoji in the toolbar order.
    await expect(page.locator('[data-name="attachment"]')).toBeVisible({ timeout: 10_000 });

    // Clicking the attachment command opens the native file picker; choose a file.
    const [fileChooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.locator('[data-name="attachment"]').click(),
    ]);
    await fileChooser.setFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Hello from an attachment.", "utf-8"),
    });

    // Collapse again so the plain composer input is available for typing.
    await page.getByRole("button", { name: "Toggle formatting" }).click();
    await expect(composer).toBeVisible({ timeout: 10_000 });

    // A preview chip appears and becomes ready once uploaded.
    const preview = page.locator(".datonfly-attachment-preview").first();
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await expect(preview).toHaveAttribute("data-attachment-status", "ready", { timeout: 10_000 });

    // Send the message together with the attachment.
    await composer.fill("Please read the attached file.");
    await expect(composerSendButton(page)).toBeEnabled();
    await composerSendButton(page).click();

    // The sent human message renders the attachment with a download link.
    const sentAttachment = page.locator(".datonfly-message-human .datonfly-message-attachment").first();
    await expect(sentAttachment).toBeVisible({ timeout: 10_000 });

    const downloadHref = await sentAttachment.evaluate((el) => {
        const anchor = el.matches("a") ? el : el.querySelector("a");
        return anchor?.getAttribute("href") ?? "";
    });
    expect(downloadHref).toContain("/datonfly-assistant/attachments/");

    // The pending preview is cleared after sending.
    await expect(page.locator(".datonfly-attachment-previews")).toHaveCount(0);
});

test("remove an uploaded attachment before sending", async ({ page }) => {
    await page.goto("/");

    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    await page.locator(".datonfly-attachment-input").setInputFiles({
        name: "remove-me.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Temporary file.", "utf-8"),
    });

    const preview = page.locator(".datonfly-attachment-preview").first();
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await expect(preview).toHaveAttribute("data-attachment-status", "ready", { timeout: 10_000 });

    await preview.locator(".datonfly-remove-attachment-button").click();

    await expect(page.locator(".datonfly-attachment-preview")).toHaveCount(0);
});

test("attach a file from the collapsed input without opening the formatting editor", async ({ page }) => {
    await page.goto("/");

    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    // The plain (collapsed) input is shown by default. The attachment button is
    // available directly in the input-end adornment, alongside the audio button,
    // so files can be attached without expanding the formatting editor.
    const attachButton = page.getByRole("button", { name: "attachment", exact: true });
    await expect(attachButton).toBeVisible({ timeout: 10_000 });

    // Clicking the attachment button opens the native file picker; choose a file.
    const [fileChooser] = await Promise.all([page.waitForEvent("filechooser"), attachButton.click()]);
    await fileChooser.setFiles({
        name: "inline.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Attached from the collapsed input.", "utf-8"),
    });

    // A preview chip appears and becomes ready once uploaded — all without ever
    // toggling the formatting editor.
    const preview = page.locator(".datonfly-attachment-preview").first();
    await expect(preview).toBeVisible({ timeout: 10_000 });
    await expect(preview).toHaveAttribute("data-attachment-status", "ready", { timeout: 10_000 });

    // Send the message together with the attachment.
    await composer.fill("Here is a file attached from the plain input.");
    await expect(composerSendButton(page)).toBeEnabled();
    await composerSendButton(page).click();

    const sentAttachment = page.locator(".datonfly-message-human .datonfly-message-attachment").first();
    await expect(sentAttachment).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".datonfly-attachment-previews")).toHaveCount(0);
});
