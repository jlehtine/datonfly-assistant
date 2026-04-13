/** Machine-readable status code emitted during assistant streaming. */
export type StatusCode = "tool_code_execution" | "tool_web_fetch" | "tool_web_search" | "unspecified";

/** Runtime constant mapping each {@link StatusCode} to itself, useful for autocomplete and iteration. */
export const STATUS_CODES = {
    tool_code_execution: "tool_code_execution",
    tool_web_fetch: "tool_web_fetch",
    tool_web_search: "tool_web_search",
    unspecified: "unspecified",
} as const satisfies Record<StatusCode, StatusCode>;
