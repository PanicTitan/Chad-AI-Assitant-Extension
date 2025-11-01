import Dexie, { type Table } from 'dexie';

export interface UserPreferencesRecord {
    id: string; // Always 'current' for single user preferences
    setupCompleted: boolean;
    userName: string;
    mascot: 'yellow' | 'blue' | 'pink';
    persona: string | null;
    speechEngine: 'kokoro' | 'browser';
    kokoroVoice: string;
    browserVoice: string;
    speechRate: number;
    speechPitch: number;
    speechVolume: number;
    enableNotifications: boolean;
    enableVoiceAlerts: boolean;
    notificationSound: boolean;
    // AI Action Settings
    summarizerType: string;
    summarizerLength: string;
    summarizerLargeContentStrategy: string;
    translatorTargetLanguage: string;
    explainPrompt: string;
    // Assistant Control
    assistantEnabled: boolean;
}

export interface SupervisorTaskHistoryRecord {
    id: string;
    task: string;
    startTime: Date;
    endTime: Date;
    duration: number;
    alertCount: number;
    completed: boolean;
    config: any; // SupervisorConfig type
}

// Chat context types
export type ChatContextData = 
    | { reason: 'selected-text'; url: string; title: string; context: string }
    | { reason: 'omnibox'; context: string }
    | { reason: 'fullpage-chat'; url: string; title: string; pageContent: string };

export interface ChatContextRecord {
    id: string; // timestamp-based unique id
    data: ChatContextData; // Structured context data
    timestamp: Date;
    used: boolean; // Whether this context has been used in chat
}

export class AssistantDatabase extends Dexie {
    userPreferences!: Table<UserPreferencesRecord, string>;
    supervisorTaskHistory!: Table<SupervisorTaskHistoryRecord, string>;
    chatContext!: Table<ChatContextRecord, string>;

    constructor() {
        super('AssistantDatabase');
        
        this.version(1).stores({
            userPreferences: 'id',
        });
        
        // Version 2: Add supervisor task history
        this.version(2).stores({
            userPreferences: 'id',
            supervisorTaskHistory: 'id, startTime',
        });
        
        // Version 3: Add chat context for agent chat
        this.version(3).stores({
            userPreferences: 'id',
            supervisorTaskHistory: 'id, startTime',
            chatContext: 'id, timestamp, used',
        });
    }
}

// Create a singleton instance
export const db = new AssistantDatabase();

// Helper functions for user preferences
export async function getUserPreferences(): Promise<Partial<UserPreferencesRecord>> {
    const prefs = await db.userPreferences.get('current');
    if (!prefs) {
        return {};
    }
    const { id, ...rest } = prefs;
    return rest;
}

export async function setUserPreferences(updates: Partial<UserPreferencesRecord>): Promise<void> {
    const existing = await db.userPreferences.get('current');
    if (existing) {
        await db.userPreferences.update('current', updates);
    } else {
        await db.userPreferences.put({ id: 'current', ...updates } as UserPreferencesRecord);
    }
}

export async function getAllUserPreferences(): Promise<UserPreferencesRecord | undefined> {
    return await db.userPreferences.get('current');
}

// Helper functions for supervisor task history
export async function getSupervisorTaskHistory(limit: number = 5): Promise<SupervisorTaskHistoryRecord[]> {
    return await db.supervisorTaskHistory
        .orderBy('startTime')
        .reverse()
        .limit(limit)
        .toArray();
}

export async function addSupervisorTaskHistory(task: SupervisorTaskHistoryRecord): Promise<void> {
    await db.supervisorTaskHistory.add(task);
    
    // Keep only last 5 tasks
    const allTasks = await db.supervisorTaskHistory
        .orderBy('startTime')
        .reverse()
        .toArray();
    
    if (allTasks.length > 5) {
        const tasksToDelete = allTasks.slice(5);
        await db.supervisorTaskHistory.bulkDelete(tasksToDelete.map(t => t.id));
    }
}

export async function clearSupervisorTaskHistory(): Promise<void> {
    await db.supervisorTaskHistory.clear();
}

// Helper functions for chat context
export async function saveChatContext(data: ChatContextData): Promise<string> {
    // Clear all old contexts before saving new one (keep only the latest)
    await db.chatContext.clear();
    console.log('[DB] Cleared old contexts');
    
    const id = `ctx-${Date.now()}`;
    const newContext: ChatContextRecord = {
        id,
        data,
        timestamp: new Date(),
        used: false,
    };
    console.log('[DB] Saving chat context:', newContext);
    await db.chatContext.add(newContext);
    console.log('[DB] Chat context saved successfully:', id);
    return id;
}

export async function getUnusedChatContext(): Promise<ChatContextRecord | undefined> {
    console.log('[DB] Querying for unused chat context...');
    
    // Get the most recent unused context
    const result = await db.chatContext
        .filter(ctx => !ctx.used)
        .reverse() // Get most recent first
        .first();
    
    console.log('[DB] Query result:', result);
    
    // Delete it immediately after retrieving (one-time transport)
    if (result) {
        await db.chatContext.delete(result.id);
        console.log('[DB] Context deleted after retrieval:', result.id);
    }
    
    return result;
}

export async function markChatContextAsUsed(id: string): Promise<void> {
    // This function is no longer needed since we delete on fetch
    // But keeping it for backwards compatibility
    await db.chatContext.delete(id);
}

// Clear old contexts, keep only the last one
export async function clearOldContexts(): Promise<void> {
    const allContexts = await db.chatContext.orderBy('timestamp').reverse().toArray();
    if (allContexts.length > 1) {
        // Delete all except the most recent
        const toDelete = allContexts.slice(1).map(ctx => ctx.id);
        await db.chatContext.bulkDelete(toDelete);
        console.log('[DB] Cleared old contexts, kept latest');
    }
}

export async function clearOldChatContexts(keepCount: number = 10): Promise<void> {
    const allContexts = await db.chatContext
        .orderBy('timestamp')
        .reverse()
        .toArray();
    
    if (allContexts.length > keepCount) {
        const contextsToDelete = allContexts.slice(keepCount);
        await db.chatContext.bulkDelete(contextsToDelete.map(c => c.id));
    }
}
