import { logger } from "./logger";
import { TextSplitter } from "./TextSplitter";
import { runBenchmarkFor, BenchResult, runDownload, DownloadResult } from "./helper";

/** Extends the native creation options with our custom strategy for handling large content. */
export interface SummarizerExCreateOptions extends SummarizerCreateOptions {
    /**
     * Determines how to handle content that exceeds the model's context window.
     * - `merge` (default): Summarizes chunks, then summarizes the combined summaries. Best for narrative text.
     * - `join`: Summarizes chunks and joins the results directly. Best for 'tldr' or 'key-points' where a final reduction pass is not needed.
     */
    largeContentStrategy?: 'merge' | 'join';
}

/**
 * An extended Summarizer that wraps a native instance to automatically handle inputs
 * larger than the model's context window with advanced, fail-proof chunking.
 */
export class SummarizerEx implements Summarizer {
    private readonly internalSummarizer: Summarizer;
    private readonly largeContentStrategy: 'merge' | 'join';
    private readonly inputQuotaThreshold = 0.75; // Use a high threshold, as our splitter is very accurate.
    private readonly recursivityMaxDeep = 10;

    /** The constructor is private to force users to use the async `create` method. */
    protected constructor(nativeSummarizer: Summarizer, options?: SummarizerExCreateOptions) {
        this.internalSummarizer = nativeSummarizer;
        this.largeContentStrategy = options?.largeContentStrategy || 'join';
    }

    public static support(): boolean {
        return "Summarizer" in self;
    }

    public static async availability(options?: SummarizerExCreateOptions | undefined): Promise<Availability> {
        return Summarizer.availability(options);
    }

    /** The public factory for creating a SummarizerEx instance. */
    public static async create(options: SummarizerExCreateOptions = {
        type: "tldr",
        length: "long", 
        format: "plain-text", 
        largeContentStrategy: "merge", 
        outputLanguage: "en",
    }): Promise<SummarizerEx> {
        const nativeSummarizer = await Summarizer.create(options);
        return new SummarizerEx(nativeSummarizer, options);
    }

    /**
     * Benchmark helper that creates an instance, runs a streaming summarize and
     * returns timing and throughput metrics.
     */
    public static async benchmark(options: SummarizerExCreateOptions = {}, input: string = "Benchmark this short text."): Promise<BenchResult> {
        return runBenchmarkFor(Summarizer, options, input);
    }

    public static async download(options: SummarizerExCreateOptions & { monitor?: CreateMonitorCallback } = {}): Promise<DownloadResult> {
        return runDownload(Summarizer, options);
    }

    // --- Passthrough Properties to match the Summarizer interface ---
    public get inputQuota(): number { return this.internalSummarizer.inputQuota; }
    public get sharedContext(): string { return this.internalSummarizer.sharedContext; }
    public get type(): SummarizerType { return this.internalSummarizer.type; }
    public get format(): SummarizerFormat { return this.internalSummarizer.format; }
    public get length(): SummarizerLength { return this.internalSummarizer.length; }
    public get expectedInputLanguages(): readonly string[] | undefined { return this.internalSummarizer.expectedInputLanguages; }
    public get expectedContextLanguages(): readonly string[] | undefined { return this.internalSummarizer.expectedContextLanguages; }
    public get outputLanguage(): string | undefined { return this.internalSummarizer.outputLanguage; }

    // --- Passthrough Methods ---
    public destroy(): void { this.internalSummarizer.destroy(); }
    public measureInputUsage(input: string, options?: SummarizerSummarizeOptions): Promise<number> {
        return this.internalSummarizer.measureInputUsage(input, options);
    }

    // --- Overridden Core Logic ---

    public async summarize(input: string, options?: SummarizerSummarizeOptions): Promise<string> {
        const usage = await this.measureInputUsage(input, options);
        if (usage <= this.inputQuota) {
            return this.internalSummarizer.summarize(input, options);
        }
        return this.handleLargeInput(input, options, 1, false) as Promise<string>;
    }

    public summarizeStreaming(input: string, options?: SummarizerSummarizeOptions): ReadableStream<string> {
        return new ReadableStream<string>({
            start: async (controller) => {
                try {
                    const usage = await this.measureInputUsage(input, options);
                    let finalStream: ReadableStream<string>;
                    if (usage <= this.inputQuota) {
                        finalStream = this.internalSummarizer.summarizeStreaming(input, options);
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
    private async handleLargeInput(text: string, options: SummarizerSummarizeOptions | undefined, depth: number, stream: true): Promise<ReadableStream<string>>;
    private async handleLargeInput(text: string, options: SummarizerSummarizeOptions | undefined, depth: number, stream?: false): Promise<string>;
    private async handleLargeInput(text: string, options: SummarizerSummarizeOptions | undefined, depth: number = 1, stream: boolean = false): Promise<string | ReadableStream<string>> {
        if (depth > this.recursivityMaxDeep) throw new Error("Summarization depth exceeded.");

        const splitter = new TextSplitter(
            (txt) => this.measureInputUsage(txt, options),
            this.inputQuota * this.inputQuotaThreshold
        );
        const chunks = await splitter.split(text);
        logger.info("chunks:", chunks);

        // --- STRATEGY CHECK ---
        const summaryType = (options as any)?.type || this.type;
        if (this.largeContentStrategy === 'join' && (summaryType === 'tldr' || summaryType === 'key-points')) {
            logger.info("Using 'join' strategy (parallel, no context).");

            // Summarize all chunks in parallel. This is the fastest method.
            const chunkSummaries = await Promise.all(
                chunks.map(chunk => this.internalSummarizer.summarize(chunk, options))
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

        // --- MERGE STRATEGY (This remains the same and is still valuable) ---
        logger.info(`Using 'merge' strategy (depth ${depth}).`);
        const chunkSummaries = await Promise.all(
            chunks.map(chunk => this.internalSummarizer.summarize(chunk, options))
        );
        logger.info("chunkSummaries:", chunkSummaries);
        const combinedSummary = chunkSummaries.join("\n\n");

        const combinedUsage = await this.measureInputUsage(combinedSummary, options);
        if (combinedUsage > this.inputQuota) {
            return this.handleLargeInput(combinedSummary, options, depth + 1, stream as any);
        }

        if (stream) {
            return this.internalSummarizer.summarizeStreaming(combinedSummary, options);
        }
        return this.internalSummarizer.summarize(combinedSummary, options);
    }
}
