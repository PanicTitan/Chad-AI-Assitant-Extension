import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
    FileTextOutlined,
    InfoCircleOutlined,
    MessageOutlined,
    TranslationOutlined,
    SettingOutlined,
    SearchOutlined,
    SoundOutlined,
    StopOutlined,
    LoadingOutlined,
} from "@ant-design/icons";
import { Popover } from 'antd';
import type { ThemeMode } from "@/utils/theme";
import styles from "./index.module.css";

export type SelectionAction = "summary" | "translate" | "explain" | "speak" | "chat" | "search";
export type SelectionConfigAction = "summary-config" | "translate-config";

export type SummarizerType = "key-points" | "tldr" | "teaser" | "headline";
export type SummarizerLength = "short" | "medium" | "long";
export type LargeContentStrategy = "join" | "merge";

export interface SummarizerConfig {
    type: SummarizerType;
    length: SummarizerLength;
    largeContentStrategy?: LargeContentStrategy;
}

export interface TranslatorConfig {
    targetLanguage: string;
}

interface SelectionToolbarProps {
    visible: boolean;
    range: Range | null;
    theme: ThemeMode;
    busyAction?: SelectionAction | null;
    speechProcessing?: boolean;
    speechPlaying?: boolean;
    onAction: (action: SelectionAction) => void;
    onConfigOpen?: (action: SelectionConfigAction) => void;
    onStopSpeech?: () => void;
}

export function SelectionToolbar({ 
    visible, 
    range, 
    theme, 
    busyAction, 
    speechProcessing = false,
    speechPlaying = false,
    onAction,
    onConfigOpen,
    onStopSpeech,
}: SelectionToolbarProps) {
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

    useLayoutEffect(() => {
        if (!visible || !range) {
            setPosition(null);
            return;
        }
        const rect = range.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const top = Math.max(12, rect.top - 12);
        const centerX = rect.left + rect.width / 2;
        const clampedLeft = Math.min(Math.max(centerX, 16), viewportWidth - 16);
        const clampedTop = Math.min(top, viewportHeight - 80);
        setPosition({ top: clampedTop, left: clampedLeft });
    }, [visible, range]);

    useEffect(() => {
        if (!visible) {
            setPosition(null);
        }
    }, [visible]);

    const actions = useMemo(
        () => [
            {
                key: "summary" as const,
                label: "Summarize",
                icon: <FileTextOutlined />,
                onClick: () => onAction("summary"),
                disabled: busyAction === "summary",
                loading: busyAction === "summary",
            },
            {
                key: "translate" as const,
                label: "Translate",
                icon: <TranslationOutlined />,
                onClick: () => onAction("translate"),
                disabled: busyAction === "translate",
                loading: busyAction === "translate",
            },
            {
                key: "explain" as const,
                label: "Explain",
                icon: <InfoCircleOutlined />,
                onClick: () => onAction("explain"),
                disabled: busyAction === "explain",
                loading: busyAction === "explain",
            },
            {
                key: "speak" as const,
                label: speechProcessing ? "Processing" : speechPlaying ? "Stop" : "Speak",
                icon: speechProcessing ? <LoadingOutlined spin /> : speechPlaying ? <StopOutlined /> : <SoundOutlined />,
                onClick: () => {
                    if (speechPlaying || speechProcessing) {
                        onStopSpeech?.();
                    } else {
                        onAction("speak");
                    }
                },
                disabled: false,
                loading: false,
                tooltip: speechProcessing ? "Generating audio..." : speechPlaying ? "Stop reading" : "Read aloud",
            },
            {
                key: "chat" as const,
                label: "Chat",
                icon: <MessageOutlined />,
                onClick: () => onAction("chat"),
                disabled: busyAction === "chat",
                loading: false,
                tooltip: "Send to side panel",
            },
            {
                key: "search" as const,
                label: "Search",
                icon: <SearchOutlined />,
                onClick: () => onAction("search"),
                disabled: busyAction === "search",
                loading: busyAction === "search",
                tooltip: "Search with Google",
            },
        ], [onAction, busyAction, speechProcessing, speechPlaying, onStopSpeech]);

    const resolvedPosition = position;

    return (
        <AnimatePresence>
            {visible && range && resolvedPosition ? (
                <motion.div
                    className={styles.wrapper}
                    style={{ top: resolvedPosition.top, left: resolvedPosition.left }}
                    data-theme={theme}
                    initial={{ opacity: 0, scale: 0.9, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: 4 }}
                >
                    <div className={styles.surface}>
                        {actions.map((item, index) => (
                            <Popover
                                zIndex={10001}
                                key={index}
                                placement="bottom"
                                content={onConfigOpen && ((item.key === "summary") || (item.key === "translate")) ? (
                                    <button
                                        type="button"
                                        className={styles.configIndicator}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (item.key === "summary") {
                                                onConfigOpen("summary-config");
                                            } else if (item.key === "translate") {
                                                onConfigOpen("translate-config");
                                            }
                                        }}
                                        title="Open settings"
                                        aria-label="Settings"
                                    >
                                        <SettingOutlined />
                                    </button>
                                ) : undefined}
                            >
                                <div key={item.key} className={styles.actionGroup}>
                                    <button
                                        type="button"
                                        className={styles.actionButton}
                                        onClick={item.onClick}
                                        disabled={item.disabled || item.loading}
                                        aria-label={item.label}
                                        data-has-config={
                                            (item.key === "summary" && onConfigOpen) ||
                                            (item.key === "translate" && onConfigOpen)
                                                ? "true"
                                                : undefined
                                        }
                                    >
                                        <span className={styles.actionIcon}>{item.icon}</span>
                                        <span className={styles.actionLabel}>{item.label}</span>
                                    </button>
                                </div>
                            </Popover>
                        ))}
                    </div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
