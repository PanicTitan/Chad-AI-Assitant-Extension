// ==================================================================================
// SECTION 1: PRE-REQUISITES
// ==================================================================================

import { logger } from "./logger";
import { SummarizerEx } from "./SummarizerEx";
import { TextSplitter } from "./TextSplitter";
import { runBenchmarkFor, BenchResult } from "./helper";
import { runDownload, DownloadResult } from "./helper";

// --- Custom Types for the LanguageModelEx Class ---

/** A custom function that receives a safe copy of the history and returns a new, modified history. */
type CustomContextHandler = (history: Readonly<LanguageModelPrompts>) => Promise<LanguageModelPrompts>;
type CustomHistoryHandler = (history: Readonly<LanguageModelPrompts>) => Promise<LanguageModelPrompts>;

type LanguageModelPrompts = [LanguageModelSystemMessage, ...LanguageModelMessage[]] | LanguageModelMessage[];

/** Extends the native creation options with settings for our advanced context management. */
export interface LanguageModelExCreateOptions extends LanguageModelCreateOptions {
    /** The maximum percentage (0.0 to 1.0) of the quota to use before the context handler is triggered. Defaults to 0.75. */
    maxQuotaUsage?: number;
    /** The strategy to handle the quota when the quota is exceeded. 
     * "clear": clean the full context except the system prompt.
     * "summarize": clear the full context except the system prompt and add a history summary in the context.
     * or a custom async function that returns a content (LanguageModelPrompt) to be added in the context. */
    contextHandler?: "clear" | "summarize" | CustomContextHandler;
    /** The strategy to handle the history when the quota is exceeded.
     * "clear": clean the whole history except the system prompt.
     * "preserve": preserve the history (but on new instances only the system prompt is used).
     * "update": update the history based on the contextHandler and use it on new instances.
     * or a custom async function that returns a new history (History) to replace the old one and use it on new instances;
     * @default "preserve"
     */
    historyHandler?: "clear" | "preserve" | "update" | CustomHistoryHandler;
}

/** Defines the custom events dispatched by this class, in addition to native events like 'quotaoverflow'. */
export interface LanguageModelExEventMap extends LanguageModelEventMap {
    "contextclear": Event;
    "contextshrink": CustomEvent<{ summary: string }>;
}


// ==================================================================================
// SECTION 2: THE DEDICATED HistoryManager CLASS
// ==================================================================================

/**
 * A dedicated class to manage the conversation history as a single, unified array,
 * mirroring the structure of the native LanguageModel API.
 */
class HistoryManager {
    private history: LanguageModelPrompts = [];

    constructor(initialPrompts: LanguageModelPrompts = []) {
        // Store a copy to prevent mutation of the original options object.
        this.history = [...initialPrompts];
    }

    /** Appends one or more prompt to the end of the history. */
    public add(prompt: LanguageModelPrompt): void {
        this.history.push(...(this.normalizeInput(prompt)));
    }

    /** Returns the entire current history array. */
    public get(): LanguageModelPrompts {
        return this.history;
    }

    /** Returns the entire current history array. */
    public getSystemPrompt(): LanguageModelSystemMessage {
        if (
            this.history.length > 0 &&
            this.history[0].role == "system"
        ) {
            return this.history[0];
        } else {
            return { role: "system", content: "" };
        }
    }

    /** Returns a deep copy of the history for safe external manipulation (e.g., in custom handlers). */
    public copy(): LanguageModelPrompts {
        return JSON.parse(JSON.stringify(this.history));
    }

    /** Replaces the entire history with a new set of messages. */
    public replace(newHistory: LanguageModelPrompts): void {
        this.history = newHistory;
    }

    /** Clears the history, but preserves the initial system prompt if one exists. */
    public clear(preserveSystem: boolean = true): void {
        if (!preserveSystem) {
            this.history = [];
            return;
        }

        if (
            this.history.length > 0 &&
            this.history[0].role == "system"
        ) {
            this.history = [this.history[0]]; // Keep only the system prompt
        } else {
            this.history = []; // Clear completely
        }
    }

