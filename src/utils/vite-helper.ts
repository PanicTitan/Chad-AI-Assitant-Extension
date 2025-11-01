export function getPublicPath(path = "/") {
    if (import.meta.env.DEV) {
        return "/public" + path;
    }
    
    // In production (Chrome extension), use chrome.runtime.getURL for absolute paths
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        return chrome.runtime.getURL(path.startsWith('/') ? path.slice(1) : path);
    }
    
    return path;
}


/**
 * Build an app URL that is safe both in dev (vite dev server) and in production (extension pages).
 * - If running under Vite dev server (import.meta.env.DEV), return an absolute URL using the dev origin.
 * - Otherwise, return a path that works in the extension environment (relative to the extension root).
 *
 * Examples:
 *  getAppUrl('/src/supervisor/index.html') ->
 *      - dev: 'http://localhost:5173/src/supervisor/index.html'
 *      - prod (extension): '/src/supervisor/index.html'
 */
export function getAppUrl(relativePath: string) {
    if (!relativePath) return relativePath;

    // Ensure it starts with a single leading slash
    const cleaned = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;

    if (import.meta.env.DEV && typeof window !== 'undefined') {
        // On dev, Vite serves files from the dev server origin
        try {
            const origin = window.location.origin || `${window.location.protocol}//${window.location.host}`;
            return origin + cleaned.replace(/^\/public/, '');
        } catch (e) {
            // Fallback to just returning the cleaned path
            return cleaned;
        }
    }

    // In production (extension), return the cleaned path so it resolves against extension base
    return cleaned;
}

