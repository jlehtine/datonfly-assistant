#!/usr/bin/env node
/**
 * Dev-only per-channel search diagnostics CLI.
 *
 * Runs a list of queries against a live Qdrant + infinity-emb and prints, per
 * query, the top-k threads with per-channel detail (dense rank/score, sparse
 * rank/score, fused rank/score) so ranking behaviour can be inspected and
 * compared across changes. See `tasks/2026/search-topic-indexing.md` Phase 0.
 *
 * Usage:
 *   node dist/bin/search-eval.js --queries queries.jsonl
 *   node dist/bin/search-eval.js --query "how do I reset my password"
 *
 * `queries.jsonl` has one JSON object per line: `{ "q": "...", "expectThreadIds": ["..."] }`.
 * `expectThreadIds` is optional; when present, recall@k and reciprocal rank are printed
 * per query and averaged (MRR) across all queries that provided it.
 */
import { readFileSync } from "node:fs";

import { QdrantClient, type QdrantClient as QdrantClientType } from "@qdrant/js-client-rest";

import { queryVector, tokenize } from "../bm25.js";
import { InfinityEmbeddingsProvider } from "../infinity-embeddings.js";

/** A single line of a `queries.jsonl` file. */
interface EvalQuery {
    q: string;
    expectThreadIds?: string[];
}

/** Parsed CLI options. */
interface CliOptions {
    qdrantUrl: string;
    infinityUrl: string;
    collection: string;
    languages: string[];
    limit: number;
    queriesFile?: string;
    adhocQueries: string[];
}

/** One Qdrant point returned by `QdrantClient.query`. */
type QueryPoint = Awaited<ReturnType<QdrantClientType["query"]>>["points"][number];

/** Per-channel rank/score, present only if the point appeared in that channel's results. */
interface ChannelHit {
    rank: number;
    score: number;
}

/** Aggregated per-channel detail for a single point across the three diagnostic queries. */
interface PointSummary {
    id: string;
    threadId: string;
    content: string;
    dense?: ChannelHit;
    sparse?: ChannelHit;
    fused?: ChannelHit;
}

function printUsageAndExit(): never {
    process.stderr.write(
        [
            "Usage: search-eval [--url <qdrantUrl>] [--infinity <infinityUrl>] [--collection <name>]",
            "                    [--languages <csv>] [--limit <k>] [--queries <file.jsonl>] [--query <text> ...]",
            "",
            "At least one of --queries or --query must be given.",
        ].join("\n"),
    );
    process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
    const options: CliOptions = {
        qdrantUrl: "http://localhost:6333",
        infinityUrl: "http://localhost:8080",
        collection: "messages",
        languages: ["english"],
        limit: 10,
        adhocQueries: [],
    };

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = (): string => {
            i++;
            const value = argv[i];
            if (value === undefined) printUsageAndExit();
            return value;
        };
        switch (arg) {
            case "--url":
                options.qdrantUrl = next();
                break;
            case "--infinity":
                options.infinityUrl = next();
                break;
            case "--collection":
                options.collection = next();
                break;
            case "--languages":
                options.languages = next()
                    .split(",")
                    .map((l) => l.trim())
                    .filter(Boolean);
                break;
            case "--limit":
                options.limit = Number(next());
                break;
            case "--queries":
                options.queriesFile = next();
                break;
            case "--query":
                options.adhocQueries.push(next());
                break;
            case "--help":
            case "-h":
                printUsageAndExit();
                break;
            default:
                process.stderr.write(`Unknown argument: ${arg ?? "(missing)"}\n`);
                printUsageAndExit();
        }
    }

    if (!options.queriesFile && options.adhocQueries.length === 0) printUsageAndExit();
    if (!Number.isInteger(options.limit) || options.limit < 1) {
        throw new Error(`--limit must be a positive integer, got "${String(options.limit)}"`);
    }

    return options;
}

function loadQueries(options: CliOptions): EvalQuery[] {
    const queries: EvalQuery[] = options.adhocQueries.map((q) => ({ q }));
    if (options.queriesFile) {
        const lines = readFileSync(options.queriesFile, "utf-8").split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            queries.push(JSON.parse(trimmed) as EvalQuery);
        }
    }
    return queries;
}

/** Merge one channel's ranked results into the shared per-point summary map. */
function recordChannel(
    points: Map<string, PointSummary>,
    result: { points: QueryPoint[] },
    channel: "dense" | "sparse" | "fused",
): void {
    result.points.forEach((point, index) => {
        const id = String(point.id);
        let summary = points.get(id);
        if (!summary) {
            const threadId = (point.payload?.threadId as string | undefined) ?? "?";
            const content = (point.payload?.content as string | undefined) ?? "";
            summary = {
                id,
                threadId,
                content: content.replace(/\s+/g, " ").slice(0, 80),
            };
            points.set(id, summary);
        }
        summary[channel] = { rank: index + 1, score: point.score };
    });
}

