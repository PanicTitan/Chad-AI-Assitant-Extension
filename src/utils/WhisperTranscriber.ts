/**
 * WhisperTranscriber - Speech-to-text transcription using Whisper models
 * Provides easy-to-use interface for audio transcription with automatic model management
 */

import { pipeline, AutomaticSpeechRecognitionPipeline, WhisperTextStreamer } from "@huggingface/transformers";
import { env as hf } from "@huggingface/transformers";
import { getPublicPath } from "./vite-helper";

// @ts-ignore
hf.backends.onnx.wasm.wasmPaths = getPublicPath("/ort/wasm/")

// List of supported languages
const LANGUAGES: Record<string, string> = {
    en: "english",
    zh: "chinese",
    de: "german",
    es: "spanish",
    ru: "russian",
    ko: "korean",
    fr: "french",
    ja: "japanese",
    pt: "portuguese",
    tr: "turkish",
    pl: "polish",
    ca: "catalan",
    nl: "dutch",
    ar: "arabic",
    sv: "swedish",
    it: "italian",
    id: "indonesian",
    hi: "hindi",
    fi: "finnish",
    vi: "vietnamese",
    he: "hebrew",
    uk: "ukrainian",
    el: "greek",
    ms: "malay",
    cs: "czech",
    ro: "romanian",
    da: "danish",
    hu: "hungarian",
    ta: "tamil",
    no: "norwegian",
    th: "thai",
    ur: "urdu",
    hr: "croatian",
    bg: "bulgarian",
    lt: "lithuanian",
    la: "latin",
    mi: "maori",
    ml: "malayalam",
    cy: "welsh",
    sk: "slovak",
    te: "telugu",
    fa: "persian",
    lv: "latvian",
    bn: "bengali",
    sr: "serbian",
    az: "azerbaijani",
    sl: "slovenian",
    kn: "kannada",
    et: "estonian",
    mk: "macedonian",
    br: "breton",
    eu: "basque",
    is: "icelandic",
    hy: "armenian",
    ne: "nepali",
    mn: "mongolian",
    bs: "bosnian",
    kk: "kazakh",
    sq: "albanian",
    sw: "swahili",
    gl: "galician",
    mr: "marathi",
    pa: "punjabi",
    si: "sinhala",
    km: "khmer",
    sn: "shona",
    yo: "yoruba",
    so: "somali",
    af: "afrikaans",
    oc: "occitan",
    ka: "georgian",
    be: "belarusian",
    tg: "tajik",
    sd: "sindhi",
    gu: "gujarati",
    am: "amharic",
    yi: "yiddish",
    lo: "lao",
    uz: "uzbek",
    fo: "faroese",
    ht: "haitian",
    ps: "pashto",
    tk: "turkmen",
    nn: "nynorsk",
    mt: "maltese",
    sa: "sanskrit",
    lb: "luxembourgish",
    my: "burmese",
    bo: "tibetan",
    tl: "tagalog",
    mg: "malagasy",
    as: "assamese",
    tt: "tatar",
    haw: "hawaiian",
    ln: "lingala",
    ha: "hausa",
    ba: "bashkir",
    jw: "javanese",
    su: "sundanese",
};

export interface WhisperTranscriberConfig {
    model?: string;
    language?: string;
    task?: 'transcribe' | 'translate';
    device?: 'webgpu' | 'wasm';
    chunkLengthS?: number;
    strideLengthS?: number;
}

export interface TranscriptionChunk {
    text: string;
    timestamp: [number, number | null];
    finalised: boolean;
    offset: number;
}

export interface TranscriptionResult {
    text: string;
    chunks: TranscriptionChunk[];
    tps?: number; // Tokens per second
}

export interface ProgressCallback {
    (data: { status: string; file?: string; progress?: number; loaded?: number; total?: number }): void;
}

export interface StreamingCallback {
    (data: { text: string; chunks: TranscriptionChunk[]; tps?: number }): void;
}

const SAMPLING_RATE = 16000;
const DEFAULT_MODEL = "onnx-community/whisper-large-v3-turbo";

/**
 * WhisperTranscriber class
 * Handles speech-to-text transcription using Whisper models
 */
export class WhisperTranscriber {
    private config: Required<WhisperTranscriberConfig>;
    private transcriber: AutomaticSpeechRecognitionPipeline | null = null;
    private isInitialized = false;
    private isLoading = false;
    private currentModel: string | null = null;

    constructor(config: WhisperTranscriberConfig = {}) {
        // Get browser language and normalize it
        const browserLang = this.normalizeBrowserLanguage();

        this.config = {
            model: config.model || DEFAULT_MODEL,
            language: config.language || browserLang,
            task: config.task || 'transcribe',
            device: config.device || 'webgpu',
            chunkLengthS: config.chunkLengthS || 30,
            strideLengthS: config.strideLengthS || 5,
        };
    }

