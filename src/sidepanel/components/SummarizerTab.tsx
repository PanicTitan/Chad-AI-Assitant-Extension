import { useState, useRef, useEffect, useContext } from 'react';
import { Input, Button, Select, Collapse, Typography, Space, Card, message, Tooltip } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { SummarizerEx } from '@/utils/built-in-ai-ex/SummarizerEx';
import { UserPreferences } from '@/utils/UserPreferences';
import AudioTranscriptionRecorder from './AudioTranscriptionRecorder';
import { TabLoadingContext } from '../index';
import styles from './SummarizerTab.module.css';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

export default function SummarizerTab() {
    const userPrefs = UserPreferences.getInstance();
    const [text, setText] = useState('');
    const [context, setContext] = useState('');
    const [summary, setSummary] = useState('');
    const [loading, setLoading] = useState(false);
    const summarizerRef = useRef<SummarizerEx | null>(null);
    const summaryRef = useRef<HTMLDivElement>(null);
    const { setTabLoading } = useContext(TabLoadingContext);
    
    const [summaryType, setSummaryType] = useState(userPrefs.get('summarizerType'));
    const [length, setLength] = useState(userPrefs.get('summarizerLength'));
    const [format, setFormat] = useState<'plain-text' | 'markdown'>('markdown');
    const [largeContentStrategy, setLargeContentStrategy] = useState(userPrefs.get('summarizerLargeContentStrategy'));

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (summarizerRef.current) {
                summarizerRef.current.destroy();
                summarizerRef.current = null;
            }
        };
    }, []);

    const handleSummarize = async () => {
        if (!text.trim()) {
            message.warning('Please enter text to summarize');
            return;
        }

        setLoading(true);
        setTabLoading('summarizer', true);
        setSummary('');

        try {
            if (!summarizerRef.current) {
                summarizerRef.current = await SummarizerEx.create({
                    type: summaryType as any,
                    length: length as any,
                    format,
                    largeContentStrategy: largeContentStrategy as any,
                });
            }

            let fullSummary = '';
            const stream = summarizerRef.current.summarizeStreaming(text, { context: context || undefined });

            for await (const chunk of stream) {
                fullSummary += chunk;
                setSummary(fullSummary);
                // Scroll to bottom when content updates
                setTimeout(() => {
                    summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }, 0);
            }
        } catch (error: any) {
            message.error(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
            setTabLoading('summarizer', false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Title level={4}>Summarizer</Title>
                <Paragraph type="secondary">
                    Summarize text with advanced options for large content
                </Paragraph>
            </div>

            <div className={styles.content}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Tooltip title="The content that you want the summarizer to process and create a condensed version of">
                                <Typography.Text strong>Text to Summarize</Typography.Text>
                            </Tooltip>
                            <AudioTranscriptionRecorder
                                onTranscriptionComplete={(transcription) => {
                                    setText(prev => prev ? `${prev}\n${transcription}` : transcription);
                                }}
                                buttonText="Dictate"
                                size="small"
                                type="dashed"
                            />
                        </Space>
                        <TextArea
                            rows={6}
                            placeholder="Paste or type the text you want to summarize..."
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    <div>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Tooltip title="Additional context about the content that can help the model produce a more accurate and relevant summary">
                                <Typography.Text strong>Additional Context (Optional)</Typography.Text>
                            </Tooltip>
                            <AudioTranscriptionRecorder
                                onTranscriptionComplete={(transcription) => {
                                    setContext(prev => prev ? `${prev}\n${transcription}` : transcription);
                                }}
                                buttonText="Dictate"
                                size="small"
                                type="dashed"
                            />
                        </Space>
                        <TextArea
                            rows={2}
                            placeholder="Additional information to contextualize..."
                            value={context}
                            onChange={(e) => setContext(e.target.value)}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    <div>
                        <Typography.Text strong>Summary Type</Typography.Text>
                        <Select
                            value={summaryType}
                            onChange={setSummaryType}
                            style={{ width: '100%', marginTop: 8 }}
                            options={[
                                { label: 'TLDR (Concise Summary)', value: 'tldr' },
                                { label: 'Key Points (Bullet Points)', value: 'key-points' },
                                { label: 'Teaser (Preview)', value: 'teaser' },
                                { label: 'Headline (Short Title)', value: 'headline' },
                            ]}
                        />
                    </div>

                    <div>
                        <Typography.Text strong>Length</Typography.Text>
                        <Select
                            value={length}
                            onChange={setLength}
                            style={{ width: '100%', marginTop: 8 }}
                            options={[
                                { label: 'Short (Quick Read)', value: 'short' },
                                { label: 'Medium (Balanced)', value: 'medium' },
                                { label: 'Long (Detailed)', value: 'long' },
                            ]}
                        />
                    </div>

                    <div>
                        <Typography.Text strong>Format</Typography.Text>
                        <Select
                            value={format}
                            onChange={setFormat}
                            style={{ width: '100%', marginTop: 8 }}
                            options={[
                                { label: 'Plain Text', value: 'plain-text' },
                                { label: 'Markdown', value: 'markdown' },
                            ]}
                        />
                    </div>

                    <Collapse
                        items={[
                            {
                                key: 'advanced',
                                label: 'Advanced Settings',
                                children: (
                                    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                                        <div>
                                            <Typography.Text strong>Large Content Strategy</Typography.Text>
                                            <Select
                                                value={largeContentStrategy}
                                                onChange={setLargeContentStrategy}
                                                style={{ width: '100%', marginTop: 8 }}
                                                options={[
                                                    { label: 'Merge (Best for narratives)', value: 'merge' },
                                                    { label: 'Join (Best for key points)', value: 'join' },
                                                ]}
                                            />
                                            <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
                                                How to handle text larger than the model's context window
                                            </Paragraph>
                                        </div>
                                    </Space>
                                ),
                            },
                        ]}
                    />

                    <Button
                        type="primary"
                        icon={<ThunderboltOutlined />}
                        onClick={handleSummarize}
                        loading={loading}
                        block
                        size="large"
                    >
                        Summarize
                    </Button>

                    {summary && (
                        <Card title="Summary" className={styles.resultCard} ref={summaryRef}>
                            <div className={styles.result}>{summary}</div>
                        </Card>
                    )}
                </Space>
            </div>
        </div>
    );
}
