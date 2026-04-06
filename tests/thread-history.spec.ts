import { expect, test } from "@playwright/test";

import { composerInput, sendAndWaitForReply } from "./helpers";

const SECRET_WORD = "Serendipity";

test("assistant remembers a word from earlier in the thread", async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto("/");

    // Wait for fake-auth + websocket connection
    const composer = composerInput(page);
    await expect(composer).toBeEnabled({ timeout: 10_000 });

    // Step 1: tell the assistant to remember a word
    await sendAndWaitForReply(page, `Remember this word: ${SECRET_WORD}`);

    // Step 2: ask what the word was
    const recallResponse = await sendAndWaitForReply(page, "What was the word I asked you to remember?");

    // Step 3: verify the response contains the word (case-insensitive)
    expect(
        recallResponse.toLowerCase().includes(SECRET_WORD.toLowerCase()),
        `Expected assistant response to contain "${SECRET_WORD}" but got: "${recallResponse}"`,
    ).toBe(true);
});
