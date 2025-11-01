/**
 * BackgroundVoiceRecognition - Continuous voice recognition using Whisper
 * Listens for keywords/phrases in the background and maintains full audio context
 */

import {
    AutoTokenizer,
    AutoProcessor,
    WhisperForConditionalGeneration,
} from '@huggingface/transformers';

const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 30; // seconds
const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;
const RECOGNITION_INTERVAL = 2000; // Process audio every 2 seconds
const AUDIO_BUFFER_DURATION = 60; // Keep 60 seconds of audio in buffer

export type VoiceRecognitionStatus = 'idle' | 'loading' | 'ready' | 'listening' | 'processing' | 'error';

export interface VoiceRecognitionConfig {
    modelId?: string;
    language?: string;
    device?: 'webgpu' | 'wasm';
    dtype?: {
        encoder_model: 'fp32' | 'fp16';
        decoder_model_merged: 'q4' | 'fp32' | 'fp16';
    };
    maxNewTokens?: number;
    recognitionInterval?: number;
    audioBufferDuration?: number;
    minMatchConfidence?: number; // 0-1, for fuzzy matching
}

export interface KeywordTrigger {
    id: string;
    keywords: string[]; // Words or phrases to match
    fuzzyMatch?: boolean; // Allow similar words (default: true)
    handler: (context: VoiceContext) => void | Promise<void>;
}

export interface VoiceContext {
    triggerId: string;
    matchedText: string;
    fullText: string;
    confidence: number;
    timestamp: number;
    getFullAudio: () => Promise<AudioBufferData>;
    waitForSilence: (silenceDurationMs?: number) => Promise<AudioBufferData>;
}

export interface AudioBufferData {
    audio: Float32Array;
    duration: number;
    sampleRate: number;
    blob: Blob;
}

export interface ProgressCallback {
    (progress: { status: string; file?: string; progress?: number; loaded?: number; total?: number }): void;
}

/**
 * BackgroundVoiceRecognition class
 * Continuously monitors audio for keywords and maintains full context
 */
export class BackgroundVoiceRecognition {
    private config: Required<VoiceRecognitionConfig>;
    private status: VoiceRecognitionStatus = 'idle';
    
    // Whisper model
    private tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null;
    private processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
    private model: Awaited<ReturnType<typeof WhisperForConditionalGeneration.from_pretrained>> | null = null;
    
    // Audio recording
    private mediaStream: MediaStream | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private audioContext: AudioContext | null = null;
    private audioSource: MediaStreamAudioSourceNode | null = null;
    private audioProcessor: ScriptProcessorNode | null = null;
    private audioChunks: Blob[] = [];
    private audioBuffer: Float32Array[] = []; // Rolling buffer of audio samples
    private isRecording = false;
    
    // Recognition
    private recognitionTimer: number | null = null;
    private triggers: Map<string, KeywordTrigger> = new Map();
    private isProcessing = false;
    
    // Callbacks
    private onStatusChange: ((status: VoiceRecognitionStatus) => void) | null = null;
    private onTranscript: ((text: string) => void) | null = null;
    private onError: ((error: Error) => void) | null = null;
    private progressCallback: ProgressCallback | null = null;
    
    // Silence detection
    private silenceDetectionCallbacks: Map<string, {
        resolve: (data: AudioBufferData) => void;
        silenceDuration: number;
        lastSoundTime: number;
    }> = new Map();

    constructor(config: VoiceRecognitionConfig = {}) {
        this.config = {
            modelId: config.modelId || 'onnx-community/whisper-base',
            language: config.language || 'en',
            device: config.device || 'webgpu',
            dtype: config.dtype || {
                encoder_model: 'fp32',
                decoder_model_merged: 'q4',
            },
            maxNewTokens: config.maxNewTokens || 64,
            recognitionInterval: config.recognitionInterval || RECOGNITION_INTERVAL,
            audioBufferDuration: config.audioBufferDuration || AUDIO_BUFFER_DURATION,
            minMatchConfidence: config.minMatchConfidence || 0.7,
        };
    }

