const logger = {
    info: (message: string, ...args: any[]) => console.log(`RichNotificationManager [INFO] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`RichNotificationManager [WARN] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`RichNotificationManager [ERROR] ${message}`, ...args),
};

export interface RichNotificationOptions {
    title: string;
    body: string;
    icon?: string;
    tag?: string;
    requireInteraction?: boolean;
    type?: 'basic' | 'image' | 'progress' | 'list';
    // Rich notification specific options
    imageUrl?: string;
    imageBlob?: Blob;
    progress?: number;
    contextMessage?: string;
    buttons?: Array<{ title: string }>;
    items?: Array<{ title: string; message: string }>;
}

export interface ButtonClickCallback {
    (notificationId: string, buttonIndex: number): void;
}

export interface NotificationClickCallback {
    (notificationId: string): void;
}

/**
 * Rich Notification Manager using Chrome Notifications API
 * Provides advanced notification features like images, progress bars, and action buttons
 */
export class RichNotificationManager {
    private static instance: RichNotificationManager | null = null;
    private buttonClickCallbacks: Map<string, ButtonClickCallback> = new Map();
    private notificationClickCallbacks: Map<string, NotificationClickCallback> = new Map();
    private initialized: boolean = false;

    private constructor() {
        this.setupListeners();
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): RichNotificationManager {
        if (!RichNotificationManager.instance) {
            RichNotificationManager.instance = new RichNotificationManager();
        }
        return RichNotificationManager.instance;
    }

