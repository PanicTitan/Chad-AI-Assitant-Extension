import { BellOutlined, ClockCircleOutlined, EyeInvisibleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Sender } from '@ant-design/x';
import { App, Divider, Flex, Select, Space, Switch, theme, TimePicker, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import styles from './SupervisorControls.module.css';
import dayjs, { Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

const { Text } = Typography;

export interface SupervisorConfig {
    task: string;
    notificationType: 'notification' | 'voice';
    checkInterval: 5 | 10 | 15 | 20 | 30 | 45 | 60;
    rigor: 'low' | 'medium' | 'high';
    timerEnabled: boolean;
    timerMinutes?: number;
    pauseOnWindowBlur: boolean;
    idleCheckEnabled: boolean;
    idleCheckInterval: 1 | 5 | 10;
    keepSystemAwake: boolean;
}

interface SupervisorControlsProps {
    onStart: (config: SupervisorConfig) => void;
    initialConfig?: Partial<SupervisorConfig>;
    onRecordingStart?: () => void;
    onRecordingStop?: () => void;
    transcribedText?: string; // Text from audio transcription
    isTranscribing?: boolean; // Loading state for transcription
}

export const SupervisorControls: React.FC<SupervisorControlsProps> = ({ 
    onStart, 
    initialConfig,
    onRecordingStart,
    onRecordingStop,
    transcribedText,
    isTranscribing
}) => {
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const [task, setTask] = useState<string>(initialConfig?.task || '');
    const [notificationType, setNotificationType] = useState<'notification' | 'voice'>(
        initialConfig?.notificationType || 'notification'
    );
    const [checkInterval, setCheckInterval] = useState<5 | 10 | 15 | 20 | 30 | 45 | 60>(initialConfig?.checkInterval || 10);
    const [rigor, setRigor] = useState<'low' | 'medium' | 'high'>(initialConfig?.rigor || 'medium');
    const [timerEnabled, setTimerEnabled] = useState<boolean>(initialConfig?.timerEnabled ?? false);
    const [timerMinutes, setTimerMinutes] = useState<number>(initialConfig?.timerMinutes || 25);
    const [pauseOnWindowBlur, setPauseOnWindowBlur] = useState<boolean>(initialConfig?.pauseOnWindowBlur ?? true);
    const [idleCheckEnabled, setIdleCheckEnabled] = useState<boolean>(initialConfig?.idleCheckEnabled ?? true);
    const [idleCheckInterval, setIdleCheckInterval] = useState<1 | 5 | 10>(initialConfig?.idleCheckInterval || 5);
    const [keepSystemAwake, setKeepSystemAwake] = useState<boolean>(initialConfig?.keepSystemAwake ?? true);
    const [recording, setRecording] = useState<boolean>(false);

    // Update form when initialConfig changes (when clicking a task from history)
    useEffect(() => {
        if (initialConfig) {
            setTask(initialConfig.task || '');
            setNotificationType(initialConfig.notificationType || 'notification');
            setCheckInterval(initialConfig.checkInterval || 10);
            setRigor(initialConfig.rigor || 'medium');
            setTimerEnabled(initialConfig.timerEnabled ?? false);
            setTimerMinutes(initialConfig.timerMinutes || 25);
            setPauseOnWindowBlur(initialConfig.pauseOnWindowBlur ?? true);
            setIdleCheckEnabled(initialConfig.idleCheckEnabled ?? true);
            setIdleCheckInterval(initialConfig.idleCheckInterval || 5);
            setKeepSystemAwake(initialConfig.keepSystemAwake ?? true);
        }
    }, [initialConfig]);

    // Update task when transcription completes
    useEffect(() => {
        if (transcribedText) {
            setTask(transcribedText);
        }
    }, [transcribedText]);

    const handleSubmit = () => {
        if (task.trim()) {
            onStart({
                task: task.trim(),
                notificationType,
                checkInterval,
                rigor,
                timerEnabled,
                timerMinutes: timerEnabled ? timerMinutes : undefined,
                pauseOnWindowBlur,
                idleCheckEnabled,
                idleCheckInterval,
                keepSystemAwake,
            });
            if (!initialConfig) {
                setTask('');
            }
        }
    };

    const handleTimeChange = (time: Dayjs | null) => {
        if (time) {
            const hours = time.hour();
            const minutes = time.minute();
            setTimerMinutes(hours * 60 + minutes);
        }
    };

    const handleNotificationTypeChange = async (value: 'notification' | 'voice') => {
        // If switching to notification mode, request permission
        if (value === 'notification') {
            try {
                const permission = await Notification.requestPermission();
                
                if (permission === 'granted') {
                    setNotificationType(value);
                    message.success('Notification permission granted');
                } else if (permission === 'denied') {
                    message.error('Notification permission denied. Please enable in browser settings.');
                    // Keep current setting (don't switch)
                } else {
                    message.warning('Notification permission not granted');
                    // Keep current setting
                }
            } catch (error) {
                console.error('[Notifications] Failed to request permission:', error);
                message.error('Failed to request notification permission');
            }
        } else {
            // Voice mode doesn't need special permission
            setNotificationType(value);
        }
    };

    const getRigorColor = () => {
        switch (rigor) {
            case 'low':
                return token.colorSuccess;
            case 'medium':
                return token.colorWarning;
            case 'high':
                return token.colorError;
            default:
                return token.colorPrimary;
        }
    };

    return (
        <Flex vertical gap="middle" style={{ width: '100%' }}>
            {/* Input first with speech */}
            <Sender
                value={isTranscribing ? "Transcribing ..." : task}
                onChange={(value) => {
                    // console.log("value:", value);
                    setTask(value);
                }}
                autoSize={{ minRows: 1, maxRows: 3 }}
                placeholder="What do you want to focus on?"
                loading={isTranscribing}
                readOnly={isTranscribing}
                disabled={isTranscribing}
                onSubmit={(message) => {
                    // console.log("message:", message);
                    handleSubmit();
                }}
                allowSpeech={{
                    recording,
                    onRecordingChange: async (isRecording) => {
                        // console.log("isRecording:", isRecording);
                        setRecording(isRecording);
                        
                        // Notify parent component
                        if (isRecording && onRecordingStart) {
                            onRecordingStart();
                        } else if (!isRecording && onRecordingStop) {
                            onRecordingStop();
                        }
                    },
                }}
                style={{
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadiusLG,
                }}
            />

            {/* Options bar below input */}
            <Flex
                justify="space-between"
                align="center"
                wrap="wrap"
                gap="small"
                style={{
                    padding: '8px 12px',
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorder}`,
                }}
            >
                <Space size="middle" wrap>
                    <Space size="small">
                        <BellOutlined style={{ color: token.colorTextSecondary }} />
                        <Select
                            value={notificationType}
                            onChange={handleNotificationTypeChange}
                            size="small"
                            variant="borderless"
                            options={[
                                { value: 'notification', label: 'Notification' },
                                { value: 'voice', label: 'Voice' },
                            ]}
                        />
                    </Space>

                    <Divider type="vertical" />

                    <Space size="small">
                        <Text type="secondary" style={{ fontSize: 12 }}>Check</Text>
                        <Select
                            value={checkInterval}
                            onChange={setCheckInterval}
                            size="small"
                            variant="borderless"
                            options={[
                                { value: 5, label: '5s' },
                                { value: 10, label: '10s' },
                                { value: 15, label: '15s' },
                                { value: 20, label: '20s' },
                                { value: 30, label: '30s' },
                                { value: 45, label: '45s' },
                                { value: 60, label: '60s' },
                                { value: 300, label: '5m' },
                            ]}
                        />
                    </Space>

                    <Divider type="vertical" />

                    <Space size="small" align="center">
                        <Text type="secondary" style={{ fontSize: 12 }}>Rigor</Text>
                        <Select
                            value={rigor}
                            onChange={setRigor}
                            size="small"
                            variant="borderless"
                            options={[
                                { value: 'low', label: 'Low' },
                                { value: 'medium', label: 'Medium' },
                                { value: 'high', label: 'High' },
                            ]}
                        />
                        <div
                            className={styles.rigorIndicator}
                            style={{ backgroundColor: getRigorColor() }}
                        />
                    </Space>
                </Space>

                <Space size="middle" wrap>
                    <Space size="small">
                        <ClockCircleOutlined style={{ color: token.colorTextSecondary }} />
                        <Switch
                            size="small"
                            checked={timerEnabled}
                            onChange={setTimerEnabled}
                        />
                        {timerEnabled && (
                            <TimePicker
                                size="small"
                                format="HH:mm"
                                showNow={false}
                                value={dayjs().hour(Math.floor(timerMinutes / 60)).minute(timerMinutes % 60)}
                                onChange={handleTimeChange}
                                placeholder="Set time"
                                style={{ width: 90 }}
                            />
                        )}
                    </Space>

                    <Divider type="vertical" />

                    <Space size="small">
                        <Text type="secondary" style={{ fontSize: 12 }}>Pause on blur</Text>
                        <Switch
                            size="small"
                            checked={pauseOnWindowBlur}
                            onChange={setPauseOnWindowBlur}
                        />
                    </Space>

                    <Divider type="vertical" />

                    <Space size="small">
                        <EyeInvisibleOutlined style={{ color: token.colorTextSecondary }} />
                        <Text type="secondary" style={{ fontSize: 12 }}>Idle check</Text>
                        <Switch
                            size="small"
                            checked={idleCheckEnabled}
                            onChange={setIdleCheckEnabled}
                        />
                        {idleCheckEnabled && (
                            <Select
                                value={idleCheckInterval}
                                onChange={setIdleCheckInterval}
                                size="small"
                                variant="borderless"
                                options={[
                                    { value: 1, label: '1 min' },
                                    { value: 5, label: '5 min' },
                                    { value: 10, label: '10 min' },
                                ]}
                                style={{ width: 70 }}
                            />
                        )}
                    </Space>

                    <Divider type="vertical" />

                    <Space size="small">
                        <ThunderboltOutlined style={{ color: token.colorTextSecondary }} />
                        <Text type="secondary" style={{ fontSize: 12 }}>Keep awake</Text>
                        <Switch
                            size="small"
                            checked={keepSystemAwake}
                            onChange={setKeepSystemAwake}
                        />
                    </Space>
                </Space>
            </Flex>
        </Flex>
    );
};
