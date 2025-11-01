import { CheckCircleOutlined, FireOutlined, TrophyOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Card, Flex, Progress, Statistic, theme, Timeline, Typography } from 'antd';
import React from 'react';
import styles from './SupervisorStats.module.css';

const { Text, Title, Paragraph } = Typography;

export interface AlertEvent {
    time: Date;
    reason: string;
}

export interface TaskStats {
    task: string;
    totalTime: number; // in seconds
    focusedTime: number; // in seconds
    alertCount: number;
    activitySummary: string; // AI-generated summary of what user was doing
    distractionSummary: string; // AI-generated summary of distractions
    alerts?: AlertEvent[]; // Timeline of alerts
}

interface SupervisorStatsProps {
    stats: TaskStats;
    onNewTask: () => void;
}

export const SupervisorStats: React.FC<SupervisorStatsProps> = ({ stats, onNewTask }) => {
    const { token } = theme.useToken();

    const formatTime = (seconds: number): string => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hrs > 0) {
            return `${hrs}h ${mins}m`;
        }
        if (mins > 0) {
            return `${mins}m ${secs}s`;
        }
        return `${secs}s`;
    };

    const focusPercentage = stats.totalTime > 0 
        ? Math.round((stats.focusedTime / stats.totalTime) * 100) 
        : 0;

    const getFocusGrade = (): { color: string; label: string; icon: React.ReactNode } => {
        if (focusPercentage >= 90) {
            return { color: token.colorSuccess, label: 'Excellent!', icon: <TrophyOutlined /> };
        } else if (focusPercentage >= 70) {
            return { color: token.colorSuccess, label: 'Great!', icon: <CheckCircleOutlined /> };
        } else if (focusPercentage >= 50) {
            return { color: token.colorWarning, label: 'Good', icon: <FireOutlined /> };
        } else {
            return { color: token.colorError, label: 'Needs Improvement', icon: <WarningOutlined /> };
        }
    };

    const grade = getFocusGrade();

    return (
        <Flex vertical gap="small" className={styles.container} style={{ width: '100%' }}>
            {/* Header */}
            <Flex vertical align="center" gap="small">
                <div style={{ fontSize: 40, color: grade.color }}>
                    {grade.icon}
                </div>
                <Title level={4} style={{ margin: 0, color: grade.color }}>
                    {grade.label}
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>Task Completed</Text>
            </Flex>

            {/* Focus percentage - more compact */}
            <Flex justify="center" style={{ padding: '8px 0' }}>
                <Progress
                    type="circle"
                    percent={focusPercentage}
                    size={90}
                    strokeColor={grade.color}
                    format={(percent) => (
                        <Flex vertical align="center">
                            <Text style={{ fontSize: 22, fontWeight: 600 }}>{percent}%</Text>
                            <Text type="secondary" style={{ fontSize: 10 }}>Focused</Text>
                        </Flex>
                    )}
                />
            </Flex>

            {/* Stats grid - more compact */}
            <Flex gap="small" wrap="wrap" justify="space-around" style={{ padding: '0 8px' }}>
                <Card
                    //   bordered={false}
                    variant='borderless'
                    size="small"
                    className={styles.statCard}
                    style={{
                        background: token.colorBgContainer,
                        flex: 1,
                        minWidth: 100,
                    }}
                >
                    <Statistic
                        title="Total"
                        value={formatTime(stats.totalTime)}
                        valueStyle={{ fontSize: 16, fontWeight: 600 }}
                    />
                </Card>
                <Card
                    //   bordered={false}
                    variant='borderless'
                    size="small"
                    className={styles.statCard}
                    style={{
                        background: token.colorBgContainer,
                        flex: 1,
                        minWidth: 100,
                    }}
                >
                    <Statistic
                        title="Focused"
                        value={formatTime(stats.focusedTime)}
                        valueStyle={{ fontSize: 16, fontWeight: 600, color: token.colorSuccess }}
                    />
                </Card>
                <Card
                    //   bordered={false}
                    variant='borderless'
                    size="small"
                    className={styles.statCard}
                    style={{
                        background: token.colorBgContainer,
                        flex: 1,
                        minWidth: 100,
                    }}
                >
                    <Statistic
                        title="Alerts"
                        value={stats.alertCount}
                        valueStyle={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: stats.alertCount > 0 ? token.colorError : token.colorSuccess
                        }}
                    />
                </Card>
            </Flex>
            {/* Summaries - more compact */}
            <Flex vertical gap="small">
                <Card
                    //   bordered={false}
                    variant='borderless'
                    size="small"
                    style={{
                        background: token.colorBgContainer,
                        borderRadius: token.borderRadiusLG,
                    }}
                >
                    <Flex vertical gap="small">
                        <Text strong style={{ color: token.colorSuccess, fontSize: 13 }}>✓ Activity Summary</Text>
                        <Paragraph
                            type="secondary"
                            style={{ margin: 0, fontSize: 12 }}
                            ellipsis={{ rows: 2, expandable: true }}
                        >
                            {stats.activitySummary || 'User maintained focus on the task throughout the session.'}
                        </Paragraph>
                    </Flex>
                </Card>

                {stats.distractionSummary && (
                    <Card
                        // bordered={false}
                        variant='borderless'
                        size="small"
                        style={{
                            background: token.colorBgContainer,
                            borderRadius: token.borderRadiusLG,
                        }}
                    >
                        <Flex vertical gap="small">
                            <Text strong style={{ color: token.colorWarning, fontSize: 13 }}>! Distraction Analysis</Text>
                            <Paragraph
                                type="secondary"
                                style={{ margin: 0, fontSize: 12 }}
                                ellipsis={{ rows: 2, expandable: true }}
                            >
                                {stats.distractionSummary}
                            </Paragraph>
                        </Flex>
                    </Card>
                )}

                {/* Alert Timeline */}
                {stats.alerts && stats.alerts.length > 0 && (
                    <Card
                        // bordered={false}
                        variant='borderless'
                        size="small"
                        style={{
                            background: token.colorBgContainer,
                            borderRadius: token.borderRadiusLG,
                            maxHeight: 150,
                            overflowY: 'auto',
                        }}
                    >
                        <Flex vertical gap="small">
                            <Text strong style={{ fontSize: 13 }}>Alert Timeline</Text>
                            <Timeline
                                mode="left"
                                items={stats.alerts.map((alert) => ({
                                    color: token.colorError,
                                    label: alert.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                    children: <Text style={{ fontSize: 11 }}>{alert.reason || 'Off-task detected'}</Text>,
                                }))}
                            />
                        </Flex>
                    </Card>
                )}
            </Flex>
            {/* Action button */}
            <Button
                type="primary"
                size="middle"
                onClick={onNewTask}
                block
                style={{ borderRadius: token.borderRadiusLG, marginTop: 8 }}
            >
                Start New Task
            </Button>
        </Flex>
    );
};
