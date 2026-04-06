import { expect, type Locator, type Page } from "@playwright/test";

/** Locate the composer input textarea. */
export function composerInput(page: Page): Locator {
    return page.locator(".datonfly-composer-input textarea:not([aria-hidden])");
}

/**
 * Send a message and wait for the assistant to finish responding.
 * Returns the text content of the last assistant message.
 */
export async function sendAndWaitForReply(page: Page, text: string): Promise<string> {
    const composer = composerInput(page);

    // Capture the assistant message count BEFORE sending so fast responses
    // don't cause a race where countBefore is already incremented.
    const assistantMsgs = page.locator(".datonfly-message-ai");
    const countBefore = await assistantMsgs.count();

    await composer.fill(text);
    await page.getByRole("button", { name: "Send" }).click();

    // Ensure our own message appears
    const userMsg = page.locator(".datonfly-message-human", { hasText: text });
    await expect(userMsg).toBeVisible({ timeout: 5_000 });

    // Wait for a new assistant bubble to appear
    await expect(assistantMsgs).toHaveCount(countBefore + 1, { timeout: 20_000 });

    // Wait for streaming to finish (● indicator disappears from the last bubble)
    const lastAssistant = assistantMsgs.last();
    await expect(lastAssistant.getByText("●")).toBeHidden({ timeout: 30_000 });

    return lastAssistant.innerText();
}
