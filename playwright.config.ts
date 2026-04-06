import { defineConfig } from "@playwright/test";

const headed = process.argv.includes("--headed");

export default defineConfig({
    testDir: "./tests",
    timeout: headed ? 120_000 : 30_000,
    workers: 2,
    use: {
        baseURL: "http://localhost:5173",
        launchOptions: {
            slowMo: headed ? 500 : 0,
        },
    },
    projects: [
        {
            name: "chromium",
            use: { browserName: "chromium" },
        },
    ],
});
