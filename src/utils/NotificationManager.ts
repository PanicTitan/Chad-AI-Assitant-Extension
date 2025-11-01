/**
 * NotificationManager - Helper class for browser notifications
 * Handles permissions, notification creation, and event management
 */

export type NotificationPermission = 'granted' | 'denied' | 'default';

export interface NotificationOptions {
    body?: string;
    icon?: string;
    image?: string;
    badge?: string;
    tag?: string;
    data?: any;
    dir?: 'auto' | 'ltr' | 'rtl';
    lang?: string;
    renotify?: boolean;
    requireInteraction?: boolean;
    silent?: boolean;
    vibrate?: number | number[];
    timestamp?: number;
    actions?: NotificationAction[];
}

export interface NotificationAction {
    action: string;
    title: string;
    icon?: string;
}

export interface NotificationConfig extends NotificationOptions {
    title: string;
    autoClose?: number; // Auto-close after N milliseconds (0 = never)
    onClick?: () => void;
    onShow?: () => void;
    onClose?: () => void;
    onError?: (error: Event) => void;
}

export class NotificationManager {
    private activeNotifications: Map<string, Notification> = new Map();
    private static instance: NotificationManager | null = null;

    private constructor() {
        // Private constructor for singleton pattern
        this.setupVisibilityHandler();
    }

    /**
     * Get singleton instance of NotificationManager
     */
    static getInstance(): NotificationManager {
        if (!NotificationManager.instance) {
            NotificationManager.instance = new NotificationManager();
        }
        return NotificationManager.instance;
    }

    /**
     * Check if the Notification API is supported
     */
    isSupported(): boolean {
        return 'Notification' in window;
    }

    /**
     * Get current notification permission status
     */
    getPermission(): NotificationPermission {
        if (!this.isSupported()) {
            return 'denied';
        }
        return Notification.permission as NotificationPermission;
    }

    /**
     * Check if permission is already granted
     */
    isPermissionGranted(): boolean {
        return this.getPermission() === 'granted';
    }

    /**
     * Check if permission was explicitly denied
     */
    isPermissionDenied(): boolean {
        return this.getPermission() === 'denied';
    }

    /**
     * Check if permission is in default state (not yet asked)
     */
    isPermissionDefault(): boolean {
        return this.getPermission() === 'default';
    }

    /**
     * Request notification permission from the user
     * @returns Promise resolving to the permission state
     */
    async requestPermission(): Promise<NotificationPermission> {
        if (!this.isSupported()) {
            throw new Error('Notifications are not supported in this browser');
        }

        if (this.isPermissionGranted()) {
            return 'granted';
        }

        if (this.isPermissionDenied()) {
            throw new Error('Notification permission was denied. Please enable it in browser settings.');
        }

        try {
            const permission = await Notification.requestPermission();
            return permission as NotificationPermission;
        } catch (error) {
            console.error('Error requesting notification permission:', error);
            throw error;
        }
    }

    /**
     * Ensure permission is granted, request if needed
     * @returns Promise resolving to true if granted, false otherwise
     */
    async ensurePermission(): Promise<boolean> {
        if (!this.isSupported()) {
            return false;
        }

        if (this.isPermissionGranted()) {
            return true;
        }

        if (this.isPermissionDenied()) {
            return false;
        }

        try {
            const permission = await this.requestPermission();
            return permission === 'granted';
        } catch {
            return false;
        }
    }

