import { Mascot } from '@/components/Mascot';
import { App, Flex, Spin, theme, Typography } from 'antd';
import styles from './index.module.css';
import { GradientBackground } from '@/components/GradientBackground';
import { useEffect, useRef, useState } from 'react';
import { SupervisorControls, SupervisorConfig } from './SupervisorControls';
import { SupervisorMonitoring, MonitoringState } from './SupervisorMonitoring';
import { SupervisorHistory, TaskHistory } from './SupervisorHistory';
import { SupervisorStats, TaskStats } from './SupervisorStats';
import { MonitorCapture } from '@/utils/MonitorCapture';
import { HybridTaskRunner } from '@/utils/HybridTaskRunner';
import { LanguageModelEx } from '@/utils/built-in-ai-ex/LanguageModelEx';
import { VisibilityManager } from '@/utils/VisibilityManager';
import { AudioCapture } from '@/utils/AudioCapture';
import { UserPreferences } from '@/utils/UserPreferences';
import { RichNotificationManager } from '@/utils/RichNotificationManager';
import { Speech } from '@/utils/Speech';
import { WriterEx } from '@/utils/built-in-ai-ex/WriterEx';
import { z } from 'zod';
import { jsonrepair } from 'jsonrepair';
import { blobToBase64 } from '@/utils/helper';
import { SummarizerEx } from '@/utils/built-in-ai-ex/SummarizerEx';
import { WhisperTranscriberWorkerClient } from '@/utils/WhisperTranscriberWorkerClient';
import { getSupervisorTaskHistory, addSupervisorTaskHistory } from '@/utils/db';
const { Title, Text } = Typography;
type AppState = 'setup' | 'monitoring' | 'stats';

