const logger = {
    info: (message: string, ...args: any[]) => console.log(`AlarmTaskRunner [INFO] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`AlarmTaskRunner [WARN] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`AlarmTaskRunner [ERROR] ${message}`, ...args),
    group: (name: string) => console.group(name),
    groupEnd: () => console.groupEnd(),
};

/**
 * A robust scheduler for running an asynchronous task at a recurring interval using Chrome Alarms API.
 * Unlike setTimeout-based schedulers, alarms persist across browser restarts and continue even when
 * the device is sleeping (though won't wake the device).
 * It ensures that one task completes fully before the next one is scheduled, preventing overlaps.
 */
export class AlarmTaskRunner {
    private task: () => Promise<any>;
    private interval: number;
    private isRunning: boolean = false;
    private isPaused: boolean = false;
    private alarmName: string;
    private boundAlarmListener: ((alarm: chrome.alarms.Alarm) => void) | null = null;
    private pausedAt: number | null = null;
    private taskExecuting: boolean = false;

    /**
     * Creates an instance of the alarm-based scheduler.
     * @param task The async function to execute on each alarm.
     * @param interval The delay in milliseconds between task executions (minimum 30000ms / 30 seconds).
     */
    constructor(task: () => Promise<any> | any, interval: number = 5000) {
        if (typeof task !== 'function') {
            throw new Error("Task must be a function that returns a Promise.");
        }
        if (interval < 30000) {
            logger.warn(`Interval ${interval}ms is below Chrome's 30-second minimum. Using 30000ms.`);
            interval = 30000;
        }
        this.task = task;
        this.interval = interval;
        // Generate a unique alarm name based on timestamp to avoid conflicts
        this.alarmName = `alarm-task-runner-${Date.now()}`;
    }

    /**
     * Starts the execution loop. If already running, it will do nothing.
     * The task is executed once immediately upon starting if executeOnStart is true.
     */
    public async start(executeOnStart: boolean = true): Promise<void> {
        if (this.isRunning) {
            logger.warn("AlarmTaskRunner is already running.");
            return;
        }

        if (!chrome?.alarms) {
            throw new Error("Chrome Alarms API is not available. Make sure 'alarms' permission is declared.");
        }

        logger.info("AlarmTaskRunner starting...");
        this.isRunning = true;
        this.isPaused = false;

        // Set up the alarm listener
        this.boundAlarmListener = this.handleAlarm.bind(this);
        chrome.alarms.onAlarm.addListener(this.boundAlarmListener);

        // Create the recurring alarm
        const periodInMinutes = this.interval / 60000;
        await chrome.alarms.create(this.alarmName, {
            delayInMinutes: executeOnStart ? 0 : periodInMinutes,
            periodInMinutes: periodInMinutes
        });

        logger.info(`Alarm created: ${this.alarmName} with period ${periodInMinutes} minutes`);

        // Execute immediately if requested
        if (executeOnStart) {
            this.executeTask();
        }
    }

    /**
     * Stops the execution loop. If a task is in progress, it will complete,
     * but the alarm will be cleared and no more tasks will be scheduled.
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        logger.info("AlarmTaskRunner stopping...");
        this.isRunning = false;
        this.isPaused = false;
        this.pausedAt = null;

        // Clear the alarm
        if (chrome?.alarms) {
            const wasCleared = await chrome.alarms.clear(this.alarmName);
            logger.info(`Alarm cleared: ${wasCleared}`);
        }

        // Remove the listener
        if (this.boundAlarmListener && chrome?.alarms?.onAlarm) {
            chrome.alarms.onAlarm.removeListener(this.boundAlarmListener);
            this.boundAlarmListener = null;
        }
    }

    /**
     * Pauses the execution loop. The alarm is cleared but state is preserved
     * so it can be resumed later. If a task is currently running, it will complete.
     */
    public async pause(): Promise<void> {
        if (!this.isRunning || this.isPaused) {
            logger.warn("Cannot pause: task is not running or already paused.");
            return;
        }

        logger.info("AlarmTaskRunner pausing...");
        this.isPaused = true;
        this.pausedAt = Date.now();

        // Clear the alarm but keep the listener
        if (chrome?.alarms) {
            await chrome.alarms.clear(this.alarmName);
            logger.info("Alarm cleared for pause");
        }
    }

    /**
     * Resumes the execution loop from where it was paused.
     * Creates a new alarm with the same interval.
     */
    public async resume(): Promise<void> {
        if (!this.isRunning || !this.isPaused) {
            logger.warn("Cannot resume: task is not running or not paused.");
            return;
        }

        logger.info("AlarmTaskRunner resuming...");
        this.isPaused = false;
        
        const periodInMinutes = this.interval / 60000;
        
        // Calculate delay based on how long we were paused
        let delayInMinutes = periodInMinutes;
        if (this.pausedAt) {
            const pauseDuration = Date.now() - this.pausedAt;
            const pauseDurationMinutes = pauseDuration / 60000;
            // Subtract pause duration from the next interval, but ensure minimum delay
            delayInMinutes = Math.max(0.5, periodInMinutes - pauseDurationMinutes);
            this.pausedAt = null;
        }

        // Recreate the alarm
        if (chrome?.alarms) {
            await chrome.alarms.create(this.alarmName, {
                delayInMinutes: delayInMinutes,
                periodInMinutes: periodInMinutes
            });
            logger.info(`Alarm resumed with ${delayInMinutes} minute delay`);
        }
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
     * Handles the alarm event. This is called by Chrome when the alarm fires.
     */
    private handleAlarm = (alarm: chrome.alarms.Alarm): void => {
        // Only handle our specific alarm
        if (alarm.name !== this.alarmName) {
            return;
        }

        // Don't execute if stopped or paused
        if (!this.isRunning || this.isPaused) {
            return;
        }

        // Prevent overlapping executions
        if (this.taskExecuting) {
            logger.warn("Previous task still executing, skipping this alarm");
            return;
        }

        this.executeTask();
    };

    /**
     * Executes the task with error handling.
     */
    private async executeTask(): Promise<void> {
        if (this.taskExecuting) {
            return;
        }

        this.taskExecuting = true;
        try {
            await this.task();
        } catch (error) {
            logger.error("An error occurred in the scheduled task:", error);
        } finally {
            this.taskExecuting = false;
        }
    }
}
