import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { FileMigrationProvider, Kysely, Migrator, PostgresDialect } from "kysely";
import pg from "pg";

import { PostgresPersistenceProvider } from "./provider.js";
import type { Database } from "./schema.js";

/** Options for {@link createPostgresPersistence}. */
export interface CreatePostgresPersistenceOptions {
    /** `pg`-compatible connection string (e.g. `"postgresql://user:pass@host:5432/db"`). */
    connectionString: string;
}

/** Return value of {@link createPostgresPersistence}. */
export interface PostgresPersistenceResult {
    /** Fully initialised persistence provider ready for use. */
    provider: PostgresPersistenceProvider;
    /** Gracefully close the underlying connection pool. */
    destroy: () => Promise<void>;
}

/**
 * Create a {@link PostgresPersistenceProvider}, run any pending database migrations,
 * and return the provider together with a `destroy` function to release the pool.
 *
 * @param options - Connection options.
 * @throws {Error} When one or more migrations fail to apply.
 */
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
        migrationTableSchema: "dfa",
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
