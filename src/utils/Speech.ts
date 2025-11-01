import EasySpeech from 'easy-speech';
import { KokoroTTS } from './kokoro.js/kokoro';
import { VOICES as KOKORO_VOICES } from './kokoro.js/voices';

type SpeechEngine = 'kokoro' | 'browser';

interface Voice {
    id: string;
    name: string;
    language: string;
    engine: SpeechEngine;
    nativeVoice?: SpeechSynthesisVoice;
}

interface SpeakOptions {
    text: string;
    voice?: string | Voice;
    rate?: number;
    pitch?: number;
    volume?: number;
    engine?: SpeechEngine;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (error: Error) => void;
    onProcessing?: () => void; // Called when starting to generate audio (for Kokoro)
    onPlaying?: () => void; // Called when audio starts playing
    onChunkHighlight?: (chunk: string, index: number) => void; // Called for each chunk being spoken
}

interface StreamOptions {
    voice?: string | Voice;
    rate?: number;
    pitch?: number;
    volume?: number;
    engine?: SpeechEngine;
    signal?: AbortSignal;
    onChunkStart?: (index: number) => void;
    onChunkEnd?: (index: number) => void;
    onError?: (error: Error) => void;
}

/**
 * Speech - Unified TTS wrapper for Kokoro and Browser Speech Synthesis
 */
export class Speech {
    private static kokoroTTS: KokoroTTS | null = null;
    private static isKokoroLoaded: boolean = false;
    private static isBrowserSpeechReady: boolean = false;
    private static audioQueue: HTMLAudioElement[] = [];
    private static isPlayingQueue: boolean = false;
    private static currentAudio: HTMLAudioElement | null = null;
    private static streamAbortController: AbortController | null = null;
    private static isStopRequested: boolean = false;
    private static currentSpeechAbortController: AbortController | null = null;

    /**
     * Initialize speech engines
     */
    static async init(options?: {
        loadKokoro?: boolean;
        kokoroModelId?: string;
        kokoroDtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
        kokoroDevice?: 'webgpu' | 'wasm';
        onProgress?: (progress: any) => void;
    }): Promise<{ kokoro: boolean; browser: boolean }> {
        const result = { kokoro: false, browser: false };

        // Initialize browser speech synthesis
        try {
            const initialized = await EasySpeech.init({
                maxTimeout: 5000,
                interval: 250,
                quiet: true,
            });
            this.isBrowserSpeechReady = initialized;
            result.browser = initialized;
            console.log('[Speech] Browser TTS initialized:', initialized);
        } catch (error) {
            console.warn('[Speech] Browser TTS initialization failed:', error);
        }

        // Initialize Kokoro TTS if requested
        if (options?.loadKokoro) {
            try {
                console.log('[Speech] Loading Kokoro TTS...');
                const modelId = options.kokoroModelId || 'onnx-community/Kokoro-82M-ONNX';
                
                this.kokoroTTS = await KokoroTTS.from_pretrained(modelId, {
                    dtype: options.kokoroDtype || 'fp32',
                    device: options.kokoroDevice || 'webgpu',
                    progress_callback: options.onProgress,
                });

                // Warm up
                console.log('[Speech] Warming up Kokoro TTS...');
                await this.kokoroTTS.generate('Hello', { voice: 'af_sky' });
                
                this.isKokoroLoaded = true;
                result.kokoro = true;
                console.log('[Speech] Kokoro TTS ready');
            } catch (error) {
                console.error('[Speech] Kokoro TTS initialization failed:', error);
            }
        }

        return result;
    }

