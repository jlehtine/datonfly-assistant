#!/usr/bin/env node
/**
 * Standalone fake Anthropic API, replaying committed/synthesized fixtures.
 *
 * Runs automatically as part of `pnpm dev` (see the `fake-api` turbo task) so
 * it is always available on `PORT` (default 4010) for `ANTHROPIC_BASE_URL` to
 * point at — the backend only actually talks to it once that variable is set.
 *
 * Both halves reload without a manual restart: `node --watch` (see the
 * `fake-api` script) restarts this process when `tsc --watch` rebuilds `dist`,
 * and the server itself watches the fixture directory. Fixtures are read rather
 * than imported, so the two mechanisms cover different things.
 *
 * Usage: `PORT=4010 FAKE_API_SPEED=8 node dist/bin/fake-api-server.js`
 */
import { startPlaybackServer } from "../testing/playback-server.js";

async function main(): Promise<void> {
    const port = Number(process.env.PORT ?? 4010);
    const speed = Number(process.env.FAKE_API_SPEED ?? 8);
    const server = await startPlaybackServer({ port, speed });
    process.stdout.write(`Fake Anthropic API replaying fixtures at ${server.url} (speed ${String(speed)}x)\n`);

    const shutdown = (): void => {
        void server.close().then(() => {
            process.exit(0);
        });
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
}

await main();