export default function Supervisor() {
    const { message } = App.useApp();
    const { token } = theme.useToken();
    const [appState, setAppState] = useState<AppState>('setup');
    const [currentConfig, setCurrentConfig] = useState<SupervisorConfig | null>(null);
    const [monitoringState, setMonitoringState] = useState<MonitoringState | null>(null);
    const [taskHistory, setTaskHistory] = useState<TaskHistory[]>([]);
    const [currentStats, setCurrentStats] = useState<TaskStats | null>(null);
    const [mascotVariant, setMascotVariant] = useState<'yellow' | 'blue' | 'pink'>('yellow');
    const [gradientScheme, setGradientScheme] = useState<'ref' | 'pink' | 'yellow' | 'blue'>('yellow');

    const monitorCaptureRef = useRef<MonitorCapture | null>(null);
    const taskRunnerRef = useRef<HybridTaskRunner | null>(null);
    const languageModelExRef = useRef<LanguageModelEx | null>(null);
    const writerExRef = useRef<WriterEx | null>(null);
    const visibilityManagerRef = useRef<VisibilityManager | null>(null);
    const audioCaptureRef = useRef<AudioCapture | null>(null);
    const userPreferencesRef = useRef<UserPreferences | null>(null);
    const notificationManagerRef = useRef<RichNotificationManager | null>(null);
    const notificationSoundRef = useRef<HTMLAudioElement | null>(null);
    const speechInitializedRef = useRef<boolean>(false); // Track if Speech is initialized
    const currentConfigRef = useRef<SupervisorConfig | null>(null); // Ref for accessing config in callbacks
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState('Initializing...');
    const wasAutoPausedRef = useRef<boolean>(false); // Track if pause was automatic
    const recordedAudioBlobRef = useRef<Blob | null>(null);
    const [transcribedText, setTranscribedText] = useState<string>(''); // For passing to SupervisorControls
    const [isTranscribing, setIsTranscribing] = useState(false); // Loading state for audio transcription
    const monitoringStateRef = useRef<MonitoringState | null>(null); // Ref to access current state in callbacks
    const idleCheckIntervalRef = useRef<NodeJS.Timeout | null>(null); // Ref for idle check interval

    const [timerCompleted, setTimerCompleted] = useState(false);

    interface AnalysisEntry {
        timestamp: Date;
        screenshot: Blob;
        onTask: boolean;
        screenshotDescription: string;
        whyNotOnTask: string;
    }
    const [analysisHistory, setAnalysisHistory] = useState<AnalysisEntry[]>([]);

    // Zod schema for AI response validation
    const AnalysisResponseSchema = z.object({
        onTask: z.boolean().describe("TRUE if user is working on the task or using work-related tools, FALSE if clearly distracted."),
        screenshotDescription: z.string().describe("Brief description of what is visible on the screen right now"),
        whyNotOnTask: z.string().optional().describe("Explanation why they're off-task, empty string if on-task")
    });

    // Audio recording handlers
    const handleRecordingStart = async () => {
        // console.log('[Audio] Recording started');
        recordedAudioBlobRef.current = null;

        try {
            // Initialize and start AudioCapture
            if (!audioCaptureRef.current) {
                audioCaptureRef.current = new AudioCapture();
            }

            // Request permission
            const hasPermission = await audioCaptureRef.current.checkPermission();
            if (!hasPermission) {
                const granted = await audioCaptureRef.current.requestPermission();
                if (!granted) {
                    message.error('Microphone permission is required for voice input');
                    return;
                }
            }

            // Start recording
            await audioCaptureRef.current.start();
            // console.log('[Audio] AudioCapture started');
        } catch (error) {
            console.error('[Audio] Failed to start recording:', error);
            message.error('Failed to start audio recording');
        }
    };

    const handleRecordingStop = async () => {
        // console.log('[Audio] Recording stop requested');

        try {
            // Stop AudioCapture and get the blob
            if (audioCaptureRef.current) {
                const recordedBlob = await audioCaptureRef.current.stop();
                if (recordedBlob) {
                    recordedAudioBlobRef.current = recordedBlob;
                    // console.log('[Audio] Recorded audio blob size:', recordedBlob.size);
                    
                    // Start transcription immediately
                    setIsTranscribing(true);
                    message.loading({ content: 'Transcribing audio...', key: 'transcribe', duration: 0 });
                    
                    try {
                        const transcription = await transcribeAudioToTask(recordedBlob);
                        if (transcription && transcription.trim()) {
                            setTranscribedText(transcription.trim());
                            message.success({ content: 'Audio transcribed! You can edit the text.', key: 'transcribe', duration: 3 });
                        } else {
                            message.warning({ content: 'No speech detected in audio', key: 'transcribe', duration: 3 });
                        }
                    } catch (error) {
                        console.error('[Audio] Transcription failed:', error);
                        message.error({ content: 'Failed to transcribe audio', key: 'transcribe', duration: 3 });
                    } finally {
                        setIsTranscribing(false);
                        recordedAudioBlobRef.current = null; // Clear the blob after transcription
                    }
                } else {
                    console.warn('[Audio] No audio data recorded');
                    message.warning('No audio data recorded');
                }
            }
        } catch (error) {
            console.error('[Audio] Failed to stop recording:', error);
            message.error('Failed to save audio recording');
        }
    };

    // Transcribe audio to text for task description
    const transcribeAudioToTask = async (audioBlob: Blob): Promise<string> => {
        try {
            setLoadingMessage('Transcribing audio recording...');
            
            // Get user preference for transcription language
            const preferences = userPreferencesRef.current;
            const transcriptionLang = preferences?.getTranscriptionLanguage() || 'en';
            
            // Use WhisperTranscriberWorkerClient to run transcription in background thread (prevents UI lag)
            // const { WhisperTranscriberWorkerClient } = await import('@/utils/WhisperTranscriberWorkerClient');
            const transcriber = new WhisperTranscriberWorkerClient();

            // Transcribe in worker (no UI blocking)
            const result = await transcriber.oneShotTranscribe(audioBlob, {
                language: transcriptionLang,
            });

            setLoadingMessage('Audio transcription complete!');
            // console.log('[Audio] Transcription result:', result.text);
            // console.log('[Audio] Transcription chunks:', result.chunks.length);
            // console.log('[Audio] Tokens per second:', result.tps);
            
            return result.text;
        } catch (error) {
            console.error('[Audio] Transcription error:', error);
            throw new Error('Failed to transcribe audio: ' + (error instanceof Error ? error.message : String(error)));
        }
    };

    const handleStart = async (config: SupervisorConfig) => {
        setIsLoading(true);

        try {


            setLoadingMessage('Initializing screen capture...');
            let monitorCapture = new MonitorCapture();
            
            // Start capture with onStop callback to stop monitoring when screen sharing stops
            let capturing = await monitorCapture.start(() => {
                // console.log('[Supervisor] Screen capture stopped - stopping monitoring');
                message.warning('Screen sharing stopped - ending supervision session');
                
                // Stop the supervisor by simulating stop button click
                document.getElementById("stop-button")?.click();
            });
            
            if (capturing) {
                monitorCaptureRef.current = monitorCapture;

                // Initialize Speech if voice mode is selected (before AI model to show progress)
                if (config.notificationType === 'voice' && !speechInitializedRef.current) {
                    const preferences = userPreferencesRef.current;
                    if (preferences?.isVoiceAlertsEnabled()) {
                        const voiceSettings = preferences.getVoiceSettings();
                        const engineName = voiceSettings.engine === 'kokoro' ? 'Kokoro TTS' : 'Browser TTS';
                        
                        setLoadingMessage(`Initializing ${engineName}...`);
                        // console.log(`[Supervisor] Initializing Speech with ${voiceSettings.engine}`);
                        
                        try {
                            await Speech.init({
                                loadKokoro: voiceSettings.engine === 'kokoro',
                                onProgress: (progress) => { 
                                    if (progress?.progress) setLoadingMessage(`Loading ${engineName}... ${Math.round(progress.progress)}%`);
                                    else setLoadingMessage(`Loading ${engineName}`);
                                }
                            });
                            speechInitializedRef.current = true;
                            // console.log('[Supervisor] Speech initialized successfully');
                        } catch (error) {
                            console.error('[Supervisor] Failed to initialize Speech:', error);
                            message.warning(`Failed to load ${engineName}, will use in-app messages`);
                        }
                    }
                }

                const rigorInstructions = {
                    low: 'Be very lenient - only flag obvious distractions.',
                    medium: 'Be reasonable - flag clear distractions but allow related work.',
                    high: 'Be moderately strict - flag clearly unrelated activities.',
                };

                // Generate dynamic guidelines using WriterEx
                setLoadingMessage('Generating task guidelines...');
                const writer = await WriterEx.create({
                    tone: 'formal',
                    format: 'plain-text',
                    length: 'short'
                });
                writerExRef.current = writer;

                const taskGuidelines = await writer.write(
                    `Based on the following user task, write clear guidelines about what activities should be considered ON TASK and what should be considered OFF TASK. These guidelines will be used by an AI supervisor monitoring screen activity. Be specific to the task context.

User task: ${config.task}

Rigor level: ${config.rigor} - ${rigorInstructions[config.rigor]}

Format the response as a concise list of what counts as ON TASK vs OFF TASK.`
                );
                // console.log('[Supervisor] Generated task guidelines:', taskGuidelines);

                const defaultModeParams = await (LanguageModel.params ? LanguageModel.params() : Promise.resolve({ defaultTemperature: 1, maxTopK: 10 }));
                // console.log("defaultModeParams:", defaultModeParams);

                setLoadingMessage('Creating AI language model...');
                let languageModelEx = await LanguageModelEx.create({
                    contextHandler: "clear",
                    historyHandler: "clear",
                    maxQuotaUsage: 0.90,
                    temperature: (defaultModeParams.defaultTemperature),
                    topK: Math.floor(defaultModeParams.maxTopK / 4),
                    expectedInputs: [
                        {
                            type: "text",
                            languages: ["en"], // ["en", navigator.languages[0]]
                        },
                        {
                            type: "image"
                        },
                        {
                            type: "audio"
                        }
                    ],
                    expectedOutputs: [{
                        type: "text",
                        languages: ["en"]
                    }],
                    initialPrompts: [
                        {
                            role: "system",
                            content: `
You are a focus supervisor monitoring a user working on the following task:
"${config.task}"

ANALYZE ONLY THE CURRENT SCREENSHOT. Look carefully at what is actually visible on screen RIGHT NOW.

Your job is to determine if they are ON TASK or OFF TASK based on these guidelines:

${taskGuidelines}

Respond in this exact JSON format:
{
    "onTask": true/false,
    "screenshotDescription": "brief description of what is visible on screen right now",
    "whyNotOnTask": "explanation if off-task, empty string if on-task"
}

CRITICAL:
- "onTask" field MUST be consistent with "screenshotDescription" and "whyNotOnTask"
- Only analyze the current screenshot, not previous context
- Be specific about what you see on screen

                        `.split("\n").map((value) => value.trim()).join("\n")
                        }
                    ]
                });
                // console.log("languageModelEx:", languageModelEx);
                languageModelExRef.current = languageModelEx;

                setLoadingMessage('Warming up AI model...');
                let warmUpPrompt = await languageModelEx.prompt("This is just a warmup, no need to anwser anything.");
                // console.log("warmUpPrompt:", warmUpPrompt);

                setLoadingMessage('Starting task monitor...');
                let taskRunner = new HybridTaskRunner(async () => {
                    // Don't execute if page is visible
                    if (document.visibilityState === 'visible') {
                        // console.log('[Supervisor] Skipping analysis - page is visible');
                        return;
                    }

                    if (monitoringStateRef.current?.status == "paused") return;

                    // Reset next check-in timer when task starts
                    setMonitoringState(prev => prev ? { ...prev, nextCheckIn: currentConfigRef.current!.checkInterval } : prev);

                    const screenshot = await monitorCaptureRef.current!.captureFrame({ imageFormat: "image/webp", quality: 1 });
                    // console.log("screenshot:", await blobToBase64(screenshot!));

                    if (!screenshot) return;

                    let input: LanguageModelPrompt;

                    // if (appScreenshot) {
                    //     // console.log("has appScreenshot")
                    //     input = [
                    //         { 
                    //             role: "user", 
                    //             content: "the follwing image is the supervisor app screenshot/print"
                    //         },
                    //         { 
                    //             role: "user", 
                    //             content: [{ type: "image", value: appScreenshot }] 
                    //         },
                    //         { 
                    //             role: "user", 
                    //             content: "the follwing image is the user monitor screenshot/print"
                    //         },
                    //         { 
                    //             role: "user", 
                    //             content: [{ type: "image", value: screenshot }] 
                    //         }
                    //     ];
                    // } else {
                    //     input = [
                    //         { 
                    //             role: "user", 
                    //             content: [{ type: "image", value: screenshot }] 
                    //         }
                    //     ];
                    // }

                    input = [
                        { 
                            role: "user", 
                            content: "Analize only the follwing print, desconsider the others."
                        },
                        {
                            role: "user",
                            content: [{ type: "image", value: screenshot }]
                        }
                    ];

                    const timestamp = new Date();
                    const imageAnalysis = await languageModelExRef.current!.prompt(input, {
                        responseConstraint: z.toJSONSchema(AnalysisResponseSchema)
                    });

                    // console.log("imageAnalysis:", imageAnalysis)

                    try {
                        const parsed = JSON.parse(jsonrepair(imageAnalysis));
                        const entry: AnalysisEntry = {
                            timestamp,
                            screenshot,
                            onTask: parsed.onTask || false,
                            screenshotDescription: parsed.screenshotDescription || 'Unknown activity',
                            whyNotOnTask: parsed.whyNotOnTask || ''
                        };

                        setAnalysisHistory(prev => [...prev, entry]);

                        // Trigger alert if off-task
                        if (!entry.onTask) {
                            setMonitoringState(prev => prev ? { ...prev, alertCount: prev.alertCount + 1 } : prev);

                            // Generate dynamic user message using WriterEx
                            let userMessage = 'Time to refocus!';
                            
                            try {
                                if (writerExRef.current) {
                                    userMessage = await writerExRef.current.write(
                                        `Write a very short, human, creative reminder (3-5 words max) to get back on task. Include context about what to stop/avoid. Sound casual and friendly.

Examples:
- "Stop browsing, start coding!"
- "Less YouTube, more work!"
- "Back to work ${userPreferencesRef.current?.getUserName() ?? "User"}"
- "Back to ${currentConfigRef.current!.task.split(' ').slice(0, 2).join(' ')}!"

User should: ${currentConfigRef.current!.task}
User is doing: ${entry.screenshotDescription}

Return ONLY the message, nothing else.`
                                    , { context: userPreferencesRef.current?.getPersonaPrompt() || undefined });
                                    userMessage = userMessage.trim().replace(/["']/g, '');
                                    // console.log('[Alert] Generated user message:', userMessage);
                                }
                            } catch (error) {
                                console.error('[Alert] Failed to generate user message:', error);
                                userMessage = 'Time to refocus!';
                            }
                            
                            // Get user preferences
                            const preferences = userPreferencesRef.current;
                            const userName = preferences?.getUserName() || 'User';
                            
                            // Personalize message with user's name
                            const personalizedMessage = userMessage.replace(/\buser\b/gi, userName);

                            // Show notification or voice alert based on config and preferences
                            if (currentConfigRef.current!.notificationType === 'notification') {
                                if (preferences?.isNotificationsEnabled()) {
                                    try {
                                        // Use RichNotificationManager with screenshot image
                                        const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                        await notificationManagerRef.current?.showWithImage(
                                            `Focus Alert - ${currentTime}`,
                                            personalizedMessage,
                                            screenshot,
                                            {
                                                icon: '/icon.png',
                                                tag: `focus-alert-${Date.now()}`,
                                                contextMessage: entry.screenshotDescription,
                                                requireInteraction: true,
                                            }
                                        );
                                        
                                        // Play notification sound
                                        notificationSoundRef.current?.play().catch(err => {
                                            console.error('[Notification] Failed to play sound:', err);
                                        });
                                    } catch (error) {
                                        console.error('[Notification] Failed to show notification:', error);
                                        message.warning(personalizedMessage);
                                    }
                                } else {
                                    // Fallback to in-app message
                                    message.warning(personalizedMessage);
                                }
                            } else if (currentConfigRef.current!.notificationType === 'voice') {
                                if (preferences?.isVoiceAlertsEnabled() && speechInitializedRef.current) {
                                    // Speech is already initialized - use it directly
                                    const voiceSettings = preferences.getVoiceSettings();
                                    
                                    Speech.speak({
                                        text: personalizedMessage,
                                        voice: voiceSettings.voice,
                                        rate: voiceSettings.rate,
                                        pitch: voiceSettings.pitch,
                                        volume: voiceSettings.volume,
                                        engine: voiceSettings.engine,
                                    }).catch(error => {
                                        console.error('[Speech] Failed to speak alert:', error);
                                        // Fallback to notification
                                        message.warning(personalizedMessage);
                                    });
                                } else {
                                    // Fallback to in-app message if Speech not ready
                                    console.warn('[Speech] Not initialized, using in-app message');
                                    message.warning(personalizedMessage);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Failed to parse AI response:', error);
                    }
                }, config.checkInterval * 1000);

                setCurrentConfig(config);
                currentConfigRef.current = config; // Store config in ref for callbacks

                // Start paused if page is currently visible
                const initialStatus = document.visibilityState === 'visible' ? 'paused' : 'running';
                if (initialStatus === 'paused') {
                    wasAutoPausedRef.current = true;
                }

                setMonitoringState({
                    task: config.task,
                    status: initialStatus,
                    elapsedTime: 0,
                    nextCheckIn: config.checkInterval,
                    checkInterval: config.checkInterval,
                    onFocus: true,
                    alertCount: 0,
                    timerMinutes: config.timerMinutes,
                    pauseOnWindowBlur: config.pauseOnWindowBlur,
                });
                setAppState('monitoring');
                taskRunnerRef.current = taskRunner;
                
                // Log which implementation is being used
                const impl = taskRunner.getImplementation();
                // console.log(`[Supervisor] Using ${impl.type === 'alarms' ? 'AlarmTaskRunner' : 'TaskRunner'} for ${impl.interval}ms interval`);

                // Initialize visibility manager
                const visibilityManager = new VisibilityManager(
                    async () => {
                        // On visible - pause monitoring to avoid self-analysis
                        // console.log('[VisibilityManager] Page visible - auto-pausing');
                        wasAutoPausedRef.current = true;
                        await taskRunnerRef.current?.pause();
                        setMonitoringState(prev => prev ? { ...prev, status: 'paused' } : prev);
                    },
                    async () => {
                        // On hidden - resume monitoring if it was auto-paused
                        if (wasAutoPausedRef.current) {
                            // console.log('[VisibilityManager] Page hidden - auto-resuming');
                            wasAutoPausedRef.current = false;
                            await taskRunnerRef.current?.resume();
                            setMonitoringState(prev => prev ? { ...prev, status: 'running' } : prev);
                        }
                    }
                );
                visibilityManagerRef.current = visibilityManager;
                visibilityManager.start();

                await taskRunner.start();

                // Request to keep system awake if enabled
                if (config.keepSystemAwake && typeof chrome !== 'undefined' && chrome.power) {
                    try {
                        chrome.power.requestKeepAwake('display');
                        // console.log('[Power] Keep awake requested - display will stay on during supervision');
                    } catch (error) {
                        console.error('[Power] Failed to request keep awake:', error);
                    }
                }

                // Setup idle detection if enabled
                if (config.idleCheckEnabled && typeof chrome !== 'undefined' && chrome.idle) {
                    const idleIntervalSeconds = config.idleCheckInterval * 60; // Convert minutes to seconds
                    
                    // Set the detection interval for the idle API
                    chrome.idle.setDetectionInterval(idleIntervalSeconds);
                    
                    // console.log(`[Idle] Detection enabled with ${config.idleCheckInterval} minute interval`);
                    
                    // Query idle state at regular intervals
                    const checkIdleState = async () => {
                        try {
                            // Skip if monitoring is paused or page is visible
                            if (monitoringStateRef.current?.status === 'paused' || document.visibilityState === 'visible') {
                                return;
                            }
                            
                            const state = await chrome.idle.queryState(idleIntervalSeconds);
                            
                            if (state === 'idle' || state === 'locked') {
                                // console.log(`[Idle] User is ${state} - triggering alert`);
                                
                                // Capture current screen for context
                                const screenshot = await monitorCaptureRef.current?.captureFrame({ 
                                    imageFormat: "image/webp", 
                                    quality: 1 
                                });
                                
                                const timestamp = new Date();
                                const idleReason = state === 'locked' 
                                    ? 'Screen is locked' 
                                    : `No activity detected for ${config.idleCheckInterval} minute(s)`;
                                
                                // Add to analysis history
                                const entry: AnalysisEntry = {
                                    timestamp,
                                    screenshot: screenshot || new Blob(),
                                    onTask: false,
                                    screenshotDescription: idleReason,
                                    whyNotOnTask: idleReason
                                };
                                
                                setAnalysisHistory(prev => [...prev, entry]);
                                
                                // Increment alert count
                                setMonitoringState(prev => prev ? { ...prev, alertCount: prev.alertCount + 1 } : prev);
                                
                                // Generate idle-specific warning message
                                let idleMessage = 'Are you still there?';
                                
                                try {
                                    if (writerExRef.current) {
                                        idleMessage = await writerExRef.current.write(
                                            `Write a very short, friendly reminder (3-5 words max) that the user appears to be idle or away from their computer. Mention that they should get back to their task.

User task: ${config.task}
Idle reason: ${idleReason}

Examples:
- "Still working on ${config.task.split(' ').slice(0, 2).join(' ')}?"
- "Hey, are you there?"
- "Time to get back!"
- "Where are you ${userPreferencesRef.current?.getUserName() ?? "User"}?"

Return ONLY the message, nothing else.`
                                        , { context: userPreferencesRef.current?.getPersonaPrompt() || undefined });
                                        idleMessage = idleMessage.trim().replace(/["']/g, '');
                                        // console.log('[Idle] Generated message:', idleMessage);
                                    }
                                } catch (error) {
                                    console.error('[Idle] Failed to generate message:', error);
                                    idleMessage = 'Are you still there?';
                                }
                                
                                // Get user preferences
                                const preferences = userPreferencesRef.current;
                                const userName = preferences?.getUserName() || 'User';
                                
                                // Personalize message
                                const personalizedMessage = idleMessage.replace(/\buser\b/gi, userName);
                                
                                // Show notification or voice alert
                                if (config.notificationType === 'notification') {
                                    if (preferences?.isNotificationsEnabled()) {
                                        try {
                                            // Calculate progress (idle time as percentage of interval)
                                            // Progress: 100 = full idle period reached
                                            const idleProgress = 100;
                                            const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                                            
                                            // Use progress notification to show idle duration
                                            await notificationManagerRef.current?.showProgress(
                                                `Idle Alert - ${currentTime}`,
                                                personalizedMessage,
                                                idleProgress,
                                                {
                                                    icon: '/icon.png',
                                                    tag: `idle-alert-${Date.now()}`,
                                                    contextMessage: `Idle for ${config.idleCheckInterval} minute(s)`,
                                                    requireInteraction: true,
                                                }
                                            );
                                            
                                            notificationSoundRef.current?.play().catch(err => {
                                                console.error('[Idle] Failed to play sound:', err);
                                            });
                                        } catch (error) {
                                            console.error('[Idle] Failed to show notification:', error);
                                            message.warning(personalizedMessage);
                                        }
                                    } else {
                                        message.warning(personalizedMessage);
                                    }
                                } else if (config.notificationType === 'voice') {
                                    if (preferences?.isVoiceAlertsEnabled() && speechInitializedRef.current) {
                                        const voiceSettings = preferences.getVoiceSettings();
                                        
                                        Speech.speak({
                                            text: personalizedMessage,
                                            voice: voiceSettings.voice,
                                            rate: voiceSettings.rate,
                                            pitch: voiceSettings.pitch,
                                            volume: voiceSettings.volume,
                                            engine: voiceSettings.engine,
                                        }).catch(error => {
                                            console.error('[Idle] Failed to speak alert:', error);
                                            message.warning(personalizedMessage);
                                        });
                                    } else {
                                        console.warn('[Idle] Speech not initialized, using in-app message');
                                        message.warning(personalizedMessage);
                                    }
                                }
                            }
                        } catch (error) {
                            console.error('[Idle] Failed to check idle state:', error);
                        }
                    };
                    
                    // Check idle state at the configured interval
                    idleCheckIntervalRef.current = setInterval(checkIdleState, idleIntervalSeconds * 1000);
                    
                    // Immediate first check
                    checkIdleState();
                }
                
                message.success('Task monitoring started!');
                
                // Clear transcribed text after successful start
                setTranscribedText('');
            } else {
                message.error('You must share your entire screen start supervision!');
            }
        } catch (error) {
            console.error('Failed to start monitoring:', error);
            message.error('Failed to start monitoring. Please try again.');
        } finally {
            setIsLoading(false);
        }
        ////



        // TODO: Start actual monitoring logic here
        // - Initialize screen capture/monitoring
        // - Start LLM analysis intervals based on checkInterval
        // - Set up notification/voice alert handlers
        // - If timerMinutes is set, schedule timer completion
    };

    const handlePause = async () => {
        wasAutoPausedRef.current = false; // Manual pause, not auto
        setMonitoringState((prev) => {
            if (prev) {
                return { ...prev, status: 'paused' };
            }
            return prev;
        });
        message.info('Task monitoring paused');
        await taskRunnerRef.current?.pause();
    };

    const handleResume = async () => {
        wasAutoPausedRef.current = false; // Clear auto-pause flag
        setMonitoringState((prev) => {
            if (prev) {
                return { ...prev, status: 'running' };
            }
            return prev;
        });
        message.success('Task monitoring resumed');
        await taskRunnerRef.current?.resume();

        // // Try to minimize/hide the window when resuming
        // try {
        //     if (typeof chrome !== 'undefined' && chrome.windows) {
        //         chrome.windows.getCurrent((window) => {
        //             if (window.id) {
        //                 chrome.windows.update(window.id, { state: 'minimized' });
        //             }
        //         });
        //     }
        // } catch (error) {
        //     // console.log('[Resume] Could not minimize window:', error);
        // }
    };

    const handleTimerComplete = async () => {
        if (timerCompleted) return;

        setTimerCompleted(true);

        // console.log('[Timer] Timer completed at:', new Date().toISOString());
        
        // Get user preferences
        const preferences = userPreferencesRef.current;
        const userName = preferences?.getUserName() || 'User';
        const config = currentConfigRef.current;
        const timerMinutes = monitoringStateRef.current?.timerMinutes || 0;
        const alertCount = monitoringStateRef.current?.alertCount || 0;
        
        // Calculate focus metrics
        const focusedEntries = analysisHistory.filter(entry => entry.onTask);
        const totalChecks = analysisHistory.length;
        const focusPercentage = totalChecks > 0 ? Math.round((focusedEntries.length / totalChecks) * 100) : 100;
        
        let completionMessage = `${userName}, your ${timerMinutes}-minute timer is complete! Great job staying focused.`;
        
        // Use WriterEx for shorter, more human timer messages
        try {
            if (writerExRef.current) {
                const performanceNote = focusPercentage >= 80 
                    ? 'stayed focused' 
                    : alertCount > 3 
                        ? 'had some distractions' 
                        : 'did okay';
                
                completionMessage = await writerExRef.current.write(
                    `Write a very short, casual, human timer completion message (one sentence, max 10 words). Sound like a friend congratulating someone.

Examples:
- "Done! You crushed it!"
- "Timer's up! Nice focus!"
- "Time! You stayed sharp!"
- "Good job ${userPreferencesRef.current?.getUserName() ?? "User"}, your timer is done!"

Context:
- User: ${userName}
- Timer: ${timerMinutes} minutes
- Performance: ${performanceNote} (${focusPercentage}% focused)

Return ONLY the message.`
                , { context: userPreferencesRef.current?.getPersonaPrompt() || undefined });
                completionMessage = completionMessage.trim().replace(/["']/g, '');
                // console.log('[Timer] Generated completion message:', completionMessage);
            }
        } catch (error) {
            console.error('[Timer] Failed to generate completion message:', error);
            // Keep the default fallback message
        }
        
        // Show notification or speak based on config
        if (config?.notificationType === 'voice') {
            if (preferences?.isVoiceAlertsEnabled() && speechInitializedRef.current) {
                // Speech is already initialized - use it directly
                const voiceSettings = preferences.getVoiceSettings();
                
                Speech.speak({
                    text: completionMessage,
                    voice: voiceSettings.voice,
                    rate: voiceSettings.rate,
                    pitch: voiceSettings.pitch,
                    volume: voiceSettings.volume,
                    engine: voiceSettings.engine,
                }).catch(error => {
                    console.error('[Speech] Failed to speak timer completion:', error);
                    message.info(completionMessage);
                });
            } else {
                // Fallback to in-app message if Speech not ready
                console.warn('[Speech] Not initialized for timer, using in-app message');
                message.info(completionMessage);
            }
        } else {
            // Use notification
            if (preferences?.isNotificationsEnabled()) {
                try {
                    const currentTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    const notificationId = await notificationManagerRef.current?.show({
                        title: `⏰ Timer Complete - ${currentTime}`,
                        body: completionMessage,
                        icon: '/icon.png',
                        tag: `timer-complete-${Date.now()}`,
                        contextMessage: `Focus: ${focusPercentage}% | Alerts: ${alertCount}`,
                        requireInteraction: true,
                        buttons: [
                            { title: 'Stop Monitoring' },
                            { title: 'Continue' }
                        ],
                    });
                    
                    // Register button click handler
                    if (notificationId) {
                        notificationManagerRef.current?.onButtonClick(notificationId, (id, buttonIndex) => {
                            if (buttonIndex === 0) {
                                // Stop Monitoring button clicked
                                // console.log('[Timer] Stop Monitoring button clicked');
                                document.getElementById("stop-button")?.click();
                            }
                            // Button 1 (Continue) - just dismiss the notification
                            notificationManagerRef.current?.clear(id);
                        });
                    }
                    
                    // Play notification sound
                    notificationSoundRef.current?.play().catch(err => {
                        console.error('[Notification] Failed to play timer sound:', err);
                    });
                } catch (error) {
                    console.error('[Notification] Failed to show timer notification:', error);
                    message.info(completionMessage);
                }
            } else {
                message.info(completionMessage);
            }
        }
    }; // Only re-create when currentConfig changes

    const handleStop = async (actualElapsedTime?: number) => {
        // console.log("monitoringState:", monitoringState);
        // console.log("currentConfig:", currentConfig);
        if (monitoringState && currentConfig) {
            // console.log("!handling stop ------------------------!")
            await taskRunnerRef.current?.stop();

            message.loading({ content: 'Generating summary...', key: 'summary', duration: 0 });

            // Use actual elapsed time from component or fallback to state
            const totalTime = actualElapsedTime || monitoringState.elapsedTime;

            // Calculate real focused time from analysis history
            const focusedEntries = analysisHistory.filter(entry => entry.onTask);
            const totalEntries = analysisHistory.length;

            // If we have analysis data, calculate proportional focused time
            // Otherwise assume 0 focused time
            let focusedTime = 0;
            if (totalEntries > 0) {
                focusedTime = Math.floor((focusedEntries.length / totalEntries) * totalTime);
            }

            // Extract real alerts from analysis history
            const realAlerts = analysisHistory
                .filter(entry => !entry.onTask)
                .map(entry => ({
                    time: entry.timestamp,
                    reason: entry.whyNotOnTask
                }));

            // Generate AI summaries using Summarizer
            let activitySummary = 'User maintained focus on the task throughout the session.';
            let distractionSummary = '';

            try {
                // const { SummarizerEx } = await import('@/utils/built-in-ai-ex/SummarizerEx');

                // Create activity summary from focused entries
                if (focusedEntries.length > 0) {
                    const focusedActivities = focusedEntries.map(e => e.screenshotDescription).join('. ');
                    const summarizer = await SummarizerEx.create({
                        type: 'tldr',
                        format: 'plain-text',
                        length: 'short'
                    });
                    activitySummary = await summarizer.summarize(
                        `User was working on: "${monitoringState.task}". Activities observed: ${focusedActivities}`
                    );
                    summarizer.destroy();
                } else if (totalEntries > 0) {
                    // If no focused entries but we have data, generate negative summary
                    const allActivities = analysisHistory.map(e => e.screenshotDescription).join('. ');
                    const summarizer = await SummarizerEx.create({
                        type: 'tldr',
                        format: 'plain-text',
                        length: 'short'
                    });
                    activitySummary = await summarizer.summarize(
                        `User failed to focus on task: "${monitoringState.task}". Off-task activities: ${allActivities}`
                    );
                    summarizer.destroy();
                }

                // Create distraction summary from off-task entries
                if (realAlerts.length > 0) {
                    const distractions = realAlerts.map(a => a.reason).join('. ');
                    const summarizer = await SummarizerEx.create({
                        type: 'tldr',
                        format: 'plain-text',
                        length: 'short'
                    });
                    distractionSummary = await summarizer.summarize(
                        `Distractions during task "${monitoringState.task}": ${distractions}. Provide brief advice.`
                    );
                    summarizer.destroy();
                }
            } catch (error) {
                console.error('Failed to generate AI summaries:', error);
                if (focusedEntries.length < (totalEntries ?? 1) / 2 && totalEntries > 0) {
                    activitySummary = 'User struggled to maintain focus and was frequently off-task during the session.';
                } else {
                    activitySummary = analysisHistory.length > 0
                        ? `Monitored ${analysisHistory.length} check-ins. ${focusedEntries.length} were on-task.`
                        : 'No activity data collected.';
                }
                if (realAlerts.length > 0) {
                    distractionSummary = `${realAlerts.length} off-task moments detected. Review timeline for details.`;
                }
            }

            const stats: TaskStats = {
                task: monitoringState.task,
                totalTime: totalTime,
                focusedTime: focusedTime,
                alertCount: monitoringState.alertCount,
                alerts: realAlerts,
                activitySummary,
                distractionSummary,
            };

            setCurrentStats(stats);

            // Add to history with full config
            const newHistoryItem: TaskHistory = {
                id: Date.now().toString(),
                task: monitoringState.task,
                startTime: new Date(Date.now() - totalTime * 1000),
                endTime: new Date(),
                duration: totalTime,
                alertCount: monitoringState.alertCount,
                completed: true,
                config: currentConfig,
            };

            // Save to database first
            try {
                await addSupervisorTaskHistory(newHistoryItem);
                // console.log('[Supervisor] Saved task history to database');
                
                // Reload from database to keep state in sync
                const updatedHistory = await getSupervisorTaskHistory(5);
                setTaskHistory(updatedHistory);
            } catch (error) {
                console.error('[Supervisor] Failed to save task history to database:', error);
                // Fallback to local state update if database fails
                setTaskHistory([newHistoryItem, ...taskHistory.slice(0, 4)]);
            }

            // Clean up resources
            visibilityManagerRef.current?.stop();
            monitorCaptureRef.current?.stop();
            languageModelExRef.current?.destroy();
            writerExRef.current?.destroy();
            
            // Clear idle check interval
            if (idleCheckIntervalRef.current) {
                clearInterval(idleCheckIntervalRef.current);
                idleCheckIntervalRef.current = null;
            }
            
            // Release keep awake request
            if (typeof chrome !== 'undefined' && chrome.power) {
                try {
                    chrome.power.releaseKeepAwake();
                    // console.log('[Power] Keep awake released - system can sleep normally');
                } catch (error) {
                    console.error('[Power] Failed to release keep awake:', error);
                }
            }
            
            // Reset Speech initialization flag for next session
            speechInitializedRef.current = false;

            message.success({ content: 'Task completed!', key: 'summary', duration: 2 });
            setAppState('stats');

            // Reset analysis history for next session
            setAnalysisHistory([]);
        }
    };

    const [selectedHistoryConfig, setSelectedHistoryConfig] = useState<SupervisorConfig | null>(null);

    const handleTaskHistoryClick = (config: SupervisorConfig) => {
        setSelectedHistoryConfig(config);
        message.info('Task settings loaded - modify and press Enter to start');
    };

    const handleNewTask = () => {
        setAppState('setup');
        setMonitoringState(null);
        setCurrentConfig(null);
        setCurrentStats(null);
        setSelectedHistoryConfig(null);
        setTranscribedText(''); // Clear transcribed text
    };

    // Keep monitoringStateRef in sync with monitoringState for callbacks
    useEffect(() => {
        monitoringStateRef.current = monitoringState;
    }, [monitoringState]);

    // Keep currentConfigRef in sync with currentConfig for callbacks
    useEffect(() => {
        currentConfigRef.current = currentConfig;
    }, [currentConfig]);

    // Initialize user preferences, notification manager, and speech on mount
    useEffect(() => {
        const initializeServices = async () => {
            try {
                // Initialize UserPreferences
                const preferences = UserPreferences.getInstance();
                await preferences.initialize();
                userPreferencesRef.current = preferences;
                // console.log('[Supervisor] UserPreferences initialized:', preferences.getAll());

                // Set mascot variant from preferences
                const mascot = preferences.get('mascot') as string;
                if (mascot === 'yellow' || mascot === 'blue' || mascot === 'pink') {
                    setMascotVariant(mascot);
                    setGradientScheme(mascot);
                    // console.log('[Supervisor] Mascot variant set to:', mascot);
                } else if (mascot === 'red') {
                    // Map 'red' to 'pink' since Mascot doesn't support red
                    setMascotVariant('pink');
                    setGradientScheme('pink');
                    // console.log('[Supervisor] Mascot variant "red" mapped to "pink"');
                } else if (mascot === 'green') {
                    // Map 'green' to 'blue' since Mascot doesn't support green
                    setMascotVariant('blue');
                    setGradientScheme('blue');
                    // console.log('[Supervisor] Mascot variant "green" mapped to "blue"');
                }

                // Initialize RichNotificationManager
                const notificationManager = RichNotificationManager.getInstance();
                await notificationManager.requestPermission();
                notificationManagerRef.current = notificationManager;
                // console.log('[Supervisor] RichNotificationManager initialized');

                // Initialize notification sound
                const audio = new Audio('/notification-sound.mp3');
                audio.volume = 0.5;
                notificationSoundRef.current = audio;
                // console.log('[Supervisor] Notification sound loaded');

                // Don't initialize Speech on mount - will be lazy loaded when voice mode is used
                // console.log('[Supervisor] Speech will be initialized on-demand when voice mode is selected');

                // Load task history from database
                const history = await getSupervisorTaskHistory(5);
                if (history.length > 0) {
                    setTaskHistory(history);
                    // console.log('[Supervisor] Loaded task history from database:', history.length);
                }
                
            } catch (error) {
                console.error('[Supervisor] Failed to initialize services:', error);
            }
        };

        initializeServices();
    }, []);

    // Prevent window close/reload while monitoring
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (appState === 'monitoring' && monitoringState) {
                e.preventDefault();
                e.returnValue = ''; // Chrome requires returnValue to be set
                return ''; // For older browsers
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [appState, monitoringState]);

    // Cleanup on component unmount
    useEffect(() => {
        return () => {
            // Stop and cleanup all resources when component unmounts
            visibilityManagerRef.current?.stop();
            taskRunnerRef.current?.stop();
            monitorCaptureRef.current?.stop();
            languageModelExRef.current?.destroy();
            writerExRef.current?.destroy();
            audioCaptureRef.current?.stop();
            
            // Clear idle check interval
            if (idleCheckIntervalRef.current) {
                clearInterval(idleCheckIntervalRef.current);
                idleCheckIntervalRef.current = null;
            }
            
            // Release keep awake request
            if (typeof chrome !== 'undefined' && chrome.power) {
                try {
                    chrome.power.releaseKeepAwake();
                } catch (error) {
                    console.error('[Power] Failed to release keep awake on cleanup:', error);
                }
            }
        };
    }, []);

    return (
        <GradientBackground scheme={gradientScheme}>
            {/* Floating close button */}
            <button
                onClick={() => window.close()}
                title="Close Supervisor"
                aria-label="Close Supervisor"
                style={{
                    position: 'fixed',
                    top: '16px',
                    right: '16px',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: 'rgba(0, 0, 0, 0.6)',
                    color: 'white',
                    border: 'none',
                    fontSize: '18px',
                    lineHeight: '1',
                    cursor: 'pointer',
                    zIndex: 10001,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    backdropFilter: 'blur(8px)',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.8)';
                    e.currentTarget.style.transform = 'scale(1.1)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(0, 0, 0, 0.6)';
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
                }}
                onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.95)';
                }}
                onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1.1)';
                }}
            >
                ✕
            </button>

            <Flex
                style={{
                    minWidth: "-webkit-fill-available",
                    minHeight: "100vh",
                }}
                justify={"center"}
                align={"center"}
            >
                <div
                    className={styles.glassDiv}
                    style={{
                        background: `${token.colorBgContainer}dd`,
                        backdropFilter: 'blur(20px)',
                        border: `1px solid ${token.colorBorder}`,
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
                        margin: "20px"
                    }}
                >
                    <Flex vertical gap="large" align="center" style={{ width: '100%' }}>
                        {appState === 'setup' && (
                            <>
                                <Mascot
                                    variant={mascotVariant}
                                    size='big'
                                />
                                <Flex vertical align="center" gap="small" style={{ textAlign: 'center' }}>
                                    <Title level={3} style={{ margin: 0 }}>Focus Supervisor</Title>
                                    <Text type="secondary">Stay on track with AI-powered monitoring</Text>
                                </Flex>

                                {isLoading ? (
                                    <Spin tip={loadingMessage} size="large">
                                        <div style={{
                                            padding: 50,
                                            background: 'rgba(0, 0, 0, 0.05)',
                                            borderRadius: 8,
                                            minWidth: 300
                                        }} />
                                    </Spin>
                                ) : (
                                    <>
                                        <SupervisorControls
                                            onStart={handleStart}
                                            initialConfig={selectedHistoryConfig || undefined}
                                            onRecordingStart={handleRecordingStart}
                                            onRecordingStop={handleRecordingStop}
                                            transcribedText={transcribedText}
                                            isTranscribing={isTranscribing}
                                        />
                                        <SupervisorHistory
                                            tasks={taskHistory}
                                            onTaskClick={handleTaskHistoryClick}
                                            onTaskStart={handleStart}
                                        />
                                    </>
                                )}
                            </>
                        )}

                        {appState === 'monitoring' && monitoringState && (
                            <>
                                <Mascot
                                    variant={mascotVariant}
                                    size='medium'
                                    motion={monitoringState.status === 'running' ? 'float' : undefined}
                                />
                                <SupervisorMonitoring
                                    initialState={monitoringState}
                                    onPause={handlePause}
                                    onResume={handleResume}
                                    onStop={handleStop}
                                    onTimerComplete={handleTimerComplete}
                                />
                                {/* Debug button to test alerts */}
                                {/* <button
                                    onClick={handleAddAlert}
                                    style={{
                                        padding: '4px 8px',
                                        fontSize: '10px',
                                        opacity: 0.5,
                                        border: '1px solid #ccc',
                                        borderRadius: '4px',
                                        background: 'transparent',
                                        cursor: 'pointer'
                                    }}
                                >
                                    + Add Alert (test)
                                </button> */}
                            </>
                        )}

                        {appState === 'stats' && currentStats && (
                            <>
                                <Mascot
                                    variant={mascotVariant}
                                    size='small'
                                />
                                <SupervisorStats
                                    stats={currentStats}
                                    onNewTask={handleNewTask}
                                />
                            </>
                        )}
                    </Flex>
                </div>
            </Flex>
        </GradientBackground>
    );
}
