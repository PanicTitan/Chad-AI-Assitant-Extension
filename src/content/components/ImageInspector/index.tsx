import type { ThemeMode } from "@/utils/theme";
import styles from "./index.module.css";

interface ImageInspectorProps {
    visible: boolean;
    anchor: DOMRect | null;
    theme: ThemeMode;
    busy: boolean;
    onInspect: () => void;
    onPointerEnter: () => void;
    onPointerLeave: () => void;
}

export function ImageInspector({
    visible,
    anchor,
    theme,
    busy,
    onInspect,
    onPointerEnter,
    onPointerLeave,
}: ImageInspectorProps) {
    if (!visible || !anchor || typeof window === "undefined") return null;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rawLeft = anchor.left + anchor.width - 24;
    const rawTop = anchor.top + 16;
    const left = Math.min(Math.max(rawLeft, 56), viewportWidth - 56);
    const top = Math.min(Math.max(rawTop, 56), viewportHeight - 56);

    return (
        <div
            id="assistant-image-inspector"
            className={styles.container}
            data-theme={theme}
            style={{ top, left }}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
        >
            <button
                type="button"
                className={styles.button}
                onClick={onInspect}
                disabled={busy}
            >
                <span className={styles.icon} aria-hidden>
                    ?
                </span>
                <span className={styles.label}>{busy ? "Analyzing..." : "Ask AI about this image"}</span>
            </button>
        </div>
    );
}
