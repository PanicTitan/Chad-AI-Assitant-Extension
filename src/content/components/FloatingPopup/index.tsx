import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CloseOutlined, FileTextOutlined, TranslationOutlined, BulbOutlined } from "@ant-design/icons";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { ThemeMode } from "@/utils/theme";
import styles from "./index.module.css";

export type PopupStatus = "idle" | "loading" | "success" | "error";

interface FloatingPopupProps {
    open: boolean;
    title: string;
    theme: ThemeMode;
    status?: PopupStatus;
    body: ReactNode;
    footer?: ReactNode;
    anchor?: { x: number; y: number } | null;
    onClose: () => void;
    initialHeight?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function FloatingPopup({ open, title, theme, status = "idle", body, footer, anchor, onClose, initialHeight }: FloatingPopupProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [position, setPosition] = useState<{ top: number; left: number }>({
        top: window.innerHeight * 0.18,
        left: window.innerWidth / 2,
    });
    const [size, setSize] = useState<{ width: number; height: number }>({ 
        width: 480, 
        height: initialHeight || 320 
    });
    const popupRef = useRef<HTMLDivElement>(null);
    const dragState = useRef<{ pointerId: number | null; startX: number; startY: number; originTop: number; originLeft: number }>(
        { pointerId: null, startX: 0, startY: 0, originTop: 0, originLeft: 0 },
    );
    const resizeState = useRef<{ pointerId: number | null; startX: number; startY: number; originWidth: number; originHeight: number }>(
        { pointerId: null, startX: 0, startY: 0, originWidth: 0, originHeight: 0 },
    );

    useEffect(() => {
        if (!open) {
            setCollapsed(false);
            return;
        }
        if (anchor) {
            setPosition({
                top: clamp(anchor.y, 80, window.innerHeight - 160),
                left: clamp(anchor.x, 180, window.innerWidth - 180),
            });
        } else {
            setPosition({ top: window.innerHeight * 0.18, left: window.innerWidth / 2 });
        }
    }, [open, anchor]);

    useEffect(() => {
        const handleResize = () => {
            if (!popupRef.current) return;
            setPosition((prev) => {
                const rect = popupRef.current!.getBoundingClientRect();
                // Get actual popup dimensions
                const popupWidth = rect.width;
                const popupHeight = rect.height;
                

                const minLeft = 0; // halfWidth + padding;
                const maxLeft = window.innerWidth - popupWidth; // window.innerWidth - halfWidth - padding;
                const minTop = 0; // padding;
                const maxTop = window.innerHeight - popupHeight; // window.innerHeight - popupHeight - padding;
                
                return {
                    top: clamp(prev.top, minTop, maxTop),
                    left: clamp(prev.left, minLeft, maxLeft),
                };
            });
        };
        window.addEventListener("resize", handleResize);
        handleResize(); // Initial check
        return () => window.removeEventListener("resize", handleResize);
    }, [size.width, size.height]);

    const statusLabel = useMemo(() => {
        if (status === "loading") return "Thinking...";
        if (status === "error") return "Something went wrong";
        if (status === "success") return "Done";
        return null;
    }, [status]);

    const titleIcon = useMemo(() => {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes("summar")) return <FileTextOutlined />;
        if (lowerTitle.includes("translat")) return <TranslationOutlined />;
        if (lowerTitle.includes("explain")) return <BulbOutlined />;
        return <FileTextOutlined />;
    }, [title]);

    const renderedBody = useMemo(() => {
        if (typeof body !== "string") return body;
        if (status === "error" || status === "loading") return <pre className={styles.contentPre}>{body}</pre>;
        
        try { 
                const html = marked.parse(body, { async: false }) as string;
                console.log("html:", html)
                const clean = DOMPurify.sanitize(html);
                console.log("clean:", clean)
                return <div className={styles.contentMarkdown} dangerouslySetInnerHTML={{ __html: clean }} />
            } catch {
                return <div className={styles.contentText}>{body}</div>;
            }
    }, [body, status]);

    const minWidth = Math.min(360, window.innerWidth - 32);
    const maxWidth = Math.min(720, window.innerWidth - 32);
    const minHeight = 200;
    const maxHeight = window.innerHeight - 120;

