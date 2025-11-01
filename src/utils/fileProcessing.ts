import { extractText, extractImages, getDocumentProxy } from 'unpdf';
import type { PDFDocumentProxy } from 'unpdf/pdfjs';

export interface ProcessedPDFData {
    text: string;
    images: Blob[];
    totalPages: number;
}

/**
 * Extract text and images from a PDF file
 */
export async function processPDF(file: File): Promise<ProcessedPDFData> {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
    
    // Extract text from all pages
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    
    // Extract images from all pages
    const allImages: Blob[] = [];
    
    try {
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            try {
                const imagesData = await extractImages(pdf, pageNum);
                
                // Convert each image data to Blob
                for (const imgData of imagesData) {
                    // Use canvas to convert raw image data to PNG blob
                    const canvas = document.createElement('canvas');
                    canvas.width = imgData.width;
                    canvas.height = imgData.height;
                    
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        const imageData = ctx.createImageData(imgData.width, imgData.height);
                        imageData.data.set(imgData.data);
                        ctx.putImageData(imageData, 0, 0);
                        
                        const blob = await new Promise<Blob>((resolve) => {
                            canvas.toBlob((b) => resolve(b!), 'image/png');
                        });
                        
                        allImages.push(blob);
                    }
                }
            } catch (pageError) {
                console.warn(`Failed to extract images from page ${pageNum}:`, pageError);
            }
        }
    } catch (error) {
        console.warn('Failed to extract images from PDF:', error);
    }
    
    return {
        text,
        images: allImages,
        totalPages
    };
}

/**
 * Split audio file into 30-second chunks
 * Uses Web Audio API to decode and slice audio
 */
export async function splitAudioIntoChunks(file: File, chunkDurationSeconds: number = 30): Promise<Blob[]> {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContext();
    
    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        const sampleRate = audioBuffer.sampleRate;
        const numberOfChannels = audioBuffer.numberOfChannels;
        const chunkSize = chunkDurationSeconds * sampleRate;
        
        const chunks: Blob[] = [];
        const totalSamples = audioBuffer.length;
        
        for (let start = 0; start < totalSamples; start += chunkSize) {
            const end = Math.min(start + chunkSize, totalSamples);
            const chunkLength = end - start;
            
            // Create a new buffer for this chunk
            const chunkBuffer = audioContext.createBuffer(
                numberOfChannels,
                chunkLength,
                sampleRate
            );
            
            // Copy data for each channel
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sourceData = audioBuffer.getChannelData(channel);
                const chunkData = chunkBuffer.getChannelData(channel);
                
                for (let i = 0; i < chunkLength; i++) {
                    chunkData[i] = sourceData[start + i];
                }
            }
            
            // Convert AudioBuffer to WAV Blob
            const wavBlob = await audioBufferToWav(chunkBuffer);
            chunks.push(wavBlob);
        }
        
        return chunks;
    } finally {
        await audioContext.close();
    }
}

/**
 * Convert AudioBuffer to WAV Blob
 */
async function audioBufferToWav(audioBuffer: AudioBuffer): Promise<Blob> {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;
    
    const data = interleave(audioBuffer);
    const dataLength = data.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    
    // Write WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);
    
    // Write audio data
    floatTo16BitPCM(view, 44, data);
    
    return new Blob([buffer], { type: 'audio/wav' });
}

function interleave(audioBuffer: AudioBuffer): Float32Array {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numberOfChannels;
    const result = new Float32Array(length);
    
    let offset = 0;
    for (let i = 0; i < audioBuffer.length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            result[offset++] = audioBuffer.getChannelData(channel)[i];
        }
    }
    
    return result;
}

function writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array): void {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}

/**
 * Get file type category
 */
export function getFileType(file: File): 'image' | 'audio' | 'pdf' | 'other' {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type === 'application/pdf') return 'pdf';
    return 'other';
}
