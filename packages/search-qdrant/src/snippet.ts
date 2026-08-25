import { tokenize, wordTokens } from "./bm25.js";

/** A word-like match between the query and the content, as a `[start, end)` character range. */
interface Match {
    start: number;
    end: number;
}

/** A generated snippet and its highlight offsets, both relative to `snippet` itself. */
export interface Snippet {
    /** A window of the original content, at most `snippetChars` characters, with `…` markers if truncated. */
    snippet: string;
    /** `[start, end)` offset pairs into `snippet` marking matched regions. */
    highlights: [number, number][];
}

/** Word segmenter for locating match offsets in the original content. See bm25.ts for the "und" locale rationale. */
const WORD_SEGMENTER = new Intl.Segmenter("und", { granularity: "word" });

/**
 * Select the densest window of `content` around terms shared with `query` (surface form, ASCII-folded
 * variant, or a configured-language stem — the same match rule `bm25.ts` uses for retrieval, so what gets
 * highlighted here is exactly what made the document match), returning a snippet of at most `snippetChars`
 * characters and highlight offsets relative to that snippet.
 *
 * Falls back to the first `snippetChars` characters, with no highlights, if nothing matches.
 */
export function selectSnippet(
    content: string,
    query: string,
    languages: readonly string[],
    snippetChars = 400,
): Snippet {
    const queryTerms = new Set(tokenize(query, languages));

    const matches: Match[] = [];
    for (const segment of WORD_SEGMENTER.segment(content)) {
        if (!segment.isWordLike) continue;
        if (wordTokens(segment.segment, languages).some((term) => queryTerms.has(term))) {
            matches.push({ start: segment.index, end: segment.index + segment.segment.length });
        }
    }

    const window = selectWindow(content, matches, snippetChars);
    return buildSnippet(content, window, matches);
}

/** The `snippetChars`-wide window containing the most matches, centered on the best-scoring match. */
function selectWindow(
    content: string,
    matches: readonly Match[],
    snippetChars: number,
): { start: number; end: number } {
    const [first, ...rest] = matches;
    if (!first) {
        return { start: 0, end: Math.min(snippetChars, content.length) };
    }

    let best = windowFor(first, content, matches, snippetChars);
    for (const match of rest) {
        const candidate = windowFor(match, content, matches, snippetChars);
        if (candidate.score > best.score) best = candidate;
    }
    return best;
}

function windowFor(
    match: Match,
    content: string,
    matches: readonly Match[],
    snippetChars: number,
): { start: number; end: number; score: number } {
    const mid = (match.start + match.end) / 2;
    const start = Math.max(0, Math.min(content.length - snippetChars, Math.round(mid - snippetChars / 2)));
    const end = Math.min(content.length, start + snippetChars);
    const score = matches.filter((m) => m.start < end && m.end > start).length;
    return { start, end, score };
}

function buildSnippet(content: string, window: { start: number; end: number }, matches: readonly Match[]): Snippet {
    const prefix = window.start > 0 ? "…" : "";
    const suffix = window.end < content.length ? "…" : "";
    const snippet = prefix + content.slice(window.start, window.end) + suffix;

    // A content offset `i` inside the window maps to snippet offset `i - window.start + prefix.length`.
    const offset = window.start - prefix.length;
    const highlights: [number, number][] = [];
    for (const match of matches) {
        const start = Math.max(match.start, window.start);
        const end = Math.min(match.end, window.end);
        if (start < end) highlights.push([start - offset, end - offset]);
    }

    return { snippet, highlights };
}
