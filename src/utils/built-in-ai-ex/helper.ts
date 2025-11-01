// Generic benchmark helper used by the *Ex classes.
// It creates the native model, runs its streaming method, measures timings and
// returns a standardized result object.

export type BenchResult = {
    model: string;
    creationTimeMs: number;
    initialLatencyMs: number;
    firstChunkLatencyMs: number | null;
    chunks: number;
    totalTimeMs: number;
    chunksPerSecond: number;
    totalBytes: number;
    sample?: string;
};

// -----------------------
// Type-safe generic helper
// -----------------------

// Supported constructor types
type LanguageClass = typeof LanguageModel;
type WriterClass = typeof Writer;
type RewriterClass = typeof Rewriter;
type SummarizerClass = typeof Summarizer;
type TranslatorClass = typeof Translator;

type SupportedClass = LanguageClass | WriterClass | RewriterClass | SummarizerClass | TranslatorClass;

// Map a constructor to the correct create-options type
export type CreateOptionsFor<C> =
    C extends LanguageClass ? LanguageModelCreateOptions :
    C extends WriterClass ? WriterCreateOptions :
    C extends RewriterClass ? RewriterCreateOptions :
    C extends SummarizerClass ? SummarizerCreateOptions :
    C extends TranslatorClass ? TranslatorCreateOptions :
    never;

// Map a constructor to the correct input/prompt type
export type InputFor<C> =
    C extends LanguageClass ? LanguageModelPrompt :
    C extends WriterClass ? string :
    C extends RewriterClass ? string :
    C extends SummarizerClass ? string :
    C extends TranslatorClass ? string :
    never;

// Map a constructor to the streaming-options type accepted by the streaming method
export type StreamOptionsFor<C> =
    C extends LanguageClass ? LanguageModelPromptOptions | undefined :
    C extends WriterClass ? WriterWriteOptions | undefined :
    C extends RewriterClass ? RewriterRewriteOptions | undefined :
    C extends SummarizerClass ? SummarizerSummarizeOptions | undefined :
    C extends TranslatorClass ? TranslatorTranslateOptions | undefined :
    never;

// Map a constructor to its instance type
export type InstanceFor<C> =
    C extends LanguageClass ? LanguageModel :
    C extends WriterClass ? Writer :
    C extends RewriterClass ? Rewriter :
    C extends SummarizerClass ? Summarizer :
    C extends TranslatorClass ? Translator :
    never;

/**
 * Strongly-typed benchmark helper. Caller passes the model class (for example
 * `LanguageModel`) and TypeScript will require the correct options, input and
 * streaming options types for that model.
 */
export async function runBenchmarkFor<C extends SupportedClass>(
    ModelClass: C,
    options?: CreateOptionsFor<C>,
    input?: InputFor<C>,
    streamOptions?: StreamOptionsFor<C>
): Promise<BenchResult> {
    // Call the static create on the passed class with a typed cast to keep runtime
    // calls safe but allow compile-time typing for callers.
    const typedCreator = ModelClass as unknown as {
        create(opts?: CreateOptionsFor<C>): Promise<InstanceFor<C>>;
    };

    const tCreateStart = performance.now();
    const instance = await typedCreator.create(options);
    const tCreateEnd = performance.now();

    const result: BenchResult = {
        model: ModelClass.name || 'unknown',
        creationTimeMs: tCreateEnd - tCreateStart,
        initialLatencyMs: tCreateEnd - tCreateStart,
        firstChunkLatencyMs: null,
        chunks: 0,
        totalTimeMs: 0,
        chunksPerSecond: 0,
        totalBytes: 0,
        sample: undefined,
    };

    try {
        const tStreamCall = performance.now();
        let stream: ReadableStream<string>;

        // Now call the correct streaming method with typed arguments
        if ((ModelClass as unknown) === (LanguageModel as unknown)) {
            stream = (instance as InstanceFor<C> as LanguageModel).promptStreaming(input as InputFor<C>, streamOptions as StreamOptionsFor<C>);
        } else if ((ModelClass as unknown) === (Writer as unknown)) {
            stream = (instance as InstanceFor<C> as Writer).writeStreaming(input as unknown as string, streamOptions as StreamOptionsFor<C>);
        } else if ((ModelClass as unknown) === (Rewriter as unknown)) {
            stream = (instance as InstanceFor<C> as Rewriter).rewriteStreaming(input as unknown as string, streamOptions as StreamOptionsFor<C>);
        } else if ((ModelClass as unknown) === (Summarizer as unknown)) {
            stream = (instance as InstanceFor<C> as Summarizer).summarizeStreaming(input as unknown as string, streamOptions as StreamOptionsFor<C>);
        } else if ((ModelClass as unknown) === (Translator as unknown)) {
            stream = (instance as InstanceFor<C> as Translator).translateStreaming(input as unknown as string, streamOptions as StreamOptionsFor<C>);
        } else {
            throw new Error("Unsupported model class passed to runBenchmarkFor");
        }

        const reader = stream.getReader();
        let firstChunkTime: number | null = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (firstChunkTime === null) {
                firstChunkTime = performance.now();
                result.firstChunkLatencyMs = firstChunkTime - tStreamCall;
            }
            result.chunks += 1;
            if (typeof value === 'string') {
                result.totalBytes += value.length;
                if (result.sample === undefined) result.sample = value;
            }
        }

        const tEnd = performance.now();
        result.totalTimeMs = tEnd - tCreateStart;
        const activeSpanSec = ((firstChunkTime || tEnd) - (firstChunkTime || tStreamCall)) / 1000 || 0.000001;
        result.chunksPerSecond = result.chunks / activeSpanSec;

        try { instance.destroy(); } catch (e) { /* ignore */ }
        if (result.sample) result.sample = result.sample.slice(0, 1000);
        return result;
    } catch (err) {
        try { instance.destroy(); } catch (e) { /* ignore */ }
        throw err;
    }
}

