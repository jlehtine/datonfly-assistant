import { newStemmer, type Stemmer } from "snowball-stemmers";

/** A Qdrant sparse vector: parallel arrays of term indices and weights. */
export interface SparseVector {
    indices: number[];
    values: number[];
}

/** BM25 term-frequency saturation constant. */
const DEFAULT_K1 = 1.5;

/** BM25 length-normalization constant. */
const DEFAULT_B = 0.75;

/** Default average document length, in tokens, matching FastEmbed's `Bm25` reference implementation. */
const DEFAULT_AVG_LEN = 256;

/** Word segmenter used for tokenization. `"und"` (undetermined) applies generic Unicode word-boundary rules,
 * deliberately not tied to any configured language — see the "no language detection" rationale in bm25.test.ts. */
const WORD_SEGMENTER = new Intl.Segmenter("und", { granularity: "word" });

/** Characters that mark a whitespace-delimited chunk as identifier-like rather than natural-language text. */
const IDENTIFIER_CHARS = /[0-9_\-./@]/;

/** Maps Snowball algorithm names to short namespace prefixes for stems (falls back to the full name). */
const LANGUAGE_TAGS: Record<string, string> = {
    arabic: "ar",
    armenian: "hy",
    basque: "eu",
    catalan: "ca",
    czech: "cs",
    danish: "da",
    dutch: "nl",
    english: "en",
    finnish: "fi",
    french: "fr",
    german: "de",
    hungarian: "hu",
    italian: "it",
    irish: "ga",
    norwegian: "no",
    portuguese: "pt",
    romanian: "ro",
    russian: "ru",
    spanish: "es",
    slovene: "sl",
    swedish: "sv",
    tamil: "ta",
    turkish: "tr",
};

/** Stemmer instances are expensive-ish to construct; build each configured language once and reuse it. */
const stemmerCache = new Map<string, Stemmer>();

function getStemmer(language: string): Stemmer {
    let stemmer = stemmerCache.get(language);
    if (!stemmer) {
        stemmer = newStemmer(language);
        stemmerCache.set(language, stemmer);
    }
    return stemmer;
}

function languageTag(language: string): string {
    return LANGUAGE_TAGS[language] ?? language;
}

/** A whitespace-delimited chunk containing a digit, `_`, `-`, `.`, `/`, `@`, or mixed case is an identifier. */
function isIdentifierLike(chunk: string): boolean {
    if (IDENTIFIER_CHARS.test(chunk)) return true;
    return /[a-z]/.test(chunk) && /[A-Z]/.test(chunk);
}

/** Strips combining diacritical marks, folding accented Latin text to its ASCII-equivalent base letters. */
function foldAscii(term: string): string {
    return term.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Tokenize text for BM25 indexing/querying.
 *
 * Two independent passes contribute terms:
 * - Whitespace-delimited chunks that look like identifiers (containing a digit, `_`, `-`, `.`, `/`, `@`, or mixed
 *   case) are emitted verbatim and lowercased, so `ABC-1234`, `getUserById` and `user@example.com` survive intact.
 * - The full text is also word-segmented with `Intl.Segmenter`, and every word-like segment contributes its
 *   lowercased surface form, an ASCII-folded variant (if different), and one namespaced stem per configured
 *   `languages` entry (e.g. `en:cat`, `fi:kissa`) — every language's stemmer runs over every token, since chat
 *   messages are too short and too often mixed-language/code-heavy for reliable per-message language detection,
 *   and mismatched index/query detection would silently break retrieval.
 *
 * No stopword filtering is done — Qdrant's IDF modifier already drives common terms to near-zero weight.
 */
export function tokenize(text: string, languages: readonly string[]): string[] {
    const tokens: string[] = [];

    for (const chunk of text.split(/\s+/)) {
        if (chunk && isIdentifierLike(chunk)) {
            tokens.push(chunk.toLowerCase());
        }
    }

    for (const segment of WORD_SEGMENTER.segment(text)) {
        if (!segment.isWordLike) continue;
        const surface = segment.segment.toLowerCase();
        tokens.push(surface);

        const folded = foldAscii(surface);
        if (folded !== surface) tokens.push(folded);

        for (const language of languages) {
            tokens.push(`${languageTag(language)}:${getStemmer(language).stem(surface)}`);
        }
    }

    return tokens;
}

/** 32-bit FNV-1a hash, mapping a term to a `u32` sparse-vector index. Collisions are negligible at this vocabulary size. */
export function fnv1a32(term: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < term.length; i++) {
        hash ^= term.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** Options for {@link documentVector}. */
export interface DocumentVectorOptions {
    /** Term-frequency saturation constant. Defaults to `1.5`. */
    k1?: number;
    /** Length-normalization constant. Defaults to `0.75`. */
    b?: number;
    /** Average document length, in tokens, used for length normalization. Defaults to `256`. */
    avgLen?: number;
}

/**
 * Build a document sparse vector carrying only the BM25 **term-frequency** component; Qdrant's `idf` modifier
 * supplies the IDF half at query time:
 * `w = tf * (k1 + 1) / (tf + k1 * (1 - b + b * len / avgLen))`.
 */
export function documentVector(tokens: readonly string[], options?: DocumentVectorOptions): SparseVector {
    const k1 = options?.k1 ?? DEFAULT_K1;
    const b = options?.b ?? DEFAULT_B;
    const avgLen = options?.avgLen ?? DEFAULT_AVG_LEN;
    const len = tokens.length;

    const termFrequencies = new Map<string, number>();
    for (const token of tokens) {
        termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1);
    }

    const indices: number[] = [];
    const values: number[] = [];
    for (const [term, tf] of termFrequencies) {
        const weight = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / avgLen));
        indices.push(fnv1a32(term));
        values.push(weight);
    }
    return { indices, values };
}

/** Build a query sparse vector: weight `1.0` per distinct term. */
export function queryVector(tokens: readonly string[]): SparseVector {
    const indices: number[] = [];
    const values: number[] = [];
    for (const term of new Set(tokens)) {
        indices.push(fnv1a32(term));
        values.push(1.0);
    }
    return { indices, values };
}
