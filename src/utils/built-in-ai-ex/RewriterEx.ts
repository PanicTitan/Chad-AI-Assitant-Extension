import { logger } from "./logger";
import { SummarizerEx } from "./SummarizerEx";
import { TextSplitter } from "./TextSplitter";
import { runBenchmarkFor, BenchResult, runDownload, DownloadResult } from "./helper";

/** Extends the native creation options with our custom strategy for handling large content. */
export interface RewriterExCreateOptions extends RewriterCreateOptions {
    /**
     * Determines how to handle content that exceeds the model's context window.
     * - `merge` (default): Rewrites chunks, then rewrites the combined rewrites. Best for narrative text.
     * - `summarize`: Rewrites chunks and summarizes the results directly. Best for 'tldr' or 'key-points' where a final reduction pass is not needed.
     * - `join`: Summarizes chunks and joins the results directly. Best for 'tldr' or 'key-points' where a final reduction pass is not needed.
     */
    largeContentStrategy?: 'merge' | 'summarize' | 'join';
}

/**
 * An extended Rewriter that wraps a native instance to automatically handle a `context`
 * that is larger than the model's context window using a "Progressive Writing" strategy.
 */
export class RewriterEx implements Rewriter {
    private readonly internalRewriter: Rewriter;
    private readonly largeContentStrategy: 'merge' | 'summarize' | 'join';
    private readonly inputQuotaThreshold = 0.75;
    private readonly recursivityMaxDeep = 10;
    
    protected constructor(nativeRewriter: Rewriter, options?: RewriterExCreateOptions) {
        this.internalRewriter = nativeRewriter;
        this.largeContentStrategy = options?.largeContentStrategy || 'join';
    }

    public static support(): boolean {
        return "Rewriter" in self;
    }

    public static async availability(options?: RewriterExCreateOptions | undefined): Promise<Availability> {
        return Rewriter.availability(options);
    }

    /** The public factory for creating a RewriterEx instance. */
    public static async create(options: RewriterExCreateOptions = {
        format: "as-is",
        largeContentStrategy: "merge",
        outputLanguage: "en",
        tone: "as-is"
    }): Promise<RewriterEx> {
        const nativeRewriter = await Rewriter.create(options);
        return new RewriterEx(nativeRewriter, options);
    }

    /**
     * Benchmark helper that creates an instance, runs a streaming rewrite and
     * returns timing and throughput metrics.
     */
    public static async benchmark(options: RewriterExCreateOptions = {}, input: string = "Benchmark this short text."): Promise<BenchResult> {
        return runBenchmarkFor(Rewriter, options, input);
    }

    public static async download(options: RewriterExCreateOptions & { monitor?: CreateMonitorCallback } = {}): Promise<DownloadResult> {
        return runDownload(Rewriter, options);
    }

    // --- Passthrough Properties to match Rewriter interface ---
    public get inputQuota(): number { return this.internalRewriter.inputQuota; }
    public get sharedContext(): string { return this.internalRewriter.sharedContext; }
    public get tone(): RewriterTone { return this.internalRewriter.tone; }
    public get format(): RewriterFormat { return this.internalRewriter.format; }
    public get length(): RewriterLength { return this.internalRewriter.length; }
    public get expectedInputLanguages(): readonly string[] | undefined { return this.internalRewriter.expectedInputLanguages; }
    public get expectedContextLanguages(): readonly string[] | undefined { return this.internalRewriter.expectedContextLanguages; }
    public get outputLanguage(): string | undefined { return this.internalRewriter.outputLanguage; }

    // --- Passthrough Methods ---
    public destroy(): void { this.internalRewriter.destroy(); }
    public measureInputUsage(input: string, options?: RewriterRewriteOptions): Promise<number> {
        return this.internalRewriter.measureInputUsage(input, options);
    }

    // --- Overridden Core Logic ---