    public measureInputUsage(model: LanguageModel): Promise<number> {
        if (
            this.history.length > 0 &&
            this.history?.[0] &&
            this.history?.[0]?.role == "system"
        ) return model.measureInputUsage([{ role: "user", content: this.history[0].content }, ...this.history.slice(1)] as LanguageModelMessage[]);
        return model.measureInputUsage(this.history as LanguageModelMessage[]);
    }

    public toString({
        format = "string",
        includeSystem = false,
    }: {
        format?: "string" | "json";
        includeSystem?: boolean;
    } = {}): string {
        if (format == "json") {
            return JSON.stringify(this.history);
        }
        if (format == "string") {
            return this.history.map(({ role, content }) => {
                if (role == "system" && !includeSystem) return;
                if (typeof content === 'string') return `${role}:\n\t${content}`;
                else return content.map(({ type, value }) => {
                    if (type == "text") return `${role}:\n\t${value}`;
                    else return `${role}:\n\tfile`;
                }).join("\n");
            }).join("\n");
        }

        return "";
    }

    /** A helper to reliably convert any LanguageModelPrompt into a message array. */
    private normalizeInput(input: LanguageModelPrompt): LanguageModelMessage[] {
        if (typeof input === 'string') {
            return [{ role: 'user', content: input }];
        }
        // If it's not a string, the API guarantees it's already a LanguageModelMessage[].
        return input;
    }
}


// ==================================================================================
// SECTION 3: THE FINAL LanguageModelEx CLASS
// ==================================================================================

/**
 * An extended LanguageModel that wraps a native instance to provide automatic
 * conversation history and robust, predictive context quota management.
 * It implements the full LanguageModel interface, acting as a drop-in replacement.
 */
export class LanguageModelEx extends EventTarget implements LanguageModel {
    private internalModel: LanguageModel;
    private readonly options: LanguageModelExCreateOptions;
    // Parameters used for large-input reduction
    private readonly largeInputQuotaThreshold = 0.75;
    private readonly largeInputRecursionLimit = 8;

    get maxQuotaUsage() {
        return this.options.maxQuotaUsage ?? 0.75;
    }
    private get contextHandler() {
        return this.options.contextHandler ?? "summarize";
    }
    private get historyHandler() {
        return this.options.historyHandler ?? "preserve";
    }

    /** Provides access to the managed conversation history. */
    public readonly history: HistoryManager;

    protected constructor(nativeModel: LanguageModel, options: LanguageModelExCreateOptions) {
        super();
        this.internalModel = nativeModel;
        this.options = options;
        this.history = new HistoryManager(options.initialPrompts);

        // Forward the native onquotaoverflow event from the internal model to this instance.
        this.internalModel.onquotaoverflow = (ev) => this.dispatchEvent(ev);
    }

    // --- Static Methods for Availability and Creation ---

    /** Checks if the LanguageModel API is available in the current browser. */
    public static support(): boolean {
        return "LanguageModel" in self;
    }

    /** Passthrough for the native `availability` check. */
    public static async availability(options?: LanguageModelCreateCoreOptions): Promise<Availability> {
        return LanguageModel.availability(options);
    }

    /** Passthrough for the native `params` check. */
    public static async params(): Promise<LanguageModelParams> {
        return LanguageModel.params();
    }

    /** Creates a new, managed instance of the LanguageModel. */
    public static async create(options: LanguageModelExCreateOptions = {}): Promise<LanguageModelEx> {
        const nativeModel = await LanguageModel.create(options);
        return new LanguageModelEx(nativeModel, options);
    }

    /**
     * Benchmark helper that creates an instance, runs a streaming prompt and
     * returns timing and throughput metrics.
     */
    public static async benchmark(options: LanguageModelExCreateOptions = {}, prompt: LanguageModelPrompt = "Benchmark: produce a short response."): Promise<BenchResult> {
        // Use the strongly-typed helper which accepts the constructor
        return runBenchmarkFor(LanguageModel, options, prompt);
    }

    /**
     * Download helper: ensures the model is available (downloads if needed).
     * Returns { ok: true } on success or { ok: false, reason, error } on failure.
     */
    public static async download(options: LanguageModelExCreateOptions & { monitor?: CreateMonitorCallback } = {}): Promise<DownloadResult> {
        return runDownload(LanguageModel, options);
    }

