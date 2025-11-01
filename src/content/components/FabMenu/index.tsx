import { useEffect, useRef, useState, type ReactElement } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
    AudioOutlined,
    CommentOutlined,
    FileTextOutlined,
    InfoCircleOutlined,
    TranslationOutlined,
    SettingOutlined,
} from "@ant-design/icons";
import { Mascot } from "@/components/Mascot";
import type { ThemeMode } from "@/utils/theme";
import { Popover, Tooltip } from 'antd';
import styles from "./index.module.css";

export type FabAction = "summary" | "translate" | "explain" | "screen-reader" | "chat";
export type FabConfigAction = "summary-config" | "translate-config" | "explain-config";

interface FabMenuProps {
    theme: ThemeMode;
    onAction: (action: FabAction) => void;
    onConfigOpen?: (action: FabConfigAction) => void;
    busyAction?: FabAction | null;
    activeStates?: Partial<Record<FabAction, boolean>>;
    mascot?: string;
}

const ACTIONS: Array<{
    id: FabAction;
    label: string;
    icon: ReactElement;
    badge?: string;
}> = [
    {
        id: "summary",
        label: "Summarize page",
        icon: <FileTextOutlined />, 
    },
    {
        id: "translate",
        label: "Toggle translation",
        icon: <TranslationOutlined />,
    },
    {
        id: "explain",
        label: "Explain page",
        icon: <InfoCircleOutlined />,
    },
    {
        id: "screen-reader",
        label: "Screen reader",
        icon: <AudioOutlined />,
    },
    {
        id: "chat",
        label: "Open chat",
        icon: <CommentOutlined />
    },
];

export function FabMenu({ 
    theme, 
    onAction,
    onConfigOpen,
    busyAction, 
    activeStates,
    mascot = 'yellow',
}: FabMenuProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className={styles.container} data-theme={theme}>
            <motion.button
                type="button"
                aria-haspopup
                aria-expanded={open}
                className={styles.toggleButton}
                whileTap={{ scale: 0.95 }}
                onClick={() => setOpen((value) => !value)}
            >
                <Mascot variant={mascot as any} size="small" motion={open ? "shake" : "float"} />
            </motion.button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        className={styles.items}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ 
                            duration: 0.2,
                            ease: [0.25, 0.1, 0.25, 1] // Smooth easing
                        }}
                    >
                        {ACTIONS.map(({ id, label, icon, badge }, index) => {
                            const hasConfig = 
                                (id === "summary" && onConfigOpen) ||
                                (id === "translate" && onConfigOpen) ||
                                (id === "explain" && onConfigOpen);

                            return (
                                <Popover 
                                    key={index}
                                    placement="left"
                                    content={hasConfig && onConfigOpen ? (
                                        <button
                                            type="button"
                                            className={styles.configIndicatorFab}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (id === "summary") {
                                                    onConfigOpen("summary-config");
                                                } else if (id === "translate") {
                                                    onConfigOpen("translate-config");
                                                } else if (id === "explain") {
                                                    onConfigOpen("explain-config");
                                                }
                                            }}
                                            title="Open settings"
                                            aria-label="Settings"
                                        >
                                            <SettingOutlined />
                                        </button>
                                    ) : undefined}
                                >
                                    <motion.div
                                        key={id}
                                        className={styles.itemWrapper}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        transition={{ 
                                            delay: index * 0.03,
                                            duration: 0.2,
                                            ease: [0.25, 0.1, 0.25, 1]
                                        }}
                                    >
                                        <motion.button
                                            type="button"
                                            className={styles.itemButton}
                                            data-active={activeStates?.[id] ?? false}
                                            data-has-config={hasConfig ? "true" : undefined}
                                            disabled={busyAction === id}
                                            onClick={() => {
                                                setOpen(false);
                                                onAction(id);
                                            }}
                                            whileHover={{ scale: 1.02, x: 2 }}
                                            whileTap={{ scale: 0.98 }}
                                        >
                                            <span className={styles.iconCircle} data-theme={theme}>
                                                {icon}
                                            </span>
                                            <span className={styles.itemLabel}>{label}</span>
                                            {badge ? <span className={styles.badge}>{badge}</span> : null}
                                            
                                        </motion.button>
                                    </motion.div>
                                </Popover>
                                
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
