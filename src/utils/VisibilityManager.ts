/**
 * VisibilityManager - Manages page visibility and triggers callbacks
 * Prevents execution when the page is visible to avoid self-analysis
 */
export class VisibilityManager {
    private visibilityCheckInterval: NodeJS.Timeout | null = null;
    private onVisibleCallback: (() => void) | null = null;
    private onHiddenCallback: (() => void) | null = null;
    private isRunning: boolean = false;

    constructor(
        onVisible?: () => void,
        onHidden?: () => void
    ) {
        this.onVisibleCallback = onVisible || null;
        this.onHiddenCallback = onHidden || null;
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
        this.handlePageHide = this.handlePageHide.bind(this);
        this.handlePageShow = this.handlePageShow.bind(this);
    }

    /**
     * Start monitoring visibility
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Add event listeners
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        window.addEventListener('pagehide', this.handlePageHide);
        window.addEventListener('pageshow', this.handlePageShow);

        // Start interval check (every second)
        this.visibilityCheckInterval = setInterval(() => {
            if (document.visibilityState === 'visible') {
                this.onVisibleCallback?.();
            } else {
                this.onHiddenCallback?.();
            }
        }, 1000);

        // Initial check
        this.handleVisibilityChange();
    }

    /**
     * Stop monitoring visibility
     */
    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        // Remove event listeners
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('pagehide', this.handlePageHide);
        window.removeEventListener('pageshow', this.handlePageShow);

        // Clear interval
        if (this.visibilityCheckInterval) {
            clearInterval(this.visibilityCheckInterval);
            this.visibilityCheckInterval = null;
        }
    }

    /**
     * Check if page is currently visible
     */
    isVisible(): boolean {
        return document.visibilityState === 'visible';
    }

    /**
     * Check if page is currently hidden
     */
    isHidden(): boolean {
        return document.visibilityState === 'hidden';
    }

    /**
     * Handle visibility change event
     */
    private handleVisibilityChange() {
        if (document.visibilityState === 'visible') {
            console.log('[VisibilityManager] Page visible - triggering onVisible callback');
            this.onVisibleCallback?.();
        } else {
            console.log('[VisibilityManager] Page hidden - triggering onHidden callback');
            this.onHiddenCallback?.();
        }
    }

    /**
     * Handle page hide event (page being unloaded or backgrounded)
     */
    private handlePageHide() {
        console.log('[VisibilityManager] Page hide event');
        this.onHiddenCallback?.();
    }

    /**
     * Handle page show event (page being shown again)
     */
    private handlePageShow() {
        console.log('[VisibilityManager] Page show event');
        if (document.visibilityState === 'visible') {
            this.onVisibleCallback?.();
        } else {
            this.onHiddenCallback?.();
        }
    }

    /**
     * Update callbacks
     */
    setCallbacks(onVisible?: () => void, onHidden?: () => void) {
        this.onVisibleCallback = onVisible || null;
        this.onHiddenCallback = onHidden || null;
    }
}
