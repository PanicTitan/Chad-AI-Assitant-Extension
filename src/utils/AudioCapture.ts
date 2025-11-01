/**
 * AudioCapture - Handles microphone recording with permission management and chunking
 */
export class AudioCapture {
    private mediaStream: MediaStream | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private audioChunks: Blob[] = [];
    private isRecording: boolean = false;
    private hasPermission: boolean = false;

    /**
     * Request microphone permission
     */
    async requestPermission(): Promise<boolean> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                } 
            });
            
            // Stop the test stream immediately
            stream.getTracks().forEach(track => track.stop());
            
            this.hasPermission = true;
            console.log('[AudioCapture] Microphone permission granted');
            return true;
        } catch (error) {
            console.error('[AudioCapture] Permission denied:', error);
            this.hasPermission = false;
            return false;
        }
    }

    /**
     * Check if we have microphone permission
     */
    async checkPermission(): Promise<boolean> {
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
            this.hasPermission = permissionStatus.state === 'granted';
            return this.hasPermission;
        } catch (error) {
            // Fallback: try to get stream to check permission
            return await this.requestPermission();
        }
    }

    /**
     * Start recording audio
     */
    async start(): Promise<boolean> {
        if (this.isRecording) {
            console.warn('[AudioCapture] Already recording');
            return false;
        }

        try {
            // Check permission first
            if (!this.hasPermission) {
                const granted = await this.requestPermission();
                if (!granted) {
                    console.error('[AudioCapture] Cannot start - no permission');
                    return false;
                }
            }

            // Get microphone stream
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                } 
            });

            // Verify we got a valid audio track
            const audioTracks = this.mediaStream.getAudioTracks();
            if (audioTracks.length === 0) {
                console.error('[AudioCapture] No audio tracks found');
                this.stop();
                return false;
            }

            console.log('[AudioCapture] Audio track:', audioTracks[0].label);

            // Create MediaRecorder
            const mimeType = this.getSupportedMimeType();
            this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });

            // Reset chunks
            this.audioChunks = [];

            // Handle data available
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            // Start recording
            this.mediaRecorder.start();
            this.isRecording = true;

            console.log('[AudioCapture] Recording started with', mimeType);
            return true;
        } catch (error) {
            console.error('[AudioCapture] Failed to start recording:', error);
            this.stop();
            return false;
        }
    }

    /**
     * Stop recording and return the audio blob
     */
    async stop(): Promise<Blob | null> {
        if (!this.isRecording) {
            console.warn('[AudioCapture] Not recording');
            return null;
        }

        return new Promise((resolve) => {
            if (!this.mediaRecorder) {
                resolve(null);
                return;
            }

            this.mediaRecorder.onstop = () => {
                const mimeType = this.getSupportedMimeType();
                const audioBlob = new Blob(this.audioChunks, { type: mimeType });
                
                console.log('[AudioCapture] Recording stopped. Size:', audioBlob.size, 'bytes');
                
                // Cleanup
                this.cleanup();
                
                resolve(audioBlob);
            };

            this.mediaRecorder.stop();
            this.isRecording = false;
        });
    }

    /**
     * Record for a specific duration and return the audio blob
     */
    async recordForDuration(durationMs: number): Promise<Blob | null> {
        const started = await this.start();
        if (!started) return null;

        return new Promise((resolve) => {
            setTimeout(async () => {
                const blob = await this.stop();
                resolve(blob);
            }, durationMs);
        });
    }

    /**
     * Split an audio blob into chunks of specified duration
     */
    async splitAudioIntoChunks(
        audioBlob: Blob, 
        chunkDurationSeconds: number = 30
    ): Promise<Blob[]> {
        const chunks: Blob[] = [];

        try {
            // Create audio context
            const audioContext = new AudioContext();
            
            // Decode audio data
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            
            const sampleRate = audioBuffer.sampleRate;
            const numberOfChannels = audioBuffer.numberOfChannels;
            const totalDuration = audioBuffer.duration;
            const chunkSamples = Math.floor(chunkDurationSeconds * sampleRate);

            console.log('[AudioCapture] Splitting audio:', {
                duration: totalDuration,
                sampleRate,
                channels: numberOfChannels,
                chunkDuration: chunkDurationSeconds,
            });

            // Split into chunks
            let offset = 0;
            while (offset < audioBuffer.length) {
                const remainingSamples = audioBuffer.length - offset;
                const currentChunkSamples = Math.min(chunkSamples, remainingSamples);
                
                // Create new audio buffer for chunk
                const chunkBuffer = audioContext.createBuffer(
                    numberOfChannels,
                    currentChunkSamples,
                    sampleRate
                );

                // Copy audio data for each channel
                for (let channel = 0; channel < numberOfChannels; channel++) {
                    const channelData = audioBuffer.getChannelData(channel);
                    const chunkChannelData = chunkBuffer.getChannelData(channel);
                    
                    for (let i = 0; i < currentChunkSamples; i++) {
                        chunkChannelData[i] = channelData[offset + i];
                    }
                }

                // Convert buffer to blob
                const chunkBlob = await this.audioBufferToBlob(chunkBuffer, sampleRate);
                chunks.push(chunkBlob);

                offset += currentChunkSamples;
            }

            await audioContext.close();
            
            console.log('[AudioCapture] Created', chunks.length, 'chunks');
            return chunks;
        } catch (error) {
            console.error('[AudioCapture] Failed to split audio:', error);
            return [audioBlob]; // Return original blob if splitting fails
        }
    }

    /**
     * Convert AudioBuffer to Blob
     */
    private async audioBufferToBlob(audioBuffer: AudioBuffer, sampleRate: number): Promise<Blob> {
        const numberOfChannels = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        const wavBuffer = this.createWavBuffer(audioBuffer, numberOfChannels, length, sampleRate);
        return new Blob([wavBuffer], { type: 'audio/wav' });
    }

    /**
     * Create WAV buffer from AudioBuffer
     */
    private createWavBuffer(
        audioBuffer: AudioBuffer,
        numberOfChannels: number,
        length: number,
        sampleRate: number
    ): ArrayBuffer {
        const bytesPerSample = 2; // 16-bit
        const blockAlign = numberOfChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = length * blockAlign;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        // WAV header
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 1, true); // PCM format
        view.setUint16(22, numberOfChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true); // bits per sample
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        // Write audio data
        let offset = 44;
        for (let i = 0; i < length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sample = audioBuffer.getChannelData(channel)[i];
                const int16 = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
                view.setInt16(offset, int16, true);
                offset += 2;
            }
        }

        return buffer;
    }

    /**
     * Write string to DataView
     */
    private writeString(view: DataView, offset: number, string: string): void {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    /**
     * Get supported MIME type for recording
     */
    private getSupportedMimeType(): string {
        const types = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/mp4',
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }

        return ''; // Let browser choose default
    }

    /**
     * Cleanup resources
     */
    private cleanup(): void {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecording = false;
    }

    /**
     * Get recording status
     */
    getStatus(): { isRecording: boolean; hasPermission: boolean } {
        return {
            isRecording: this.isRecording,
            hasPermission: this.hasPermission,
        };
    }

    /**
     * Check if browser supports audio recording
     */
    static isSupported(): boolean {
        return !!(
            navigator.mediaDevices && 
            'getUserMedia' in navigator.mediaDevices && 
            typeof MediaRecorder !== 'undefined'
        );
    }
}
