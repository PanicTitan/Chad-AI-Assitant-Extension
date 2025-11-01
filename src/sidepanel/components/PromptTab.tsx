import { useState, useRef, useEffect } from 'react';
import { Input, Button, Collapse, Slider, Select, Typography, Space, Card, message, Progress, Tooltip } from 'antd';
import { SendOutlined, ReloadOutlined } from '@ant-design/icons';
import { LanguageModelEx } from '@/utils/built-in-ai-ex/LanguageModelEx';
import AudioTranscriptionRecorder from './AudioTranscriptionRecorder';
import styles from './PromptTab.module.css';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

export default function PromptTab() {
    const [prompt, setPrompt] = useState('');
    const [systemPrompt, setSystemPrompt] = useState('');
    const [responseSchema, setResponseSchema] = useState('');
    const [response, setResponse] = useState('');
    const [loading, setLoading] = useState(false);
    const modelRef = useRef<LanguageModelEx | null>(null);
    
    // Advanced settings
    const [topK, setTopK] = useState(10);
    const [temperature, setTemperature] = useState(0.7);
    const [maxQuota, setMaxQuota] = useState(0.75);
    const [contextHandler, setContextHandler] = useState<'clear' | 'summarize'>('summarize');
    const [historyHandler, setHistoryHandler] = useState<'clear' | 'preserve' | 'update'>('preserve');
    
    // Context tracking
    const [quotaUsage, setQuotaUsage] = useState(0);
    const [quotaTotal, setQuotaTotal] = useState(0);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (modelRef.current) {
                modelRef.current.destroy();
                modelRef.current = null;
            }
        };
    }, []);

    const handleResetModel = () => {
        if (modelRef.current) {
            modelRef.current.destroy();
            modelRef.current = null;
            setQuotaUsage(0);
            setQuotaTotal(0);
            message.success('Model reset successfully');
        }
    };

    const handlePrompt = async () => {
        if (!prompt.trim()) {
            message.warning('Please enter a prompt');
            return;
        }

        setLoading(true);
        setResponse('');

        try {
            // Create model if not exists
            if (!modelRef.current) {
                const createOptions: any = {
                    temperature,
                    topK,
                    maxQuotaUsage: maxQuota,
                    contextHandler,
                    historyHandler,
                };

                // Add system prompt if provided
                if (systemPrompt.trim()) {
                    createOptions.initialPrompts = [{ role: 'system', content: systemPrompt }];
                }

                // Add response schema if provided
                if (responseSchema.trim()) {
                    try {
                        createOptions.responseConstraintSchema = JSON.parse(responseSchema);
                    } catch (e) {
                        message.error('Invalid JSON schema for response constraint');
                        setLoading(false);
                        return;
                    }
                }

                modelRef.current = await LanguageModelEx.create(createOptions);
            }

            // Update quota tracking
            setQuotaTotal(modelRef.current.inputQuota);
            setQuotaUsage(modelRef.current.inputUsage);

            let fullResponse = '';
            const stream = modelRef.current.promptStreaming(prompt);

            for await (const chunk of stream) {
                fullResponse += chunk;
                setResponse(fullResponse);
            }

            // Update quota after prompt
            setQuotaUsage(modelRef.current.inputUsage);
        } catch (error: any) {
            message.error(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Title level={4}>Language Model</Title>
                <Paragraph type="secondary">
                    Direct access to the language model with custom prompts
                </Paragraph>
            </div>

            <div className={styles.content}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Tooltip title="The user prompt is the text that you want to send to the language model to get a response based on your requirements">
                                <Typography.Text strong>User Prompt</Typography.Text>
                            </Tooltip>
                            <AudioTranscriptionRecorder
                                onTranscriptionComplete={(text) => {
                                    setPrompt(prev => prev ? `${prev}\n${text}` : text);
                                }}
                                buttonText="Dictate"
                                size="small"
                                type="dashed"
                            />
                        </Space>
                        <TextArea
                            rows={4}
                            placeholder="Enter your prompt here..."
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    <div>
                        <Tooltip title="The system prompt is a set of instructions or guidelines that define how the model should behave and respond throughout the conversation">
                            <Typography.Text strong>System Prompt</Typography.Text>
                        </Tooltip>
                        <TextArea
                            rows={2}
                            placeholder="Define the assistant's behavior (optional)..."
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    {quotaTotal > 0 && (
                        <Card size="small">
                            <Space direction="vertical" style={{ width: '100%' }} size="small">
                                <Typography.Text strong>Context Quota Usage</Typography.Text>
                                <Progress 
                                    percent={Math.round((quotaUsage / quotaTotal) * 100)} 
                                    status={quotaUsage / quotaTotal > 0.9 ? 'exception' : 'active'}
                                    format={() => `${quotaUsage} / ${quotaTotal}`}
                                />
                            </Space>
                        </Card>
                    )}

                    <Collapse
                        items={[
                            {
                                key: 'advanced',
                                label: 'Advanced Settings',
                                children: (
                                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                        <div>
                                            <Typography.Text>TopK (Sampling): {topK}</Typography.Text>
                                            <Slider
                                                min={1}
                                                max={50}
                                                value={topK}
                                                onChange={setTopK}
                                                disabled={!!modelRef.current}
                                            />
                                        </div>
                                        <div>
                                            <Typography.Text>Temperature (Creativity): {temperature}</Typography.Text>
                                            <Slider
                                                min={0}
                                                max={2}
                                                step={0.1}
                                                value={temperature}
                                                onChange={setTemperature}
                                                disabled={!!modelRef.current}
                                            />
                                        </div>
                                        <div>
                                            <Typography.Text>Max Quota Usage (Before Clear): {maxQuota}</Typography.Text>
                                            <Slider
                                                min={0.1}
                                                max={1}
                                                step={0.05}
                                                value={maxQuota}
                                                onChange={setMaxQuota}
                                                disabled={!!modelRef.current}
                                            />
                                        </div>
                                        <div>
                                            <Typography.Text strong>Context Handler (Quota Strategy)</Typography.Text>
                                            <Select
                                                style={{ width: '100%', marginTop: 8 }}
                                                value={contextHandler}
                                                onChange={setContextHandler}
                                                disabled={!!modelRef.current}
                                                options={[
                                                    { value: 'clear', label: 'Clear (Fastest)' },
                                                    { value: 'summarize', label: 'Summarize (Best)' },
                                                ]}
                                            />
                                        </div>
                                        <div>
                                            <Typography.Text strong>History Handler (Memory Strategy)</Typography.Text>
                                            <Select
                                                style={{ width: '100%', marginTop: 8 }}
                                                value={historyHandler}
                                                onChange={setHistoryHandler}
                                                disabled={!!modelRef.current}
                                                options={[
                                                    { value: 'clear', label: 'Clear (No Memory)' },
                                                    { value: 'preserve', label: 'Preserve (Keep History)' },
                                                    { value: 'update', label: 'Update (Smart Memory)' },
                                                ]}
                                            />
                                        </div>
                                        <div>
                                            <Tooltip title="A JSON schema that's used to constrain the model's response to match a specific structure or format">
                                                <Typography.Text strong>Response Constraint Schema (JSON)</Typography.Text>
                                            </Tooltip>
                                            <TextArea
                                                rows={4}
                                                placeholder='{"type": "object", "properties": {...}}'
                                                value={responseSchema}
                                                onChange={(e) => setResponseSchema(e.target.value)}
                                                style={{ marginTop: 8, fontFamily: 'monospace' }}
                                                disabled={!!modelRef.current}
                                            />
                                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                                Optional JSON schema to constrain the model's response format
                                            </Typography.Text>
                                        </div>
                                    </Space>
                                ),
                            },
                        ]}
                    />

                    <Space style={{ width: '100%' }} size="middle">
                        <Button
                            type="primary"
                            icon={<SendOutlined />}
                            onClick={handlePrompt}
                            loading={loading}
                            size="large"
                            style={{ flex: 1 }}
                        >
                            Generate
                        </Button>
                        {modelRef.current && (
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={handleResetModel}
                                disabled={loading}
                                size="large"
                                danger
                            >
                                Reset Model
                            </Button>
                        )}
                    </Space>

                    {response && (
                        <Card title="Response" className={styles.responseCard}>
                            <div className={styles.response}>{response}</div>
                        </Card>
                    )}
                </Space>
            </div>
        </div>
    );
}
