/**
 * Structured logger contract used by provider packages (agents, search, etc.).
 *
 * The method signatures follow the Pino convention `(fields, message?)` so
 * that a Pino logger instance satisfies this interface without adapters.
 */
export interface ProviderLogger {
    /** Log a debug event with structured fields. */
    debug(fields: Record<string, unknown>, message?: string): void;
    /** Log an informational event with structured fields. */
    info(fields: Record<string, unknown>, message?: string): void;
    /** Log a warning event with structured fields. */
    warn(fields: Record<string, unknown>, message?: string): void;
    /** Log an error event with structured fields. */
    error(fields: Record<string, unknown>, message?: string): void;

    /** Create a child logger with additional contextual fields. */
    child(fields: Record<string, unknown>): ProviderLogger;
}

/** No-op {@link ProviderLogger} that silently discards all log calls. */
export const NOOP_PROVIDER_LOGGER: ProviderLogger = {
    debug() {
        // Intentionally empty.
    },
    info() {
        // Intentionally empty.
    },
    warn() {
        // Intentionally empty.
    },
    error() {
        // Intentionally empty.
    },
    child() {
        return NOOP_PROVIDER_LOGGER;
    },
};
