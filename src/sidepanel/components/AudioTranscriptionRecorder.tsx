import { useState, useRef } from 'react';
import { Button, message, Space, Spin } from 'antd';
import { AudioOutlined, AudioMutedOutlined } from '@ant-design/icons';
import { AudioCapture } from '@/utils/AudioCapture';
import { WhisperTranscriberWorkerClient } from '@/utils/WhisperTranscriberWorkerClient';
import { UserPreferences } from '@/utils/UserPreferences';

interface AudioTranscriptionRecorderProps {
    onTranscriptionComplete: (text: string) => void;
    buttonText?: string;
    size?: 'small' | 'middle' | 'large';
    type?: 'default' | 'primary' | 'dashed' | 'link' | 'text';
}

export default function AudioTranscriptionRecorder({
    onTranscriptionComplete,
    buttonText = 'Record',
    size = 'middle',
    type = 'default',
}: AudioTranscriptionRecorderProps) {
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [recordingDuration, setRecordingDuration] = useState(0);
    const audioCaptureRef = useRef<AudioCapture | null>(null);
    const timerRef = useRef<number | null>(null);
    const transcriberRef = useRef<WhisperTranscriberWorkerClient | null>(null);

    const startRecording = async () => {
        try {
            if (!audioCaptureRef.current) {
                audioCaptureRef.current = new AudioCapture();
            }

            // Request permission
            const hasPermission = await audioCaptureRef.current.requestPermission();
            if (!hasPermission) {
                message.error('Microphone permission denied');
                return;
            }

            // Start recording
            const started = await audioCaptureRef.current.start();
            if (!started) {
                message.error('Failed to start recording');
                return;
            }

            setIsRecording(true);
            setRecordingDuration(0);

            // Start timer
            timerRef.current = window.setInterval(() => {
                setRecordingDuration((prev) => prev + 1);
            }, 1000);

            message.info('Recording started');
        } catch (error) {
            console.error('Failed to start recording:', error);
            message.error('Failed to start recording');
        }
    };

    const stopRecording = async () => {
        try {
            if (!audioCaptureRef.current) return;

            // Stop timer
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }

            // Stop recording
            const audioBlob = await audioCaptureRef.current.stop();
            setIsRecording(false);
            setRecordingDuration(0);

            if (!audioBlob) {
                message.error('No audio recorded');
                return;
            }

            message.info('Recording stopped, transcribing...');
            setIsTranscribing(true);

            // Transcribe audio
            await transcribeAudio(audioBlob);
        } catch (error) {
            console.error('Failed to stop recording:', error);
            message.error('Failed to stop recording');
            setIsTranscribing(false);
        }
    };

    const transcribeAudio = async (audioBlob: Blob) => {
        try {
            // Get user preference for transcription language
            const userPrefs = UserPreferences.getInstance();
            const transcriptionLang = userPrefs.getTranscriptionLanguage();
            
            message.loading({
                content: 'Transcribing audio...',
                key: 'transcribing',
                duration: 0,
            });

            // Use worker client for non-blocking transcription
            const transcriber = new WhisperTranscriberWorkerClient();
            
            // Transcribe in worker (no UI lag)
            const result = await transcriber.oneShotTranscribe(audioBlob, {
                language: transcriptionLang,
            });

            message.destroy('transcribing');
            message.success('Transcription complete!');

            // Call callback with transcribed text
            onTranscriptionComplete(result.text);
        } catch (error) {
            console.error('Transcription error:', error);
            message.destroy('transcribing');
            message.error('Failed to transcribe audio: ' + (error instanceof Error ? error.message : String(error)));
        } finally {
            setIsTranscribing(false);
        }
    };

    const handleToggleRecording = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const formatDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <Space>
            <Button
                type={isRecording ? 'primary' : type}
                danger={isRecording}
                icon={isRecording ? <AudioMutedOutlined /> : <AudioOutlined />}
                onClick={handleToggleRecording}
                disabled={isTranscribing}
                size={size}
            >
                {isRecording
                    ? `Stop (${formatDuration(recordingDuration)})`
                    : buttonText}
            </Button>
            {isTranscribing && <Spin size="small" />}
        </Space>
    );
}
