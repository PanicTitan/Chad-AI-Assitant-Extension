import { MonitorCapture } from '@/utils/MonitorCapture';
import { TaskRunner } from '@/utils/TaskRunner';
import { LanguageModelEx } from '@/utils/built-in-ai-ex/LanguageModelEx';
import type { SupervisorConfig } from '../supervisor/SupervisorControls';
import type { AlertEvent } from '../supervisor/SupervisorStats';

const logger = {
    info: (message: string, ...args: any[]) => console.log(`[Supervisor INFO] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`[Supervisor WARN] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`[Supervisor ERROR] ${message}`, ...args),
};

export interface SupervisorCallbacks {
    onAlert: (reason: string) => void;
    onFocusChange: (isFocused: boolean) => void;
    onStop: () => void;
}

export interface SupervisorSession {
    startTime: Date;
    alerts: AlertEvent[];
    focusedTime: number;
    totalTime: number;
    activityLog: Array<{ time: Date; description: string; focused: boolean }>;
}

/**
 * Main Supervisor class that orchestrates screen monitoring and AI analysis
 */
export class Supervisor {
    private config: SupervisorConfig;
    private callbacks: SupervisorCallbacks;
    
    private monitorCapture: MonitorCapture;
    private taskRunner: TaskRunner | null = null;
    private languageModel: LanguageModelEx | null = null;
    
    private session: SupervisorSession;
    private isRunning: boolean = false;
    private isPaused: boolean = false;
    
    private lastCheckTime: Date | null = null;

    constructor(config: SupervisorConfig, callbacks: SupervisorCallbacks) {
        this.config = config;
        this.callbacks = callbacks;
        this.monitorCapture = new MonitorCapture();
        
        this.session = {
            startTime: new Date(),
            alerts: [],
            focusedTime: 0,
            totalTime: 0,
            activityLog: [],
        };
    }

    /**
     * Start the supervision session
     */
    async start(): Promise<boolean> {
        if (this.isRunning) {
            logger.warn('Supervisor is already running');
            return false;
        }

        logger.info('Starting supervisor session...');

        // Start screen capture
        const captureStarted = await this.monitorCapture.start(() => {
            logger.info('Screen capture stopped by user');
            this.stop();
        });

        if (!captureStarted) {
            logger.error('Failed to start screen capture');
            return false;
        }

        // Initialize the language model
        try {
            await this.initializeLanguageModel();
        } catch (error) {
            logger.error('Failed to initialize language model:', error);
            this.monitorCapture.stop();
            return false;
        }

        // Start the task runner for periodic checks
        this.taskRunner = new TaskRunner(
            () => this.performCheck(),
            this.config.checkInterval * 1000
        );
        this.taskRunner.start();

        this.isRunning = true;
        this.session.startTime = new Date();
        logger.info('Supervisor session started successfully');

        return true;
    }

    /**
     * Pause the supervision (stops checks but keeps capture active)
     */
    pause(): void {
        if (!this.isRunning || this.isPaused) return;
        
        logger.info('Pausing supervisor...');
        this.isPaused = true;
        this.taskRunner?.stop();
    }

    /**
     * Resume the supervision
     */
    resume(): void {
        if (!this.isRunning || !this.isPaused) return;
        
        logger.info('Resuming supervisor...');
        this.isPaused = false;
        
        if (this.taskRunner) {
            this.taskRunner.start();
        }
    }

    /**
     * Stop the supervision session completely
     */
    stop(): void {
        if (!this.isRunning) return;
        
        logger.info('Stopping supervisor session...');
        
        this.taskRunner?.stop();
        this.monitorCapture.stop();
        this.languageModel?.destroy();
        
        this.isRunning = false;
        this.isPaused = false;
        
        this.callbacks.onStop();
        logger.info('Supervisor session stopped');
    }

    /**
     * Get the current session data
     */
    getSession(): SupervisorSession {
        return { ...this.session };
    }

    /**
     * Initialize the language model with the task context
     */
    private async initializeLanguageModel(): Promise<void> {
        logger.info('Initializing language model...');

        const systemPromptContent = this.buildSystemPrompt();
        
        this.languageModel = await LanguageModelEx.create({
            initialPrompts: [
                {
                    role: 'system',
                    content: systemPromptContent,
                },
            ],
            temperature: 0.7,
            topK: 20,
        });

        // Warm up the model
        const warmupStart = performance.now();
        await this.languageModel.prompt('');
        const warmupTime = performance.now() - warmupStart;
        logger.info(`Language model warmed up in ${warmupTime.toFixed(2)}ms`);
    }

    /**
     * Build the system prompt based on config
     */
    private buildSystemPrompt(): string {
        const rigorInstructions = {
            low: 'Be lenient - only flag clear distractions like social media or entertainment.',
            medium: 'Be balanced - flag activities that seem unrelated to the task.',
            high: 'Be strict - flag any activity that is not directly working on the exact task.',
        };

        return `You are a focus supervisor monitoring a user working on the following task:
"${this.config.task}"

Your job is to analyze screenshots of the user's screen and determine if they are ON TASK or OFF TASK.

Rigor level: ${this.config.rigor} - ${rigorInstructions[this.config.rigor]}

Respond in this exact JSON format:
{
  "focused": true/false,
  "activity": "brief description of what user is doing",
  "reason": "explanation if off-task, empty string if on-task"
}

Be concise. Focus on accuracy.`;
    }

