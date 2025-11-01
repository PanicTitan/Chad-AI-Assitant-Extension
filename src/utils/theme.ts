export type ThemeMode = "light" | "dark";

export function getTheme(): ThemeMode {
    if (typeof window === "undefined") return "light";
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
}

export function onThemeChange(callback: (mode: ThemeMode) => void): () => void {
    if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => callback(event.matches ? "dark" : "light");
    if ("addEventListener" in media) {
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
    }
    const legacy = media as MediaQueryList & {
        addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
        removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(listener);
    return () => legacy.removeListener?.(listener);
}