    /**
     * Normalize browser language to match available languages
     * Example: "pt-BR" -> "pt", "en-US" -> "en"
     */
    private normalizeBrowserLanguage(): string {
        try {
            const browserLang = navigator.language || 'en';
            const langCode = browserLang.split('-')[0].toLowerCase();
            
            // Check if language is supported
            if (LANGUAGES[langCode]) {
                return langCode;
            }
            
            return 'en'; // Fallback to English
        } catch {
            return 'en';
        }
    }

    /**
     * Download the model (useful for pre-loading during setup)
     */
    async download(progressCallback?: ProgressCallback): Promise<void> {
        if (this.isInitialized && this.currentModel === this.config.model) {
            console.log('[WhisperTranscriber] Model already downloaded');
            return;
        }

        await this.create({ progressCallback });
    }

    /**
     * Initialize/Create the transcriber
     */
    async create(options?: { progressCallback?: ProgressCallback }): Promise<void> {
        if (this.isInitialized && this.currentModel === this.config.model) {
            console.log('[WhisperTranscriber] Transcriber already initialized');
            return;
        }

        if (this.isLoading) {
            console.warn('[WhisperTranscriber] Model is already loading');
            return;
        }

        this.isLoading = true;

        try {
            console.log('[WhisperTranscriber] Loading model:', this.config.model);

            const isDistilWhisper = this.config.model.startsWith("distil-whisper/");

            // Dispose of old transcriber if model changed
            if (this.transcriber && this.currentModel !== this.config.model) {
                await this.transcriber.dispose();
                this.transcriber = null;
            }

            // Create pipeline
            const pipelineResult = await pipeline('automatic-speech-recognition', this.config.model, {
                dtype: {
                    encoder_model: this.config.model === "onnx-community/whisper-large-v3-turbo" ? "fp16" : "fp32",
                    decoder_model_merged: "q4",
                },
                device: this.config.device,
                progress_callback: options?.progressCallback,
            });
            
            this.transcriber = pipelineResult as any as AutomaticSpeechRecognitionPipeline;

            this.currentModel = this.config.model;
            this.isInitialized = true;
            console.log('[WhisperTranscriber] Model loaded successfully');
        } catch (error) {
            console.error('[WhisperTranscriber] Failed to load model:', error);
            throw error;
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Destroy/Reset the transcriber (unload model from memory)
     */
    async destroy(): Promise<void> {
        if (this.transcriber) {
            console.log('[WhisperTranscriber] Disposing model...');
            await this.transcriber.dispose();
            this.transcriber = null;
        }

        this.isInitialized = false;
        this.currentModel = null;
        this.isLoading = false;
        console.log('[WhisperTranscriber] Model disposed');
    }

    /**
     * Reset without disposing (just mark as not initialized)
     */
    reset(): void {
        this.isInitialized = false;
        this.currentModel = null;
    }

    /**
     * Transcribe audio blob
     */
    async transcribe(
        audioBlob: Blob,
        options?: {
            language?: string;
            task?: 'transcribe' | 'translate';
            onProgress?: StreamingCallback;
        }
    ): Promise<TranscriptionResult> {
        if (!this.isInitialized || !this.transcriber) {
            throw new Error('Transcriber not initialized. Call create() first.');
        }

        // Convert blob to AudioBuffer
        const audioBuffer = await this.blobToAudioBuffer(audioBlob);

        // Extract audio data
        const audio = await this.extractAudioData(audioBuffer);

        // Transcribe
        return await this.transcribeAudioData(audio, options);
    }

    /**
     * One-shot transcribe: create, transcribe, and destroy
     */
    async oneShotTranscribe(
        audioBlob: Blob,
        options?: {
            language?: string;
            task?: 'transcribe' | 'translate';
            progressCallback?: ProgressCallback;
            onProgress?: StreamingCallback;
        }
    ): Promise<TranscriptionResult> {
        try {
            // Initialize if needed
            if (!this.isInitialized) {
                await this.create({ progressCallback: options?.progressCallback });
            }

            // Transcribe
            const result = await this.transcribe(audioBlob, options);

            // Cleanup
            await this.destroy();

            return result;
        } catch (error) {
            // Make sure to cleanup on error
            await this.destroy();
            throw error;
        }
    }

    /**
     * Convert Blob to AudioBuffer
     */
    private async blobToAudioBuffer(blob: Blob): Promise<AudioBuffer> {
        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new AudioContext({ sampleRate: SAMPLING_RATE });
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        await audioContext.close();
        return audioBuffer;
    }

    /**
     * Extract audio data from AudioBuffer
     */
    private async extractAudioData(audioBuffer: AudioBuffer): Promise<Float32Array> {
        let audio: Float32Array;

        if (audioBuffer.numberOfChannels === 2) {
            // Stereo to mono conversion
            const SCALING_FACTOR = Math.sqrt(2);
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.getChannelData(1);

            audio = new Float32Array(left.length);
            for (let i = 0; i < audioBuffer.length; i++) {
                audio[i] = (SCALING_FACTOR * (left[i] + right[i])) / 2;
            }
        } else {
            // Mono audio
            audio = audioBuffer.getChannelData(0);
        }

        return audio;
    }

    /**
     * Transcribe audio data (Float32Array)
     * Public method to allow usage from Web Workers
     */
    async transcribeAudioData(
        audio: Float32Array,
        options?: {
            language?: string;
            task?: 'transcribe' | 'translate';
            onProgress?: StreamingCallback;
        }
    ): Promise<TranscriptionResult> {
        if (!this.transcriber) {
            throw new Error('Transcriber not initialized');
        }

        const language = options?.language || this.config.language;
        const task = options?.task || this.config.task;
        const isDistilWhisper = this.config.model.startsWith("distil-whisper/");
        
        const chunkLengthS = isDistilWhisper ? 20 : this.config.chunkLengthS;
        const strideLengthS = isDistilWhisper ? 3 : this.config.strideLengthS;

        const timePrecision = (this.transcriber as any).processor.feature_extractor.config.chunk_length /
            (this.transcriber as any).model.config.max_source_positions;

        // Storage for chunks
        const chunks: TranscriptionChunk[] = [];
        let chunkCount = 0;
        let startTime: number | null = null;
        let numTokens = 0;
        let tps: number | undefined;

        // Create streamer for real-time updates
        const streamer = new WhisperTextStreamer((this.transcriber as any).tokenizer, {
            time_precision: timePrecision,
            on_chunk_start: (x: number) => {
                const offset = (chunkLengthS - strideLengthS) * chunkCount;
                chunks.push({
                    text: "",
                    timestamp: [offset + x, null],
                    finalised: false,
                    offset,
                });
            },
            token_callback_function: () => {
                startTime ??= performance.now();
                if (numTokens++ > 0) {
                    tps = (numTokens / (performance.now() - startTime)) * 1000;
                }
            },
            callback_function: (x: string) => {
                if (chunks.length === 0) return;
                
                // Append text to the last chunk
                chunks[chunks.length - 1].text += x;

                // Call progress callback
                if (options?.onProgress) {
                    options.onProgress({
                        text: chunks.map(c => c.text).join(''),
                        chunks: [...chunks],
                        tps,
                    });
                }
            },
            on_chunk_end: (x: number) => {
                const current = chunks[chunks.length - 1];
                current.timestamp[1] = x + current.offset;
                current.finalised = true;
            },
            on_finalize: () => {
                startTime = null;
                numTokens = 0;
                chunkCount++;
            },
        });

        // Run transcription
        const output = await this.transcriber(audio, {
            top_k: 0,
            do_sample: false,
            chunk_length_s: chunkLengthS,
            stride_length_s: strideLengthS,
            language: language,
            task: task,
            return_timestamps: true,
            force_full_sequences: false,
            streamer,
        });

        const fullText = chunks.map(chunk => chunk.text).join('').trim();

        return {
            text: fullText,
            chunks,
            tps,
        };
    }

    /**
     * Get current configuration
     */
    getConfig(): Readonly<Required<WhisperTranscriberConfig>> {
        return { ...this.config };
    }

    /**
     * Update configuration (requires reinitialization if model changes)
     */
    async updateConfig(config: Partial<WhisperTranscriberConfig>): Promise<void> {
        const needsReinit = config.model && config.model !== this.config.model;

        Object.assign(this.config, config);

        if (needsReinit && this.isInitialized) {
            await this.destroy();
            await this.create();
        }
    }

    /**
     * Check if transcriber is initialized
     */
    isReady(): boolean {
        return this.isInitialized && this.transcriber !== null;
    }

    /**
     * Check if model is currently loading
     */
    isModelLoading(): boolean {
        return this.isLoading;
    }

    /**
     * Get available languages
     */
    static getAvailableLanguages(): Record<string, string> {
        return { ...LANGUAGES };
    }

    /**
     * Get available models with sizes (in MB)
     */
    static getAvailableModels(): Array<{ id: string; name: string; size: number }> {
        return [
            { id: 'onnx-community/whisper-tiny', name: 'Whisper Tiny', size: 120 },
            { id: 'onnx-community/whisper-base', name: 'Whisper Base', size: 206 },
            { id: 'onnx-community/whisper-small', name: 'Whisper Small', size: 586 },
            { id: 'onnx-community/whisper-large-v3-turbo', name: 'Whisper Large V3 Turbo (Recommended)', size: 1604 },
        ];
    }

    /**
     * Check if WebGPU is supported
     */
    static isWebGPUSupported(): boolean {
        return !!(navigator as any).gpu;
    }
}