    /**
     * Setup event listeners for notification interactions
     */
    private setupListeners(): void {
        if (!chrome?.notifications) {
            logger.warn('Chrome notifications API not available');
            return;
        }

        // Listen for button clicks
        chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
            logger.info(`Button ${buttonIndex} clicked on notification: ${notificationId}`);
            const callback = this.buttonClickCallbacks.get(notificationId);
            if (callback) {
                callback(notificationId, buttonIndex);
            }
        });

        // Listen for notification clicks
        chrome.notifications.onClicked.addListener((notificationId) => {
            logger.info(`Notification clicked: ${notificationId}`);
            const callback = this.notificationClickCallbacks.get(notificationId);
            if (callback) {
                callback(notificationId);
            }
        });

        // Listen for notification close
        chrome.notifications.onClosed.addListener((notificationId, byUser) => {
            logger.info(`Notification closed: ${notificationId}, by user: ${byUser}`);
            // Clean up callbacks
            this.buttonClickCallbacks.delete(notificationId);
            this.notificationClickCallbacks.delete(notificationId);
        });

        this.initialized = true;
        logger.info('Rich notification listeners initialized');
    }

    /**
     * Request notification permission
     */
    public async requestPermission(): Promise<boolean> {
        if (!chrome?.notifications) {
            logger.error('Chrome notifications API not available');
            return false;
        }

        try {
            const level = await chrome.notifications.getPermissionLevel();
            logger.info(`Notification permission level: ${level}`);
            return level === 'granted';
        } catch (error) {
            logger.error('Failed to check notification permission:', error);
            return false;
        }
    }

    /**
     * Convert Blob to data URL for use in notifications
     */
    private async blobToDataUrl(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Show a rich notification
     */
    public async show(options: RichNotificationOptions): Promise<string> {
        if (!chrome?.notifications) {
            logger.error('Chrome notifications API not available');
            throw new Error('Chrome notifications API not available');
        }

        try {
            // Generate notification ID if not provided via tag
            const notificationId = options.tag || `notification-${Date.now()}`;

            // Convert image blob to data URL if provided
            let imageUrl = options.imageUrl;
            if (options.imageBlob) {
                imageUrl = await this.blobToDataUrl(options.imageBlob);
            }

            // Determine notification type
            const type = options.type || (imageUrl ? 'image' : 'basic');

            // Build notification options
            const notificationOptions: chrome.notifications.NotificationOptions = {
                type: type,
                iconUrl: options.icon || '/icon.png',
                title: options.title,
                message: options.body,
                contextMessage: options.contextMessage,
                requireInteraction: options.requireInteraction ?? true, // Default to true for better visibility
                buttons: options.buttons,
                priority: 2, // Maximum priority (0=lowest, 2=highest)
            };

            // Add type-specific options
            if (type === 'image' && imageUrl) {
                notificationOptions.imageUrl = imageUrl;
            }

            if (type === 'progress' && options.progress !== undefined) {
                notificationOptions.progress = Math.min(100, Math.max(0, options.progress));
            }

            if (type === 'list' && options.items) {
                notificationOptions.items = options.items;
            }

            // Create the notification (ensure all required fields are present)
            const createOptions: any = {
                ...notificationOptions,
                type: type,
                iconUrl: notificationOptions.iconUrl || '/icon.png',
                title: notificationOptions.title,
                message: notificationOptions.message,
            };
            
            const createdId = await chrome.notifications.create(notificationId, createOptions);
            logger.info(`Notification created: ${createdId}`);

            return createdId;
        } catch (error) {
            logger.error('Failed to show notification:', error);
            throw error;
        }
    }

    /**
     * Show a basic notification (backward compatible with NotificationManager)
     */
    public async showBasic(title: string, body: string, icon?: string): Promise<string> {
        return this.show({
            title,
            body,
            icon,
            type: 'basic',
        });
    }

    /**
     * Show an image notification with screenshot
     */
    public async showWithImage(
        title: string,
        body: string,
        imageBlob: Blob,
        options?: Partial<RichNotificationOptions>
    ): Promise<string> {
        return this.show({
            title,
            body,
            imageBlob,
            type: 'image',
            ...options,
        });
    }

    /**
     * Show a progress notification
     */
    public async showProgress(
        title: string,
        body: string,
        progress: number,
        options?: Partial<RichNotificationOptions>
    ): Promise<string> {
        return this.show({
            title,
            body,
            progress,
            type: 'progress',
            ...options,
        });
    }

    /**
     * Update an existing notification
     */
    public async update(notificationId: string, options: Partial<RichNotificationOptions>): Promise<boolean> {
        if (!chrome?.notifications) {
            logger.error('Chrome notifications API not available');
            return false;
        }

        try {
            // Convert image blob if provided
            let imageUrl = options.imageUrl;
            if (options.imageBlob) {
                imageUrl = await this.blobToDataUrl(options.imageBlob);
            }

            const updateOptions: chrome.notifications.NotificationOptions = {};

            if (options.title) updateOptions.title = options.title;
            if (options.body) updateOptions.message = options.body;
            if (options.icon) updateOptions.iconUrl = options.icon;
            if (options.contextMessage) updateOptions.contextMessage = options.contextMessage;
            if (options.progress !== undefined) updateOptions.progress = options.progress;
            if (imageUrl) updateOptions.imageUrl = imageUrl;
            if (options.buttons) updateOptions.buttons = options.buttons;
            if (options.items) updateOptions.items = options.items;

            const wasUpdated = await chrome.notifications.update(notificationId, updateOptions);
            logger.info(`Notification ${notificationId} updated: ${wasUpdated}`);
            return wasUpdated;
        } catch (error) {
            logger.error('Failed to update notification:', error);
            return false;
        }
    }

    /**
     * Clear a specific notification
     */
    public async clear(notificationId: string): Promise<boolean> {
        if (!chrome?.notifications) {
            return false;
        }

        try {
            const wasCleared = await chrome.notifications.clear(notificationId);
            logger.info(`Notification ${notificationId} cleared: ${wasCleared}`);
            
            // Clean up callbacks
            this.buttonClickCallbacks.delete(notificationId);
            this.notificationClickCallbacks.delete(notificationId);
            
            return wasCleared;
        } catch (error) {
            logger.error('Failed to clear notification:', error);
            return false;
        }
    }

    /**
     * Register a callback for button clicks on a specific notification
     */
    public onButtonClick(notificationId: string, callback: ButtonClickCallback): void {
        this.buttonClickCallbacks.set(notificationId, callback);
    }

    /**
     * Register a callback for clicks on a specific notification
     */
    public onClick(notificationId: string, callback: NotificationClickCallback): void {
        this.notificationClickCallbacks.set(notificationId, callback);
    }

    /**
     * Get all active notifications
     */
    public async getAll(): Promise<{ [id: string]: boolean }> {
        if (!chrome?.notifications) {
            return {};
        }

        try {
            return await chrome.notifications.getAll();
        } catch (error) {
            logger.error('Failed to get all notifications:', error);
            return {};
        }
    }

    /**
     * Check if notifications are supported
     */
    public isSupported(): boolean {
        return typeof chrome !== 'undefined' && !!chrome.notifications;
    }
}
