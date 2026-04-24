/** Structured logger contract used by provider packages (agents, search, etc.). */
export interface ProviderLogger {
    /** Log an error event with structured fields. */
    error(fields: Record<string, unknown>, message?: string): void;

    /** Create a child logger with additional contextual fields. */
    child(fields: Record<string, unknown>): ProviderLogger;
}

/** No-op {@link ProviderLogger} that silently discards all log calls. */
export const NOOP_PROVIDER_LOGGER: ProviderLogger = {
    error() {
        // Intentionally empty.
    },
    child() {
        return NOOP_PROVIDER_LOGGER;
    },
};
