import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloseOutlined, EditOutlined, SettingOutlined } from "@ant-design/icons";
import type { ThemeMode } from "@/utils/theme";
import styles from "./index.module.css";

export type WriterSize = "short" | "medium" | "long";
export type WriterFormat = "paragraph" | "list" | "professional";

interface InputModalProps {
    open: boolean;
    theme: ThemeMode;
    title: string;
    placeholder: string;
    onSubmit: (input: string, size: WriterSize, format: WriterFormat) => void;
    onClose: () => void;
    showSizeOption?: boolean;
    showFormatOption?: boolean;
}

export function InputModal({
    open,
    theme,
    title,
    placeholder,
    onSubmit,
    onClose,
    showSizeOption = true,
    showFormatOption = true,
}: InputModalProps) {
    const [input, setInput] = useState("");
    const [size, setSize] = useState<WriterSize>("medium");
    const [format, setFormat] = useState<WriterFormat>("paragraph");
    const [settingsOpen, setSettingsOpen] = useState(false);

    const handleSubmit = () => {
        if (!input.trim()) return;
        onSubmit(input, size, format);
        setInput("");
        setSize("medium");
        setFormat("paragraph");
        setSettingsOpen(false);
    };

    const handleClose = () => {
        setInput("");
        setSize("medium");
        setFormat("paragraph");
        setSettingsOpen(false);
        onClose();
    };

    return (
        <AnimatePresence>
            {open ? (
                <>
                    <motion.div
                        className={styles.overlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={handleClose}
                    />
                    <motion.div
                        className={styles.modal}
                        data-theme={theme}
                        initial={{ opacity: 0, y: 20, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 12, scale: 0.96 }}
                        transition={{ type: "spring", damping: 22, stiffness: 180 }}
                    >
                        <div className={styles.header}>
                            <span className={styles.title}>
                                <EditOutlined />
                                {title}
                            </span>
                            <button type="button" className={styles.closeBtn} onClick={handleClose}>
                                <CloseOutlined />
                            </button>
                        </div>

                        <div className={styles.body}>
                            <div className={styles.section}>
                                <label className={styles.label}>O que você quer {title.toLowerCase()}?</label>
                                <textarea
                                    className={styles.textarea}
                                    placeholder={placeholder}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            {(showSizeOption || showFormatOption) && (
                                <div className={styles.section}>
                                    <button
                                        type="button"
                                        className={styles.settingsToggle}
                                        onClick={() => setSettingsOpen(!settingsOpen)}
                                    >
                                        <SettingOutlined />
                                        {settingsOpen ? "Ocultar configurações" : "Mostrar configurações"}
                                    </button>

                                    {settingsOpen && (
                                        <>
                                            {showSizeOption && (
                                                <div className={styles.section}>
                                                    <label className={styles.label}>Tamanho</label>
                                                    <div className={styles.radioGroup}>
                                                        <label className={styles.radioOption}>
                                                            <input
                                                                type="radio"
                                                                className={styles.radioInput}
                                                                value="short"
                                                                checked={size === "short"}
                                                                onChange={(e) => setSize(e.target.value as WriterSize)}
                                                            />
                                                            <span className={styles.radioLabel}>Curto (2-3 frases)</span>
                                                        </label>
                                                        <label className={styles.radioOption}>
                                                            <input
                                                                type="radio"
                                                                className={styles.radioInput}
                                                                value="medium"
                                                                checked={size === "medium"}
                                                                onChange={(e) => setSize(e.target.value as WriterSize)}
                                                            />
                                                            <span className={styles.radioLabel}>Médio (1 parágrafo)</span>
                                                        </label>
                                                        <label className={styles.radioOption}>
                                                            <input
                                                                type="radio"
                                                                className={styles.radioInput}
                                                                value="long"
                                                                checked={size === "long"}
                                                                onChange={(e) => setSize(e.target.value as WriterSize)}
                                                            />
                                                            <span className={styles.radioLabel}>Longo (múltiplos parágrafos)</span>
                                                        </label>
                                                    </div>
                                                </div>
                                            )}

                                            {showFormatOption && (
                                                <div className={styles.section}>
                                                    <label className={styles.label}>Formato</label>
                                                    <div className={styles.radioGroup}>
                                                        <label className={styles.radioOption}>
                                                            <input
                                                                type="radio"
                                                                className={styles.radioInput}
                                                                value="paragraph"
                                                                checked={format === "paragraph"}
                                                                onChange={(e) => setFormat(e.target.value as WriterFormat)}
                                                            />
                                                            <span className={styles.radioLabel}>Parágrafo</span>
                                                        </label>
                                                        <label className={styles.radioOption}>
                                                            <input
                                                                type="radio"
                                                                className={styles.radioInput}
                                                                value="list"
                                                                checked={format === "list"}
                                                                onChange={(e) => setFormat(e.target.value as WriterFormat)}
                                                            />
                                                            <span className={styles.radioLabel}>Lista de tópicos</span>
                                                        </label>
                                                        <label className={styles.radioOption}>
                                                            <input
                                                                type="radio"
                                                                className={styles.radioInput}
                                                                value="professional"
                                                                checked={format === "professional"}
                                                                onChange={(e) => setFormat(e.target.value as WriterFormat)}
                                                            />
                                                            <span className={styles.radioLabel}>Profissional</span>
                                                        </label>
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className={styles.footer}>
                            <button type="button" className={styles.button} data-variant="ghost" onClick={handleClose}>
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className={styles.button}
                                data-variant="primary"
                                onClick={handleSubmit}
                                disabled={!input.trim()}
                            >
                                {title}
                            </button>
                        </div>
                    </motion.div>
                </>
            ) : null}
        </AnimatePresence>
    );
}
