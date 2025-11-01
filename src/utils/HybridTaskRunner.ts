import { TaskRunner } from './TaskRunner';
import { AlarmTaskRunner } from './AlarmTaskRunner';

const logger = {
    info: (message: string, ...args: any[]) => console.log(`HybridTaskRunner [INFO] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`HybridTaskRunner [WARN] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`HybridTaskRunner [ERROR] ${message}`, ...args),
};

/**
 * A hybrid scheduler that automatically chooses the best implementation based on interval:
 * - For intervals >= 30 seconds: Uses AlarmTaskRunner (Chrome Alarms API) for persistence
 * - For intervals < 30 seconds: Uses TaskRunner (setTimeout-based) to avoid Chrome's minimum
 * 
 * This provides the best of both worlds: persistence for longer intervals and precision for shorter ones.
 */
export class HybridTaskRunner {
    private task: () => Promise<any>;
    private interval: number;
    private runner: TaskRunner | AlarmTaskRunner;
    private useAlarms: boolean;

    /**
     * Creates an instance of the hybrid scheduler.
     * @param task The async function to execute on each interval.
     * @param interval The delay in milliseconds between task executions.
     */
    constructor(task: () => Promise<any> | any, interval: number = 5000) {
        if (typeof task !== 'function') {
            throw new Error("Task must be a function that returns a Promise.");
        }
        
        this.task = task;
        this.interval = interval;
        
        // Chrome Alarms API has a 30-second (30000ms) minimum
        const ALARM_THRESHOLD = 30000;
        this.useAlarms = interval >= ALARM_THRESHOLD;
        
        if (this.useAlarms) {
            logger.info(`Using AlarmTaskRunner for ${interval}ms interval (>= 30s threshold)`);
            this.runner = new AlarmTaskRunner(task, interval);
        } else {
            logger.info(`Using TaskRunner for ${interval}ms interval (< 30s threshold)`);
            this.runner = new TaskRunner(task, interval);
        }
    }

    /**
     * Starts the execution loop. If already running, it will do nothing.
     * The task is executed once immediately upon starting if executeOnStart is true.
     */
    public async start(executeOnStart: boolean = true): Promise<void> {
        if (this.useAlarms) {
            // AlarmTaskRunner.start() is async
            await (this.runner as AlarmTaskRunner).start(executeOnStart);
        } else {
            // TaskRunner.start() is synchronous
            (this.runner as TaskRunner).start(executeOnStart);
        }
    }

    /**
     * Stops the execution loop. If a task is in progress, it will complete,
     * but no more tasks will be scheduled.
     */
    public async stop(): Promise<void> {
        if (this.useAlarms) {
            // AlarmTaskRunner.stop() is async
            await (this.runner as AlarmTaskRunner).stop();
        } else {
            // TaskRunner.stop() is synchronous
            (this.runner as TaskRunner).stop();
        }
    }

    /**
     * Pauses the execution loop, preserving state for resume.
     * If a task is currently running, it will complete.
     */
    public async pause(): Promise<void> {
        if (this.useAlarms) {
            // AlarmTaskRunner.pause() is async
            await (this.runner as AlarmTaskRunner).pause();
        } else {
            // TaskRunner.pause() is synchronous
            (this.runner as TaskRunner).pause();
        }
    }

    /**
     * Resumes the execution loop from where it was paused.
     */
    public async resume(): Promise<void> {
        if (this.useAlarms) {
            // AlarmTaskRunner.resume() is async
            await (this.runner as AlarmTaskRunner).resume();
        } else {
            // TaskRunner.resume() is synchronous
            (this.runner as TaskRunner).resume();
        }
    }

    /**
     * Returns the current status of the task runner.
     */
    public getStatus(): { isRunning: boolean; isPaused: boolean } {
        return this.runner.getStatus();
    }

    /**
     * Returns information about which implementation is being used.
     */
    public getImplementation(): { type: 'alarms' | 'timer'; interval: number } {
        return {
            type: this.useAlarms ? 'alarms' : 'timer',
            interval: this.interval
        };
    }
}
