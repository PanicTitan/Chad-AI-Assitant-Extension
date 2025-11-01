import { AudioOutlined, EditOutlined, PlusOutlined, RedoOutlined, ThunderboltOutlined, StopOutlined, CheckCircleOutlined } from "@ant-design/icons";
import { Button, Dropdown, Tooltip, theme as antdTheme } from "antd";
import type { MenuProps } from "antd";
import type { ThemeMode } from "@/utils/theme";
import styles from "./index.module.css";

export type InputAction = "write" | "rewrite" | "expand" | "fix-grammar" | "voice" | "voice-stop";

interface InputAssistantProps {
    theme: ThemeMode;
    anchor: DOMRect | null;
    busyAction?: InputAction | null;
    onAction: (action: InputAction) => void;
    visible: boolean;
    isRecording?: boolean;
}

export function InputAssistant({ theme, anchor, busyAction, onAction, visible, isRecording = false }: InputAssistantProps) {
    const { token } = antdTheme.useToken();

    if (!visible || !anchor) {
        return null;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const targetTop = anchor.top + anchor.height / 2;
    const targetLeft = anchor.right + 12;
    const left = Math.min(Math.max(targetLeft, 48), viewportWidth - 48);
    const top = Math.min(Math.max(targetTop, 48), viewportHeight - 48);

    const menuItems: MenuProps["items"] = [
        {
            key: "write",
            icon: <EditOutlined />,
            label: "Write with AI",
            disabled: busyAction === "write",
        },
        {
            key: "rewrite",
            icon: <RedoOutlined />,
            label: "Rewrite",
            disabled: busyAction === "rewrite",
        },
        {
            key: "expand",
            icon: <PlusOutlined />,
            label: "Expand",
            disabled: busyAction === "expand",
        },
        {
            key: "fix-grammar",
            icon: <CheckCircleOutlined />,
            label: "Fix Grammar",
            disabled: busyAction === "fix-grammar",
        },
    ];

    const handleMenuClick: MenuProps["onClick"] = ({ key }) => {
        onAction(key as InputAction);
    };

    const handlePreventBlur = (e: React.PointerEvent) => {
        // Prevent input from losing focus when clicking buttons
        e.preventDefault();
    };

    return (
        <div 
            className={styles.anchor} 
            style={{ top, left }} 
            data-theme={theme}
            onPointerDown={handlePreventBlur}
        >
            <Dropdown
                menu={{ items: menuItems, onClick: handleMenuClick }}
                trigger={["click"]}
                placement="bottomRight"
                overlayClassName={styles.dropdown}
            >
                <Button
                    type="primary"
                    shape="circle"
                    size="middle"
                    icon={<ThunderboltOutlined />}
                    loading={Boolean(busyAction && busyAction !== "voice" && busyAction !== "voice-stop")}
                    style={{ boxShadow: token.boxShadowSecondary }}
                    onPointerDown={handlePreventBlur}
                />
            </Dropdown>
            <Tooltip title={busyAction === "voice" ? "Transcribing..." : isRecording ? "Stop recording" : "Voice to text"} placement="left">
                <Button
                    className={isRecording ? `${styles.voiceButton} ${styles.recording}` : styles.voiceButton}
                    shape="circle"
                    size="middle"
                    icon={isRecording ? <StopOutlined /> : <AudioOutlined />}
                    danger={isRecording && busyAction !== "voice"}
                    loading={busyAction === "voice"}
                    onClick={() => onAction(isRecording ? "voice-stop" : "voice")}
                    onPointerDown={handlePreventBlur}
                />
            </Tooltip>
        </div>
    );
}
