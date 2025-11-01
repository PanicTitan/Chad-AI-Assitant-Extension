/** A simple structured logger for consistent console output. */
export const logger = {
    info: (message: string, ...args: any[]) => console.log(`[AI AI] ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.warn(`[AI AI] ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`[AI AI] ${message}`, ...args),
};
