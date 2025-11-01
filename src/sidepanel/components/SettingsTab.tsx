import { useState, useEffect } from 'react';
import { Input, Select, Switch, Slider, Button, Typography, Space, Card, Divider, message, Radio } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import { UserPreferences, MascotVariant, SpeechEngine } from '@/utils/UserPreferences';
import { Mascot } from '@/components/Mascot';
import styles from './SettingsTab.module.css';

const { Title, Paragraph, Text } = Typography;
const { TextArea } = Input;

export default function SettingsTab() {
    const userPrefs = UserPreferences.getInstance();
    
    // User Identity
    const [userName, setUserName] = useState(userPrefs.get('userName'));
    
    // Visual
    const [mascot, setMascot] = useState<MascotVariant>(userPrefs.get('mascot'));
    
    // AI Persona
    const [persona, setPersona] = useState(userPrefs.get('persona') || '');
    
    // Speech
    const [speechEngine, setSpeechEngine] = useState<SpeechEngine>(userPrefs.get('speechEngine'));
    const [kokoroVoice, setKokoroVoice] = useState(userPrefs.get('kokoroVoice'));
    const [browserVoice, setBrowserVoice] = useState(userPrefs.get('browserVoice'));
    const [speechRate, setSpeechRate] = useState(userPrefs.get('speechRate'));
    const [speechPitch, setSpeechPitch] = useState(userPrefs.get('speechPitch'));
    const [speechVolume, setSpeechVolume] = useState(userPrefs.get('speechVolume'));
    
    // Notifications
    const [enableNotifications, setEnableNotifications] = useState(userPrefs.get('enableNotifications'));
    const [enableVoiceAlerts, setEnableVoiceAlerts] = useState(userPrefs.get('enableVoiceAlerts'));
    const [notificationSound, setNotificationSound] = useState(userPrefs.get('notificationSound'));
    
    // AI Settings
    const [summarizerType, setSummarizerType] = useState(userPrefs.get('summarizerType'));
    const [summarizerLength, setSummarizerLength] = useState(userPrefs.get('summarizerLength'));
    const [summarizerLargeContentStrategy, setSummarizerLargeContentStrategy] = useState(userPrefs.get('summarizerLargeContentStrategy'));
    const [translatorTargetLanguage, setTranslatorTargetLanguage] = useState(userPrefs.get('translatorTargetLanguage'));
    const [transcriptionLanguage, setTranscriptionLanguage] = useState(userPrefs.get('transcriptionLanguage'));
    const [explainPrompt, setExplainPrompt] = useState(userPrefs.get('explainPrompt'));
    
    // Assistant Control
    const [assistantEnabled, setAssistantEnabled] = useState(userPrefs.get('assistantEnabled'));
    
    const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const loadVoices = () => {
            const voices = window.speechSynthesis.getVoices();
            setAvailableVoices(voices);
        };

        loadVoices();
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await userPrefs.update({
                userName,
                mascot,
                persona: persona || null,
                speechEngine,
                kokoroVoice,
                browserVoice,
                speechRate,
                speechPitch,
                speechVolume,
                enableNotifications,
                enableVoiceAlerts,
                notificationSound,
                summarizerType,
                summarizerLength,
                summarizerLargeContentStrategy,
                translatorTargetLanguage,
                transcriptionLanguage,
                explainPrompt,
                assistantEnabled,
            });
            message.success('Settings saved successfully!');
        } catch (error) {
            message.error('Failed to save settings');
            console.error(error);
        } finally {
            setSaving(false);
        }
    };

    const handleReset = async () => {
        try {
            await userPrefs.reset();
            // Reload all values
            setUserName(userPrefs.get('userName'));
            setMascot(userPrefs.get('mascot'));
            setPersona(userPrefs.get('persona') || '');
            setSpeechEngine(userPrefs.get('speechEngine'));
            setKokoroVoice(userPrefs.get('kokoroVoice'));
            setBrowserVoice(userPrefs.get('browserVoice'));
            setSpeechRate(userPrefs.get('speechRate'));
            setSpeechPitch(userPrefs.get('speechPitch'));
            setSpeechVolume(userPrefs.get('speechVolume'));
            setEnableNotifications(userPrefs.get('enableNotifications'));
            setEnableVoiceAlerts(userPrefs.get('enableVoiceAlerts'));
            setNotificationSound(userPrefs.get('notificationSound'));
            setSummarizerType(userPrefs.get('summarizerType'));
            setSummarizerLength(userPrefs.get('summarizerLength'));
            setSummarizerLargeContentStrategy(userPrefs.get('summarizerLargeContentStrategy'));
            setTranslatorTargetLanguage(userPrefs.get('translatorTargetLanguage'));
            setTranscriptionLanguage(userPrefs.get('transcriptionLanguage'));
            setExplainPrompt(userPrefs.get('explainPrompt'));
            setAssistantEnabled(userPrefs.get('assistantEnabled'));
            message.success('Settings reset to defaults');
        } catch (error) {
            message.error('Failed to reset settings');
            console.error(error);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Title level={4}>Settings</Title>
                <Paragraph type="secondary">
                    Customize your AI assistant experience
                </Paragraph>
            </div>

            <div className={styles.content}>
                <Space direction="vertical" size="large" style={{ width: '100%' }}>
                    {/* User Identity */}
                    <Card title="User Identity" size="small">
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <div>
                                <Text strong>User Name</Text>
                                <Input
                                    placeholder="Your name..."
                                    value={userName}
                                    onChange={(e) => setUserName(e.target.value)}
                                    style={{ marginTop: 8 }}
                                />
                            </div>
                        </Space>
                    </Card>

                    {/* Visual Preferences */}
                    <Card title="Visual Preferences" size="small">
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <div>
                                <Text strong>Mascot</Text>
                                <Radio.Group value={mascot} onChange={(e) => setMascot(e.target.value)} style={{ marginTop: 8, display: 'block' }}>
                                    <Space direction="horizontal" size="small">
                                        <div className={`${styles.mascotOption} ${mascot === 'yellow' ? styles.selected : ''}`} onClick={() => setMascot('yellow')}>
                                            <Mascot variant="yellow" size="small" />
                                            <Radio value="yellow">Yellow</Radio>
                                        </div>
                                        <div className={`${styles.mascotOption} ${mascot === 'blue' ? styles.selected : ''}`} onClick={() => setMascot('blue')}>
                                            <Mascot variant="blue" size="small" />
                                            <Radio value="blue">Blue</Radio>
                                        </div>
                                        <div className={`${styles.mascotOption} ${mascot === 'pink' ? styles.selected : ''}`} onClick={() => setMascot('pink')}>
                                            <Mascot variant="pink" size="small" />
                                            <Radio value="pink">Pink</Radio>
                                        </div>
                                    </Space>
                                </Radio.Group>
                            </div>
                        </Space>
                    </Card>

                    {/* AI Persona */}
                    <Card title="AI Persona" size="small">
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <div>
                                <Text strong>Persona</Text>
                                <TextArea
                                    rows={3}
                                    placeholder="Define AI response style..."
                                    value={persona}
                                    onChange={(e) => setPersona(e.target.value)}
                                    maxLength={500}
                                    showCount
                                    style={{ marginTop: 8 }}
                                />
                            </div>
                        </Space>
                    </Card>

                    {/* Speech Settings */}
                    <Card title="Speech Settings" size="small">
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <div>
                                <Text strong>Speech Engine</Text>
                                <Select
                                    value={speechEngine}
                                    onChange={setSpeechEngine}
                                    style={{ width: '100%', marginTop: 8 }}
                                    options={[
                                        { label: 'Kokoro (High Quality)', value: 'kokoro' },
                                        { label: 'Browser (Fast)', value: 'browser' },
                                    ]}
                                />
                            </div>

                            {speechEngine === 'kokoro' ? (
                                <div>
                                    <Text strong>Kokoro Voice</Text>
                                    <Select
                                        value={kokoroVoice}
                                        onChange={setKokoroVoice}
                                        style={{ width: '100%', marginTop: 8 }}
                                        options={[
                                            { label: 'Bella (Female)', value: 'af_bella' },
                                            { label: 'Sarah (Female)', value: 'af_sarah' },
                                            { label: 'Adam (Male)', value: 'am_adam' },
                                            { label: 'Michael (Male)', value: 'am_michael' },
                                        ]}
                                    />
                                </div>
                            ) : (
                                <div>
                                    <Text strong>Browser Voice</Text>
                                    <Select
                                        value={browserVoice}
                                        onChange={setBrowserVoice}
                                        style={{ width: '100%', marginTop: 8 }}
                                        options={availableVoices.map((v) => ({
                                            label: `${v.name} (${v.lang})`,
                                            value: v.name,
                                        }))}
                                    />
                                </div>
                            )}

                            <div>
                                <Text>Speech Rate: {speechRate}</Text>
                                <Slider
                                    min={0.1}
                                    max={2}
                                    step={0.1}
                                    value={speechRate}
                                    onChange={setSpeechRate}
                                />
                            </div>

                            <div>
                                <Text>Speech Pitch: {speechPitch}</Text>
                                <Slider
                                    min={0}
                                    max={2}
                                    step={0.1}
                                    value={speechPitch}
                                    onChange={setSpeechPitch}
                                />
                            </div>

                            <div>
                                <Text>Speech Volume: {speechVolume}</Text>
                                <Slider
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    value={speechVolume}
                                    onChange={setSpeechVolume}
                                />
                            </div>
                        </Space>
                    </Card>

                    {/* Notifications */}
                    <Card title="Notifications" size="small">
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <div className={styles.switchRow}>
                                <Text>Enable Notifications</Text>
                                <Switch checked={enableNotifications} onChange={setEnableNotifications} />
                            </div>
                            <div className={styles.switchRow}>
                                <Text>Enable Voice Alerts</Text>
                                <Switch checked={enableVoiceAlerts} onChange={setEnableVoiceAlerts} />
                            </div>
                            <div className={styles.switchRow}>
                                <Text>Notification Sound</Text>
                                <Switch checked={notificationSound} onChange={setNotificationSound} />
                            </div>
                        </Space>
                    </Card>

                    {/* AI Action Settings */}
                    <Card title="AI Action Settings" size="small">
                        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                            <div>
                                <Text strong>Default Summarizer Type</Text>
                                <Select
                                    value={summarizerType}
                                    onChange={setSummarizerType}
                                    style={{ width: '100%', marginTop: 8 }}
                                    options={[
                                        { label: 'TLDR', value: 'tldr' },
                                        { label: 'Key Points', value: 'key-points' },
                                        { label: 'Teaser', value: 'teaser' },
                                        { label: 'Headline', value: 'headline' },
                                    ]}
                                />
                            </div>

                            <div>
                                <Text strong>Default Summarizer Length</Text>
                                <Select
                                    value={summarizerLength}
                                    onChange={setSummarizerLength}
                                    style={{ width: '100%', marginTop: 8 }}
                                    options={[
                                        { label: 'Short', value: 'short' },
                                        { label: 'Medium', value: 'medium' },
                                        { label: 'Long', value: 'long' },
                                    ]}
                                />
                            </div>

                            <div>
                                <Text strong>Large Content Strategy</Text>
                                <Select
                                    value={summarizerLargeContentStrategy}
                                    onChange={setSummarizerLargeContentStrategy}
                                    style={{ width: '100%', marginTop: 8 }}
                                    options={[
                                        { label: 'Merge', value: 'merge' },
                                        { label: 'Join', value: 'join' },
                                    ]}
                                />
                            </div>

                            <div>
                                <Text strong>Default Translation Target Language</Text>
                                <Input
                                    placeholder="e.g., en, es, fr..."
                                    value={translatorTargetLanguage}
                                    onChange={(e) => setTranslatorTargetLanguage(e.target.value)}
                                    style={{ marginTop: 8 }}
                                />
                            </div>

                            <div>
                                <Text strong>Audio Transcription Language</Text>
                                <Select
                                    showSearch
                                    placeholder="Select language for voice transcription"
                                    value={transcriptionLanguage}
                                    onChange={setTranscriptionLanguage}
                                    style={{ width: '100%', marginTop: 8 }}
                                    options={Object.entries({
                                        en: 'English', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese',
                                        it: 'Italian', nl: 'Dutch', pl: 'Polish', ru: 'Russian', ja: 'Japanese',
                                        zh: 'Chinese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish',
                                        vi: 'Vietnamese', th: 'Thai', id: 'Indonesian', uk: 'Ukrainian', cs: 'Czech',
                                        ro: 'Romanian', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
                                    }).map(([code, name]) => ({ label: name, value: code }))}
                                />
                                <Paragraph type="secondary" style={{ fontSize: '12px', marginTop: 4, marginBottom: 0 }}>
                                    Language used for audio-to-text transcription in recordings
                                </Paragraph>
                            </div>

                            <div>
                                <Text strong>Explain Prompt</Text>
                                <TextArea
                                    rows={2}
                                    placeholder="Custom prompt for explain feature..."
                                    value={explainPrompt}
                                    onChange={(e) => setExplainPrompt(e.target.value)}
                                    style={{ marginTop: 8 }}
                                />
                            </div>
                        </Space>
                    </Card>

                    {/* Assistant Control */}
                    <Card title="Assistant Control" size="small">
                        <div className={styles.switchRow}>
                            <Text>Assistant Enabled</Text>
                            <Switch checked={assistantEnabled} onChange={setAssistantEnabled} />
                        </div>
                    </Card>

                    <Divider />

                    {/* Action Buttons */}
                    <Space direction="horizontal" size="middle" style={{ width: '100%' }}>
                        <Button
                            type="primary"
                            icon={<SaveOutlined />}
                            onClick={handleSave}
                            loading={saving}
                            size="large"
                            block
                        >
                            Save Settings
                        </Button>
                        <Button
                            icon={<ReloadOutlined />}
                            onClick={handleReset}
                            size="large"
                        >
                            Reset
                        </Button>
                    </Space>
                </Space>
            </div>
        </div>
    );
}
