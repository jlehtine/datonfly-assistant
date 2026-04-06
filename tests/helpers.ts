import { expect, type Page } from "@playwright/test";

/**
 * Send a message and wait for the assistant to finish responding.
 * Returns the text content of the last assistant message.
 */
export async function sendAndWaitForReply(page: Page, text: string): Promise<string> {
    const composer = page.getByPlaceholder("Type a message...");
    await composer.fill(text);
    await page.getByRole("button", { name: "Send" }).click();

    // Ensure our own message appears
    const userMsg = page.locator("[data-role='human']", { hasText: text });
    await expect(userMsg).toBeVisible({ timeout: 5_000 });

    // Wait for a new assistant bubble to appear
    const assistantMsgs = page.locator("[data-role='ai']");
    const countBefore = await assistantMsgs.count();
    await expect(assistantMsgs).toHaveCount(countBefore + 1, { timeout: 20_000 });

    // Wait for streaming to finish (● indicator disappears from the last bubble)
    const lastAssistant = assistantMsgs.last();
    await expect(lastAssistant.getByText("●")).toBeHidden({ timeout: 30_000 });

    return lastAssistant.innerText();
}
