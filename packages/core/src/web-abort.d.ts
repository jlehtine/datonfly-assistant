/**
 * Minimal ambient declarations for AbortController / AbortSignal.
 *
 * These APIs are available in all target runtimes (Node 15+, modern browsers)
 * but are not included in TypeScript's `lib: ["ES2022"]`.  Rather than pulling
 * in the entire DOM lib or `@types/node` (which would pollute core with
 * runtime-specific globals), we declare only the subset we actually use.
 */

interface AbortSignal {
    readonly aborted: boolean;
    readonly reason: unknown;
    addEventListener(type: "abort", listener: () => void): void;
    removeEventListener(type: "abort", listener: () => void): void;
}

interface AbortController {
    readonly signal: AbortSignal;
    abort(reason?: unknown): void;
}

// eslint-disable-next-line no-var -- ambient declarations require `var`
declare var AbortController: {
    prototype: AbortController;
    new (): AbortController;
};

// eslint-disable-next-line no-var -- ambient declarations require `var`
declare var AbortSignal: {
    prototype: AbortSignal;
    new (): AbortSignal;
};
