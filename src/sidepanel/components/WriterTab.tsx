import { useState, useRef, useEffect, useContext } from 'react';
import { Input, Button, Select, Collapse, Typography, Space, Card, message, Tooltip } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import { WriterEx } from '@/utils/built-in-ai-ex/WriterEx';
import AudioTranscriptionRecorder from './AudioTranscriptionRecorder';
import { TabLoadingContext } from '../index';
import styles from './WriterTab.module.css';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

export default function WriterTab() {
    const [description, setDescription] = useState('');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);
    const writerRef = useRef<WriterEx | null>(null);
    const resultRef = useRef<HTMLDivElement>(null);
    const { setTabLoading } = useContext(TabLoadingContext);
    
    const [tone, setTone] = useState<'formal' | 'neutral' | 'casual'>('neutral');
    const [length, setLength] = useState<'short' | 'medium' | 'long'>('medium');
    const [format, setFormat] = useState<'plain-text' | 'markdown'>('markdown');
    const [largeContentStrategy, setLargeContentStrategy] = useState<'merge' | 'summarize' | 'join'>('merge');

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (writerRef.current) {
                writerRef.current.destroy();
                writerRef.current = null;
            }
        };
    }, []);

    const handleWrite = async () => {
        if (!description.trim()) {
            message.warning('Please enter a description');
            return;
        }

        setLoading(true);
        setTabLoading('writer', true);
        setResult('');

        try {
            if (!writerRef.current) {
                writerRef.current = await WriterEx.create({
                    tone,
                    length,
                    format,
                    largeContentStrategy,
                });
            }

            let fullResult = '';
            const stream = writerRef.current.writeStreaming(description);

            for await (const chunk of stream) {
                fullResult += chunk;
                setResult(fullResult);
                // Scroll to bottom when content updates
                setTimeout(() => {
                    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }, 0);
            }
        } catch (error: any) {
            message.error(`Error: ${error.message}`);
            console.error(error);
        } finally {
            setLoading(false);
            setTabLoading('writer', false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Title level={4}>Writer</Title>
                <Paragraph type="secondary">
                    Generate text from a description
                </Paragraph>
            </div>

            <div className={styles.content}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Tooltip title="The description of the text that you want the writer to generate based on your requirements and preferences">
                                <Typography.Text strong>Text Description</Typography.Text>
                            </Tooltip>
                            <AudioTranscriptionRecorder
                                onTranscriptionComplete={(text) => {
                                    setDescription(prev => prev ? `${prev}\n${text}` : text);
                                }}
                                buttonText="Dictate"
                                size="small"
                                type="dashed"
                            />
                        </Space>
                        <TextArea
                            rows={4}
                            placeholder="Describe what you want to write..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    <div>
                        <Typography.Text strong>Tone</Typography.Text>
                        <Select
                            value={tone}
                            onChange={setTone}
                            style={{ width: '100%', marginTop: 8 }}
                            options={[
                                { label: 'Formal', value: 'formal' },
                                { label: 'Neutral', value: 'neutral' },
                                { label: 'Casual', value: 'casual' },
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
                                { label: 'Short', value: 'short' },
                                { label: 'Medium', value: 'medium' },
                                { label: 'Long', value: 'long' },
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
                                    <div>
                                        <Typography.Text strong>Large Content Strategy</Typography.Text>
                                        <Select
                                            value={largeContentStrategy}
                                            onChange={setLargeContentStrategy}
                                            style={{ width: '100%', marginTop: 8 }}
                                            options={[
                                                { label: 'Merge', value: 'merge' },
                                                { label: 'Summarize', value: 'summarize' },
                                                { label: 'Join', value: 'join' },
                                            ]}
                                        />
                                    </div>
                                ),
                            },
                        ]}
                    />

                    <Button
                        type="primary"
                        icon={<EditOutlined />}
                        onClick={handleWrite}
                        loading={loading}
                        block
                        size="large"
                    >
                        Write
                    </Button>

                    {result && (
                        <Card title="Generated Text" className={styles.resultCard} ref={resultRef}>
                            <div className={styles.result}>{result}</div>
                        </Card>
                    )}
                </Space>
            </div>
        </div>
    );
}
