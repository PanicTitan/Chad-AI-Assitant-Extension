import { useState, useRef, useEffect } from 'react';
import { Input, Button, Select, Collapse, Typography, Space, Card, message, Tooltip } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import { RewriterEx } from '@/utils/built-in-ai-ex/RewriterEx';
import AudioTranscriptionRecorder from './AudioTranscriptionRecorder';
import styles from './RewriterTab.module.css';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

export default function RewriterTab() {
    const [text, setText] = useState('');
    const [context, setContext] = useState('');
    const [rewriteContext, setRewriteContext] = useState('');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);
    const rewriterRef = useRef<RewriterEx | null>(null);
    
    const [tone, setTone] = useState<'as-is' | 'more-formal' | 'more-casual'>('as-is');
    const [length, setLength] = useState<'as-is' | 'shorter' | 'longer'>('as-is');
    const [format, setFormat] = useState<'as-is' | 'plain-text' | 'markdown'>('as-is');
    const [largeContentStrategy, setLargeContentStrategy] = useState<'merge' | 'summarize' | 'join'>('merge');

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (rewriterRef.current) {
                rewriterRef.current.destroy();
                rewriterRef.current = null;
            }
        };
    }, []);

    const handleRewrite = async () => {
        if (!text.trim()) {
            message.warning('Please enter text to rewrite');
            return;
        }

        setLoading(true);
        setResult('');

        try {
            if (!rewriterRef.current) {
                rewriterRef.current = await RewriterEx.create({
                    tone,
                    length,
                    format,
                    largeContentStrategy,
                });
            }

            // Combine rewrite instructions with context
            const fullContext = rewriteContext 
                ? `${context ? context + '\n\n' : ''}Instructions: ${rewriteContext}`
                : context || undefined;
            
            let fullResult = '';
            const stream = rewriterRef.current.rewriteStreaming(text, {
                context: fullContext,
            });

            for await (const chunk of stream) {
                fullResult += chunk;
                setResult(fullResult);
            }
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
                <Title level={4}>Rewriter</Title>
                <Paragraph type="secondary">
                    Rewrite text with different styles and tones
                </Paragraph>
            </div>

            <div className={styles.content}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Tooltip title="The text that you want the rewriter to process and transform according to your specifications">
                                <Typography.Text strong>Text to Rewrite</Typography.Text>
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
                            rows={4}
                            placeholder="Paste the text you want to rewrite..."
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    <div>
                        <Tooltip title="Shared context to be used by the rewriter that applies generally to all rewriting tasks">
                            <Typography.Text strong>Shared Context (Optional)</Typography.Text>
                        </Tooltip>
                        <TextArea
                            rows={2}
                            placeholder="General context that applies to the text..."
                            value={context}
                            onChange={(e) => setContext(e.target.value)}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    <div>
                        <Tooltip title="Context to be used for this rewrite task only, providing specific instructions or guidelines for this particular rewriting operation">
                            <Typography.Text strong>Rewrite Instructions (Optional)</Typography.Text>
                        </Tooltip>
                        <TextArea
                            rows={2}
                            placeholder="Specific rewriting instructions..."
                            value={rewriteContext}
                            onChange={(e) => setRewriteContext(e.target.value)}
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
                                { label: 'As Is', value: 'as-is' },
                                { label: 'More Formal', value: 'more-formal' },
                                { label: 'More Casual', value: 'more-casual' },
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
                                { label: 'As Is', value: 'as-is' },
                                { label: 'Shorter', value: 'shorter' },
                                { label: 'Longer', value: 'longer' },
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
                                { label: 'As Is', value: 'as-is' },
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
                        icon={<SyncOutlined />}
                        onClick={handleRewrite}
                        loading={loading}
                        block
                        size="large"
                    >
                        Rewrite
                    </Button>

                    {result && (
                        <Card title="Rewritten Text" className={styles.resultCard}>
                            <div className={styles.result}>{result}</div>
                        </Card>
                    )}
                </Space>
            </div>
        </div>
    );
}
