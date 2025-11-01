import { PauseCircleOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Flex, Progress, Statistic, Tag, theme, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import styles from './SupervisorMonitoring.module.css';

const { Text, Title } = Typography;

export type TaskStatus = 'running' | 'paused' | 'stopped';

export interface MonitoringState {
    task: string;
    status: TaskStatus;
    elapsedTime: number; // in seconds
    nextCheckIn: number; // seconds until next check
    checkInterval: number;
    onFocus: boolean; // is user focused on task?
    alertCount: number;
    timerMinutes?: number; // total task time limit
    pauseOnWindowBlur: boolean;
}

interface SupervisorMonitoringProps {
    initialState: MonitoringState;
    onPause: () => void;
    onResume: () => void;
    onStop: (elapsedTime: number) => void;
    onTimerComplete?: () => void;
}

export const SupervisorMonitoring: React.FC<SupervisorMonitoringProps> = ({
    initialState,
    onPause,
    onResume,
    onStop,
    onTimerComplete,
}) => {
    const { token } = theme.useToken();
    const [state, setState] = useState<MonitoringState>(initialState);
    const [wasPausedManually, setWasPausedManually] = useState(false);
    const [hasTriggerTimerComplete, setHasTriggerTimerComplete] = useState(false);

    // Only update status and alertCount when they change, preserve timer values
    useEffect(() => {
        setState((prev) => ({
            ...prev,
            status: initialState.status,
            alertCount: initialState.alertCount,
        }));
    }, [initialState.status, initialState.alertCount]);

    useEffect(() => {
        if (state.status !== 'running') return;

        const timer = setInterval(() => {
            setState((prev) => {
                const newElapsedTime = prev.elapsedTime + 1;

                // Check if timer has completed
                if (prev.timerMinutes && newElapsedTime >= prev.timerMinutes * 60) {
                    if (!hasTriggerTimerComplete) {
                        setHasTriggerTimerComplete(true)
                        onTimerComplete?.();
                    }
                }

                return {
                    ...prev,
                    elapsedTime: newElapsedTime,
                    nextCheckIn: prev.nextCheckIn > 0 ? prev.nextCheckIn - 1 : prev.checkInterval,
                };
            });
        }, 1000);

        return () => clearInterval(timer);
    }, [state.status, state.checkInterval, onTimerComplete]);

    // Window focus detection - INVERTED: pause on focus, resume on blur
    useEffect(() => {
        if (!state.pauseOnWindowBlur) return;

        const handleFocus = () => {
            // When window gains focus (user is IN the extension), pause if running
            if (state.status === 'running' && !wasPausedManually) {
                onPause();
            }
        };

        const handleBlur = () => {
            // When window loses focus (user is working), resume if it was auto-paused
            if (state.status === 'paused' && !wasPausedManually) {
                onResume();
            }
        };

        window.addEventListener('focus', handleFocus);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('blur', handleBlur);
        };
    }, [state.status, state.pauseOnWindowBlur, wasPausedManually, onPause, onResume]);

    const formatTime = (seconds: number): string => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hrs > 0) {
            return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const getStatusColor = (): string => {
        switch (state.status) {
            case 'running':
                return state.onFocus ? token.colorSuccess : token.colorWarning;
            case 'paused':
                return token.colorInfo;
            case 'stopped':
                return token.colorTextSecondary;
            default:
                return token.colorPrimary;
        }
    };

    const getStatusText = (): string => {
        if (state.status === 'running') {
            return state.onFocus ? 'On Task' : 'Off Task';
        }
        return state.status.charAt(0).toUpperCase() + state.status.slice(1);
    };

    const progressPercent = ((state.checkInterval - state.nextCheckIn) / state.checkInterval) * 100;

    const timeRemaining = state.timerMinutes ? (state.timerMinutes * 60) - state.elapsedTime : undefined;
    const timerProgressPercent = state.timerMinutes ? (state.elapsedTime / (state.timerMinutes * 60)) * 100 : 0;

    return (
        <Flex vertical gap="large" className={styles.container} style={{ width: '100%' }}>
            {/* Task header with description */}
            <Flex vertical gap="small" align="center" style={{ textAlign: 'center' }}>
                <Flex justify="center" align="center" gap="small">
                    <Text type="secondary" style={{ fontSize: 12 }}>Current Task</Text>
                    <Tag color={getStatusColor()} className={styles.statusTag}>
                        {getStatusText()}
                    </Tag>
                </Flex>
                <Title level={3} style={{ margin: 0 }}>{state.task}</Title>
                {state.pauseOnWindowBlur && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        Window is being monitored • Leave to resume
                    </Text>
                )}
            </Flex>

            {/* Timer progress (if enabled) */}
            {state.timerMinutes && (
                <div>
                    <Flex justify="space-between" style={{ marginBottom: 8 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>Task Timer</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {timeRemaining && timeRemaining > 0 ? formatTime(timeRemaining) : 'Time\'s up!'}
                        </Text>
                    </Flex>
                    <Progress
                        percent={timerProgressPercent}
                        showInfo={false}
                        strokeColor={timeRemaining && timeRemaining <= 60 ? token.colorError : token.colorPrimary}
                        trailColor={token.colorBgContainer}
                    />
                </div>
            )}

            {/* Timer stats */}
            <Flex justify="space-around" align="center" className={styles.statsContainer} style={{ background: token.colorBgContainer }}>
                <Statistic
                    title="Elapsed"
                    value={formatTime(state.elapsedTime)}
                    valueStyle={{ fontSize: 20, fontWeight: 500 }}
                />
                <div className={styles.divider} style={{ background: token.colorBorder }} />
                <Statistic
                    title="Next Check"
                    value={state.nextCheckIn}
                    suffix="s"
                    valueStyle={{
                        fontSize: 20,
                        fontWeight: 500,
                        color: state.nextCheckIn <= 3 ? token.colorWarning : undefined
                    }}
                />
                <div className={styles.divider} style={{ background: token.colorBorder }} />
                <Statistic
                    title="Alerts"
                    value={state.alertCount}
                    valueStyle={{
                        fontSize: 20,
                        fontWeight: 500,
                        color: state.alertCount > 0 ? token.colorError : undefined
                    }}
                />
            </Flex>

            {/* Progress bar for next check */}
            <div>
                <Progress
                    percent={progressPercent}
                    showInfo={false}
                    strokeColor={getStatusColor()}
                    trailColor={token.colorBgContainer}
                    className={styles.progress}
                />
            </div>

            {/* Control buttons */}
            <Flex justify="center" gap="middle">
                {state.status === 'running' ? (
                    <Button
                        type="default"
                        size="large"
                        icon={<PauseCircleOutlined />}
                        onClick={() => {
                            setWasPausedManually(true);
                            onPause();
                        }}
                        className={styles.controlButton}
                    >
                        Pause
                    </Button>
                ) : (
                    <Flex
                        vertical
                        align="center"
                        justify="center"
                        style={{
                            padding: '12px 24px',
                            background: 'rgba(0, 0, 0, 0.02)',
                            borderRadius: token.borderRadiusLG,
                            border: `1px dashed ${token.colorBorder}`,
                            minWidth: 200,
                        }}
                    >
                        <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                            ⏸️ Monitoring paused while viewing this page
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11, textAlign: 'center', marginTop: 4 }}>
                            Will auto-resume when you switch tabs
                        </Text>
                    </Flex>
                )}
                <Button
                    id='stop-button'
                    danger
                    size="large"
                    icon={<StopOutlined />}
                    onClick={() => onStop(state.elapsedTime)}
                    className={styles.controlButton}
                >
                    Stop
                </Button>
            </Flex>
        </Flex>
    );
};
