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

function formatSingleError(error: Error): string {
    const name = error.name.trim();
    const message = error.message.trim();

    if (name && message) {
        return `${name}: ${message}`;
    }

    if (message) {
        return message;
    }

    if (name) {
        return name;
    }

    return "Error";
}

/**
 * Convert a caught value into a loggable error string.
 *
 * When the value is an {@link Error}, this follows the `.cause` chain for as
 * long as each cause is also an {@link Error}, composing the chain into a
 * single string. Cycles are detected and truncated defensively.
 */
export function formatLoggedError(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error);
    }

    const segments: string[] = [];
    const seen = new Set<Error>();
    let current: Error | undefined = error;

    while (current && !seen.has(current)) {
        seen.add(current);
        segments.push(formatSingleError(current));

        const cause: unknown = current.cause;
        current = cause instanceof Error ? cause : undefined;
    }

    if (current) {
        segments.push("[Circular error cause]");
    }

    return segments.join(" <- ");
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
