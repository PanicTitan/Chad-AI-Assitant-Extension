import { useState, useEffect, useRef } from 'react';
import { Button, Input, Radio, Space, Progress, Card, message, Select } from 'antd';
import { Bubble, Sender, ThoughtChain } from '@ant-design/x';
import { RobotOutlined, UserOutlined, LoadingOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { UserPreferences, MascotVariant, SpeechEngine } from '@/utils/UserPreferences';
import { Mascot } from '@/components/Mascot';
import { LanguageModelEx } from '@/utils/built-in-ai-ex/LanguageModelEx';
import { SummarizerEx } from '@/utils/built-in-ai-ex/SummarizerEx';
import { WriterEx } from '@/utils/built-in-ai-ex/WriterEx';
import { RewriterEx } from '@/utils/built-in-ai-ex/RewriterEx';
import { TranslatorEx } from '@/utils/built-in-ai-ex/TranslatorEx';
import { Speech } from '@/utils/Speech';
import { VOICES as KOKORO_VOICES } from '@/utils/kokoro.js/voices';
import styles from './InitialSetup.module.css';
import { WhisperTranscriberWorkerClient } from '@/utils/WhisperTranscriberWorkerClient';

const { TextArea } = Input;

interface InitialSetupProps {
    onComplete: () => void;
}

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string | React.ReactNode;
}

type SetupStep = 
    | 'welcome' 
    | 'name' 
    | 'mascot' 
    | 'persona-ask' 
    | 'persona-input' 
    | 'permissions' 
    | 'models' 
    | 'voice-engine'
    | 'voice-selection'
    | 'voice-test'
    | 'transcription-language'
    | 'complete';

