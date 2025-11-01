import { ClockCircleOutlined } from '@ant-design/icons';
import { List, Space, theme, Typography, Tag } from 'antd';
import React from 'react';
import styles from './SupervisorHistory.module.css';
import type { SupervisorConfig } from './SupervisorControls';

const { Text } = Typography;

export interface TaskHistory {
    id: string;
    task: string;
    startTime: Date;
    endTime: Date;
    duration: number; // in seconds
    alertCount: number;
    completed: boolean;
    config: SupervisorConfig; // Store full config for reuse
}

interface SupervisorHistoryProps {
    tasks: TaskHistory[];
    onTaskClick?: (config: SupervisorConfig) => void;
    onTaskStart?: (config: SupervisorConfig) => void;
}

export const SupervisorHistory: React.FC<SupervisorHistoryProps> = ({ tasks, onTaskClick, onTaskStart }) => {
    const { token } = theme.useToken();

    const handleTaskClick = (config: SupervisorConfig, e: React.MouseEvent) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
            // With modifier key, directly start
            onTaskStart?.(config);
        } else {
            // Without modifier, just load settings
            onTaskClick?.(config);
        }
    };

    const formatTime = (seconds: number): string => {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);

        if (hrs > 0) {
            return `${hrs}h ${mins}m`;
        }
        return `${mins}m`;
    };

    const formatDate = (date: Date): string => {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));

        if (hours < 1) {
            const minutes = Math.floor(diff / (1000 * 60));
            return `${minutes}m ago`;
        }
        if (hours < 24) {
            return `${hours}h ago`;
        }
        return date.toLocaleDateString();
    };
    return (
        <div className={styles.container}>
            <Text type="secondary" strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Recent Tasks (Ctrl+Click to start)
            </Text>
            <List
                className={styles.list}
                dataSource={tasks}
                renderItem={(item) => (
                    <List.Item
                        className={styles.listItem}
                        onClick={(e) => handleTaskClick(item.config, e)}
                        style={{
                            background: token.colorBgContainer,
                            borderColor: token.colorBorder,
                            cursor: onTaskClick ? 'pointer' : 'default',
                        }}
                    >
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                            <Text strong ellipsis style={{ maxWidth: '100%' }}>
                                {item.task}
                            </Text>
                            <Space size="small" wrap style={{ fontSize: 12 }}>
                                <Tag color={token.colorPrimary} bordered={false}>
                                    {item.config.checkInterval}s
                                </Tag>
                                <Tag color={
                                    item.config.rigor === 'high' ? 'red' :
                                        item.config.rigor === 'medium' ? 'orange' :
                                            'green'
                                } bordered={false}>
                                    {item.config.rigor}
                                </Tag>
                                {item.config.timerEnabled && (
                                    <Tag color={token.colorInfo} bordered={false}>
                                        ⏰ {item.config.timerMinutes}min
                                    </Tag>
                                )}
                            </Space>
                            <Space size="middle" style={{ fontSize: 12 }}>
                                <Text type="secondary">
                                    <ClockCircleOutlined /> {formatTime(item.duration)}
                                </Text>
                                {item.alertCount > 0 && (
                                    <Text type="warning">
                                        {item.alertCount} {item.alertCount === 1 ? 'alert' : 'alerts'}
                                    </Text>
                                )}
                                <Text type="secondary">
                                    {formatDate(item.startTime)}
                                </Text>
                            </Space>
                        </Space>
                    </List.Item>
                )}
            />
        </div>
    );
};