    /**
     * Perform a single check cycle
     */
    private async performCheck(): Promise<void> {
        if (this.isPaused || !this.isRunning) return;

        const checkStartTime = performance.now();
        logger.info('Performing check...');

        try {
            // Capture the screen
            const screenshot = await this.monitorCapture.captureFrame({
                scale: 0.5,
                imageFormat: 'image/webp',
                quality: 0.8,
            });

            if (!screenshot) {
                logger.error('Failed to capture screenshot');
                return;
            }

            logger.info(`Screenshot captured (${(screenshot.size / 1024).toFixed(2)} KB)`);

            // Analyze with AI
            const analysis = await this.analyzeScreenshot(screenshot);
            
            if (analysis) {
                const checkTime = new Date();
                
                // Log the activity
                this.session.activityLog.push({
                    time: checkTime,
                    description: analysis.activity,
                    focused: analysis.focused,
                });

                // Update focus metrics
                if (this.lastCheckTime) {
                    const timeSinceLastCheck = (checkTime.getTime() - this.lastCheckTime.getTime()) / 1000;
                    if (analysis.focused) {
                        this.session.focusedTime += timeSinceLastCheck;
                    }
                }
                this.lastCheckTime = checkTime;

                // Handle off-task detection
                if (!analysis.focused) {
                    const alertEvent: AlertEvent = {
                        time: checkTime,
                        reason: analysis.reason || 'Off-task activity detected',
                    };
                    this.session.alerts.push(alertEvent);
                    this.callbacks.onAlert(alertEvent.reason);
                    logger.warn(`OFF TASK: ${analysis.reason}`);
                } else {
                    logger.info(`ON TASK: ${analysis.activity}`);
                }

                // Notify focus change
                this.callbacks.onFocusChange(analysis.focused);
            }

            const checkDuration = performance.now() - checkStartTime;
            logger.info(`Check completed in ${checkDuration.toFixed(2)}ms`);

        } catch (error) {
            logger.error('Error during check:', error);
        }
    }

    /**
     * Analyze a screenshot with the AI model
     */
    private async analyzeScreenshot(screenshot: Blob): Promise<{
        focused: boolean;
        activity: string;
        reason: string;
    } | null> {
        if (!this.languageModel) {
            logger.error('Language model not initialized');
            return null;
        }

        try {
            const analysisStart = performance.now();
            
            const response = await this.languageModel.prompt([
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            value: screenshot,
                        },
                        {
                            type: 'text',
                            value: 'Analyze this screenshot and respond in JSON format.',
                        },
                    ],
                },
            ]);

            const analysisTime = performance.now() - analysisStart;
            logger.info(`AI analysis completed in ${analysisTime.toFixed(2)}ms`);

            // Parse the JSON response
            try {
                // Extract JSON from response (handle potential markdown code blocks)
                let jsonText = response.trim();
                const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonText = jsonMatch[0];
                }
                
                const parsed = JSON.parse(jsonText);
                return {
                    focused: parsed.focused === true,
                    activity: parsed.activity || 'Unknown activity',
                    reason: parsed.reason || '',
                };
            } catch (parseError) {
                logger.error('Failed to parse AI response:', response);
                // Fallback: try to determine from text
                const lowerResponse = response.toLowerCase();
                const focused = lowerResponse.includes('on task') || lowerResponse.includes('focused');
                return {
                    focused,
                    activity: response,
                    reason: focused ? '' : 'Unable to parse detailed reason',
                };
            }

        } catch (error) {
            logger.error('Error analyzing screenshot:', error);
            return null;
        }
    }

    /**
     * Generate final summary using AI
     */
    async generateSummary(): Promise<{
        activitySummary: string;
        distractionSummary: string;
    }> {
        if (!this.languageModel || this.session.activityLog.length === 0) {
            return {
                activitySummary: 'No activity recorded during this session.',
                distractionSummary: '',
            };
        }

        try {
            // Create a summary of the activity log
            const activitySummaryText = this.session.activityLog
                .map(log => `${log.time.toLocaleTimeString()}: ${log.description} (${log.focused ? 'focused' : 'distracted'})`)
                .join('\n');

            const summaryPrompt = `Based on this activity log, provide two summaries in JSON format:

Activity Log:
${activitySummaryText}

Task: "${this.config.task}"

Respond with:
{
  "activitySummary": "2-3 sentences about what the user accomplished and worked on",
  "distractionSummary": "2-3 sentences about distractions encountered, or empty string if none"
}`;

            const response = await this.languageModel.prompt(summaryPrompt);
            
            try {
                let jsonText = response.trim();
                const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    jsonText = jsonMatch[0];
                }
                
                const parsed = JSON.parse(jsonText);
                return {
                    activitySummary: parsed.activitySummary || 'Activity summary not available.',
                    distractionSummary: parsed.distractionSummary || '',
                };
            } catch (parseError) {
                logger.error('Failed to parse summary response');
                return {
                    activitySummary: response.substring(0, 200),
                    distractionSummary: '',
                };
            }

        } catch (error) {
            logger.error('Error generating summary:', error);
            return {
                activitySummary: 'Summary generation failed.',
                distractionSummary: '',
            };
        }
    }

    /**
     * Check if supervisor is currently running
     */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Check if supervisor is paused
     */
    getPausedState(): boolean {
        return this.isPaused;
    }
}