export default function InitialSetup({ onComplete }: InitialSetupProps) {
    const [messages, setMessages] = useState<Message[]>([]);
    const [currentStep, setCurrentStep] = useState<SetupStep>('welcome');
    const [waitingForInput, setWaitingForInput] = useState(false);
    const [mascotVariant, setMascotVariant] = useState<MascotVariant>('yellow');
    const [loading, setLoading] = useState(false);
    const [mascotThinking, setMascotThinking] = useState(false);
    const [modelProgress, setModelProgress] = useState<{ [key: number]: number }>({});
    
    // Setup data
    const setupDataRef = useRef({
        userName: '',
        mascot: 'yellow' as MascotVariant,
        wantsPersona: false,
        persona: '',
        speechEngine: 'kokoro' as SpeechEngine,
        voice: 'af_bella',
    });

    const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [selectedVoiceEngine, setSelectedVoiceEngine] = useState<SpeechEngine>('kokoro');
    const [selectedVoice, setSelectedVoice] = useState<string>('');
    const [selectedLanguage, setSelectedLanguage] = useState<string>('');
    const userPrefs = UserPreferences.getInstance();
    const conversationEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Load browser voices
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            setAvailableVoices(voices);
        };
        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;

        // Start conversation
        addMascotMessage("👋 Hey there! Welcome! I'm so excited to meet you!");
        setTimeout(() => {
            setMascotThinking(true);
            setTimeout(() => {
                setMascotThinking(false);
                addMascotMessage("I'm your new AI assistant, and I'm here to help make your life easier! 🎉");
                setTimeout(() => {
                    setMascotThinking(true);
                    setTimeout(() => {
                        setMascotThinking(false);
                        addMascotMessage("But first, let's get to know each other better! What's your name?");
                        setCurrentStep('name');
                        setWaitingForInput(true);
                    }, 800);
                }, 1000);
            }, 800);
        }, 1000);
    }, []);

    useEffect(() => {
        conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const addMascotMessage = (content: string | React.ReactNode, showLoading: boolean = false) => {
        setMessages(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            role: 'assistant',
            content,
        }]);
        setMascotThinking(showLoading);
    };

    const addUserMessage = (content: string) => {
        setMessages(prev => [...prev, {
            id: Date.now().toString() + Math.random(),
            role: 'user',
            content,
        }]);
    };

    const handleUserResponse = async (input: string) => {
        if (!input.trim()) return;

        setWaitingForInput(false);
        addUserMessage(input);
        setLoading(true);

        await new Promise(resolve => setTimeout(resolve, 800));

        try {
            switch (currentStep) {
                case 'name':
                    setupDataRef.current.userName = input;
                    await userPrefs.set('userName', input);
                    addMascotMessage(`Nice to meet you, ${input}! That's a great name! 😊`);
                    await delay(1200);
                    addMascotMessage("Now, let me show you the different versions of me! Pick your favorite:");
                    await delay(800);
                    addMascotMessage(renderMascotSelection());
                    setCurrentStep('mascot');
                    break;

                case 'persona-input':
                    setupDataRef.current.persona = input;
                    await userPrefs.set('persona', input);
                    addMascotMessage("Perfect! I'll remember to be like that. Thanks for customizing me! 🎯");
                    await goToPermissions();
                    break;

                case 'persona-ask':
                case 'voice-engine':
                case 'voice-selection':
                case 'voice-test':
                    // Handled by buttons
                    break;
            }
        } finally {
            setLoading(false);
        }
    };

    const handleMascotSelect = async (variant: MascotVariant) => {
        setupDataRef.current.mascot = variant;
        setMascotVariant(variant);
        await userPrefs.set('mascot', variant);
        
        addUserMessage(`I choose ${variant}!`);
        await delay(800);
        
        const responses = {
            yellow: "Great choice! Yellow is energetic and fun! ⚡",
            blue: "Nice! Blue is calm and reliable! 💙",
            pink: "Lovely! Pink is friendly and warm! 💖"
        };
        
        addMascotMessage(responses[variant]);
        await delay(1200);
        addMascotMessage("Now, would you like to customize my personality?");
        await delay(600);
        addMascotMessage(
            <Space>
                <Button type="primary" size="large" onClick={() => handlePersonaChoice(true)}>
                    Yes, Customize! 🎨
                </Button>
                <Button size="large" onClick={() => handlePersonaChoice(false)}>
                    No, Keep Default 😊
                </Button>
            </Space>
        );
        setCurrentStep('persona-ask');
    };

    const handlePersonaChoice = async (wantsCustom: boolean) => {
        setupDataRef.current.wantsPersona = wantsCustom;
        
        if (wantsCustom) {
            addUserMessage("Yes, Customize! 🎨");
            await delay(800);
            addMascotMessage("Awesome! Tell me how you want me to respond. Be creative! 🎨");
            await delay(1000);
            addMascotMessage("For example: 'Be friendly and helpful, with a touch of humor' or 'Professional and concise'");
            setCurrentStep('persona-input');
            setWaitingForInput(true);
        } else {
            addUserMessage("No, Keep Default 😊");
            await delay(800);
            addMascotMessage("No problem! I'll be my natural, helpful self! 😊");
            await goToPermissions();
        }
    };

    const goToPermissions = async () => {
        await delay(1000);
        addMascotMessage("Alright! Now I need some permissions to work my magic! 🔐");
        await delay(1200);
        addMascotMessage("I'll need access to your microphone (for voice commands) and notifications (to keep you updated).");
        await delay(800);
        addMascotMessage(
            <Button type="primary" onClick={handlePermissions} size="large">
                Grant Permissions
            </Button>
        );
        setCurrentStep('permissions');
    };

    const handlePermissions = async () => {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            if ('Notification' in window && Notification.permission === 'default') {
                await Notification.requestPermission();
            }
            addMascotMessage("Perfect! Thanks for trusting me! 🙏");
        } catch {
            addMascotMessage("No worries if you're not ready! You can enable these later in settings. 😊");
        }
        
        await delay(1200);
        addMascotMessage("Now for the exciting part - let me download my brain! 🧠");
        await delay(1000);
        addMascotMessage("This might take a moment...");
        setCurrentStep('models');
        await downloadModels();
    };

    const downloadModels = async () => {
        const models = [
            { name: 'Language Model', class: LanguageModelEx },
            { name: 'Summarizer', class: SummarizerEx },
            { name: 'Writer', class: WriterEx },
            { name: 'Rewriter', class: RewriterEx },
            { name: 'Translator', class: TranslatorEx },
            { name: 'Whisper Transcriber', class: null, isWhisper: true }, // Special handling for Whisper
            { name: 'Kokoro Voice', class: null, isKokoro: true }, // Special handling for Kokoro
        ];

        // Initialize progress states
        const initialProgress: { [key: number]: number } = {};
        models.forEach((_, idx) => initialProgress[idx] = 0);
        setModelProgress(initialProgress);

        const progressMessageId = Date.now().toString() + Math.random();
        
        // Render progress card component
        const renderProgressCard = (currentProgress: { [key: number]: number }) => (
            <Card style={{ width: '100%', marginTop: 16 }}>
                {models.map((model, idx) => (
                    <div key={idx} style={{ marginBottom: 12 }}>
                        <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {currentProgress[idx] === 100 ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> : <LoadingOutlined />}
                            <strong>{model.name}</strong>
                        </div>
                        <Progress 
                            percent={currentProgress[idx] || 0} 
                            percentPosition={{ align: 'center', type: 'inner' }}
                            size={[300, 20]}
                            status={currentProgress[idx] === 100 ? 'success' : 'active'}
                        />
                    </div>
                ))}
            </Card>
        );
        
        // Add initial progress card
        setMessages(prev => [...prev, {
            id: progressMessageId,
            role: 'assistant',
            content: renderProgressCard(initialProgress),
        }]);

        for (let i = 0; i < models.length; i++) {
            const model = models[i];
            try {
                if ((model as any).isWhisper) {
                    // Download Whisper transcriber using worker (non-blocking)
                    // const { WhisperTranscriberWorkerClient } = await import('@/utils/WhisperTranscriberWorkerClient');
                    const transcriber = new WhisperTranscriberWorkerClient();
                    
                    let downloadEventCount = 0;
                    await transcriber.download((progress: any) => {
                        downloadEventCount++;
                        // Only update UI every 1000 events to avoid too many updates
                        if (downloadEventCount % 1000 === 0 || progress.status === 'ready') {
                            const percent = progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0;
                            
                            setModelProgress(prev => {
                                const newProgress = { ...prev, [i]: isNaN(percent) ? 0 : percent };
                                
                                // Update the message with new progress
                                setMessages(msgs => msgs.map(msg => 
                                    msg.id === progressMessageId 
                                        ? { ...msg, content: renderProgressCard(newProgress) }
                                        : msg
                                ));
                                
                                return newProgress;
                            });
                        }
                    });
                    
                    // Cleanup after download
                    await transcriber.destroy();
                } else if ((model as any).isKokoro) {
                    // Download Kokoro TTS
                    let downloadEventCount = 0;
                    await Speech.init({
                        loadKokoro: true,
                        onProgress: (progress: any) => {
                            downloadEventCount++;
                            // Only update UI every 1000 events to avoid too many updates
                            if (downloadEventCount % 1000 === 0) {
                                const percent = Math.round((progress.loaded / progress.total) * 100);
                                
                                setModelProgress(prev => {
                                    const newProgress = { ...prev, [i]: isNaN(percent) ? 0 : percent };
                                    
                                    // Update the message with new progress
                                    setMessages(msgs => msgs.map(msg => 
                                        msg.id === progressMessageId 
                                            ? { ...msg, content: renderProgressCard(newProgress) }
                                            : msg
                                    ));
                                    
                                    return newProgress;
                                });
                            }
                        }
                    });
                } else {
                    // Download AI model
                    await (model.class as any).download({
                        monitor: (progress: any) => {
                            const percent = Math.round((progress.loaded / progress.total) * 100);
                            
                            setModelProgress(prev => {
                                const newProgress = { ...prev, [i]: isNaN(percent) ? 0 : percent };
                                
                                // Update the message with new progress
                                setMessages(msgs => msgs.map(msg => 
                                    msg.id === progressMessageId 
                                        ? { ...msg, content: renderProgressCard(newProgress) }
                                        : msg
                                ));
                                
                                return newProgress;
                            });
                        }
                    });
                }
                
                // Mark as complete
                setModelProgress(prev => {
                    const newProgress = { ...prev, [i]: 100 };
                    setMessages(msgs => msgs.map(msg => 
                        msg.id === progressMessageId 
                            ? { ...msg, content: renderProgressCard(newProgress) }
                            : msg
                    ));
                    return newProgress;
                });
            } catch (error) {
                console.error(`Failed to download ${model.name}:`, error);
                setModelProgress(prev => {
                    const newProgress = { ...prev, [i]: 100 };
                    setMessages(msgs => msgs.map(msg => 
                        msg.id === progressMessageId 
                            ? { ...msg, content: renderProgressCard(newProgress) }
                            : msg
                    ));
                    return newProgress;
                });
            }
        }

        await delay(1000);
        addMascotMessage("All set! My brain is fully loaded! 🎓");
        await delay(1200);
        addMascotMessage("Last thing - let's set up my voice! Which engine would you prefer?");
        await delay(800);
        addMascotMessage(renderVoiceEngineSelection());
        setCurrentStep('voice-engine');
    };

    const handleVoiceEngineSelect = async (engine: SpeechEngine) => {
        setupDataRef.current.speechEngine = engine;
        await userPrefs.set('speechEngine', engine);
        
        addUserMessage(engine === 'kokoro' ? 'Kokoro (High Quality)' : 'Browser (Fast)');
        await delay(800);
        
        if (engine === 'kokoro') {
            addMascotMessage("Great choice! Kokoro sounds amazing! 🎵 Pick your favorite voice:");
        } else {
            addMascotMessage("Good choice for speed! Pick a voice:");
        }
        
        // Set engine and reset voice AFTER adding messages
        setSelectedVoiceEngine(engine);
        setSelectedVoice(''); // Reset voice selection
        
        await delay(600);
        setCurrentStep('voice-selection');
    };

    const handleVoiceConfirm = async () => {
        if (!selectedVoice) return;
        
        setupDataRef.current.voice = selectedVoice;
        if (setupDataRef.current.speechEngine === 'kokoro') {
            await userPrefs.set('kokoroVoice', selectedVoice);
        } else {
            await userPrefs.set('browserVoice', selectedVoice);
        }
        
        const voiceName = selectedVoiceEngine === 'kokoro' 
            ? KOKORO_VOICES[selectedVoice]?.name || selectedVoice
            : selectedVoice;
        
        addUserMessage(`Selected: ${voiceName}`);
        await delay(800);
        addMascotMessage("Great choice!");
        await delay(1000);
        
        // Go to transcription language selection
        await goToTranscriptionLanguage();
    };

    const goToTranscriptionLanguage = async () => {
        addMascotMessage("One last thing! 🎤");
        await delay(800);
        addMascotMessage("What language will you use for voice transcription?");
        await delay(600);
        
        // Get browser language as default
        const browserLang = navigator.language.split('-')[0].toLowerCase();
        setSelectedLanguage(browserLang);
        setCurrentStep('transcription-language');
    };

    const handleLanguageConfirm = async () => {
        if (!selectedLanguage) return;
        
        await userPrefs.setTranscriptionLanguage(selectedLanguage);
        
        const langName = selectedLanguage.toUpperCase();
        addUserMessage(`Selected: ${langName}`);
        await delay(800);
        addMascotMessage("Perfect! Everything is ready! 🎉");
        await delay(1000);
        addMascotMessage("I'm all set up and can't wait to help you be more productive! ✨");
        await delay(1200);
        addMascotMessage(
            <Button 
                type="primary" 
                size="large"
                onClick={handleCompleteSetup}
                style={{ marginTop: 8 }}
            >
                Let's Get Started! 🚀
            </Button>
        );
        setCurrentStep('complete');
    };

    const handleCompleteSetup = async () => {
        await userPrefs.completeSetup();
        onComplete();
    };

    const testVoice = async () => {
        if (!selectedVoice) return;
        
        const text = `Hello ${setupDataRef.current.userName || 'there'}! I'm your AI assistant and I'm ready to help!`;
        
        if (selectedVoiceEngine === 'browser') {
            const utterance = new SpeechSynthesisUtterance(text);
            const voice = availableVoices.find(v => v.name === selectedVoice);
            if (voice) utterance.voice = voice;
            window.speechSynthesis.speak(utterance);
            message.success('Playing voice...');
        } else {
            // Kokoro is already downloaded during model download phase
            const loadingMessage = message.loading('Testing Kokoro voice...', 0);
            try {
                await Speech.speak({
                    text,
                    engine: 'kokoro',
                    voice: selectedVoice,
                });
                loadingMessage();
                message.success('Voice test complete!');
            } catch (error) {
                loadingMessage();
                message.error('Failed to play Kokoro voice');
                console.error('Kokoro test error:', error);
            }
        }
    };

    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const renderMascotSelection = () => (
        <div className={styles.mascotSelection}>
            <Space direction="horizontal" size="large">
                {(['yellow', 'blue', 'pink'] as MascotVariant[]).map(variant => (
                    <div 
                        key={variant}
                        className={styles.mascotOption}
                        onClick={() => handleMascotSelect(variant)}
                    >
                        <Mascot variant={variant} size="medium" motion="float" />
                        <Button type="primary">{variant.charAt(0).toUpperCase() + variant.slice(1)}</Button>
                    </div>
                ))}
            </Space>
        </div>
    );

    const renderVoiceEngineSelection = () => (
        <Space direction="vertical" style={{ width: '100%' }}>
            <Button 
                block 
                size="large" 
                onClick={() => handleVoiceEngineSelect('kokoro')}
            >
                🎵 Kokoro (High Quality)
            </Button>
            <Button 
                block 
                size="large" 
                onClick={() => handleVoiceEngineSelect('browser')}
            >
                ⚡ Browser (Fast)
            </Button>
        </Space>
    );

    const renderVoiceSelection = () => {
        // Get voice options based on selected engine
        const voiceOptions = selectedVoiceEngine === 'kokoro' 
            ? Object.entries(KOKORO_VOICES).map(([key, meta]) => ({
                value: key,
                label: `${meta.name} - ${meta.gender} (${meta.language}) ${meta.traits || ''}`.trim(),
            }))
            : availableVoices.map(voice => ({
                value: voice.name,
                label: `${voice.name} (${voice.lang})`,
            }));

        return (
            <Space direction="vertical" style={{ width: '100%', gap: 16 }}>
                <div>
                    <div style={{ marginBottom: 8 }}>
                        <strong>Select a voice:</strong>
                    </div>
                    <Select
                        style={{ width: '100%' }}
                        placeholder="Choose your voice"
                        size="large"
                        showSearch
                        optionFilterProp="label"
                        onChange={(value) => setSelectedVoice(value)}
                        value={selectedVoice || undefined}
                        options={voiceOptions}
                    />
                </div>
                <Space style={{ width: '100%' }}>
                    <Button 
                        size="large" 
                        disabled={!selectedVoice}
                        onClick={testVoice}
                    >
                        🔊 Test Voice
                    </Button>
                    <Button 
                        type="primary" 
                        size="large" 
                        style={{ flex: 1 }}
                        disabled={!selectedVoice}
                        onClick={() => handleVoiceConfirm()}
                    >
                        Continue
                    </Button>
                </Space>
            </Space>
        );
    };

    const renderLanguageSelection = () => {
        const commonLanguages = [
            { code: 'en', name: 'English' },
            { code: 'es', name: 'Spanish' },
            { code: 'fr', name: 'French' },
            { code: 'de', name: 'German' },
            { code: 'pt', name: 'Portuguese' },
            { code: 'zh', name: 'Chinese' },
            { code: 'ja', name: 'Japanese' },
            { code: 'ko', name: 'Korean' },
            { code: 'ru', name: 'Russian' },
            { code: 'ar', name: 'Arabic' },
        ];

        return (
            <Space direction="vertical" style={{ width: '100%', gap: 16 }}>
                <div>
                    <div style={{ marginBottom: 8 }}>
                        <strong>Select transcription language:</strong>
                    </div>
                    <Select
                        style={{ width: '100%' }}
                        placeholder="Choose language"
                        size="large"
                        showSearch
                        optionFilterProp="label"
                        onChange={(value) => setSelectedLanguage(value)}
                        value={selectedLanguage || undefined}
                        options={commonLanguages.map(lang => ({
                            label: lang.name,
                            value: lang.code
                        }))}
                    />
                </div>
                <Button 
                    type="primary" 
                    size="large" 
                    block
                    disabled={!selectedLanguage}
                    onClick={handleLanguageConfirm}
                >
                    Confirm
                </Button>
            </Space>
        );
    };

    return (
        <div className={styles.setupContainer}>
            <div className={styles.mascotHeader}>
                <Mascot variant={mascotVariant} size="small" motion="float" />
            </div>

            <div className={styles.chatContainer}>
                {messages.map(msg => (
                    <Bubble
                        className={styles.chatBubble}
                        key={msg.id}
                        placement={msg.role === 'user' ? 'end' : 'start'}
                        content={msg.content}
                        variant={msg.role === 'user' ? 'filled' : 'shadow'}
                        avatar={msg.role === 'user' 
                            ? { icon: <UserOutlined  style={{ color: "black" }}  /> } 
                            : { icon: <Mascot variant={mascotVariant} size="medium" /> }
                        }
                        style={{
                            marginBottom: 12,
                            // maxWidth: '85%',
                        }}
                    />
                ))}
                {mascotThinking && (
                    <Bubble
                        className={styles.chatBubble}
                        placement="start"
                        loading={true}
                        content=""
                        avatar={{ icon: <Mascot variant={mascotVariant} size="medium" /> }}
                        variant="shadow"
                        style={{ marginBottom: 12 }}
                    />
                )}
                <div ref={conversationEndRef} />
            </div>

            {currentStep === 'voice-selection' && (
                <div className={styles.inputContainer}>
                    {renderVoiceSelection()}
                </div>
            )}

            {currentStep === 'transcription-language' && (
                <div className={styles.inputContainer}>
                    {renderLanguageSelection()}
                </div>
            )}

            {waitingForInput && (
                <div className={styles.inputContainer}>
                    <Sender
                        placeholder="Type your response..."
                        onSubmit={handleUserResponse}
                        loading={loading}
                        disabled={loading}
                    />
                </div>
            )}
        </div>
    );
}
