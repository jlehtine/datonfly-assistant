import { expect, test } from "@playwright/test";

import { composerInput, composerSendButton } from "./helpers";

test("upload a text attachment, preview it, send, and render with a download link", async ({ page }) => {
    await page.goto("/");

    // Wait for auth (fake mode auto-authenticates) and connection.
    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    // The attachment "+" button is shown only when the server advertises fileInput.
    await expect(page.locator(".datonfly-add-attachment-button")).toBeVisible({ timeout: 10_000 });

    // Attach a small text file via the hidden file input.
    await page.locator(".datonfly-attachment-input").setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("Hello from an attachment.", "utf-8"),
    });

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
