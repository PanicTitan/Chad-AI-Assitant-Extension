import { useState } from "react";
import { SettingOutlined } from "@ant-design/icons";
import styles from "./index.module.css";

export type WriterSize = "short" | "medium" | "long";
export type WriterFormat = "plain-text" | "markdown";
export type WriterTone = "formal" | "neutral" | "casual";

interface WriterFormProps {
    action: "write" | "rewrite" | "expand";
    onSubmit: (input: string, size: WriterSize, format: WriterFormat, tone: WriterTone) => void;
    onCancel?: () => void;
    loading?: boolean;
}

export function WriterForm({ action, onSubmit, onCancel, loading = false }: WriterFormProps) {
    const [input, setInput] = useState("");
    const [size, setSize] = useState<WriterSize>("medium");
    const [format, setFormat] = useState<WriterFormat>("plain-text");
    const [tone, setTone] = useState<WriterTone>("neutral");
    const [settingsOpen, setSettingsOpen] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || loading) return;
        onSubmit(input, size, format, tone);
    };

    const showSizeOption = action === "write" || action === "rewrite" || action === "expand";
    const showFormatOption = action === "write" || action === "rewrite";
    const showToneOption = action === "write" || action === "rewrite";

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.section}>
                <label className={styles.label}>
                    {action === "write" ? "What do you want to write?" : 
                     action === "rewrite" ? "How do you want to rewrite?" : 
                     "The current text will be expanded"}
                </label>
                <textarea
                    className={styles.textarea}
                    placeholder={
                        action === "write"
                            ? "Type what you want to write..."
                            : action === "rewrite"
                            ? "E.g., Make it more formal and concise"
                            : "Type additional instructions..."
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            if (input.trim() && !loading) {
                                onSubmit(input, size, format, tone);
                            }
                        }
                    }}
                    disabled={loading}
                    autoFocus
                    rows={3}
                />
            </div>

            {(showSizeOption || showFormatOption) && (
                <div className={styles.section}>
                    <button
                        type="button"
                        className={styles.settingsToggle}
                        onClick={() => setSettingsOpen(!settingsOpen)}
                        disabled={loading}
                    >
                        <SettingOutlined />
                        {settingsOpen ? "Hide settings" : "Show settings"}
                    </button>

                    {settingsOpen && (
                        <div className={styles.settingsContent}>
                            {showSizeOption && (
                                <div className={styles.optionGroup}>
                                    <label className={styles.optionLabel}>Length</label>
                                    <div className={styles.radioGroup}>
                                        <label className={styles.radioOption}>
                                            <input
                                                type="radio"
                                                name="size"
                                                value="short"
                                                checked={size === "short"}
                                                onChange={(e) => setSize(e.target.value as WriterSize)}
                                                disabled={loading}
                                            />
                                            <span>Short</span>
                                        </label>
                                        <label className={styles.radioOption}>
                                            <input
                                                type="radio"
                                                name="size"
                                                value="medium"
                                                checked={size === "medium"}
                                                onChange={(e) => setSize(e.target.value as WriterSize)}
                                                disabled={loading}
                                            />
                                            <span>Medium</span>
                                        </label>
                                        <label className={styles.radioOption}>
                                            <input
                                                type="radio"
                                                name="size"
                                                value="long"
                                                checked={size === "long"}
                                                onChange={(e) => setSize(e.target.value as WriterSize)}
                                                disabled={loading}
                                            />
                                            <span>Long</span>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {showFormatOption && (
                                <div className={styles.optionGroup}>
                                    <label className={styles.optionLabel}>Format</label>
                                    <div className={styles.radioGroup}>
                                        <label className={styles.radioOption}>
                                            <input
                                                type="radio"
                                                name="format"
                                                value="plain-text"
                                                checked={format === "plain-text"}
                                                onChange={(e) => setFormat(e.target.value as WriterFormat)}
                                                disabled={loading}
                                            />
                                            <span>Plain text</span>
                                        </label>
                                        <label className={styles.radioOption}>
                                            <input
                                                type="radio"
                                                name="format"
                                                value="markdown"
                                                checked={format === "markdown"}
                                                onChange={(e) => setFormat(e.target.value as WriterFormat)}
                                                disabled={loading}
                                            />
                                            <span>Markdown</span>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {showToneOption && (
                                <div className={styles.optionGroup}>
                                    <label className={styles.optionLabel}>Tone</label>
                                    <div className={styles.radioGroup}>
                                        <label className={styles.radioOption}>
                                            <input
                                                type="radio"
                                                name="tone"
                                                value="formal"
                                                checked={tone === "formal"}
                                                onChange={(e) => setTone(e.target.value as WriterTone)}
                                                disabled={loading}
                                            />
                                            <span>Formal</span>
                                        </label>
                                        <label className={styles.radioOption}>
                                            <input
                                                type="radio"
                                                name="tone"
                                                value="neutral"
                                                checked={tone === "neutral"}
                                                onChange={(e) => setTone(e.target.value as WriterTone)}
                                                disabled={loading}
                                            />
                                            <span>Neutral</span>
                                        </label>
                                        <label className={styles.radioOption}>
                                            <input
                                                type="radio"
                                                name="tone"
                                                value="casual"
                                                checked={tone === "casual"}
                                                onChange={(e) => setTone(e.target.value as WriterTone)}
                                                disabled={loading}
                                            />
                                            <span>Casual</span>
                                        </label>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            <div className={styles.footer}>
                {onCancel && (
                    <button
                        type="button"
                        className={styles.button}
                        data-variant="ghost"
                        onClick={onCancel}
                        disabled={loading}
                    >
                        Cancel
                    </button>
                )}
                <button
                    type="submit"
                    className={styles.button}
                    data-variant="primary"
                    disabled={!input.trim() || loading}
                >
                    {loading ? "Processing..." : 
                     action === "write" ? "Write" : 
                     action === "rewrite" ? "Rewrite" : 
                     "Expand"}
                </button>
            </div>
        </form>
    );
}