    /**
     * Get all available voices from both engines
     */
    static getVoices(): Voice[] {
        const voices: Voice[] = [];

        // Browser voices
        if (this.isBrowserSpeechReady) {
            const browserVoices = EasySpeech.voices();
            voices.push(...browserVoices.map(v => ({
                id: v.voiceURI,
                name: v.name,
                language: v.lang,
                engine: 'browser' as SpeechEngine,
                nativeVoice: v,
            })));
        }

        // Kokoro voices
        if (this.isKokoroLoaded && this.kokoroTTS) {
            const kokoroVoiceIds = Object.keys(KOKORO_VOICES);
            voices.push(...kokoroVoiceIds.map(voiceId => ({
                id: voiceId,
                name: KOKORO_VOICES[voiceId].name,
                language: KOKORO_VOICES[voiceId].language,
                engine: 'kokoro' as SpeechEngine,
            })));
        }

        return voices;
    }

    /**
     * Filter voices by language
     */
    static filterVoices(language: string, engine?: SpeechEngine): Voice[] {
        const allVoices = this.getVoices();
        
        return allVoices.filter(voice => {
            const langMatch = voice.language.toLowerCase().startsWith(language.toLowerCase());
            const engineMatch = !engine || voice.engine === engine;
            return langMatch && engineMatch;
        });
    }

    /**
     * Get local/device voices only (browser engine)
     */
    static getLocalVoices(language?: string): Voice[] {
        if (!this.isBrowserSpeechReady) return [];

        const browserVoices = EasySpeech.voices();
        const localVoices = browserVoices.filter(v => v.localService);

        return localVoices
            .filter(v => !language || v.lang.toLowerCase().startsWith(language.toLowerCase()))
            .map(v => ({
                id: v.voiceURI,
                name: v.name,
                language: v.lang,
                engine: 'browser' as SpeechEngine,
                nativeVoice: v,
            }));
    }

