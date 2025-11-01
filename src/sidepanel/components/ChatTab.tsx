import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    Conversations,
    Sender,
    ThoughtChain,
    Bubble,
    Prompts,
    Actions,
    Attachments,
    type PromptsProps,
    type ThoughtChainItem,
    type ActionsProps,
    type AttachmentsProps
} from '@ant-design/x';
import {
    Button,
    Space,
    Typography,
    message as antdMessage,
    Collapse,
    type GetProp
} from 'antd';
import {
    ClearOutlined,
    DownloadOutlined,
    AudioOutlined,
    AudioMutedOutlined,
    RobotOutlined,
    UserOutlined,
    CopyOutlined,
    RedoOutlined,
    StopOutlined,
    LinkOutlined,
    CloudUploadOutlined,
    BulbOutlined,
    InfoCircleOutlined,
    RocketOutlined,
    SearchOutlined,
    FileTextOutlined,
    EnterOutlined,
    DownOutlined,
    DeleteOutlined
} from '@ant-design/icons';
import { Agent, type AgentRun, type IterationLogEntry, type ToolCallLog } from '@/utils/built-in-ai-ex/Agent';
import { UserPreferences } from '@/utils/UserPreferences';
import { BackgroundVoiceRecognition } from '@/utils/BackgroundVoiceRecognition';
import { createAgentTools } from '@/utils/agentTools';
import { processPDF, splitAudioIntoChunks, getFileType } from '@/utils/fileProcessing';
import AudioTranscriptionRecorder from './AudioTranscriptionRecorder';
import { Mascot } from '@/components/Mascot';
import { marked } from 'marked';
import styles from './ChatTab.module.css';
import { getUnusedChatContext } from '@/utils/db';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ToolOutlined } from '@ant-design/icons';
import { fetchPageText } from '@/utils/extensionHelper';

const { Title, Text } = Typography;

interface FilePreviewItem {
    uid?: string;
    name: string;
    size?: number;
    description?: string;
    status?: 'uploading' | 'done' | 'error';
}

interface Message {
    id: string;
    role: 'user' | 'assistant' | 'file' | 'suggestion';
    content: string | any;
    timestamp: number;
    attachments?: Array<{ type: 'image' | 'audio' | 'pdf'; data: Blob; name: string }>;
    filePreview?: FilePreviewItem[];
    thoughtChain?: readonly IterationLogEntry[];
    isStreaming?: boolean;
}

interface ContextReference {
    reason: 'selected-text' | 'omnibox' | 'fullpage-chat';
    context: string;
    title?: string;
    url?: string;
    pageContent?: string;
}

// Initial prompt suggestions
const initialPrompts: PromptsProps['items'] = [
    {
        key: '1',
        icon: <BulbOutlined style={{ color: '#FFD700' }} />,
        label: 'Organize My Tabs',
        description: 'Group my open tabs by category',
    },
    {
        key: '2',
        icon: <SearchOutlined style={{ color: '#1890FF' }} />,
        label: 'Search My History',
        description: 'Find something I visited recently',
    },
    {
        key: '3',
        icon: <RocketOutlined style={{ color: '#722ED1' }} />,
        label: 'Web Research',
        description: 'Search and summarize information from the web',
    },
    {
        key: '4',
        icon: <FileTextOutlined style={{ color: '#52C41A' }} />,
        label: 'Analyze Content',
        description: 'Help me understand this page or document',
    },
    {
        key: '5',
        icon: <InfoCircleOutlined style={{ color: '#FF4D4F' }} />,
        label: 'Ask Anything',
        description: 'General questions and assistance',
    },
];