    // --- Passthrough Properties to Match Interface ---
    public get inputQuota(): number { return this.internalModel.inputQuota; }
    public get inputUsage(): number { return this.internalModel.inputUsage; }
    public get topK(): number { return this.internalModel.topK; }
    public get temperature(): number { return this.internalModel.temperature; }
    public set onquotaoverflow(handler: ((this: LanguageModel, ev: Event) => any) | null) { this.internalModel.onquotaoverflow = handler; }

    // --- Passthrough Methods to Match Interface ---
    public destroy() { return this.internalModel.destroy(); }
    public measureInputUsage(input: LanguageModelPrompt, options?: LanguageModelPromptOptions): Promise<number> {
        return this.internalModel.measureInputUsage(input, options);
    }
    public async clone(options?: LanguageModelCloneOptions): Promise<LanguageModel> {
        // logger.warn("Cloning a LanguageModelEx returns a native LanguageModel, not a new managed instance with shared history.");
        let newModel = await this.internalModel.clone(options);
        this.internalModel.destroy();
        this.internalModel = newModel;
        return this.internalModel;
    }

    // --- Overridden Core Logic with History and Quota Management ---

    /** Appends messages to the history and immediately checks if the context needs to be handled. */
    public async append(input: LanguageModelPrompt, options?: LanguageModelAppendOptions): Promise<undefined> {
        await this.handleContextQuota(input);

        let response = this.internalModel.append(input, options);
        response.then(() => {
            if (!options?.signal?.aborted) {
                this.history.add(input);
            }
        });

        return response;
    }

    public async prompt(input: LanguageModelPrompt, options?: LanguageModelPromptOptions): Promise<string> {
        // If the incoming input is a potentially huge single string, try to reduce it
        // before any context handling so it can fit into the model quota.
        if (typeof input === 'string') {
            const usage = await this.measureInputUsage(input);
            if (usage > this.inputQuota) {
                input = await this.handleLargePromptInput(input, options);
            }
        }

        await this.handleContextQuota(input);

        this.history.add(input);

        const response = this.internalModel.prompt(input, options);

        response.then((content) => {
            if (!options?.signal?.aborted) {
                this.history.add([{ role: 'assistant', content }]);
            }
        });

        return response;
    }

