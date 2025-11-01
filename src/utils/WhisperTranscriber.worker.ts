/**
 * Web Worker for WhisperTranscriber
 * Runs transcription in a background thread to prevent UI blocking
 */

import { WhisperTranscriber, WhisperTranscriberConfig, TranscriptionResult } from './WhisperTranscriber';

// Worker message types
type WorkerRequest = 
    | { type: 'download'; modelName?: string }
    | { type: 'create'; config: WhisperTranscriberConfig }
    | { type: 'destroy' }
    | { type: 'transcribe'; audioData: ArrayBuffer; sampleRate: number }
    | { type: 'getAvailableLanguages' }
    | { type: 'getAvailableModels' };

type WorkerResponse = 
    | { type: 'download-progress'; progress: number; loaded: number; total: number }
    | { type: 'download-complete' }
    | { type: 'create-complete' }
    | { type: 'destroy-complete' }
    | { type: 'transcribe-result'; result: TranscriptionResult }
    | { type: 'available-languages'; languages: Record<string, string> }
    | { type: 'available-models'; models: Array<{ id: string; name: string; size: number }> }
    | { type: 'error'; error: string };

let transcriber: WhisperTranscriber | null = null;

// Handle messages from main thread
self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
    const message = e.data;

    try {
        switch (message.type) {
            case 'download': {
                // Create a temporary instance to download
                const tempTranscriber = new WhisperTranscriber({
                    model: message.modelName || 'whisper-large-v3-turbo'
                });
                
                await tempTranscriber.download((progress) => {
                    const response: WorkerResponse = {
                        type: 'download-progress',
                        progress: progress.progress || 0,
                        loaded: progress.loaded || 0,
                        total: progress.total || 0
                    };
                    self.postMessage(response);
                });
                
                const response: WorkerResponse = { type: 'download-complete' };
                self.postMessage(response);
                break;
            }

            case 'create': {
                // Destroy existing instance if any
                if (transcriber) {
                    transcriber.destroy();
                }

                transcriber = new WhisperTranscriber(message.config);
                await transcriber.create();
                
                const response: WorkerResponse = { type: 'create-complete' };
                self.postMessage(response);
                break;
            }

            case 'destroy': {
                if (transcriber) {
                    transcriber.destroy();
                    transcriber = null;
                }
                
                const response: WorkerResponse = { type: 'destroy-complete' };
                self.postMessage(response);
                break;
            }

            case 'transcribe': {
                if (!transcriber) {
                    throw new Error('Transcriber not initialized. Call create() first.');
                }

                // Audio is already preprocessed as Float32Array buffer
                const audioFloat32 = new Float32Array(message.audioData);
                
                // Perform transcription directly on audio data
                const result = await (transcriber as any).transcribeAudioData(audioFloat32);
                
                const response: WorkerResponse = {
                    type: 'transcribe-result',
                    result
                };
                self.postMessage(response);
                break;
            }

            case 'getAvailableLanguages': {
                const languages = WhisperTranscriber.getAvailableLanguages();
                const response: WorkerResponse = {
                    type: 'available-languages',
                    languages
                };
                self.postMessage(response);
                break;
            }

            case 'getAvailableModels': {
                const models = WhisperTranscriber.getAvailableModels();
                const response: WorkerResponse = {
                    type: 'available-models',
                    models
                };
                self.postMessage(response);
                break;
            }

            default:
                throw new Error(`Unknown message type: ${(message as any).type}`);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const response: WorkerResponse = {
            type: 'error',
            error: errorMessage
        };
        self.postMessage(response);
    }
};
