/**
 * WhisperTranscriberWorkerClient
 * Client wrapper for using WhisperTranscriber in a Web Worker
 * Prevents UI blocking during heavy transcription operations
 */

import { WhisperTranscriberConfig, TranscriptionResult, ProgressCallback } from './WhisperTranscriber';

export class WhisperTranscriberWorkerClient {
    private worker: Worker | null = null;
    private messageId = 0;
    private pendingRequests = new Map<number, {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        progressCallback?: ProgressCallback;
    }>();

    constructor() {
        // Worker will be created lazily on first use
    }

    private ensureWorker(): void {
        if (!this.worker) {
            this.worker = new Worker(
                new URL('./WhisperTranscriber.worker.ts', import.meta.url),
                { type: 'module' }
            );

            this.worker.onmessage = (e) => {
                this.handleWorkerMessage(e.data);
            };

            this.worker.onerror = (error) => {
                console.error('[WhisperWorker] Worker error:', error);
                // Reject all pending requests
                this.pendingRequests.forEach(({ reject }) => {
                    reject(new Error('Worker error: ' + error.message));
                });
                this.pendingRequests.clear();
            };
        }
    }

    private handleWorkerMessage(message: any): void {
        if (message.type === 'download-progress') {
            // Find the download request and call its progress callback
            this.pendingRequests.forEach(({ progressCallback }) => {
                if (progressCallback) {
                    progressCallback({
                        status: 'downloading',
                        progress: message.progress,
                        loaded: message.loaded,
                        total: message.total
                    });
                }
            });
            return;
        }

        // For other messages, find the matching request
        const request = Array.from(this.pendingRequests.values())[0]; // FIFO
        if (!request) return;

        const { resolve, reject } = request;

        if (message.type === 'error') {
            this.pendingRequests.delete(this.messageId - 1);
            reject(new Error(message.error));
        } else if (message.type === 'download-complete') {
            this.pendingRequests.delete(this.messageId - 1);
            resolve(undefined);
        } else if (message.type === 'create-complete') {
            this.pendingRequests.delete(this.messageId - 1);
            resolve(undefined);
        } else if (message.type === 'destroy-complete') {
            this.pendingRequests.delete(this.messageId - 1);
            resolve(undefined);
        } else if (message.type === 'transcribe-result') {
            this.pendingRequests.delete(this.messageId - 1);
            resolve(message.result);
        } else if (message.type === 'available-languages') {
            this.pendingRequests.delete(this.messageId - 1);
            resolve(message.languages);
        } else if (message.type === 'available-models') {
            this.pendingRequests.delete(this.messageId - 1);
            resolve(message.models);
        }
    }

    /**
     * Pre-download the model for offline use
     */
    async download(progressCallback?: ProgressCallback, modelName?: string): Promise<void> {
        this.ensureWorker();
        
        const id = this.messageId++;
        const promise = new Promise<void>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject, progressCallback });
        });

        this.worker!.postMessage({
            type: 'download',
            modelName
        });

        return promise;
    }

    /**
     * Initialize the transcriber with configuration
     */
    async create(config: WhisperTranscriberConfig = {}): Promise<void> {
        this.ensureWorker();
        
        const id = this.messageId++;
        const promise = new Promise<void>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
        });

        this.worker!.postMessage({
            type: 'create',
            config
        });

        return promise;
    }

    /**
     * Destroy the transcriber and free up resources
     */
    async destroy(): Promise<void> {
        if (!this.worker) return;
        
        const id = this.messageId++;
        const promise = new Promise<void>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
        });

        this.worker!.postMessage({
            type: 'destroy'
        });

        await promise;

        // Terminate the worker
        this.worker.terminate();
        this.worker = null;
        this.pendingRequests.clear();
    }

    /**
     * Transcribe audio blob to text
     */
    async transcribe(audioBlob: Blob): Promise<TranscriptionResult> {
        this.ensureWorker();
        
        const id = this.messageId++;
        const promise = new Promise<TranscriptionResult>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
        });

        // Process audio in main thread (AudioContext not available in workers)
        const audioData = await this.preprocessAudio(audioBlob);

        this.worker!.postMessage({
            type: 'transcribe',
            audioData: audioData.buffer,
            sampleRate: audioData.sampleRate
        }, [audioData.buffer]); // Transfer ArrayBuffer for better performance

        return promise;
    }

    /**
     * Preprocess audio: decode and convert to Float32Array
     * This must run in the main thread because AudioContext is not available in workers
     */
    private async preprocessAudio(blob: Blob): Promise<{ buffer: ArrayBuffer; sampleRate: number }> {
        const SAMPLING_RATE = 16000;
        
        // Convert blob to array buffer
        const arrayBuffer = await blob.arrayBuffer();
        
        // Decode audio using AudioContext (main thread only)
        const audioContext = new AudioContext({ sampleRate: SAMPLING_RATE });
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Extract and convert to mono if needed
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
        
        await audioContext.close();
        
        return {
            buffer: audio.buffer as ArrayBuffer,
            sampleRate: audioBuffer.sampleRate
        };
    }

    /**
     * One-shot transcription: create, transcribe, and destroy in one call
     */
    async oneShotTranscribe(audioBlob: Blob, config?: WhisperTranscriberConfig): Promise<TranscriptionResult> {
        await this.create(config);
        try {
            const result = await this.transcribe(audioBlob);
            return result;
        } finally {
            await this.destroy();
        }
    }

    /**
     * Get available languages (static method equivalent)
     */
    async getAvailableLanguages(): Promise<Record<string, string>> {
        this.ensureWorker();
        
        const id = this.messageId++;
        const promise = new Promise<Record<string, string>>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
        });

        this.worker!.postMessage({
            type: 'getAvailableLanguages'
        });

        return promise;
    }

    /**
     * Get available models (static method equivalent)
     */
    async getAvailableModels(): Promise<Array<{ id: string; name: string; size: number }>> {
        this.ensureWorker();
        
        const id = this.messageId++;
        const promise = new Promise<Array<{ id: string; name: string; size: number }>>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
        });

        this.worker!.postMessage({
            type: 'getAvailableModels'
        });

        return promise;
    }
}