/** Group point summaries by thread, ordered by each thread's best (lowest) fused rank. */
function groupByThread(points: Map<string, PointSummary>): { threadId: string; hits: PointSummary[] }[] {
    const byThread = new Map<string, PointSummary[]>();
    for (const summary of points.values()) {
        const hits = byThread.get(summary.threadId) ?? [];
        hits.push(summary);
        byThread.set(summary.threadId, hits);
    }

    const groups = [...byThread.entries()].map(([threadId, hits]) => ({
        threadId,
        hits: hits.sort((a, b) => (a.fused?.rank ?? Infinity) - (b.fused?.rank ?? Infinity)),
    }));
    groups.sort((a, b) => (a.hits[0]?.fused?.rank ?? Infinity) - (b.hits[0]?.fused?.rank ?? Infinity));
    return groups;
}

function formatChannel(hit: ChannelHit | undefined): string {
    return hit ? `#${String(hit.rank)} (${hit.score.toFixed(4)})` : "-";
}

async function runQuery(
    client: QdrantClient,
    embeddings: InfinityEmbeddingsProvider,
    options: CliOptions,
    evalQuery: EvalQuery,
): Promise<{
    threadGroups: { threadId: string; hits: PointSummary[] }[];
    recall: boolean | undefined;
    reciprocalRank: number | undefined;
}> {
    const denseVector = await embeddings.embedQuery(evalQuery.q);
    const sparseVector = queryVector(tokenize(evalQuery.q, options.languages));

    const [denseResult, sparseResult, fusedResult] = await Promise.all([
        client.query(options.collection, {
            query: denseVector,
            using: "dense",
            limit: options.limit,
            with_payload: true,
        }),
        client.query(options.collection, {
            query: sparseVector,
            using: "lexical",
            limit: options.limit,
            with_payload: true,
        }),
        client.query(options.collection, {
            prefetch: [
                { query: denseVector, using: "dense", limit: options.limit },
                { query: sparseVector, using: "lexical", limit: options.limit },
            ],
            // Same construct as `QdrantSearchProvider.search` — equal weights, since this tool
            // compares channels rather than tuning them.
            query: { rrf: { weights: [1, 1] } },
            limit: options.limit,
            with_payload: true,
        }),
    ]);

    const points = new Map<string, PointSummary>();
    recordChannel(points, denseResult, "dense");
    recordChannel(points, sparseResult, "sparse");
    recordChannel(points, fusedResult, "fused");

    const threadGroups = groupByThread(points).slice(0, options.limit);

    let recall: boolean | undefined;
    let reciprocalRank: number | undefined;
    if (evalQuery.expectThreadIds) {
        const expected = new Set(evalQuery.expectThreadIds);
        recall = threadGroups.some((group) => expected.has(group.threadId));
        const hitIndex = threadGroups.findIndex((group) => expected.has(group.threadId));
        reciprocalRank = hitIndex >= 0 ? 1 / (hitIndex + 1) : 0;
    }

    return { threadGroups, recall, reciprocalRank };
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const queries = loadQueries(options);

    const client = new QdrantClient({ url: options.qdrantUrl });
    const embeddings = new InfinityEmbeddingsProvider({ url: options.infinityUrl });

    const reciprocalRanks: number[] = [];
    let recallHits = 0;
    let recallTotal = 0;

    for (const evalQuery of queries) {
        process.stdout.write(`\nQuery: ${evalQuery.q}\n`);
        const { threadGroups, recall, reciprocalRank } = await runQuery(client, embeddings, options, evalQuery);

        process.stdout.write(
            `${"thread".padEnd(38)}${"dense".padEnd(16)}${"sparse".padEnd(16)}${"fused".padEnd(16)}content\n`,
        );
        for (const group of threadGroups) {
            const top = group.hits[0];
            if (!top) continue;
            process.stdout.write(
                `${group.threadId.padEnd(38)}${formatChannel(top.dense).padEnd(16)}${formatChannel(top.sparse).padEnd(16)}${formatChannel(top.fused).padEnd(16)}${top.content}\n`,
            );
        }

        if (recall !== undefined && reciprocalRank !== undefined) {
            process.stdout.write(
                `recall@${String(options.limit)}: ${String(recall)}, reciprocal rank: ${reciprocalRank.toFixed(3)}\n`,
            );
            recallTotal++;
            if (recall) recallHits++;
            reciprocalRanks.push(reciprocalRank);
        }
    }

    if (reciprocalRanks.length > 0) {
        const mrr = reciprocalRanks.reduce((sum, rr) => sum + rr, 0) / reciprocalRanks.length;
        process.stdout.write(
            `\nOverall: recall@${String(options.limit)} = ${String(recallHits)}/${String(recallTotal)}, MRR = ${mrr.toFixed(3)}\n`,
        );
    }
}

await main();