    /**
     * Split text into chunks suitable for Kokoro TTS (max ~50 words or 350 characters)
     */
    private static splitTextForKokoro(text: string): string[] {
        const chunks: string[] = [];
        const maxChars = 350;
        const maxWords = 50;
        
        // Split by sentences first
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        
        let currentChunk = '';
        
        for (const sentence of sentences) {
            const trimmedSentence = sentence.trim();
            if (!trimmedSentence) continue;
            
            const testChunk = currentChunk ? currentChunk + ' ' + trimmedSentence : trimmedSentence;
            const wordCount = testChunk.split(/\s+/).length;
            
            // If adding this sentence would exceed limits, save current chunk and start new one
            if (testChunk.length > maxChars || wordCount > maxWords) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                
                // If single sentence is too long, split it by commas or words
                if (trimmedSentence.length > maxChars || trimmedSentence.split(/\s+/).length > maxWords) {
                    const subChunks = this.splitLongSentence(trimmedSentence, maxChars, maxWords);
                    chunks.push(...subChunks);
                    currentChunk = '';
                } else {
                    currentChunk = trimmedSentence;
                }
            } else {
                currentChunk = testChunk;
            }
        }
        
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        
        return chunks.filter(c => c.length > 0);
    }

    /**
     * Split a long sentence into smaller chunks
     */
    private static splitLongSentence(sentence: string, maxChars: number, maxWords: number): string[] {
        const chunks: string[] = [];
        
        // Try splitting by commas first
        const parts = sentence.split(/,\s*/);
        let currentChunk = '';
        
        for (const part of parts) {
            const testChunk = currentChunk ? currentChunk + ', ' + part : part;
            
            if (testChunk.length > maxChars || testChunk.split(/\s+/).length > maxWords) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                
                // If part itself is too long, split by words
                if (part.length > maxChars || part.split(/\s+/).length > maxWords) {
                    const words = part.split(/\s+/);
                    let wordChunk = '';
                    
                    for (const word of words) {
                        const testWordChunk = wordChunk ? wordChunk + ' ' + word : word;
                        
                        if (testWordChunk.length > maxChars || testWordChunk.split(/\s+/).length > maxWords) {
                            if (wordChunk) {
                                chunks.push(wordChunk.trim());
                            }
                            wordChunk = word;
                        } else {
                            wordChunk = testWordChunk;
                        }
                    }
                    
                    if (wordChunk) {
                        currentChunk = wordChunk;
                    } else {
                        currentChunk = '';
                    }
                } else {
                    currentChunk = part;
                }
            } else {
                currentChunk = testChunk;
            }
        }
        
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        
        return chunks.filter(c => c.length > 0);
    }

    /**
     * Speak text once with automatic engine selection
     */
    static async speak(options: SpeakOptions): Promise<void> {
        const { text, voice, rate, pitch, volume, engine, onStart, onEnd, onError, onProcessing, onPlaying, onChunkHighlight } = options;

        // Reset stop flag and create new abort controller
        this.isStopRequested = false;
        this.currentSpeechAbortController = new AbortController();

        // Determine which engine to use
        let selectedEngine: SpeechEngine = engine || 'browser';
        
        if (engine === 'kokoro' && !this.isKokoroLoaded) {
            console.warn('[Speech] Kokoro not loaded, falling back to browser');
            selectedEngine = 'browser';
        }

        if (engine === 'browser' && !this.isBrowserSpeechReady) {
            throw new Error('Browser speech not available');
        }

        try {
            if (selectedEngine === 'kokoro') {
                await this.speakWithKokoro(text, voice, onStart, onEnd, onError, onProcessing, onPlaying, onChunkHighlight);
            } else {
                await this.speakWithBrowser(text, voice, rate, pitch, volume, onStart, onEnd, onError, onPlaying);
            }
        } catch (error) {
            if (this.isStopRequested) {
                console.log('[Speech] Stopped by user');
                this.isStopRequested = false;
                return;
            }
            console.error('[Speech] Speak failed:', error);
            onError?.(error as Error);
            throw error;
        } finally {
            this.currentSpeechAbortController = null;
        }
    }

    /**
     * Speak with Kokoro TTS (with chunking for long texts)
     */
    private static async speakWithKokoro(
        text: string,
        voice?: string | Voice,
        onStart?: () => void,
        onEnd?: () => void,
        onError?: (error: Error) => void,
        onProcessing?: () => void,
        onPlaying?: () => void,
        onChunkHighlight?: (chunk: string, index: number) => void
    ): Promise<void> {
        if (!this.kokoroTTS) {
            throw new Error('Kokoro TTS not loaded');
        }

        try {
            const voiceId = typeof voice === 'string' ? voice : voice?.id || 'af_sky';
            
            // Split text into chunks
            const chunks = this.splitTextForKokoro(text);
            console.log(`[Speech] Split into ${chunks.length} chunks for Kokoro`);
            
            let isFirstChunk = true;
            
            for (let i = 0; i < chunks.length; i++) {
                // Check if stop was requested
                if (this.isStopRequested) {
                    console.log('[Speech] Stopping Kokoro speech');
                    throw new Error('Speech stopped by user');
                }
                
                const chunk = chunks[i];
                console.log(`[Speech] Processing chunk ${i + 1}/${chunks.length}:`, chunk.substring(0, 50) + '...');
                
                // Call onProcessing before generating
                if (isFirstChunk) {
                    onProcessing?.();
                }
                
                // Highlight current chunk
                onChunkHighlight?.(chunk, i);
                
                // Generate audio for this chunk
                const audio = await this.kokoroTTS.generate(chunk, { voice: voiceId });
                const audioBlob = await audio.toBlob();
                
                // Play the audio
                await this.playAudioBlob(
                    audioBlob,
                    isFirstChunk ? () => {
                        onStart?.();
                        onPlaying?.();
                    } : undefined,
                    i === chunks.length - 1 ? onEnd : undefined,
                    onError
                );
                
                isFirstChunk = false;
            }
        } catch (error) {
            console.error('[Speech] Kokoro generation failed:', error);
            onError?.(error as Error);
            throw error;
        }
    }

    /**
     * Speak with browser speech synthesis
     */
    private static async speakWithBrowser(
        text: string,
        voice?: string | Voice,
        rate?: number,
        pitch?: number,
        volume?: number,
        onStart?: () => void,
        onEnd?: () => void,
        onError?: (error: Error) => void,
        onPlaying?: () => void
    ): Promise<void> {
        if (!this.isBrowserSpeechReady) {
            throw new Error('Browser TTS not ready');
        }

        const voiceObj = this.resolveVoice(voice);

        return new Promise((resolve, reject) => {
            EasySpeech.speak({
                text,
                voice: voiceObj,
                rate: rate || 1,
                pitch: pitch || 1,
                volume: volume || 1,
                start: () => {
                    console.log('[Speech] Browser TTS started');
                    onStart?.();
                    onPlaying?.();
                },
                end: () => {
                    console.log('[Speech] Browser TTS ended');
                    onEnd?.();
                    resolve();
                },
                error: (e) => {
                    console.error('[Speech] Browser TTS error:', e);
                    onError?.(new Error(e.error));
                    reject(new Error(e.error));
                },
            });
        });
    }

    /**
     * Stream text chunks and speak them as they arrive
     */
    static async speakStream(options: StreamOptions): Promise<{
        addText: (text: string) => Promise<void>;
        finish: () => Promise<void>;
        cancel: () => void;
    }> {
        const textQueue: string[] = [];
        let isProcessing = false;
        let isFinished = false;
        let chunkIndex = 0;

        this.streamAbortController = new AbortController();
        const signal = options.signal || this.streamAbortController.signal;

        const processQueue = async () => {
            if (isProcessing || signal.aborted) return;
            if (textQueue.length === 0 && !isFinished) return;

            isProcessing = true;

            while (textQueue.length > 0 && !signal.aborted) {
                const text = textQueue.shift()!;
                const currentIndex = chunkIndex++;

                try {
                    options.onChunkStart?.(currentIndex);
                    
                    await this.speak({
                        text,
                        voice: options.voice,
                        rate: options.rate,
                        pitch: options.pitch,
                        volume: options.volume,
                        engine: options.engine,
                    });

                    options.onChunkEnd?.(currentIndex);
                } catch (error) {
                    console.error('[Speech] Stream chunk failed:', error);
                    options.onError?.(error as Error);
                }
            }

            isProcessing = false;
        };

        return {
            addText: async (text: string) => {
                if (signal.aborted) return;
                textQueue.push(text);
                await processQueue();
            },
            finish: async () => {
                isFinished = true;
                await processQueue();
            },
            cancel: () => {
                this.streamAbortController?.abort();
                this.stop();
            },
        };
    }

    /**
     * Play an audio blob through the queue system
     */
    private static async playAudioBlob(
        blob: Blob,
        onStart?: () => void,
        onEnd?: () => void,
        onError?: (error: Error) => void
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const audio = new Audio(URL.createObjectURL(blob));
            
            // Store callbacks with the audio element so processAudioQueue can call them
            (audio as any).__callbacks = { onStart, onEnd, onError, resolve, reject };
            
            audio.onloadeddata = () => {
                this.audioQueue.push(audio);
                this.processAudioQueue();
            };

            audio.onerror = (e) => {
                const error = new Error('Audio playback failed');
                console.error('[Speech] Audio error:', e);
                onError?.(error);
                reject(error);
            };
        });
    }

    /**
     * Process the audio queue
     */
    private static async processAudioQueue(): Promise<void> {
        if (this.isPlayingQueue || this.audioQueue.length === 0) return;

        this.isPlayingQueue = true;

        while (this.audioQueue.length > 0) {
            const audio = this.audioQueue.shift()!;
            this.currentAudio = audio;
            
            // Get stored callbacks
            const callbacks = (audio as any).__callbacks || {};

            await new Promise<void>((resolve) => {
                audio.onplay = () => {
                    callbacks.onStart?.();
                };
                
                audio.onended = () => {
                    URL.revokeObjectURL(audio.src);
                    this.currentAudio = null;
                    callbacks.onEnd?.();
                    callbacks.resolve?.();
                    resolve();
                };
                
                audio.onerror = () => {
                    URL.revokeObjectURL(audio.src);
                    this.currentAudio = null;
                    const error = new Error('Audio playback failed');
                    callbacks.onError?.(error);
                    callbacks.reject?.(error);
                    resolve(); // Still resolve the queue processing
                };
                
                audio.play().catch((e) => {
                    console.error('[Speech] Audio play failed:', e);
                    URL.revokeObjectURL(audio.src);
                    this.currentAudio = null;
                    const error = new Error('Audio play failed');
                    callbacks.onError?.(error);
                    callbacks.reject?.(error);
                    resolve();
                });
            });
        }

        this.isPlayingQueue = false;
    }

    /**
     * Stop all speech (both engines)
     */
    static stop(): void {
        // Set stop flag
        this.isStopRequested = true;
        
        // Abort ongoing speech generation
        if (this.currentSpeechAbortController) {
            this.currentSpeechAbortController.abort();
        }

        // Stop browser TTS
        if (this.isBrowserSpeechReady) {
            EasySpeech.cancel();
        }

        // Stop Kokoro audio playback
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }

        // Clear audio queue
        this.audioQueue.forEach(audio => {
            audio.pause();
            URL.revokeObjectURL(audio.src);
        });
        this.audioQueue = [];
        this.isPlayingQueue = false;

        console.log('[Speech] All speech stopped');
    }

    /**
     * Pause speech (browser only)
     */
    static pause(): void {
        if (this.isBrowserSpeechReady) {
            EasySpeech.pause();
        }
        if (this.currentAudio && !this.currentAudio.paused) {
            this.currentAudio.pause();
        }
    }

    /**
     * Resume speech (browser only)
     */
    static resume(): void {
        if (this.isBrowserSpeechReady) {
            EasySpeech.resume();
        }
        if (this.currentAudio && this.currentAudio.paused) {
            this.currentAudio.play();
        }
    }

    /**
     * Get current status
     */
    static getStatus(): {
        kokoro: { loaded: boolean; voices: string[] };
        browser: { ready: boolean; voices: number };
        playing: boolean;
        queueLength: number;
    } {
        return {
            kokoro: {
                loaded: this.isKokoroLoaded,
                voices: this.kokoroTTS?.list_voices() || [],
            },
            browser: {
                ready: this.isBrowserSpeechReady,
                voices: this.isBrowserSpeechReady ? EasySpeech.voices().length : 0,
            },
            playing: this.isPlayingQueue || !!this.currentAudio,
            queueLength: this.audioQueue.length,
        };
    }

    /**
     * Check if speech is supported
     */
    static isSupported(): boolean {
        return this.isBrowserSpeechReady || this.isKokoroLoaded;
    }

    /**
     * Resolve voice from string or Voice object
     */
    private static resolveVoice(voice?: string | Voice): SpeechSynthesisVoice | undefined {
        if (!voice) return undefined;
        
        if (typeof voice === 'string') {
            const allVoices = this.getVoices();
            const found = allVoices.find(v => v.id === voice || v.name === voice);
            return found?.nativeVoice;
        }
        
        return voice.nativeVoice;
    }

    /**
     * Set default voice for browser TTS
     */
    static setDefaultVoice(voice: string | Voice | null): void {
        if (!this.isBrowserSpeechReady) return;
        
        const voiceObj = voice ? this.resolveVoice(voice) : null;
        EasySpeech.defaults({ voice: voiceObj || undefined });
    }

    /**
     * Reset to initial state
     */
    static async reset(): Promise<void> {
        this.stop();
        
        if (this.isBrowserSpeechReady) {
            EasySpeech.reset();
            this.isBrowserSpeechReady = false;
        }

        try {
            await this.kokoroTTS?.model.dispose();  
        } catch (error) {
            
        }

        this.kokoroTTS = null;
        this.isKokoroLoaded = false;
        
        console.log('[Speech] Reset complete');
    }
}
