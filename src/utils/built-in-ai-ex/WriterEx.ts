import { logger } from "./logger";
import { SummarizerEx } from "./SummarizerEx";
import { TextSplitter } from "./TextSplitter";
import { runBenchmarkFor, BenchResult, runDownload, DownloadResult } from "./helper";

/** Extends the native creation options with our custom strategy for handling large content. */
export interface WriterExCreateOptions extends WriterCreateOptions {
    /**
     * Determines how to handle content that exceeds the model's context window.
     * - `merge` (default): Writes chunks, then writes the combined writes. Best for narrative text.
     * - `summarize`: Writes chunks and summarizes the results directly. Best for 'tldr' or 'key-points' where a final reduction pass is not needed.
     * - `join`: Summarizes chunks and joins the results directly. Best for 'tldr' or 'key-points' where a final reduction pass is not needed.
     */
    largeContentStrategy?: 'merge' | 'summarize' | 'join';
}

/**
 * An extended Writer that wraps a native instance to automatically handle a `context`
 * that is larger than the model's context window using a "Progressive Writing" strategy.
 */
export class WriterEx implements Writer {
    private readonly internalWriter: Writer;
    private readonly largeContentStrategy: 'merge' | 'summarize' | 'join';
    private readonly inputQuotaThreshold = 0.75;
    private readonly recursivityMaxDeep = 10;
    
    protected constructor(nativeWriter: Writer, options?: WriterExCreateOptions) {
        this.internalWriter = nativeWriter;
        this.largeContentStrategy = options?.largeContentStrategy || 'merge';
    }

    public static support(): boolean {
        return "Writer" in self;
    }

    public static async availability(options?: WriterExCreateOptions | undefined): Promise<Availability> {
        return Writer.availability(options);
    }

    /** The public factory for creating a WriterEx instance. */
    public static async create(options: WriterExCreateOptions = {
        format: "plain-text",
        largeContentStrategy: "merge",
        outputLanguage: "en",
        tone: "neutral"
    }): Promise<WriterEx> {
        console.log("Writer:", Writer)
        const nativeWriter = await Writer.create(options);
        console.log("nativeWriter:", nativeWriter)
        return new WriterEx(nativeWriter, options);
    }

    /**
     * Benchmark helper that creates an instance, runs a streaming write and
     * returns timing and throughput metrics.
     */
    public static async benchmark(options: WriterExCreateOptions = {}, input: string = "Benchmark this short text."): Promise<BenchResult> {
        return runBenchmarkFor(Writer, options, input);
    }

    /** Ensure the Writer model is downloaded/available. */
    public static async download(options: WriterExCreateOptions & { monitor?: CreateMonitorCallback } = {}): Promise<DownloadResult> {
        return runDownload(Writer, options);
    }

    // --- Passthrough Properties to match Writer interface ---
    public get inputQuota(): number { return this.internalWriter.inputQuota; }
    public get sharedContext(): string | undefined { return this.internalWriter.sharedContext; }
    public get tone(): WriterTone { return this.internalWriter.tone; }
    public get format(): WriterFormat { return this.internalWriter.format; }
    public get length(): WriterLength { return this.internalWriter.length; }
    public get expectedInputLanguages(): readonly string[] | undefined { return this.internalWriter.expectedInputLanguages; }
    public get expectedContextLanguages(): readonly string[] | undefined { return this.internalWriter.expectedContextLanguages; }
    public get outputLanguage(): string | undefined { return this.internalWriter.outputLanguage; }

    // --- Passthrough Methods ---
    public destroy(): void { this.internalWriter.destroy(); }
    public measureInputUsage(input: string, options?: WriterWriteOptions): Promise<number> {
        return this.internalWriter.measureInputUsage(input, options);
    }

    // --- Overridden Core Logic ---

    public async write(input: string, options?: WriterWriteOptions): Promise<string> {
        const usage = await this.measureInputUsage(input, options);
        if (usage <= this.inputQuota) {
            return this.internalWriter.write(input, options);
        }
        return this.handleLargeInput(input, options, 1, false) as Promise<string>;
    }

    public writeStreaming(input: string, options?: WriterWriteOptions): ReadableStream<string> {
        return new ReadableStream<string>({
            start: async (controller) => {
                try {
                    const usage = await this.measureInputUsage(input, options);
                    let finalStream: ReadableStream<string>;
                    if (usage <= this.inputQuota) {
                        finalStream = this.internalWriter.writeStreaming(input, options);
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
    private async handleLargeInput(text: string, options: WriterWriteOptions | undefined, depth: number, stream: true): Promise<ReadableStream<string>>;
    private async handleLargeInput(text: string, options: WriterWriteOptions | undefined, depth: number, stream?: false): Promise<string>;
    private async handleLargeInput(text: string, options: WriterWriteOptions | undefined, depth: number = 1, stream: boolean = false): Promise<string | ReadableStream<string>> {
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
                chunks.map(chunk => this.internalWriter.write(chunk, options))
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
                format: this.format,
                largeContentStrategy: "join",
            });

            let summary = await summarizer.summarize(text);
            logger.info("summary:", summary);

            if (stream) {
                return this.internalWriter.writeStreaming(summary, options);
            }
            return this.internalWriter.write(summary, options);
        }

        // --- MERGE STRATEGY (This remains the same and is still valuable) ---
        logger.info(`Using 'merge' strategy (depth ${depth}).`);
        const chunkSummaries = await Promise.all(
            chunks.map(chunk => this.internalWriter.write(`Sumarize this content shortly for me: \n${chunk}`, options))
        );
        logger.info("chunkSummaries:", chunkSummaries);
        const combinedSummary = chunkSummaries.join("\n\n");

        const combinedUsage = await this.measureInputUsage(combinedSummary, options);
        if (combinedUsage > this.inputQuota) {
            return this.handleLargeInput(combinedSummary, options, depth + 1, stream as any);
        }

        if (stream) {
            return this.internalWriter.writeStreaming(combinedSummary, options);
        }
        return this.internalWriter.write(combinedSummary, options);
    }
}
