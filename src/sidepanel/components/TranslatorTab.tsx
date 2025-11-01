import { useState, useRef, useEffect } from 'react';
import { Input, Button, Select, Typography, Space, Card, message } from 'antd';
import { TranslationOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { TranslatorEx } from '@/utils/built-in-ai-ex/TranslatorEx';
import { UserPreferences } from '@/utils/UserPreferences';
import AudioTranscriptionRecorder from './AudioTranscriptionRecorder';
import styles from './TranslatorTab.module.css';

const { Title, Paragraph } = Typography;
const { TextArea } = Input;

const LANGUAGES = [
    { label: '🔍 Auto-detect', value: 'auto' },
    { label: 'English', value: 'en' },
    { label: 'Spanish', value: 'es' },
    { label: 'French', value: 'fr' },
    { label: 'German', value: 'de' },
    { label: 'Italian', value: 'it' },
    { label: 'Portuguese', value: 'pt' },
    { label: 'Russian', value: 'ru' },
    { label: 'Japanese', value: 'ja' },
    { label: 'Korean', value: 'ko' },
    { label: 'Chinese (Simplified)', value: 'zh' },
    { label: 'Chinese (Traditional)', value: 'zh-Hant' },
    { label: 'Arabic', value: 'ar' },
    { label: 'Hindi', value: 'hi' },
    { label: 'Turkish', value: 'tr' },
    { label: 'Dutch', value: 'nl' },
    { label: 'Polish', value: 'pl' },
    { label: 'Swedish', value: 'sv' },
    { label: 'Danish', value: 'da' },
    { label: 'Norwegian', value: 'no' },
    { label: 'Finnish', value: 'fi' },
];

export default function TranslatorTab() {
    const userPrefs = UserPreferences.getInstance();
    const [text, setText] = useState('');
    const [result, setResult] = useState('');
    const [loading, setLoading] = useState(false);
    const [detecting, setDetecting] = useState(false);
    const [detectedLanguage, setDetectedLanguage] = useState<string>('');
    const translatorRef = useRef<TranslatorEx | null>(null);
    
    const [sourceLang, setSourceLang] = useState<string>('auto');
    const [targetLang, setTargetLang] = useState<string>(userPrefs.get('translatorTargetLanguage'));

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (translatorRef.current) {
                translatorRef.current.destroy();
                translatorRef.current = null;
            }
        };
    }, []);

    const handleDetect = async () => {
        if (!text.trim()) {
            message.warning('Please enter text to detect language');
            return;
        }

        setDetecting(true);
        try {
            if ('translation' in self && (self as any).translation.createDetector) {
                const detector = await (self as any).translation.createDetector();
                const results = await detector.detect(text);
                if (results.length > 0) {
                    const detected = results[0].detectedLanguage;
                    setDetectedLanguage(detected);
                    setSourceLang(detected);
                    message.success(`Detected language: ${detected}`);
                }
            } else {
                message.info('Language detection API not available in this browser');
            }
        } catch (error: any) {
            message.error(`Error detecting language: ${error.message}`);
            console.error(error);
        } finally {
            setDetecting(false);
        }
    };

    const handleTranslate = async () => {
        if (!text.trim()) {
            message.warning('Please enter text to translate');
            return;
        }

        if (sourceLang === targetLang && sourceLang !== 'auto') {
            message.warning('Source and target languages cannot be the same');
            return;
        }

        setLoading(true);
        setResult('');

        try {
            let detectedSource = sourceLang;
            
            // Auto-detect if selected
            if (sourceLang === 'auto') {
                const detection = await TranslatorEx.autoDetect(text);
                if (detection && detection.detectedLanguage) {
                    detectedSource = detection.detectedLanguage;
                    setDetectedLanguage(detectedSource);
                    message.info(`Detected language: ${detectedSource}`);
                } else {
                    message.error('Could not detect language');
                    setLoading(false);
                    return;
                }
            }

            if (detectedSource === targetLang) {
                message.warning('Source and target languages are the same');
                setLoading(false);
                return;
            }

            // Create translator with detected/selected source language
            const options: any = {
                sourceLanguage: detectedSource,
                targetLanguage: targetLang,
            };
            
            if (!translatorRef.current) {
                translatorRef.current = await TranslatorEx.create(options);
            }

            let fullResult = '';
            const stream = translatorRef.current.translateStreaming(text);

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
                <Title level={4}>Translator</Title>
                <Paragraph type="secondary">
                    Translate text between languages
                </Paragraph>
            </div>

            <div className={styles.content}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    <div>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Typography.Text strong>Text to Translate</Typography.Text>
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
                            placeholder="Type or paste the text to translate..."
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            style={{ marginTop: 8 }}
                        />
                    </div>

                    <Space direction="horizontal" style={{ width: '100%' }} size="middle">
                        <div style={{ flex: 1 }}>
                            <Typography.Text strong>Source Language</Typography.Text>
                            <Select
                                value={sourceLang}
                                onChange={setSourceLang}
                                style={{ width: '100%', marginTop: 8 }}
                                options={LANGUAGES}
                                showSearch
                                filterOption={(input, option) =>
                                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                            />
                        </div>

                        <div style={{ flex: 1 }}>
                            <Typography.Text strong>Target Language</Typography.Text>
                            <Select
                                value={targetLang}
                                onChange={setTargetLang}
                                style={{ width: '100%', marginTop: 8 }}
                                options={LANGUAGES.filter(lang => lang.value !== 'auto')}
                                showSearch
                                filterOption={(input, option) =>
                                    (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                            />
                        </div>
                    </Space>

                    {sourceLang === 'auto' && (
                        <Button
                            icon={<ThunderboltOutlined />}
                            onClick={handleDetect}
                            loading={detecting}
                            block
                        >
                            Auto-Detect Language
                        </Button>
                    )}

                    {detectedLanguage && (
                        <Paragraph type="success">
                            Detected language: <strong>{detectedLanguage}</strong>
                        </Paragraph>
                    )}

                    <Button
                        type="primary"
                        icon={<TranslationOutlined />}
                        onClick={handleTranslate}
                        loading={loading}
                        block
                        size="large"
                    >
                        Translate
                    </Button>

                    {result && (
                        <Card title="Translation" className={styles.resultCard}>
                            <div className={styles.result}>{result}</div>
                        </Card>
                    )}
                </Space>
            </div>
        </div>
    );
}
