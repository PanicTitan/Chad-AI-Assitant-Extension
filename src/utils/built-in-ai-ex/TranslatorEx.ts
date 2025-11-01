import { logger } from "./logger";
import { runBenchmarkFor, BenchResult, runDownload, DownloadResult } from "./helper";

export interface TranslatorExCreateOptions extends TranslatorCreateOptions {

}

/**
 * An extended, unified class that combines the functionality of a Translator
 * and a LanguageDetector. It can automatically detect the source language of
 * an input before translating it.
 */
export class TranslatorEx implements Translator {
    private readonly internalTranslator: Translator;

    /** The constructor is private to force the use of the async `create` method. */
    protected constructor(nativeTranslator: Translator) {
        this.internalTranslator = nativeTranslator;
    }

    public static support(): boolean {
        return "Translator" in self && "LanguageDetector" in self;
    }

    public static async availability(options: TranslatorExCreateOptions): Promise<Availability> {
        return Translator.availability(options);
    }

    /**
     * The public factory for creating a TranslatorEx instance.
     * It creates the underlying Translator instance.
     */
    public static async create(options: TranslatorExCreateOptions): Promise<TranslatorEx> {
        const nativeTranslator = await Translator.create(options);
        return new TranslatorEx(nativeTranslator);
    }

    /**
     * Benchmark helper that creates an instance, runs a streaming translate and
     * returns timing and throughput metrics.
     */
    public static async benchmark(options: TranslatorExCreateOptions = {} as TranslatorExCreateOptions, input: string = "Benchmark this short text."): Promise<BenchResult> {
        return runBenchmarkFor(Translator, options, input);
    }

    public static async download(options: TranslatorExCreateOptions & { monitor?: CreateMonitorCallback } = {} as any): Promise<DownloadResult> {
        return runDownload(Translator, options);
    }

    // --- Passthrough Properties to match the implemented interfaces ---

    // From Translator
    public get sourceLanguage(): string { return this.internalTranslator.sourceLanguage; }
    public get targetLanguage(): string { return this.internalTranslator.targetLanguage; }
    public get inputQuota(): number {
        return this.internalTranslator.inputQuota;
    }


    // --- Core Methods ---

    /**
     * Destroys the internal Translator instance to free resources.
     */
    public destroy(): void {
        this.internalTranslator.destroy();
        logger.info("Translator instance destroyed.");
    }

    /**
     * Detects the language(s) of the input text. Creates a temporary LanguageDetector instance.
     * @static
     */
    public static async detect(input: string, options?: LanguageDetectorDetectOptions): Promise<LanguageDetectionResult[]> {
        if (!TranslatorEx.support()) {
            throw new Error("LanguageDetector is not supported in this environment.");
        }
        
        const detector = await LanguageDetector.create();
        try {
            return await detector.detect(input, options);
        } finally {
            detector.destroy();
        }
    }

    /**
     * HELPER: Returns only the single most likely language detection result.
     * @param input The text to analyze.
     * @returns A promise resolving to the top detection result, or null if none was found.
     * @static
     */
    public static async autoDetect(input: string): Promise<LanguageDetectionResult | null> {
        const results = await TranslatorEx.detect(input);
        return results[0] || null;
    }

    /**
     * Translates the input text. If `sourceLanguage` was not specified during creation,
     * this method will first call `detect()` to automatically determine the source language.
     * @param input The text to translate.
     * @param options Standard Translator options.
     * @returns A promise that resolves to the translated string.
     */
    public async translate(input: string, options?: TranslatorTranslateOptions): Promise<string> {
        return this.internalTranslator.translate(input, options);
    }

    /**
     * Translates the input text via a stream. Also supports auto-detection of the source language.
     */
    public translateStreaming(input: string, options?: TranslatorTranslateOptions): ReadableStream<string> {
        return this.internalTranslator.translateStreaming(input, options);
    }

    /**
     * Measures the input usage. Delegates to the primary (Translator) model.
     */
    public measureInputUsage(input: string, options?: TranslatorTranslateOptions): Promise<number> {
        // The measurement is typically tied to a specific model pair, so we use the translator's.
        return this.internalTranslator.measureInputUsage(input, options);
    }

   /**
     * Creates a duplex (readable and writable) stream for continuous translation.
     * You can pipe a stream of source language text chunks to the `writable` side,
     * and read a stream of translated text from the `readable` side.
     *
     * @param {TranslatorTranslateOptions} [options] - Options for the translation, including an AbortSignal.
     * @returns {TransformStream<string, string>} A TransformStream for real-time, chunk-based translation.
     * @throws {Error} If `sourceLanguage` was not set during creation.
     */
    public stream(options?: TranslatorTranslateOptions): TransformStream<string, string> {
        // Fail-fast if the source language is not known.
        if (!this.sourceLanguage) {
            throw new Error(
                "The stream() method requires a `sourceLanguage` to be explicitly provided during TranslatorEx creation."
            );
        }

        const transformStream = new TransformStream<string, string>({
            /**
             * This function is called for every chunk written to the writable side.
             * @param chunk The incoming string chunk in the source language.
             * @param controller The controller to enqueue the translated chunks.
             */
            transform: async (chunk, controller) => {
                // --- CANCELLATION CHECK ---
                // Before processing a new chunk, check if the stream has been aborted.
                if (options?.signal?.aborted) {
                    logger.warn("Translation stream aborted. Halting processing.");
                    // We don't need to explicitly close, the AbortError will handle cleanup.
                    return;
                }

                try {
                    // --- PASS THE SIGNAL ---
                    // Create a native translation stream, passing the signal to it.
                    // If the signal is aborted while this stream is running, it will throw an AbortError.
                    const translationStream = this.internalTranslator.translateStreaming(chunk, options);

                    const reader = translationStream.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) {
                            break; // Internal stream is finished.
                        }
                        controller.enqueue(value); // Pass the chunk to the user.
                    }
                } catch (error: any) {
                    // Gracefully handle cancellation errors.
                    if (error.name === 'AbortError') {
                        logger.info("A translation chunk was successfully aborted.");
                        // We don't propagate the error, as this is an expected outcome.
                    } else {
                        // For any other error, propagate it to the consumer.
                        logger.error("An error occurred during chunk translation in the stream.", error);
                        controller.error(error);
                    }
                }
            },
        });

        return transformStream;
    }
}