// -----------------------
// Download helper
// -----------------------

export type DownloadResult = { ok: true } | { ok: false; reason: string; error?: Error };

/**
 * Generic download helper. It calls the model's static create with a monitor
 * wrapper that forwards progress events to the user-provided monitor and also
 * resolves the returned promise when the model becomes available.
 */
export async function runDownload<C extends SupportedClass>(
    ModelClass: C,
    options?: CreateOptionsFor<C> & { monitor?: CreateMonitorCallback }
): Promise<DownloadResult> {
    // If the API provides an availability check, call it first.
    try {
        // Some constructors accept availability; try to call it safely.
        const availabilityFn = ModelClass.availability as ((opts?: CreateOptionsFor<C>) => Promise<Availability>) | undefined;
        if (availabilityFn) {
            const avail = await availabilityFn(options);
            if (avail === 'unavailable') {
                return { ok: false, reason: 'unavailable' };
            }
            if (avail === 'available') {
                // no download required
            }
        }

        // Wrap the user's monitor so we can detect when download is complete.
        let resolveReady: (() => void) | null = null;
        const readyPromise = new Promise<void>((res) => { resolveReady = res; });

        const monitorWrapper: CreateMonitorCallback = (monitor: CreateMonitor) => {
            // Forward to user monitor, if provided
            try { options && options.monitor && options.monitor(monitor); } catch (e) { /* ignore forwarding errors */ }

            // Listen for downloadprogress and availability changes
            monitor.addEventListener('downloadprogress', () => {
                // The CreateMonitor does not provide a standard 'complete' event in the types; rely on availability or progress handler below.
            });

            // Also attempt to watch the monitor object for state changes if a property is present
            try {
                monitor.ondownloadprogress = (ev: ProgressEvent<EventTarget>) => {
                    // If progress is 100% try to resolve
                    try {
                        const p = ev.loaded / (ev.total || 1);
                        if (p >= 1 && resolveReady) resolveReady();
                    } catch (e) { }
                };
            } catch (e) { /* ignore */ }
        };

        const wrappedOptions = ({
            ...(options as object),
            monitor: monitorWrapper,
        }) as unknown as CreateOptionsFor<C> & { monitor?: CreateMonitorCallback };

        // Start creation (this will trigger download when applicable)
        const creator = (ModelClass as unknown) as {
            create(opts?: CreateOptionsFor<C> & { monitor?: CreateMonitorCallback }): Promise<InstanceFor<C>>;
        };

        let instancePromise: Promise<InstanceFor<C>>;
        try {
            instancePromise = creator.create(wrappedOptions);
        } catch (e) {
            return { ok: false, reason: 'create_failed', error: e as Error };
        }

        // Wait for either the instance creation to resolve OR the readyPromise (whichever comes first)
        try {
            const inst = await Promise.race([instancePromise, readyPromise.then(() => instancePromise)]);
            if (!inst) {
                return { ok: false, reason: 'no_instance' };
            }
            // If we reach here, the model was created (downloaded if necessary)
            try { inst.destroy(); } catch (e) { /* ignore */ }
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: 'error', error: err as Error };
        }
    } catch (err) {
        return { ok: false, reason: 'error', error: err as Error };
    }
}


export async function dataUrlToBlob(dataUrl: string) {
    const response = await fetch(dataUrl);

    const blob = await response.blob();

    return blob;
}

function findByTextAndAttributes(rootElement: HTMLElement, text: string): HTMLElement[] {
    const walker = document.createTreeWalker(
        rootElement,
        NodeFilter.SHOW_ELEMENT,
        null,
        // false
    );

    const nodes: HTMLElement[] = [];
    let currentNode: HTMLElement | null;

    while ((currentNode = walker.nextNode() as HTMLElement | null)) {
        // Check element's direct text content
        const ownText = Array.from(currentNode.childNodes)
            .filter((node: ChildNode): node is Text => node.nodeType === document.TEXT_NODE)
            .map((node: Text) => node.nodeValue || '')
            .join('');

        if (ownText.includes(text)) {
            nodes.push(currentNode);
            continue;
        }

        // Check element's attributes
        if (currentNode.hasAttributes()) {
            const attrs = currentNode.attributes;
            for (let i = 0; i < attrs.length; i++) {
                if (attrs[i].value.includes(text)) {
                    nodes.push(currentNode);
                    break;
                }
            }
        }
    }

    return nodes;
}

/**
 * Returns a single string representing the locally formatted date and time.
 *
 * @param {Date} [date=new Date()] - The date to format. Defaults to now.
 * @returns {string} The formatted date and time string.
 */
export function getLocalizedDateTimeString(date = new Date()) {
    // Define options for formatting
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    };

    // 'undefined' uses the default locale, options specifies the format.
    return date.toLocaleString(undefined, options);
}
