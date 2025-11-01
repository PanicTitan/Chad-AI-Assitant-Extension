const logger = {
    info: (message: string, ...args: any[]) => console.log(`MonitorCapture [INFO] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`MonitorCapture [WARN] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`MonitorCapture [ERROR] ${message}`, ...args),
    group: (name: string) => console.group(name),
    groupEnd: () => console.groupEnd(),
};

/** Options for the on-demand frame capture method. */
export type CaptureFrameOptions = {
    scale?: number;
    imageFormat?: 'image/png' | 'image/jpeg' | 'image/webp';
    quality?: number;
};

/**
 * A self-contained class to manage the entire lifecycle of a screen monitoring session.
 * It handles starting, stopping, and provides an on-demand method to capture frames.
 */
export class MonitorCapture {
    private mediaStream: MediaStream | null = null;
    private videoTrack: MediaStreamTrack | null = null;
    private isRunning: boolean = false;
    private onStopCallback: (() => void) | null = null;

    private canvas!: HTMLCanvasElement;

    /**
     * Prompts the user for screen access, verifies it's a full monitor,
     * and prepares the monitor for capturing.
     * @param {MonitorLifecycleCallbacks} callbacks - Optional callbacks for lifecycle events.
     * @returns {Promise<boolean>} True if started successfully, false otherwise.
     */
    public async start(onStop?: () => void): Promise<boolean> {
        if (this.isRunning) {
            logger.warn("ScreenMonitor is already running.");
            return true;
        }

        try {
            this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "monitor", selfBrowserSurface: "exclude" } as any,
                audio: false,
            });
        } catch (err) {
            logger.error("Failed to start screen capture. User may have denied permission.");
            return false;
        }

        this.videoTrack = this.mediaStream.getVideoTracks()[0];
        if (!this.videoTrack || this.videoTrack.getSettings().displaySurface !== 'monitor') {
            logger.warn(`Verification failed. User must share a full monitor, not a '${this.videoTrack?.getSettings().displaySurface || 'none'}'.`);
            this.mediaStream.getTracks().forEach(track => track.stop());
            // alert("This feature requires sharing your entire screen. Please try again and select a monitor.");
            return false;
        }
        
        // Link the browser's "Stop sharing" button to our stop() method.
        this.videoTrack.onended = () => {
            logger.info("Stream ended externally (e.g., user clicked 'Stop sharing').");
            this.stop();
        };

        this.isRunning = true;
        this.onStopCallback = onStop || null; // Store the onStop callback
        
        logger.info("ScreenMonitor started successfully.");

        if (!this.canvas) this.canvas = document.createElement('canvas');

        return true;
    }

    /**
     * Stops the screen capture, releases all media resources, and triggers the onStop callback.
     */
    public stop(): void {
        if (!this.isRunning) {
            return;
        }
        
        logger.info("ScreenMonitor stopping...");
        this.isRunning = false; // Set state immediately to prevent race conditions

        // Unhook the onended listener to prevent a double-call loop if stop is called manually
        if (this.videoTrack) {
            this.videoTrack.onended = null;
        }

        this.mediaStream?.getTracks().forEach(track => track.stop());
        
        this.mediaStream = null;
        this.videoTrack = null;

        // Trigger the stored onStop callback
        this.onStopCallback?.();
        this.onStopCallback = null; // Clear callback after it's been used
    }

    /**
     * Captures a single frame from the active stream on demand.
     * This method is self-contained and manages its own canvas.
     * @param {CaptureFrameOptions} options - Optional settings for image quality and scale.
     * @returns {Promise<Blob | null>} A Promise that resolves to the captured image blob, or null if failed.
     */
    public async captureFrame(options: CaptureFrameOptions = {}): Promise<Blob | null> {
        if (!this.isRunning || !this.videoTrack) {
            logger.error("Cannot capture frame: monitor is not running.");
            return null;
        }

        const scale = options?.scale ?? 1;
        const imageFormat = options?.imageFormat ?? "image/webp";
        const quality = options?.quality ?? 1;

        try {
            const imageCapture = new ImageCapture(this.videoTrack);
            const imageBitmap = await imageCapture.grabFrame();

            if (scale == 1) {
                const ctx = this.canvas.getContext("bitmaprenderer", {
                    alpha: false
                })!;
                ctx.transferFromImageBitmap(imageBitmap);
            } else {
                this.canvas.width = imageBitmap.width * scale;
                this.canvas.height = imageBitmap.height * scale;
                const ctx = this.canvas.getContext("2d", {
                        alpha: false,
                        willReadFrequently: false,
                        desynchronized: true
                    })!;
                ctx.drawImage(imageBitmap, 0, 0, this.canvas.width, this.canvas.height);
            }

            return new Promise(resolve => this.canvas.toBlob(resolve, imageFormat, quality));
        } catch (error) {
            logger.error("Failed to capture frame:", error);
            return null;
        } finally {
            
        }
    }
}