    /**
     * Check if WebGPU is supported
     */
    static isWebGPUSupported(): boolean {
        return !!(navigator as any).gpu;
    }

    /**
     * Check if getUserMedia is supported
     */
    static isMediaSupported(): boolean {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    /**
     * Get current status
     */
    getStatus(): VoiceRecognitionStatus {
        return this.status;
    }

    /**
     * Check if model is loaded and ready
     */
    isReady(): boolean {
        return this.status === 'ready' || this.status === 'listening' || this.status === 'processing';
    }

    /**
     * Check if currently listening
     */
    isListening(): boolean {
        return this.status === 'listening' || this.status === 'processing';
    }

    /**
     * Set status change callback
     */
    setOnStatusChange(callback: (status: VoiceRecognitionStatus) => void): void {
        this.onStatusChange = callback;
    }

    /**
     * Set transcript callback (receives all recognized text)
     */
    setOnTranscript(callback: (text: string) => void): void {
        this.onTranscript = callback;
    }

    /**
     * Set error callback
     */
    setOnError(callback: (error: Error) => void): void {
        this.onError = callback;
    }

    /**
     * Load the Whisper model
     */
    async loadModel(progressCallback?: ProgressCallback): Promise<void> {
        if (this.isReady()) {
            return;
        }

        this.progressCallback = progressCallback || null;
        this.updateStatus('loading');

        try {
            this.emitProgress({ status: 'loading', file: 'Loading Whisper model...' });

            // Load tokenizer, processor, and model
            this.tokenizer = await AutoTokenizer.from_pretrained(this.config.modelId, {
                progress_callback: (progress: any) => this.emitProgress(progress),
            });

            this.processor = await AutoProcessor.from_pretrained(this.config.modelId, {
                progress_callback: (progress: any) => this.emitProgress(progress),
            });

            this.model = await WhisperForConditionalGeneration.from_pretrained(this.config.modelId, {
                dtype: this.config.dtype,
                device: this.config.device,
                progress_callback: (progress: any) => this.emitProgress(progress),
            });

            this.emitProgress({ status: 'loading', file: 'Warming up model...' });

            // Warm up model with dummy input
            const dummyInput = new Float32Array(MAX_SAMPLES).fill(0);
            await this.recognizeAudio(dummyInput);

            this.updateStatus('ready');
            this.emitProgress({ status: 'ready' });
        } catch (error) {
            this.updateStatus('error');
            const err = error instanceof Error ? error : new Error(String(error));
            this.handleError(err);
            throw err;
        }
    }

    /**
     * Request microphone permission
     */
    async requestPermission(): Promise<boolean> {
        if (!BackgroundVoiceRecognition.isMediaSupported()) {
            throw new Error('getUserMedia is not supported in this browser');
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            
            // Stop the stream immediately, we just wanted permission
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            console.error('Microphone permission denied:', error);
            return false;
        }
    }

    /**
     * Start listening for keywords
     */
    async start(): Promise<void> {
        if (!this.isReady()) {
            throw new Error('Model not loaded. Call loadModel() first.');
        }

        if (this.isListening()) {
            console.warn('Already listening');
            return;
        }

        try {
            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            // Create audio context
            this.audioContext = new AudioContext({
                sampleRate: WHISPER_SAMPLING_RATE,
            });

            // Use Web Audio API to process audio directly
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const audioData = new Float32Array(inputData);
                
                // Add to rolling buffer
                this.audioBuffer.push(audioData);

                // Keep only last N seconds
                const maxSamples = WHISPER_SAMPLING_RATE * this.config.audioBufferDuration;
                let totalSamples = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);

                while (totalSamples > maxSamples && this.audioBuffer.length > 0) {
                    const removed = this.audioBuffer.shift();
                    if (removed) {
                        totalSamples -= removed.length;
                    }
                }

                // Check for silence detection callbacks
                this.checkSilenceDetection(audioData);
            };

            source.connect(processor);
            processor.connect(this.audioContext.destination);

            this.isRecording = true;

            // Keep references for cleanup
            this.audioSource = source;
            this.audioProcessor = processor;

            // Start recognition timer
            this.recognitionTimer = window.setInterval(() => {
                this.processRecognition();
            }, this.config.recognitionInterval);

            this.updateStatus('listening');
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.handleError(err);
            throw err;
        }
    }

    /**
     * Stop listening
     */
    stop(): void {
        if (this.recognitionTimer) {
            clearInterval(this.recognitionTimer);
            this.recognitionTimer = null;
        }

        // Disconnect audio nodes
        if (this.audioProcessor) {
            this.audioProcessor.disconnect();
            this.audioProcessor = null;
        }

        if (this.audioSource) {
            this.audioSource.disconnect();
            this.audioSource = null;
        }

        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this.audioChunks = [];
        this.audioBuffer = [];
        this.isRecording = false;
        this.updateStatus('ready');
    }

    /**
     * Add a keyword trigger
     */
    addTrigger(trigger: KeywordTrigger): void {
        this.triggers.set(trigger.id, trigger);
    }

    /**
     * Remove a trigger
     */
    removeTrigger(id: string): boolean {
        return this.triggers.delete(id);
    }

    /**
     * Clear all triggers
     */
    clearTriggers(): void {
        this.triggers.clear();
    }

    /**
     * Get all triggers
     */
    getTriggers(): KeywordTrigger[] {
        return Array.from(this.triggers.values());
    }



    /**
     * Process recognition on buffered audio
     */
    private async processRecognition(): Promise<void> {
        if (this.isProcessing || this.audioBuffer.length === 0) {
            return;
        }

        this.isProcessing = true;
        this.updateStatus('processing');

        try {
            // Get last 30 seconds of audio for recognition
            const audio = this.getLastNSeconds(30);
            const text = await this.recognizeAudio(audio);

            if (text && text.trim()) {
                // Emit transcript
                if (this.onTranscript) {
                    this.onTranscript(text);
                }

                // Check triggers
                this.checkTriggers(text);
            }
        } catch (error) {
            console.error('Recognition error:', error);
        } finally {
            this.isProcessing = false;
            this.updateStatus('listening');
        }
    }

    /**
     * Recognize audio using Whisper
     */
    private async recognizeAudio(audio: Float32Array): Promise<string> {
        if (!this.tokenizer || !this.processor || !this.model) {
            throw new Error('Model not initialized');
        }

        try {
            // Trim or pad audio to max length
            let processedAudio = audio;
            if (audio.length > MAX_SAMPLES) {
                processedAudio = audio.slice(-MAX_SAMPLES);
            }

            const inputs = await this.processor(processedAudio);

            const outputs = await this.model.generate({
                ...inputs,
                max_new_tokens: this.config.maxNewTokens,
                language: this.config.language,
            });

            const decoded = this.tokenizer.batch_decode(outputs as any, {
                skip_special_tokens: true,
            });

            return decoded[0] || '';
        } catch (error) {
            console.error('Error during recognition:', error);
            return '';
        }
    }

    /**
     * Check if recognized text matches any triggers
     */
    private checkTriggers(text: string): void {
        const lowerText = text.toLowerCase();

        for (const trigger of this.triggers.values()) {
            for (const keyword of trigger.keywords) {
                const lowerKeyword = keyword.toLowerCase();
                const fuzzyMatch = trigger.fuzzyMatch !== false;

                let isMatch = false;
                let confidence = 0;

                if (fuzzyMatch) {
                    confidence = this.calculateSimilarity(lowerText, lowerKeyword);
                    isMatch = confidence >= this.config.minMatchConfidence;
                } else {
                    isMatch = lowerText.includes(lowerKeyword);
                    confidence = isMatch ? 1 : 0;
                }

                if (isMatch) {
                    const context: VoiceContext = {
                        triggerId: trigger.id,
                        matchedText: keyword,
                        fullText: text,
                        confidence,
                        timestamp: Date.now(),
                        getFullAudio: () => this.getFullAudioBuffer(),
                        waitForSilence: (silenceDurationMs = 2000) => 
                            this.waitForSilence(trigger.id, silenceDurationMs),
                    };

                    // Call handler (async or sync)
                    Promise.resolve(trigger.handler(context)).catch((error) => {
                        console.error(`Error in trigger handler "${trigger.id}":`, error);
                    });

                    break; // Only trigger once per keyword
                }
            }
        }
    }

    /**
     * Calculate similarity between two strings (Levenshtein distance based)
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        // Check if shorter is contained in longer
        if (longer.includes(shorter)) {
            return 0.9;
        }

        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance
     */
    private levenshteinDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * Get last N seconds of audio from buffer
     */
    private getLastNSeconds(seconds: number): Float32Array {
        const samples = WHISPER_SAMPLING_RATE * seconds;
        const totalSamples = this.audioBuffer.reduce((sum, arr) => sum + arr.length, 0);

        if (totalSamples === 0) {
            return new Float32Array(0);
        }

        // Concatenate all chunks
        const combined = new Float32Array(totalSamples);
        let offset = 0;
        for (const chunk of this.audioBuffer) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        // Return last N seconds
        if (combined.length > samples) {
            return combined.slice(-samples);
        }

        return combined;
    }

    /**
     * Get full audio buffer as AudioBufferData
     */
    private async getFullAudioBuffer(): Promise<AudioBufferData> {
        const audio = this.getLastNSeconds(this.config.audioBufferDuration);
        const blob = await this.createAudioBlob(audio);

        return {
            audio,
            duration: audio.length / WHISPER_SAMPLING_RATE,
            sampleRate: WHISPER_SAMPLING_RATE,
            blob,
        };
    }

    /**
     * Wait for silence and return audio buffer
     */
    private waitForSilence(triggerId: string, silenceDurationMs: number): Promise<AudioBufferData> {
        return new Promise((resolve) => {
            this.silenceDetectionCallbacks.set(triggerId, {
                resolve,
                silenceDuration: silenceDurationMs,
                lastSoundTime: Date.now(),
            });
        });
    }

    /**
     * Check for silence in audio chunk
     */
    private checkSilenceDetection(audioData: Float32Array): void {
        const rms = this.calculateRMS(audioData);
        const isSilent = rms < 0.01; // Threshold for silence

        const now = Date.now();

        for (const [triggerId, callback] of this.silenceDetectionCallbacks.entries()) {
            if (!isSilent) {
                callback.lastSoundTime = now;
            } else {
                const silenceDuration = now - callback.lastSoundTime;
                if (silenceDuration >= callback.silenceDuration) {
                    // Silence detected
                    this.getFullAudioBuffer().then(callback.resolve);
                    this.silenceDetectionCallbacks.delete(triggerId);
                }
            }
        }
    }

    /**
     * Calculate RMS (Root Mean Square) of audio data
     */
    private calculateRMS(audioData: Float32Array): number {
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        return Math.sqrt(sum / audioData.length);
    }

    /**
     * Create audio blob from Float32Array
     */
    private async createAudioBlob(audioData: Float32Array): Promise<Blob> {
        // Create WAV file
        const wavBuffer = this.createWavBuffer(audioData, WHISPER_SAMPLING_RATE);
        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    /**
     * Create WAV buffer from audio data
     */
    private createWavBuffer(samples: Float32Array, sampleRate: number): ArrayBuffer {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        // WAV header
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);

        // Write samples
        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }

        return buffer;
    }

    /**
     * Update status and notify callback
     */
    private updateStatus(status: VoiceRecognitionStatus): void {
        this.status = status;
        if (this.onStatusChange) {
            this.onStatusChange(status);
        }
    }

    /**
     * Emit progress update
     */
    private emitProgress(progress: any): void {
        if (this.progressCallback) {
            this.progressCallback(progress);
        }
    }

    /**
     * Handle error
     */
    private handleError(error: Error): void {
        console.error('BackgroundVoiceRecognition error:', error);
        if (this.onError) {
            this.onError(error);
        }
    }

    /**
     * Destroy and cleanup
     */
    destroy(): void {
        this.stop();
        this.clearTriggers();
        this.silenceDetectionCallbacks.clear();
        
        this.tokenizer = null;
        this.processor = null;
        this.model = null;
        
        this.updateStatus('idle');
    }
}
