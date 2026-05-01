import { expect, test } from "@playwright/test";

import { composerInput, createThreadViaApi, loginAsFakeUser, uniqueTitle } from "./helpers";

// A well-formed UUID v4 that will never exist in the database.
const NONEXISTENT_THREAD_ID = "00000000-0000-4000-8000-000000000001";

test.describe("thread routing", () => {
    test("initial URL is / when logged in", async ({ page }) => {
        await loginAsFakeUser(page, 1);
        await expect(page).toHaveURL("/");
    });

    test("select thread updates URL, new conversation returns to /, direct navigation opens thread", async ({
        page,
    }) => {
        await loginAsFakeUser(page, 1);

        const title = uniqueTitle("Route");
        const threadId = await createThreadViaApi(page, title);

        // Wait for thread to appear in the sidebar (via WS thread-created event).
        const threadItem = page.locator(".datonfly-thread-item").filter({ hasText: title });
        await expect(threadItem).toBeVisible({ timeout: 10_000 });

        // ── Selecting a thread updates the URL ──
        await expect(page).toHaveURL("/");
        await threadItem.click();
        await expect(page).toHaveURL(`/threads/${threadId}`, { timeout: 5_000 });

        // ── Clicking New conversation returns URL to / ──
        await page.click('[aria-label="New conversation"]');
        await expect(page).toHaveURL("/", { timeout: 5_000 });

        // ── Navigating directly to /threads/:id opens that thread ──
        await page.goto(`/threads/${threadId}`);
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });
        await expect(threadItem).toBeVisible({ timeout: 10_000 });
        await expect(page).toHaveURL(`/threads/${threadId}`);
    });

    test("sending the first message updates URL to /threads/:id", async ({ page }) => {
        await loginAsFakeUser(page, 1);
        await expect(page).toHaveURL("/");

        // Start typing and send — this triggers POST /threads which resolves
        // before any LLM response, so the URL change is fast.
        await composerInput(page).fill("Hello");
        await page.getByRole("button", { name: "Send", exact: true }).click();

        // URL should update once POST /threads completes (no need to wait for LLM).
        await expect(page).toHaveURL(/\/threads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, {
            timeout: 10_000,
        });
    });

    test("navigating to a non-existent thread shows a specific error and keeps the URL", async ({ page }) => {
        await loginAsFakeUser(page, 1);

        await page.goto(`/threads/${NONEXISTENT_THREAD_ID}`);
        await expect(composerInput(page)).toBeEnabled({ timeout: 10_000 });

        // A specific error alert must appear (not the generic client_error).
        const alert = page.locator(".datonfly-chat-error");
        await expect(alert).toBeVisible({ timeout: 10_000 });

        // The error code must be not_member (thread doesn't exist → not a member).
        await expect(alert).toHaveAttribute("data-error-code", "not_member");

        // URL must remain unchanged — no redirect.
        await expect(page).toHaveURL(`/threads/${NONEXISTENT_THREAD_ID}`);
    });
});
