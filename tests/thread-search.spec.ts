import { expect, test } from "@playwright/test";

import { composerInput, composerSendButton } from "./helpers";

test.describe("thread search", () => {
    test("indexes a rare identifier and finds it via search, with a highlighted snippet", async ({ page }) => {
        test.setTimeout(180_000);

        await page.goto("/");

        const composer = composerInput(page);
        await expect(composer).toBeEnabled({ timeout: 10_000 });

        // A rare identifier-like token: contains a digit and a hyphen, so the lexical
        // tokenizer keeps it intact (see bm25.ts) and it won't collide with real content.
        const identifier = `TICKET-${Date.now().toString().slice(-8)}`;
        const messageText = `Please investigate ${identifier}, it looks like a regression.`;

        // Send the message and wait for our own bubble — indexing fires on the human
        // message immediately, there is no need to wait for an AI reply.
        await composer.fill(messageText);
        await composerSendButton(page).click();
        await expect(page.locator(".datonfly-message-human", { hasText: identifier })).toBeVisible({
            timeout: 10_000,
        });

        // Open search and look for the identifier. Indexing is async (fire-and-forget
        // embedding + Qdrant upsert), so retry the query until it catches up. Other,
        // weakly-relevant threads may also surface via the dense recall channel, so
        // look for our specific result rather than asserting an exact result count.
        await page.locator(".datonfly-search-toggle-button").click();
        const searchInput = page.locator(".datonfly-search-input input");
        await expect(searchInput).toBeVisible({ timeout: 5_000 });

        const matchingResult = page.locator(".datonfly-search-result-item", { hasText: identifier });
        await expect(async () => {
            await searchInput.fill("");
            await searchInput.fill(identifier);
            await expect(matchingResult).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 60_000, intervals: [2_000] });

        // The identifier's parts should be highlighted in the rendered snippet. The
        // hyphen splits it into separate word segments ("TICKET" and the digits), so
        // each surfaces as its own <mark> rather than one span covering the whole token.
        const highlights = matchingResult.locator(".datonfly-search-highlight");
        await expect(highlights.first()).toBeVisible();
        const highlightTexts = await highlights.allTextContents();
        expect(highlightTexts.some((text) => text.length > 0 && identifier.includes(text))).toBe(true);

        // Selecting the result navigates to the thread containing the message.
        await matchingResult.click();
        await expect(page.locator(".datonfly-message-human", { hasText: identifier })).toBeVisible({
            timeout: 10_000,
        });
    });
});
