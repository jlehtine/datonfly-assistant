import { expect, type Browser, type Locator, type Page } from "@playwright/test";

/** Locate the composer input textarea. */
export function composerInput(page: Page): Locator {
    return page.locator(".datonfly-composer-input textarea:not([aria-hidden])");
}

/** Locate the composer send button. */
export function composerSendButton(page: Page): Locator {
    return page.locator(".datonfly-send-button");
}

/** Locate a thread list item by its data-thread-title marker attribute. */
export function threadItemByTitle(page: Page, title: string): Locator {
    return page.locator(`.datonfly-thread-item[data-thread-title="${title.replaceAll('"', '\\"')}"]`);
}

/**
 * Send a message and wait for the assistant to finish responding.
 * Returns the text content of the last assistant message.
 */
export async function sendAndWaitForReply(page: Page, text: string): Promise<string> {
    // Capture the assistant message count BEFORE sending so fast responses
    // don't cause a race where countBefore is already incremented.
    const assistantMsgs = page.locator(".datonfly-message-ai");
    const countBefore = await assistantMsgs.count();

    // Thread switches can transiently remount the composer. Fill + click with a
    // small retry loop so we don't get stuck on a detached or temporarily disabled
    // send button.
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });
        await composer.fill(text);

        const sendButton = composerSendButton(page);
        await expect(sendButton).toBeVisible({ timeout: 10_000 });
        await expect(sendButton).toBeEnabled({ timeout: 10_000 });

        try {
            await sendButton.click({ timeout: 10_000 });
            break;
        } catch (error) {
            if (attempt === 1) {
                throw error;
            }
        }
    }

    // Ensure our own message appears
    const userMsg = page.locator(".datonfly-message-human", { hasText: text });
    await expect(userMsg).toBeVisible({ timeout: 5_000 });

    // Wait for a new assistant bubble to appear
    await expect(assistantMsgs).toHaveCount(countBefore + 1, { timeout: 20_000 });

    // Wait for streaming to finish (indicator disappears from the last bubble)
    const lastAssistant = assistantMsgs.last();
    await expect(lastAssistant.locator(".datonfly-message-streaming-indicator")).toHaveCount(0, { timeout: 30_000 });

    return lastAssistant.innerText();
}

// ── Multi-user helpers ──────────────────────────────────────────────────────

/** Generate a unique title string for thread identification in tests. */
export function uniqueTitle(label: string): string {
    return `${label}-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Log in as a fake user by navigating to the login endpoint.
 * Waits for redirect and the composer to become enabled.
 */
export async function loginAsFakeUser(page: Page, fakeid: number): Promise<void> {
    await page.goto(`/auth/login?fakeid=${String(fakeid)}`);
    await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });
}

/**
 * Create a second browser context logged in as a different fake user.
 * Returns both the new context's page and a cleanup function.
 */
export async function createSecondUser(browser: Browser, fakeid: number): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsFakeUser(page, fakeid);
    return page;
}

/**
 * Ensure a fake user exists in persistence by performing one login handshake.
 *
 * Invite-by-name lookups rely on persisted users, so tests that invite before
 * opening a second user session should call this first.
 */
export async function ensureFakeUserExists(browser: Browser, fakeid: number): Promise<void> {
    const page = await createSecondUser(browser, fakeid);
    await page.context().close();
}

/**
 * Rename the currently selected thread via the inline editable title in the chat header.
 */
export async function renameCurrentThread(page: Page, newTitle: string): Promise<void> {
    await page.locator(".datonfly-edit-title-button").click();
    const titleInput = page.locator(".datonfly-edit-title-input input[maxlength]");
    await expect(titleInput).toBeFocused({ timeout: 3_000 });
    await titleInput.fill(newTitle);
    await titleInput.press("Enter");
}

/**
 * Send a message that creates a new thread, rename it for identification,
 * and wait for the AI reply to complete. Returns the unique title.
 */
export async function createThreadAndSend(page: Page, text: string, label: string): Promise<string> {
    await sendAndWaitForReply(page, text);
    // Wait for thread item to appear in sidebar
    await expect(page.locator(".datonfly-thread-item").first()).toBeVisible({ timeout: 15_000 });
    // Let any auto-title arrive before we overwrite
    await page.waitForTimeout(2_000);
    const title = uniqueTitle(label);
    await renameCurrentThread(page, title);
    await expect(threadItemByTitle(page, title)).toBeVisible({ timeout: 10_000 });
    return title;
}

/**
 * Open the member drawer by clicking the invite button, search for a user,
 * and select them. Waits for the member count to increase.
 */
export async function inviteMember(page: Page, name: string): Promise<void> {
    // Open member drawer via invite button
    await page.locator(".datonfly-invite-member-button").click();

    // Wait for drawer to open and the invite autocomplete to be visible
    const searchInput = page.locator(".datonfly-invite-search-input");
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Get current member count
    const memberCount = page.locator(".datonfly-member-count");
    const countBefore = parseInt((await memberCount.getAttribute("data-member-count")) ?? "0", 10);

    // Search and select user
    await searchInput.fill(name);
    await page.locator(".datonfly-invite-option").first().click();

    // Wait for member count to increase
    await expect(memberCount).toHaveAttribute("data-member-count", String(countBefore + 1), { timeout: 10_000 });
}

/** Open the member drawer. If it's already open, this is a no-op. */
export async function openMemberDrawer(page: Page): Promise<void> {
    await page.locator(".datonfly-invite-member-button").click();
    await expect(page.locator(".datonfly-member-count")).toBeVisible({ timeout: 5_000 });
}

/** Open a thread from the sidebar by matching its title text. */
export async function openThread(page: Page, title: string): Promise<void> {
    const threadItem = threadItemByTitle(page, title);
    await expect(threadItem).toBeVisible({ timeout: 15_000 });
    await threadItem.click();
    // Wait for selection state to settle so follow-up composer interactions
    // do not race against route-driven remounts.
    await expect(threadItem).toHaveClass(/Mui-selected/, { timeout: 10_000 });
}

/** Wait for a message with given text and role to appear. */
export async function waitForMessage(page: Page, text: string, role: "human" | "ai"): Promise<void> {
    const selector = role === "human" ? ".datonfly-message-human" : ".datonfly-message-ai";
    await expect(page.locator(selector, { hasText: text })).toBeVisible({ timeout: 30_000 });
}

/**
 * Create a new thread via the REST API from within the authenticated browser context.
 * Returns the new thread's ID. Does not require an LLM response.
 */
export async function createThreadViaApi(page: Page, title: string): Promise<string> {
    const threadId = await page.evaluate(async (t: string) => {
        const res = await fetch("/datonfly-assistant/threads", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: t }),
        });
        if (!res.ok) throw new Error(`POST /threads failed: ${res.status.toString()}`);
        const data = (await res.json()) as { id: string };
        return data.id;
    }, title);
    return threadId;
}
