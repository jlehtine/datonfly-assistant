import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { FileMigrationProvider, Kysely, Migrator, PostgresDialect } from "kysely";
import pg from "pg";

import { PostgresPersistenceProvider } from "./provider.js";
import type { Database } from "./schema.js";

export interface CreatePostgresPersistenceOptions {
    connectionString: string;
}

export interface PostgresPersistenceResult {
    provider: PostgresPersistenceProvider;
    destroy: () => Promise<void>;
}

export async function createPostgresPersistence(
    options: CreatePostgresPersistenceOptions,
): Promise<PostgresPersistenceResult> {
    const pool = new pg.Pool({ connectionString: options.connectionString });

    const db = new Kysely<Database>({
        dialect: new PostgresDialect({ pool }),
    });

    // Run migrations
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const migrator = new Migrator({
        db,
        provider: new FileMigrationProvider({
            fs,
            path,
            migrationFolder: path.join(__dirname, "migrations"),
        }),
    });

    const { error, results } = await migrator.migrateToLatest();

    results?.forEach((it) => {
        if (it.status === "Success") {
            console.log(`Migration "${it.migrationName}" executed successfully`);
        } else if (it.status === "Error") {
            console.error(`Migration "${it.migrationName}" failed`);
        }
    });

    if (error) {
        throw new Error(`Database migration failed: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
    }

    const provider = new PostgresPersistenceProvider(db);

    return {
        provider,
        destroy: async () => {
            await db.destroy();
        },
    };
}

export { PostgresPersistenceProvider } from "./provider.js";
export type { Database } from "./schema.js";