    public promptStreaming(input: LanguageModelPrompt, options?: LanguageModelPromptOptions): ReadableStream<string> {
        // This method must be synchronous. All async logic happens inside the stream's start method.
        return new ReadableStream<string>({
            start: async (controller) => {
                try {
                    // Reduce huge single-string inputs before handling context to avoid
                    // situations where a single prompt is larger than the model quota.
                    if (typeof input === 'string') {
                        const usage = await this.measureInputUsage(input);
                        if (usage > this.inputQuota) {
                            input = await this.handleLargePromptInput(input, options);
                        }
                    }

                    await this.handleContextQuota(input);

                    this.history.add(input);

                    const stream = this.internalModel.promptStreaming(input, options);

                    const [streamForUser, streamForHistory] = stream.tee();

                    (async () => {
                        const assistantMessage: LanguageModelMessage = { role: 'assistant', content: "" };

                        this.history.add([assistantMessage]);

                        try {
                            for await (const chunk of streamForHistory) {
                                assistantMessage.content += chunk;
                            }
                        } catch (error) {
                            if (options?.signal?.aborted) {
                                logger.info("Stream aborted. Partial response retained in history.");
                            }
                        }
                    })();

                    const reader = streamForUser.getReader();
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

    // --- Private Context Handling Logic ---

    private async handleContextQuota(newInput?: LanguageModelPrompt): Promise<void> {
        this.contextHandler
        this.historyHandler

        const newInputQuota = newInput ? await this.measureInputUsage(newInput) : 0;
        const futureQuota = this.internalModel.inputUsage + newInputQuota;

        if (this.maxQuotaUsage > futureQuota / this.inputQuota) {
            return; // Everything fits, no action needed.
        }

        if (
            this.historyHandler == "clear" ||
            this.historyHandler == "update"
        ) {
            this.history.clear();
        }

        if (
            typeof this.historyHandler !== "string"
        ) {
            this.history.replace(await this.historyHandler(this.history.copy()));
        }

        if (
            this.contextHandler == "clear"
        ) {
            return this.recreateInternalModel();
        }

        if (
            this.contextHandler == "summarize"
        ) {
            const summarizer = await SummarizerEx.create({ type: "tldr", length: "long", largeContentStrategy: "merge" });

            // let historyCopy = this.history.copy();
            // const conversation = historyCopy
            //     .filter(message => message.role !== 'system')
            //     .map(message => `${message.role}: ${message.content}`)
            //     .join('\n')
            //     ;
            const conversation = this.history.toString();
            const summary = await summarizer.summarize(conversation);

            summarizer.destroy();

            if (
                this.historyHandler == "update"
            ) {
                this.history.clear();
                this.history.add([{ role: 'assistant', content: `Summary of previous conversation: ${summary}` }]);
            }

            return this.recreateInternalModel();
        }

        if (
            typeof this.contextHandler !== "string"
        ) {
            return this.recreateInternalModel(await this.contextHandler(this.history.copy()));
        }
    }

    private async recreateInternalModel(initialPrompts?: LanguageModelPrompts): Promise<void> {
        this.internalModel.destroy();

        if (!initialPrompts) {
            if (
                this.historyHandler == "preserve"
            ) {
                initialPrompts = [this.history.getSystemPrompt()];
            }
            if (
                this.historyHandler == "clear" ||
                this.historyHandler == "update"
            ) {
                initialPrompts = this.history.copy();
            }
        }

        this.internalModel = await LanguageModel.create({
            ...this.options,
            initialPrompts,
        });
        logger.info("Internal model session recreated successfully with new context.");
    }

    /**
     * Reduce a very large single-string input so it fits within the model quota.
     * Strategy: split into balanced chunks using TextSplitter (which measures tokens),
     * summarize each chunk using the language model itself (via prompt), then merge
     * the summaries and recurse if still too large.
     */
    private async handleLargePromptInput(input: string, options?: LanguageModelPromptOptions, depth: number = 1): Promise<string> {
        if (depth > this.largeInputRecursionLimit) throw new Error("Large input reduction exceeded recursion limit.");

        // Use TextSplitter to partition the input into chunks that fit the token limit.
        const splitter = new TextSplitter((txt) => this.internalModel.measureInputUsage(txt, options), this.inputQuota * this.largeInputQuotaThreshold);
        const chunks = await splitter.split(input);

        // For each chunk, ask the model to reduce it. We form a short instruction prompt
        // that includes the system context (if any) to help preserve intent.
        const systemPrompt = this.history.getSystemPrompt()?.content ?? "";

        // Create a separate LanguageModelEx instance to perform reductions so
        // its quota/history is independent from this instance.
        const reducer = await LanguageModelEx.create({ contextHandler: "clear", historyHandler: "clear", maxQuotaUsage: this.maxQuotaUsage });
        try {
            const reducedChunks = await Promise.all(chunks.map(async (chunk) => {
                const instruct = `Reduce the following text to the most important information while preserving the user's intent and important facts. Keep it concise but preserve meaning.\n\nSystem context:\n${systemPrompt}\n\nText:\n${chunk}`;
                try {
                    return await reducer.prompt(instruct, options);
                } catch (err) {
                    // Fallback: if the model call fails, return the original chunk to avoid data loss.
                    logger.warn("Chunk reduction failed, keeping original chunk.", err);
                    return chunk;
                }
            }));

            const combined = reducedChunks.join("\n\n");

            const combinedUsage = await this.internalModel.measureInputUsage(combined, options);
            if (combinedUsage > this.inputQuota) {
                // Recurse to further reduce the combined summary.
                return this.handleLargePromptInput(combined, options, depth + 1);
            }

            return combined;
        } finally {
            try { reducer.destroy(); } catch (e) { /* ignore */ }
        }
    }

    // --- Correctly Typed Event Listener Overloads ---
    public addEventListener<K extends keyof LanguageModelExEventMap>(type: K, listener: (this: this, ev: LanguageModelExEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    public addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
        super.addEventListener(type, listener, options);
    }

    public removeEventListener<K extends keyof LanguageModelExEventMap>(type: K, listener: (this: this, ev: LanguageModelExEventMap[K]) => any, options?: boolean | EventListenerOptions): void;
    public removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
        super.removeEventListener(type, listener, options);
    }
}
