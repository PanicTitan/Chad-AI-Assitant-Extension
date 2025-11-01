const logger = {
    info: (message: string, ...args: any[]) => console.log(`TaskRunner [INFO] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`TaskRunner [WARN] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`TaskRunner [ERROR] ${message}`, ...args),
    group: (name: string) => console.group(name),
    groupEnd: () => console.groupEnd(),
};

/**
 * A robust scheduler for running an asynchronous task at a recurring interval.
 * It ensures that one task completes fully before the next one is scheduled,
 * preventing overlaps.
 */
export class TaskRunner {
    private task: () => Promise<any>;
    private interval: number;
    private isRunning: boolean = false;
    private isPaused: boolean = false;
    private timeoutId: number | null = null;
    private lastScheduledAt: number | null = null;
    private remainingTime: number | null = null;

    /**
     * Creates an instance of the scheduler.
     * @param task The async function to execute on each interval.
     * @param interval The delay in milliseconds *after* a task completes before the next one starts.
     */
    constructor(task: () => Promise<any> | any, interval: number = 5000) {
        if (typeof task !== 'function') {
            throw new Error("Task must be a function that returns a Promise.");
        }
        this.task = task;
        this.interval = interval;
    }

    /**
     * Starts the execution loop. If already running, it will do nothing.
     * The task is executed once immediately upon starting.
     */
    public start(executeOnStart: boolean = true): void {
        if (this.isRunning) {
            logger.warn("ScheduledTask is already running.");
            return;
        }

        logger.info("ScheduledTask starting...");
        this.isRunning = true;
        // Start the loop immediately without waiting for the first interval.
        if (executeOnStart) {
            this.runLoop();
        } else {
            const now = Date.now();
            this.lastScheduledAt = now;
            // @ts-ignore
            this.timeoutId = setTimeout(this.runLoop, this.interval);
        }
    }

    /**
     * Stops the execution loop. If a task is in progress, it will complete,
     * but the next one will not be scheduled.
     */
    public stop(): void {
        if (!this.isRunning) {
            return;
        }

        logger.info("ScheduledTask stopping...");
        this.isRunning = false;
        this.isPaused = false;
        this.lastScheduledAt = null;
        this.remainingTime = null;
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    /**
     * Pauses the execution loop, preserving the remaining time until the next task.
     * If a task is currently running, it will complete, but the next one will be delayed
     * until resume() is called.
     */
    public pause(): void {
        if (!this.isRunning || this.isPaused) {
            logger.warn("Cannot pause: task is not running or already paused.");
            return;
        }

        logger.info("ScheduledTask pausing...");
        this.isPaused = true;

        // Calculate and store the remaining time
        const now = Date.now();
        this.remainingTime = this.lastScheduledAt 
            ? Math.max(0, this.interval - (now - this.lastScheduledAt))
            : this.interval;

        logger.info(`Remaining time preserved: ${this.remainingTime}ms`);

        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    /**
     * Resumes the execution loop from where it was paused.
     * Uses the preserved remaining time to schedule the next task.
     */
    public resume(): void {
        if (!this.isRunning || !this.isPaused) {
            logger.warn("Cannot resume: task is not running or not paused.");
            return;
        }

        this.isPaused = false;
        
        // Use the remaining time that was calculated during pause
        const delay = this.remainingTime ?? this.interval;
        logger.info(`ScheduledTask resuming with ${delay}ms delay...`);

        // Schedule the next run and save when we scheduled it
        const now = Date.now();
        this.lastScheduledAt = now;
        this.remainingTime = null;
        
        // @ts-ignore
        this.timeoutId = setTimeout(this.runLoop, delay);
    }

    /**
     * Returns the current status of the task runner.
     */
    public getStatus(): { isRunning: boolean; isPaused: boolean } {
        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
        };
    }

    /**
     * The core execution loop. This is an arrow function to preserve `this` context.
     */
    private runLoop = async (): Promise<void> => {
        // The stop() method might have been called while the task was running.
        // This check ensures we don't proceed if that's the case.
        if (!this.isRunning) {
            return;
        }

        // If paused, don't execute the task
        if (this.isPaused) {
            return;
        }

        try {
            // Execute the provided async task and wait for it to complete.
            await this.task();
        } catch (error) {
            logger.error("An error occurred in the scheduled task:", error);
            // We continue the loop even if one iteration fails.
        } finally {
            // Only schedule the next run if the task is still supposed to be running and not paused.
            if (this.isRunning && !this.isPaused) {
                // Save when we schedule the next task for accurate pause/resume calculation
                const now = Date.now();
                this.lastScheduledAt = now;
                // @ts-ignore
                this.timeoutId = setTimeout(this.runLoop, this.interval);
            }
        }
    };
}