    public async rewrite(input: string, options?: RewriterRewriteOptions): Promise<string> {
        const usage = await this.measureInputUsage(input, options);
        if (usage <= this.inputQuota) {
            return this.internalRewriter.rewrite(input, options);
        }
        return this.handleLargeInput(input, options, 1, false) as Promise<string>;
    }

    public rewriteStreaming(input: string, options?: RewriterRewriteOptions): ReadableStream<string> {
        return new ReadableStream<string>({
            start: async (controller) => {
                try {
                    const usage = await this.measureInputUsage(input, options);
                    let finalStream: ReadableStream<string>;
                    if (usage <= this.inputQuota) {
                        finalStream = this.internalRewriter.rewriteStreaming(input, options);
                    } else {
                        finalStream = await this.handleLargeInput(input, options, 1, true) as ReadableStream<string>;
                    }
                    // Pipe the chosen stream to our controller to pass data to the user.
                    const reader = finalStream.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            break; // Internal stream is finished.
                        }
                        controller.enqueue(value); // Pass the chunk to the user.
                    }
                    controller.close();
                } catch (error) {
                    controller.error(error);
                }
            }
        });
    }

    // --- The Core Large Content Handler ---

    // The function overloads remain the same to ensure type safety.
    private async handleLargeInput(text: string, options: RewriterRewriteOptions | undefined, depth: number, stream: true): Promise<ReadableStream<string>>;
    private async handleLargeInput(text: string, options: RewriterRewriteOptions | undefined, depth: number, stream?: false): Promise<string>;
    private async handleLargeInput(text: string, options: RewriterRewriteOptions | undefined, depth: number = 1, stream: boolean = false): Promise<string | ReadableStream<string>> {
        if (depth > this.recursivityMaxDeep) throw new Error("Summarization depth exceeded.");

        const splitter = new TextSplitter(
            (txt) => this.measureInputUsage(txt, options),
            this.inputQuota * this.inputQuotaThreshold
        );
        const chunks = await splitter.split(text);
        logger.info("chunks:", chunks);

        // --- STRATEGY CHECK ---
        if (this.largeContentStrategy === 'join') {
            logger.info("Using 'join' strategy (parallel, no context).");

            // Summarize all chunks in parallel. This is the fastest method.
            const chunkSummaries = await Promise.all(
                chunks.map(chunk => this.internalRewriter.rewrite(chunk, options))
            );
            logger.info("chunkSummaries:", chunkSummaries);
            const combinedSummary = chunkSummaries.join("\n\n");

            if (stream) {
                return new ReadableStream({
                    start(controller) {
                        controller.enqueue(combinedSummary);
                        controller.close();
                    }
                });
            }
            return combinedSummary;
        }

        if (this.largeContentStrategy === 'summarize') {
            logger.info("Using 'summarize' strategy (parallel, no context).");
            console.log("this.outputLanguage:", this.outputLanguage)
            let summarizer = await SummarizerEx.create({
                format: "plain-text",
                largeContentStrategy: "join",
                length: "long",
                type: "tldr",
            });

            let summary = await summarizer.summarize(text);
            logger.info("summary:", summary);

            if (stream) {
                return this.internalRewriter.rewriteStreaming(summary, options);
            }
            return this.internalRewriter.rewrite(summary, options);
        }

        // --- MERGE STRATEGY (This remains the same and is still valuable) ---
        logger.info(`Using 'merge' strategy (depth ${depth}).`);
        const chunkSummaries = await Promise.all(
            chunks.map(chunk => this.internalRewriter.rewrite(`Sumarize this content shortly for me: \n${chunk}`, options))
        );
        logger.info("chunkSummaries:", chunkSummaries);
        const combinedSummary = chunkSummaries.join("\n\n");

        const combinedUsage = await this.measureInputUsage(combinedSummary, options);
        if (combinedUsage > this.inputQuota) {
            return this.handleLargeInput(combinedSummary, options, depth + 1, stream as any);
        }

        if (stream) {
            return this.internalRewriter.rewriteStreaming(combinedSummary, options);
        }
        return this.internalRewriter.rewrite(combinedSummary, options);
    }
}
