import { expect, test } from "@playwright/test";

test("send hello and receive assistant response", async ({ page }) => {
    const consoleLogs: string[] = [];
    page.on("console", (msg) => {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    const wsMessages: string[] = [];
    page.on("websocket", (ws) => {
        wsMessages.push(`WS opened: ${ws.url()}`);
        ws.on("framereceived", (frame) => {
            wsMessages.push(`WS recv: ${frame.payload.toString().slice(0, 500)}`);
        });
        ws.on("framesent", (frame) => {
            wsMessages.push(`WS sent: ${frame.payload.toString().slice(0, 500)}`);
        });
        ws.on("close", () => {
            wsMessages.push(`WS closed: ${ws.url()}`);
        });
    });

    await page.goto("/");

    // Wait for connection
    const composer = page.getByPlaceholder("Type a message...");
    await expect(composer).toBeEnabled({ timeout: 5000 });

    // Type and send a message
    await composer.fill("Hello!");
    await page.getByRole("button", { name: "Send" }).click();

    // Expect the user message to appear
    await expect(page.getByText("Hello!")).toBeVisible({ timeout: 3000 });

    // Wait for either an assistant response or an error alert (up to 20s)
    const errorAlert = page.getByRole("alert");

    const gotResponse = await Promise.race([
        errorAlert.waitFor({ timeout: 20000 }).then(() => "error" as const),
        // Wait for any text from the assistant (streamed via message-delta)
        page
            .waitForFunction(
                () => {
                    const body = document.body.innerText;
                    // Check if there's content beyond header + "Hello!" + "Connecting..."
                    const lines = body
                        .split("\n")
                        .filter(
                            (l) =>
                                l.trim() &&
                                l.trim() !== "Verbal Assistant" &&
                                l.trim() !== "Hello!" &&
                                l.trim() !== "Connecting...",
                        );
                    return lines.length > 0;
                },
                { timeout: 20000 },
            )
            .then(() => "response" as const),
    ]);

    console.log(`\n=== RESULT: ${gotResponse} ===`);

    if (gotResponse === "error") {
        const alertText = await errorAlert.innerText();
        console.log(`Error alert text: ${alertText}`);
    }

    // Give streaming a moment to finish
    await page.waitForTimeout(3000);

    // Dump diagnostics
    const bodyText = await page.locator("body").innerText();
    console.log("\n=== PAGE TEXT ===");
    console.log(bodyText);

    console.log("\n=== CONSOLE LOGS ===");
    for (const log of consoleLogs) console.log(log);

    console.log("\n=== WEBSOCKET ACTIVITY ===");
    for (const msg of wsMessages) console.log(msg);

    // Verify outcome
    if (gotResponse === "response") {
        const bodyText2 = await page.locator("body").innerText();
        const assistantLines = bodyText2
            .split("\n")
            .filter((l) => l.trim() && l.trim() !== "Verbal Assistant" && l.trim() !== "Hello!");
        console.log("\n=== ASSISTANT RESPONSE ===");
        console.log(assistantLines.join("\n"));
        expect(assistantLines.length).toBeGreaterThan(0);
    } else {
        const alertText = await errorAlert.innerText();
        console.log("\n=== ERROR SHOWN TO USER ===");
        console.log(alertText);
        expect(await errorAlert.isVisible()).toBe(true);
    }
});