export default function ChatTab() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(false);
    const [agentInitializing, setAgentInitializing] = useState(false);
    const [currentRun, setCurrentRun] = useState<AgentRun | null>(null);
    const [currentIteration, setCurrentIteration] = useState<IterationLogEntry | null>(null);
    const [voiceStatus, setVoiceStatus] = useState<'idle' | 'loading' | 'listening'>('idle');
    const [transcript, setTranscript] = useState('');
    const [inputValue, setInputValue] = useState('');
    const [contextReference, setContextReference] = useState<ContextReference | null>(null);
    const [attachedFiles, setAttachedFiles] = useState<GetProp<AttachmentsProps, 'items'>>([]);
    const [showAttachments, setShowAttachments] = useState(false);
    // Preview of processed attachments (blobs and extracted text snippets)
    const [processedAttachmentsPreview, setProcessedAttachmentsPreview] = useState<Array<{ type: 'image' | 'audio' | 'pdf' | 'text' | 'other'; data?: Blob; text?: string; name: string }>>([]);
    const [abortController, setAbortController] = useState<AbortController | null>(null);

    const agentRef = useRef<Agent | null>(null);
    const voiceRecognitionRef = useRef<BackgroundVoiceRecognition | null>(null);
    const attachmentsRef = useRef<any>(null);
    const senderRef = useRef<any>(null);
    const userPrefs = UserPreferences.getInstance();
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const mascotVariant = userPrefs.getMascot();

    // Remove any textarea siblings of #root that might be causing React errors
    useEffect(() => {
        const root = document.getElementById('root');
        if (root && root.parentElement) {
            const textareas = root.parentElement.querySelectorAll('textarea');
            textareas.forEach((textarea) => {
                if (textarea.parentElement === root.parentElement && textarea !== root && !root.contains(textarea)) {
                    console.log('[ChatTab] Removing orphaned textarea element');
                    textarea.remove();
                }
            });
        }
    }, []);

    // Load context from database on mount
    useEffect(() => {
        console.log('[ChatTab] Component mounted, checking for context...');
        const loadChatContext = async () => {
            try {
                const context = await getUnusedChatContext();
                console.log('[ChatTab] Context retrieved:', context);

                if (context) {
                    console.log('[ChatTab] Loaded context data:', context.data);

                    // Store context reference for display
                    setContextReference(context.data as ContextReference);

                    // Construct message based on context type
                    let contextMessage = '';

                    switch (context.data.reason) {
                        case 'selected-text':
                            contextMessage = `"${context.data.context}"`;
                            break;
                        case 'omnibox':
                            contextMessage = context.data.context;
                            break;
                        case 'fullpage-chat':
                            // contextMessage = `Analyze this page: "${context.data.title}"\n${context.data.url}\n`;
                            break;
                    }

                    setInputValue(contextMessage);
                }
            } catch (error) {
                console.error('[ChatTab] Failed to load context:', error);
            }
        };

        loadChatContext();
    }, []);

    // Initialize agent lazily (on first prompt)
    const initializeAgent = async () => {
        if (agentRef.current) return; // Already initialized

        try {
            setAgentInitializing(true);
            console.log('[ChatTab] Initializing agent...');
            const tools = createAgentTools();

            // Get user's custom persona prompt if available
            const userSystemPrompt = userPrefs.getPersonaPrompt() ?? "";

            // Agent.create will automatically generate the system prompt with tools
            agentRef.current = await Agent.create({
                tools,
                toolsFormat: "detailed_snippet",
                initialPrompts: [
                    {
                        role: "system",
                        content: userSystemPrompt,
                    }
                ],
            });
            console.log('[ChatTab] Agent initialized successfully');
        } catch (error) {
            console.error('[ChatTab] Failed to initialize agent:', error);
            antdMessage.error('Failed to initialize AI agent: ' + (error instanceof Error ? error.message : 'Unknown error'));
            throw error;
        } finally {
            setAgentInitializing(false);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (agentRef.current) {
                agentRef.current.destroy();
            }
        };
    }, []);

    // Initialize voice recognition
    useEffect(() => {
        if (voiceRecognitionRef.current) return; // Prevent re-initialization

        const voiceRecognition = new BackgroundVoiceRecognition({
            language: 'en',
            device: 'webgpu',
        });

        voiceRecognition.setOnStatusChange((status) => {
            console.log('Voice status:', status);
            if (status === 'listening') {
                setVoiceStatus('listening');
            } else if (status === 'loading') {
                setVoiceStatus('loading');
            } else {
                setVoiceStatus('idle');
            }
        });

        voiceRecognition.setOnTranscript((text) => {
            console.log('Transcript:', text);
            setTranscript(text);
        });

        voiceRecognition.setOnError((error) => {
            console.error('Voice recognition error:', error);
            antdMessage.error('Voice recognition error: ' + error.message);
            setVoiceStatus('idle');
        });

        // Add trigger for "help" keyword
        voiceRecognition.addTrigger({
            id: 'help-trigger',
            keywords: ['help', 'help me'],
            fuzzyMatch: true,
            handler: async (context) => {
                console.log('🎤 Help keyword detected!');
                antdMessage.success(`Help detected! You said: "${context.fullText}"`);
                setInputValue('I need help');
            },
        });

        voiceRecognitionRef.current = voiceRecognition;

        // Cleanup
        return () => {
            if (voiceRecognitionRef.current) {
                voiceRecognitionRef.current.stop();
                voiceRecognitionRef.current.destroy();
                voiceRecognitionRef.current = null;
            }
        };
    }, []);

    const handleToggleVoice = useCallback(async () => {
        if (!voiceRecognitionRef.current) return;

        if (voiceStatus === 'listening') {
            // Stop listening
            voiceRecognitionRef.current.stop();
            setVoiceStatus('idle');
            antdMessage.info('Voice recognition stopped');
        } else {
            // Start listening
            try {
                setVoiceStatus('loading');

                // Check support
                if (!BackgroundVoiceRecognition.isWebGPUSupported()) {
                    antdMessage.warning('WebGPU not supported, using WASM fallback');
                }

                // Request permission
                const hasPermission = await voiceRecognitionRef.current.requestPermission();
                if (!hasPermission) {
                    antdMessage.error('Microphone permission denied');
                    setVoiceStatus('idle');
                    return;
                }

                // Load model if not loaded
                if (!voiceRecognitionRef.current.isReady()) {
                    antdMessage.info('Loading voice recognition model...');
                    await voiceRecognitionRef.current.loadModel((progress) => {
                        if (progress.status === 'loading' && progress.file) {
                            console.log('Loading:', progress.file);
                        }
                    });
                }

                // Start listening
                await voiceRecognitionRef.current.start();
                antdMessage.success('Voice recognition active! Say "help" to trigger assistance');
            } catch (error) {
                console.error('Failed to start voice recognition:', error);
                antdMessage.error('Failed to start voice recognition');
                setVoiceStatus('idle');
            }
        }
    }, [voiceStatus]);

    const handleSendMessage = async (content: string) => {
        if (!content.trim() && attachedFiles.length === 0) return;

        setLoading(true);

        try {
            // Initialize agent on first message
            await initializeAgent();

            if (!agentRef.current) {
                antdMessage.error('Failed to initialize agent');
                setLoading(false);
                return;
            }
            // Process attached files: support images, audio chunks, PDFs (extract text + images), and text-like files
            const processedAttachments: Array<{ type: 'image' | 'audio' | 'pdf' | 'text' | 'other'; data?: Blob; text?: string; name: string }> = [];
            const previewItems: typeof processedAttachments = [];

            for (const fileItem of attachedFiles) {
                if (!fileItem.originFileObj) continue;

                const file = fileItem.originFileObj as File;
                const fileType = getFileType(file);

                if (fileType === 'image') {
                    // Keep file as blob
                    processedAttachments.push({ type: 'image', data: file, name: file.name });
                    previewItems.push({ type: 'image', data: file, name: file.name });
                } else if (fileType === 'audio') {
                    // Split into chunks for transcription/processing
                    const chunks = await splitAudioIntoChunks(file);
                    chunks.forEach((chunk, idx) => {
                        const name = `${file.name} (chunk ${idx + 1})`;
                        processedAttachments.push({ type: 'audio', data: chunk, name });
                        previewItems.push({ type: 'audio', data: chunk, name });
                    });
                } else if (fileType === 'pdf') {
                    const pdfData = await processPDF(file);
                    console.log("pdfData:", pdfData)
                    // Merge PDF text into the prompt
                    content = `${content}\n\n[PDF Content from ${file.name}]:\n${pdfData.text}`;
                    // Add extracted images
                    pdfData.images.forEach((img, idx) => {
                        const name = `${file.name} - page ${idx + 1}`;
                        processedAttachments.push({ type: 'image', data: img, name });
                        previewItems.push({ type: 'image', data: img, name });
                    });
                    previewItems.push({ type: 'text', text: pdfData.text.slice(0, 400) + (pdfData.text.length > 400 ? '…' : ''), name: `${file.name} (extracted text)` });
                } else {
                    // Try reading text-like files
                    const textLikeTypes = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/xml', 'application/ld+json'];
                    if (textLikeTypes.includes(file.type) || /\.(md|markdown|json|xml|csv|txt)$/i.test(file.name)) {
                        try {
                            const txt = await file.text();
                            content = `${content}\n\n[File ${file.name}]:\n${txt}`;
                            processedAttachments.push({ type: 'text', text: txt, name: file.name });
                            previewItems.push({ type: 'text', text: txt.slice(0, 400) + (txt.length > 400 ? '…' : ''), name: file.name });
                        } catch (e) {
                            processedAttachments.push({ type: 'other', name: file.name });
                            previewItems.push({ type: 'other', name: file.name });
                        }
                    } else {
                        // Unknown binary - include as other
                        processedAttachments.push({ type: 'other', name: file.name });
                        previewItems.push({ type: 'other', name: file.name });
                    }
                }
            }

            // update preview so the attachments header can show processed items
            setProcessedAttachmentsPreview(previewItems);

            // Build the full prompt with context if available
            let finalPrompt = content.trim();

            if (contextReference) {
                if (contextReference.reason === 'fullpage-chat' && contextReference.pageContent) {
                    finalPrompt = `${content}\n\n[Page Context]:\nTitle: ${contextReference.title}\nURL: ${contextReference.url}\n\nContent:\n${contextReference.pageContent}`;
                }
            }

            // Create user message. Only attach binary blobs (images/audio) to the message so UI can display them.
            const binaryAttachmentsForMessage = processedAttachments.filter(a => (a.type === 'image' || a.type === 'audio') && a.data) as Array<{ type: 'image' | 'audio'; data: Blob; name: string }>;

            const userMessage: Message = {
                id: Date.now().toString(),
                role: 'user',
                content: content.trim(),
                timestamp: Date.now(),
                attachments: binaryAttachmentsForMessage.length > 0 ? binaryAttachmentsForMessage : undefined,
                filePreview: processedAttachmentsPreview && processedAttachmentsPreview.length > 0 ? processedAttachmentsPreview.map(p => ({ uid: undefined, name: p.name, size: undefined, description: p.text, status: 'done' as const })) : undefined,
            };

            setMessages((prev) => [...prev, userMessage]);

            // Clear attachments and context
            setAttachedFiles([]);
            setContextReference(null);
            setShowAttachments(false);

            // Create assistant message placeholder
            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                isStreaming: true,
                thoughtChain: [],
            };

            setMessages((prev) => [...prev, assistantMessage]);

            // Prepare input for agent (text + attachments). Include extracted text parts as separate text entries.
            const agentInput: any[] = [{ type: 'text', value: finalPrompt }];

            for (const attachment of processedAttachments) {
                if ((attachment.type === 'image') && attachment.data) {
                    agentInput.push({ type: 'image', value: attachment.data });
                } else if (attachment.type === 'audio' && attachment.data) {
                    agentInput.push({ type: 'audio', value: attachment.data });
                } else if (attachment.type === 'text' && attachment.text) {
                    // Include extracted text as additional text input to the model
                    agentInput.push({ type: 'text', value: attachment.text });
                }
            }

            // Create abort controller for this run
            const controller = new AbortController();
            setAbortController(controller);
            console.log("finalPrompt:", finalPrompt)
            console.log("agentInput:", agentInput)
            // Run agent with signal. Send a single user message where content is the structured agentInput array
            const run = agentRef.current.run([
                
                { role: "user", content: finalPrompt },
                { role: "user", content: agentInput }
            ], 20, { signal: controller.signal });
            setCurrentRun(run);

            console.log('[ChatTab] Agent run started:', run);
            console.log('[ChatTab] Initial history:', run.history.value);
            console.log('[ChatTab] Initial currentIteration:', run.currentIteration.value);

            // Subscribe to completed iterations (history)
            run.history.subscribe((completedIterations) => {
                console.log('[ChatTab] ✅ History update - completed iterations:', completedIterations.length);
                completedIterations.forEach((iter, idx) => {
                    console.log(`[ChatTab]   Iteration ${idx + 1}:`, {
                        message: iter.message,
                        thoughts: iter.thoughts,
                        toolCalls: iter.tool_calls.length,
                    });
                });

                setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                        // Update thought chain with completed iterations
                        lastMessage.thoughtChain = completedIterations;
                        console.log('[ChatTab] Updated message thoughtChain');
                    }
                    return newMessages;
                });
            });

            // Subscribe to current iteration for live updates
            run.currentIteration.subscribe((currentIter) => {
                console.log('[ChatTab] 🔄 Current iteration update:', currentIter ? {
                    message: currentIter.message,
                    thoughts: currentIter.thoughts,
                    toolCalls: currentIter.tool_calls.length,
                    plan: currentIter.plan,
                } : null);
                setCurrentIteration(currentIter);
            });

            // Wait for completion
            try {
                console.log('[ChatTab] Waiting for run to complete...');
                await run;
                console.log('[ChatTab] ✅ Agent run completed successfully');
                console.log('[ChatTab] Run status:', run.status.value);

                // Get final message from last iteration
                const finalHistory = run.history.value;
                console.log('[ChatTab] Final history length:', finalHistory.length);

                const finalMessage = finalHistory.length > 0
                    ? finalHistory[finalHistory.length - 1].message
                    : 'Task completed';

                console.log('[ChatTab] Final message:', finalMessage);

                // Update final message
                setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMessage = newMessages[newMessages.length - 1];
                    if (lastMessage && lastMessage.role === 'assistant') {
                        console.log('[ChatTab] Updating final message in state');
                        lastMessage.content = finalMessage;
                        lastMessage.isStreaming = false;
                        lastMessage.thoughtChain = finalHistory;
                    }
                    return newMessages;
                });
            } catch (error) {
                console.error('[ChatTab] ❌ Agent run failed:', error);
                throw error;
            } finally {
                console.log('[ChatTab] Cleanup: clearing current iteration and run');
                setCurrentIteration(null);
                setCurrentRun(null);
                setAbortController(null);
            }

        } catch (error) {
            console.error('Chat error:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Sorry, I encountered an error. Please try again.',
                timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };

    const handleStopGeneration = () => {
        console.log('[ChatTab] Stop generation requested');
        if (abortController) {
            console.log('[ChatTab] Aborting via signal');
            try {
                abortController.abort();
                console.log('[ChatTab] Signal aborted successfully');
            } catch (error) {
                console.error('[ChatTab] Error aborting signal:', error);
            }

            setAbortController(null);
            setCurrentRun(null);
            setCurrentIteration(null);
            setLoading(false);

            // Update last message to show it was cancelled
            setMessages((prev) => {
                const newMessages = [...prev];
                const lastMessage = newMessages[newMessages.length - 1];
                if (lastMessage && lastMessage.role === 'assistant' && lastMessage.isStreaming) {
                    lastMessage.content = lastMessage.content || 'Generation cancelled';
                    lastMessage.isStreaming = false;
                }
                return newMessages;
            });

            antdMessage.info('Generation stopped');
        }
    };

    const handleClear = () => {
        setMessages([]);
        setContextReference(null);
        setAttachedFiles([]);
    };

    const handleExport = () => {
        const exportData = messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            timestamp: new Date(msg.timestamp).toISOString(),
            thoughtChain: msg.thoughtChain,
        }));

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agent-chat-export-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleCopyMessage = (content: string) => {
        navigator.clipboard.writeText(content);
        antdMessage.success('Copied to clipboard');
    };

    const handleRetryMessage = (messageId: string) => {
        const message = messages.find(m => m.id === messageId);
        if (message && message.role === 'assistant') {
            // Find the previous user message
            const messageIndex = messages.findIndex(m => m.id === messageId);
            if (messageIndex > 0) {
                const userMessage = messages[messageIndex - 1];
                if (userMessage.role === 'user') {
                    // Remove the assistant message and retry
                    setMessages(prev => prev.filter(m => m.id !== messageId));
                    handleSendMessage(userMessage.content);
                }
            }
        }
    };

    const handlePromptClick = (promptKey: string) => {
        const prompt = initialPrompts?.find(p => p.key === promptKey);
        if (prompt && typeof prompt.description === 'string') {
            setInputValue(prompt.description);
        }
    };

    // Memoize context reference header
    const contextHeader = useMemo(() => {
        if (!contextReference) return null;

        return (
            <Sender.Header
                open={true}
                title={
                    <Space>
                        <EnterOutlined />
                        <Text type="secondary">
                            {contextReference.reason === 'selected-text' && 'Selected Text'}
                            {contextReference.reason === 'omnibox' && 'Search Query'}
                            {contextReference.reason === 'fullpage-chat' && `Page: "${contextReference.title}"`}
                        </Text>
                    </Space>
                }
                onOpenChange={(open) => !open && setContextReference(null)}
            />
        );
    }, [contextReference]);

    // Memoize attachments header
    const attachmentsHeader = useMemo(() => (
        <Sender.Header
            title="Attachments"
            styles={{ content: { padding: 0 } }}
            open={showAttachments}
            onOpenChange={setShowAttachments}
            forceRender
        >
            {processedAttachmentsPreview && processedAttachmentsPreview.length > 0 && (
                <div style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>
                    {processedAttachmentsPreview.map((p, i) => (
                        <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                            <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', borderRadius: 4, border: '1px solid #eee' }}>
                                {p.type === 'image' ? '🖼️' : p.type === 'audio' ? '🎵' : p.type === 'text' ? '📄' : '📎'}
                            </div>
                            <div style={{ fontSize: 12, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>
                                {p.name}{p.text ? ` — ${p.text}` : ''}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <Attachments
                ref={attachmentsRef}
                beforeUpload={() => false}
                items={attachedFiles}
                onChange={({ fileList }) => setAttachedFiles(fileList)}
                placeholder={(type) =>
                    type === 'drop'
                        ? { title: 'Drop files here' }
                        : {
                            icon: <CloudUploadOutlined />,
                            title: 'Upload files',
                            description: 'Images, Audio, or PDF documents',
                        }
                }
                getDropContainer={() => chatContainerRef.current}
            />
        </Sender.Header>
    ), [showAttachments, attachedFiles]);

    return (
        <div className={styles.chatContainer} ref={chatContainerRef}>
            <div className={styles.chatHeader}>
                <Space style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Title level={4} style={{ margin: 0 }}>
                        <RobotOutlined /> Agent Chat
                    </Title>
                    {(messages.length > 0 || contextReference) && (
                        <Button
                            icon={<DeleteOutlined />}
                            onClick={handleClear}
                            size="small"
                            title="Clear chat and context"
                            type="text"
                            danger
                            style={{
                                fontSize: '16px',
                            }}
                        />
                    )}
                </Space>
            </div>

            <div className={styles.chatContent}>
                {/* Show loading mascot when initializing agent */}
                {agentInitializing && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '100%',
                        gap: '16px',
                    }}>
                        <Mascot size="big" motion="float" variant={mascotVariant} />
                        <Text type="secondary" style={{ fontSize: '14px' }}>
                            Initializing AI Agent...
                        </Text>
                    </div>
                )}

                {!agentInitializing && voiceStatus === 'listening' && transcript && (
                    <div style={{
                        padding: '6px 10px',
                        background: '#e6f7ff',
                        border: '1px solid #91d5ff',
                        borderRadius: '6px',
                        marginBottom: '8px',
                        fontSize: '11px',
                        wordBreak: 'break-word',
                    }}>
                        <strong>🎤 Listening:</strong> {transcript}
                    </div>
                )}

                {!agentInitializing && messages.length === 0 && (
                    <div style={{ padding: '12px' }}>
                        <Prompts
                            title="✨ How can I help?"
                            items={initialPrompts}
                            onItemClick={(info) => handlePromptClick(info.data.key)}
                            wrap
                            styles={{
                                list: {
                                    gap: '8px',
                                },
                                item: {
                                    flex: '1 1 auto',
                                    minWidth: '140px',
                                    maxWidth: '100%',
                                    backgroundImage: 'linear-gradient(137deg, #e5f4ff 0%, #efe7ff 100%)',
                                    border: '1px solid #d9d9d9',
                                    fontSize: '12px',
                                }
                            }}
                        />
                    </div>
                )}

                {messages.map((msg) => (
                    <div key={msg.id}>
                        {/* User message */}
                        {msg.role === 'user' && (
                            <div style={{ marginBottom: '12px' }}>
                                <Bubble
                                    variant="shadow"
                                    placement="end"
                                    shape="round"
                                    avatar={{
                                        icon: <UserOutlined />,
                                        style: { background: '#1890ff', fontSize: '14px' }
                                    }}
                                    styles={{
                                        content: {
                                            maxWidth: '100%',
                                            wordBreak: 'break-word',
                                            fontSize: '13px',
                                        }
                                    }}
                                    content={
                                        <div>
                                            {/* If the message contains a filePreview, render a compact file UI */}
                                            {msg.filePreview && msg.filePreview.length > 0 ? (
                                                <div>
                                                    <div style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                        {msg.filePreview.map((item, idx) => (
                                                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa', borderRadius: 4, border: '1px solid #eee' }}>
                                                                    📎
                                                                </div>
                                                                <div style={{ fontSize: 13 }}>
                                                                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                                                                    {item.description && <div style={{ fontSize: 12, color: '#666' }}>{item.description}</div>}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div style={{ whiteSpace: 'pre-wrap' }}>
                                                        {msg.content}
                                                    </div>

                                                    {msg.attachments && msg.attachments.length > 0 && (
                                                        <div style={{
                                                            marginTop: '6px',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            gap: '4px',
                                                        }}>
                                                            {msg.attachments.map((att, idx) => (
                                                                <div key={idx} style={{
                                                                    fontSize: '11px',
                                                                    color: '#666',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px',
                                                                }}>
                                                                    <span>📎</span>
                                                                    <span style={{
                                                                        overflow: 'hidden',
                                                                        textOverflow: 'ellipsis',
                                                                        whiteSpace: 'nowrap',
                                                                    }}>
                                                                        {att.name}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    }
                                />
                            </div>
                        )}

                        {/* Assistant message - separate bubbles for thoughts, tools, and message */}
                        {msg.role === 'assistant' && (
                            <>
                                {msg.thoughtChain && msg.thoughtChain.map((iteration, iterIdx) => (
                                    <div key={`${msg.id}-iter-${iterIdx}`}>
                                        {/* Thoughts bubble */}
                                        {iteration.thoughts && (
                                            <div style={{ marginBottom: '12px' }}>
                                                <Bubble
                                                    variant="shadow"
                                                    placement="start"
                                                    shape="round"
                                                    avatar={{
                                                        icon: <Mascot size="small" variant={mascotVariant} style={{ width: '24px', height: '24px' }} />,
                                                        style: { background: 'transparent', border: 'none' }
                                                    }}
                                                    styles={{
                                                        content: {
                                                            maxWidth: '100%',
                                                            wordBreak: 'break-word',
                                                            fontSize: '13px',
                                                        }
                                                    }}
                                                    content={
                                                        <Collapse
                                                            size="small"
                                                            ghost
                                                            items={[{
                                                                key: 'thoughts',
                                                                label: <span style={{ fontSize: '12px' }}>💭 Thinking Process</span>,
                                                                children: (
                                                                    <div style={{
                                                                        fontSize: '11px',
                                                                        color: '#666',
                                                                        whiteSpace: 'pre-wrap',
                                                                        wordBreak: 'break-word',
                                                                        padding: '8px',
                                                                        background: '#f9f9f9',
                                                                        borderRadius: '4px',
                                                                    }}>
                                                                        {iteration.thoughts}
                                                                    </div>
                                                                ),
                                                            }]}
                                                        />
                                                    }
                                                />
                                            </div>
                                        )}

                                        {/* Tools bubble */}
                                        {iteration.tool_calls && iteration.tool_calls.length > 0 && (
                                            <div style={{ marginBottom: '12px' }}>
                                                <Bubble
                                                    variant="shadow"
                                                    placement="start"
                                                    shape="round"
                                                    avatar={{
                                                        icon: <Mascot size="small" variant={mascotVariant} style={{ width: '24px', height: '24px' }} />,
                                                        style: { background: 'transparent', border: 'none' }
                                                    }}
                                                    styles={{
                                                        content: {
                                                            maxWidth: '100%',
                                                            wordBreak: 'break-word',
                                                            fontSize: '13px',
                                                        }
                                                    }}
                                                    content={
                                                        <Collapse
                                                            size="small"
                                                            ghost
                                                            items={[{
                                                                key: 'tools',
                                                                label: <span style={{ fontSize: '12px' }}>🔧 Tool Calls ({iteration.tool_calls.length})</span>,
                                                                children: (
                                                                    <div>
                                                                        {iteration.tool_calls.map((toolCall, idx) => {
                                                                            const isRunning = toolCall.status === 'running';
                                                                            const isSuccess = toolCall.status === 'success';
                                                                            const isError = toolCall.status === 'error';

                                                                            return (
                                                                                <div key={idx} style={{
                                                                                    marginBottom: idx < iteration.tool_calls.length - 1 ? '8px' : 0,
                                                                                    padding: '8px',
                                                                                    background: isError ? '#fff2f0' : '#fafafa',
                                                                                    border: `1px solid ${isError ? '#ffccc7' : '#e8e8e8'}`,
                                                                                    borderRadius: '4px',
                                                                                }}>
                                                                                    <div style={{
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        gap: '6px',
                                                                                        marginBottom: '6px',
                                                                                    }}>
                                                                                        {isRunning ? <LoadingOutlined /> :
                                                                                            isSuccess ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> :
                                                                                                isError ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> :
                                                                                                    <ToolOutlined />}
                                                                                        <strong style={{ fontSize: '11px' }}>{toolCall.tool}</strong>
                                                                                    </div>
                                                                                    <div style={{
                                                                                        fontSize: '10px',
                                                                                        color: '#666',
                                                                                        marginBottom: '6px',
                                                                                    }}>
                                                                                        <strong>Args:</strong>
                                                                                        <pre style={{
                                                                                            margin: '4px 0 0 0',
                                                                                            padding: '4px',
                                                                                            background: '#fff',
                                                                                            borderRadius: '2px',
                                                                                            overflow: 'auto',
                                                                                        }}>
                                                                                            {JSON.stringify(toolCall.args, null, 2)}
                                                                                        </pre>
                                                                                    </div>
                                                                                    {toolCall.result && (
                                                                                        <div style={{
                                                                                            fontSize: '10px',
                                                                                            color: '#666',
                                                                                        }}>
                                                                                            <strong>Result:</strong>
                                                                                            <div style={{
                                                                                                margin: '4px 0 0 0',
                                                                                                padding: '6px',
                                                                                                background: '#fff',
                                                                                                borderRadius: '2px',
                                                                                                maxHeight: '150px',
                                                                                                overflow: 'auto',
                                                                                                whiteSpace: 'pre-wrap',
                                                                                                wordBreak: 'break-word',
                                                                                            }}>
                                                                                                {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
                                                                                            </div>
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                ),
                                                            }]}
                                                        />
                                                    }
                                                />
                                            </div>
                                        )}
                                    </div>
                                ))}

                                {/* Final message bubble */}
                                <div style={{ marginBottom: '12px' }}>
                                    <Bubble
                                        variant="shadow"
                                        placement="start"
                                        shape="round"
                                        avatar={{
                                            icon: <Mascot size="small" variant={mascotVariant} style={{ width: '24px', height: '24px' }} />,
                                            style: { background: 'transparent', border: 'none' }
                                        }}
                                        styles={{
                                            content: {
                                                maxWidth: '100%',
                                                wordBreak: 'break-word',
                                                fontSize: '13px',
                                            }
                                        }}
                                        content={
                                            <div>
                                                {msg.content ? (
                                                    <div style={{ whiteSpace: 'pre-wrap' }}>
                                                        {msg.content}
                                                    </div>
                                                ) : msg.isStreaming ? (
                                                    <div style={{
                                                        color: '#999',
                                                        fontStyle: 'italic',
                                                    }}>
                                                        Thinking...
                                                    </div>
                                                ) : null}

                                                {msg.role === 'assistant' && !msg.isStreaming && msg.content && (
                                                    <div style={{ marginTop: '6px' }}>
                                                        <Actions
                                                            items={[
                                                                { key: 'copy', icon: <CopyOutlined /> },
                                                                { key: 'retry', icon: <RedoOutlined /> },
                                                            ]}
                                                            onClick={({ key }) => {
                                                                if (key === 'copy') handleCopyMessage(msg.content);
                                                                if (key === 'retry') handleRetryMessage(msg.id);
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        }
                                    />
                                </div>
                            </>
                        )}
                    </div>
                ))}

                {!agentInitializing && currentIteration && (
                    <div>
                        {/* Current thoughts bubble */}
                        {currentIteration.thoughts && (
                            <div style={{ marginBottom: '12px' }}>
                                <Bubble
                                    variant="shadow"
                                    placement="start"
                                    shape="round"
                                    avatar={{
                                        icon: <Mascot size="small" variant={mascotVariant} style={{ width: '24px', height: '24px' }} />,
                                        style: { background: 'transparent', border: 'none' }
                                    }}
                                    styles={{
                                        content: {
                                            maxWidth: '100%',
                                            wordBreak: 'break-word',
                                            fontSize: '13px',
                                        }
                                    }}
                                    content={
                                        <Collapse
                                            size="small"
                                            ghost
                                            items={[{
                                                key: 'thoughts',
                                                label: <span style={{ fontSize: '12px' }}>💭 Thinking Process</span>,
                                                children: (
                                                    <div style={{
                                                        fontSize: '11px',
                                                        color: '#666',
                                                        whiteSpace: 'pre-wrap',
                                                        wordBreak: 'break-word',
                                                        padding: '8px',
                                                        background: '#f9f9f9',
                                                        borderRadius: '4px',
                                                    }}>
                                                        {currentIteration.thoughts}
                                                    </div>
                                                ),
                                            }]}
                                        />
                                    }
                                />
                            </div>
                        )}

                        {/* Current tools bubble */}
                        {currentIteration.tool_calls && currentIteration.tool_calls.length > 0 && (
                            <div style={{ marginBottom: '12px' }}>
                                <Bubble
                                    variant="shadow"
                                    placement="start"
                                    shape="round"
                                    avatar={{
                                        icon: <Mascot size="small" variant={mascotVariant} style={{ width: '24px', height: '24px' }} />,
                                        style: { background: 'transparent', border: 'none' }
                                    }}
                                    styles={{
                                        content: {
                                            maxWidth: '100%',
                                            wordBreak: 'break-word',
                                            fontSize: '13px',
                                        }
                                    }}
                                    content={
                                        <Collapse
                                            size="small"
                                            ghost
                                            defaultActiveKey={['tools']}
                                            items={[{
                                                key: 'tools',
                                                label: <span style={{ fontSize: '12px' }}>🔧 Tool Calls ({currentIteration.tool_calls.length})</span>,
                                                children: (
                                                    <div>
                                                        {currentIteration.tool_calls.map((toolCall, idx) => {
                                                            const isRunning = toolCall.status === 'running';
                                                            const isSuccess = toolCall.status === 'success';
                                                            const isError = toolCall.status === 'error';

                                                            return (
                                                                <div key={idx} style={{
                                                                    marginBottom: idx < currentIteration.tool_calls.length - 1 ? '8px' : 0,
                                                                    padding: '8px',
                                                                    background: isError ? '#fff2f0' : '#fafafa',
                                                                    border: `1px solid ${isError ? '#ffccc7' : '#e8e8e8'}`,
                                                                    borderRadius: '4px',
                                                                }}>
                                                                    <div style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '6px',
                                                                        marginBottom: '6px',
                                                                    }}>
                                                                        {isRunning ? <LoadingOutlined /> :
                                                                            isSuccess ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> :
                                                                                isError ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> :
                                                                                    <ToolOutlined />}
                                                                        <strong style={{ fontSize: '11px' }}>{toolCall.tool}</strong>
                                                                    </div>
                                                                    <div style={{
                                                                        fontSize: '10px',
                                                                        color: '#666',
                                                                        marginBottom: '6px',
                                                                    }}>
                                                                        <strong>Args:</strong>
                                                                        <pre style={{
                                                                            margin: '4px 0 0 0',
                                                                            padding: '4px',
                                                                            background: '#fff',
                                                                            borderRadius: '2px',
                                                                            overflow: 'auto',
                                                                        }}>
                                                                            {JSON.stringify(toolCall.args, null, 2)}
                                                                        </pre>
                                                                    </div>
                                                                    {toolCall.result && (
                                                                        <div style={{
                                                                            fontSize: '10px',
                                                                            color: '#666',
                                                                        }}>
                                                                            <strong>Result:</strong>
                                                                            <div style={{
                                                                                margin: '4px 0 0 0',
                                                                                padding: '6px',
                                                                                background: '#fff',
                                                                                borderRadius: '2px',
                                                                                maxHeight: '150px',
                                                                                overflow: 'auto',
                                                                                whiteSpace: 'pre-wrap',
                                                                                wordBreak: 'break-word',
                                                                            }}>
                                                                                {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ),
                                            }]}
                                        />
                                    }
                                />
                            </div>
                        )}

                        {/* Current message bubble */}
                        {currentIteration.message && (
                            <div style={{ marginBottom: '12px' }}>
                                <Bubble
                                    variant="shadow"
                                    placement="start"
                                    shape="round"
                                    avatar={{
                                        icon: <Mascot size="small" variant={mascotVariant} style={{ width: '24px', height: '24px' }} />,
                                        style: { background: 'transparent', border: 'none' }
                                    }}
                                    styles={{
                                        content: {
                                            maxWidth: '100%',
                                            wordBreak: 'break-word',
                                            fontSize: '13px',
                                        }
                                    }}
                                    content={
                                        <div style={{
                                            color: '#666',
                                            whiteSpace: 'pre-wrap',
                                        }}>
                                            {currentIteration.message}
                                        </div>
                                    }
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className={styles.chatFooter}>
                <Sender
                    ref={senderRef}
                    header={contextHeader || attachmentsHeader}
                    prefix={
                        <Button
                            type="text"
                            icon={<LinkOutlined />}
                            onClick={() => setShowAttachments(!showAttachments)}
                            title="Attach files"
                        />
                    }
                    placeholder="Type your message or attach files..."
                    value={inputValue}
                    onChange={setInputValue}
                    onPasteFile={(_, files) => {
                        for (const file of files) {
                            attachmentsRef.current?.upload(file);
                        }
                        setShowAttachments(true);
                    }}
                    onSubmit={(value) => {
                        handleSendMessage(value);
                        setInputValue('');
                    }}
                    onCancel={handleStopGeneration}
                    loading={loading}
                    disabled={loading}
                    allowSpeech={{
                        recording: voiceStatus === 'listening',
                        onRecordingChange: async (isRecording) => {
                            if (isRecording) {
                                await handleToggleVoice();
                            } else {
                                handleToggleVoice();
                            }
                        },
                    }}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                />
            </div>
        </div>
    );
}