    return (
        <AnimatePresence>
            {open ? (
                <motion.div
                    ref={popupRef}
                    className={`${styles.popup} ${collapsed ? styles.collapsed : ""}`}
                    data-theme={theme}
                    data-floating-popup="true"
                    initial={{ opacity: 0, y: 20, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.96 }}
                    transition={{ type: "spring", damping: 22, stiffness: 180 }}
                    style={{
                        top: position.top,
                        left: position.left,
                        transform: "translate(-50%, 0)",
                        width: clamp(size.width, minWidth, maxWidth),
                        height: collapsed ? "auto" : clamp(size.height, minHeight, maxHeight),
                    }}
                >
                    <header
                        className={styles.header}
                        onPointerDown={(event) => {
                            const target = event.target as HTMLElement | null;
                            if (target && target.closest("button, a, input, textarea")) {
                                return;
                            }
                            dragState.current = {
                                pointerId: event.pointerId,
                                startX: event.clientX,
                                startY: event.clientY,
                                originTop: position.top,
                                originLeft: position.left,
                            };
                            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                        }}
                        onPointerMove={(event) => {
                            if (dragState.current.pointerId !== event.pointerId) return;
                            if (!popupRef.current) return;
                            
                            const nextTop = dragState.current.originTop + (event.clientY - dragState.current.startY);
                            const nextLeft = dragState.current.originLeft + (event.clientX - dragState.current.startX);
                            
                            // Get actual popup dimensions
                            const rect = popupRef.current.getBoundingClientRect();
                            const popupWidth = rect.width;
                            const popupHeight = rect.height;
                            

                            const minLeft = 0; // halfWidth + padding;
                            const maxLeft = window.innerWidth - popupWidth; // window.innerWidth - halfWidth - padding;
                            const minTop = 0; // padding;
                            const maxTop = window.innerHeight - popupHeight; // window.innerHeight - popupHeight - padding;
                            
                            setPosition({
                                top: clamp(nextTop, minTop, maxTop),
                                left: clamp(nextLeft, minLeft, maxLeft),
                            });
                        }}
                        onPointerUp={(event) => {
                            if (dragState.current.pointerId !== event.pointerId) return;
                            dragState.current.pointerId = null;
                            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
                        }}
                    >
                        <span className={styles.title}>
                            <span className={styles.titleIcon}>{titleIcon}</span>
                            {title}
                            {!(!collapsed && status === "loading") && statusLabel && <span className={styles.statusLabel} data-status={status}>{statusLabel}</span>}
                            {collapsed && status === "loading" && <span className={styles.headerSpinner} />}
                        </span>
                        <div className={styles.actions}>
                            <button
                                type="button"
                                className={styles.collapseBtn}
                                onClick={() => setCollapsed(!collapsed)}
                                aria-label={collapsed ? "Expand" : "Collapse"}
                            >
                                {collapsed ? "⬆" : "⬇"}
                            </button>
                            <button
                                type="button"
                                className={styles.closeBtn}
                                onClick={onClose}
                                aria-label="Close"
                            >
                                <CloseOutlined />
                            </button>
                        </div>
                    </header>
                    <motion.div
                        initial={false}
                        animate={{ height: collapsed ? 0 : "-webkit-fill-available", opacity: collapsed ? 0 : 1 }}
                        transition={{ type: "spring", damping: 20, stiffness: 200 }}
                        style={{ overflow: "hidden", paddingBottom: collapsed ? 0 : "20px" }}
                    >
                        <div className={styles.body}>
                            {statusLabel && status != "success" ? (
                                <div className={styles.statusLine}>
                                    {status === "loading" ? <span className={styles.spinner} /> : null}
                                    <span>{statusLabel}</span>
                                </div>
                            ) : null}
                            {renderedBody}
                        </div>
                        {footer ? <div className={styles.footer}>{footer}</div> : null}
                        <div
                            className={styles.resizeHandle}
                            onPointerDown={(event) => {
                                resizeState.current = {
                                    pointerId: event.pointerId,
                                    startX: event.clientX,
                                    startY: event.clientY,
                                    originWidth: size.width,
                                    originHeight: size.height,
                                };
                                (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
                            }}
                            onPointerMove={(event) => {
                                if (resizeState.current.pointerId !== event.pointerId) return;
                                const nextWidth = resizeState.current.originWidth + (event.clientX - resizeState.current.startX);
                                const nextHeight = resizeState.current.originHeight + (event.clientY - resizeState.current.startY);
                                setSize({
                                    width: clamp(nextWidth, minWidth, maxWidth),
                                    height: clamp(nextHeight, minHeight, maxHeight),
                                });
                            }}
                            onPointerUp={(event) => {
                                if (resizeState.current.pointerId !== event.pointerId) return;
                                resizeState.current.pointerId = null;
                                (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
                            }}
                        />
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