    /**
     * Show a notification
     * @param config Notification configuration
     * @returns Promise resolving to the notification ID (tag) or null if failed
     */
    async show(config: NotificationConfig): Promise<string | null> {
        if (!this.isSupported()) {
            console.error('Notifications are not supported');
            return null;
        }

        // Ensure permission is granted
        const hasPermission = await this.ensurePermission();
        if (!hasPermission) {
            console.error('Notification permission not granted');
            return null;
        }

        try {
            // Generate tag if not provided
            const tag = config.tag || `notification-${Date.now()}`;

            // Close existing notification with same tag
            if (this.activeNotifications.has(tag)) {
                this.close(tag);
            }

            // Prepare notification options
            const options: NotificationOptions = {
                body: config.body,
                icon: config.icon,
                image: config.image,
                badge: config.badge,
                tag,
                data: config.data,
                dir: config.dir,
                lang: config.lang,
                renotify: config.renotify,
                requireInteraction: config.requireInteraction,
                silent: config.silent,
                vibrate: config.vibrate,
                timestamp: config.timestamp || Date.now(),
                actions: config.actions,
            };

            // Create notification
            const notification = new Notification(config.title, options);

            // Store active notification
            this.activeNotifications.set(tag, notification);

            // Setup event handlers
            this.setupNotificationHandlers(notification, config, tag);

            // Auto-close if configured
            if (config.autoClose && config.autoClose > 0) {
                setTimeout(() => {
                    this.close(tag);
                }, config.autoClose);
            }

            return tag;
        } catch (error) {
            console.error('Error showing notification:', error);
            if (config.onError) {
                config.onError(error as Event);
            }
            return null;
        }
    }

    /**
     * Show a simple notification with just title and body
     */
    async showSimple(title: string, body?: string, icon?: string): Promise<string | null> {
        return this.show({
            title,
            body,
            icon,
            autoClose: 10000, // 10 seconds
        });
    }

    /**
     * Show a notification that requires user interaction
     */
    async showPersistent(title: string, body?: string, icon?: string): Promise<string | null> {
        return this.show({
            title,
            body,
            icon,
            requireInteraction: true,
        });
    }

    /**
     * Show a silent notification (no sound/vibration)
     */
    async showSilent(title: string, body?: string, icon?: string): Promise<string | null> {
        return this.show({
            title,
            body,
            icon,
            silent: true,
            autoClose: 5000,
        });
    }

    /**
     * Close a specific notification by tag
     */
    close(tag: string): boolean {
        const notification = this.activeNotifications.get(tag);
        if (notification) {
            notification.close();
            this.activeNotifications.delete(tag);
            return true;
        }
        return false;
    }

    /**
     * Close all active notifications
     */
    closeAll(): void {
        this.activeNotifications.forEach((notification) => {
            notification.close();
        });
        this.activeNotifications.clear();
    }

    /**
     * Get count of active notifications
     */
    getActiveCount(): number {
        return this.activeNotifications.size;
    }

    /**
     * Get all active notification tags
     */
    getActiveTags(): string[] {
        return Array.from(this.activeNotifications.keys());
    }

    /**
     * Check if a notification with given tag is active
     */
    isActive(tag: string): boolean {
        return this.activeNotifications.has(tag);
    }

    /**
     * Setup event handlers for a notification
     */
    private setupNotificationHandlers(
        notification: Notification,
        config: NotificationConfig,
        tag: string
    ): void {
        // Show event
        notification.addEventListener('show', () => {
            if (config.onShow) {
                config.onShow();
            }
        });

        // Click event
        notification.addEventListener('click', () => {
            if (config.onClick) {
                config.onClick();
            }
            // Auto-close on click unless requireInteraction is true
            if (!config.requireInteraction) {
                this.close(tag);
            }
        });

        // Close event
        notification.addEventListener('close', () => {
            this.activeNotifications.delete(tag);
            if (config.onClose) {
                config.onClose();
            }
        });

        // Error event
        notification.addEventListener('error', (event) => {
            console.error('Notification error:', event);
            this.activeNotifications.delete(tag);
            if (config.onError) {
                config.onError(event);
            }
        });
    }

    /**
     * Setup visibility handler to close notifications when page is hidden
     */
    private setupVisibilityHandler(): void {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                // Optionally close all notifications when page is hidden
                // Uncomment if you want this behavior:
                // this.closeAll();
            }
        });
    }

    /**
     * Destroy the manager and close all notifications
     */
    destroy(): void {
        this.closeAll();
        NotificationManager.instance = null;
    }
}

// Export singleton instance getter
export const getNotificationManager = () => NotificationManager.getInstance();

// Export default instance for convenience
export default NotificationManager.getInstance();
