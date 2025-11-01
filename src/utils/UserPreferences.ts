/**
 * UserPreferences - Manages user settings and preferences
 * 
 * Stores and retrieves user preferences from IndexedDB using Dexie.
 */

import { db } from './db';

export type MascotVariant = 'yellow' | 'blue' | 'pink';
export type SpeechEngine = 'kokoro' | 'browser';

export interface UserPreferencesData {
    // Setup status
    setupCompleted: boolean;
    
    // User identity
    userName: string;
    
    // Visual preferences
    mascot: MascotVariant;
    
    // AI persona
    persona: string | null; // Model response style/personality
    
    // Speech settings
    speechEngine: SpeechEngine;
    kokoroVoice: string; // Voice ID for Kokoro TTS
    browserVoice: string; // Voice name for browser SpeechSynthesis
    speechRate: number; // 0.1 to 10 (1 = normal)
    speechPitch: number; // 0 to 2 (1 = normal)
    speechVolume: number; // 0 to 1
    
    // Notification preferences
    enableNotifications: boolean;
    enableVoiceAlerts: boolean;
    notificationSound: boolean;
    
    // AI Action Settings
    summarizerType: string;
    summarizerLength: string;
    summarizerLargeContentStrategy: string;
    translatorTargetLanguage: string;
    transcriptionLanguage: string; // Language for Whisper transcription
    explainPrompt: string;
    
    // Assistant Control
    assistantEnabled: boolean;
}

let maybeWindow: Window & typeof globalThis;
try {
    maybeWindow = window;
} catch (error) {
    // @ts-ignore
    maybeWindow = {};
}

export class UserPreferences {
    private static instance: UserPreferences | null = null;
    private preferences: UserPreferencesData;
    // TODO: Connect to IndexedDB in the future
    // private dbName = 'FocusSupervisorDB';
    // private storeName = 'userPreferences';
    // private db: IDBDatabase | null = null;

    // Default preferences
    private static readonly DEFAULT_PREFERENCES: UserPreferencesData = {
        setupCompleted: false,
        userName: 'User',
        mascot: 'yellow',
        persona: null,
        speechEngine: 'kokoro',
        kokoroVoice: 'af_bella', // Default Kokoro voice
        browserVoice: '', // Will be set to first available voice
        speechRate: 1.0,
        speechPitch: 1.0,
        speechVolume: 1.0,
        enableNotifications: true,
        enableVoiceAlerts: true,
        notificationSound: true,
        summarizerType: 'key-points',
        summarizerLength: 'long',
        summarizerLargeContentStrategy: 'join',
        translatorTargetLanguage: maybeWindow?.navigator?.language ?? 'en',
        transcriptionLanguage: (maybeWindow?.navigator?.language?.split('-')[0] ?? 'en').toLowerCase(),
        explainPrompt: '',
        assistantEnabled: true,
    };

    private constructor() {
        // Initialize with default preferences (mocked data for now)
        this.preferences = { ...UserPreferences.DEFAULT_PREFERENCES };
    }

    /**
     * Get singleton instance
     */
    public static getInstance(): UserPreferences {
        if (!UserPreferences.instance) {
            UserPreferences.instance = new UserPreferences();
        }
        return UserPreferences.instance;
    }

    /**
     * Initialize IndexedDB connection and load preferences
     */
    public async initialize(): Promise<void> {
        console.log('[UserPreferences] Initializing from IndexedDB...');
        
        try {
            const stored = await db.userPreferences.get('current');
            if (stored) {
                const { id, ...prefs } = stored;
                this.preferences = { ...UserPreferences.DEFAULT_PREFERENCES, ...prefs };
                console.log('[UserPreferences] Loaded from IndexedDB:', this.preferences);
            } else {
                // No preferences stored yet, save defaults
                console.log('[UserPreferences] No stored preferences, using defaults');
                await this.save();
            }
        } catch (error) {
            console.error('[UserPreferences] Failed to load from IndexedDB:', error);
            // Fallback to defaults
            this.preferences = { ...UserPreferences.DEFAULT_PREFERENCES };
        }
    }

    /**
     * Get all preferences
     */
    public getAll(): UserPreferencesData {
        return { ...this.preferences };
    }

    /**
     * Get a specific preference
     */
    public get<K extends keyof UserPreferencesData>(key: K): UserPreferencesData[K] {
        return this.preferences[key];
    }

    /**
     * Set a specific preference
     */
    public async set<K extends keyof UserPreferencesData>(
        key: K,
        value: UserPreferencesData[K]
    ): Promise<void> {
        this.preferences[key] = value;
        await this.save();
    }

    /**
     * Update multiple preferences at once
     */
    public async update(updates: Partial<UserPreferencesData>): Promise<void> {
        this.preferences = { ...this.preferences, ...updates };
        await this.save();
    }

    /**
     * Reset to default preferences
     */
    public async reset(): Promise<void> {
        this.preferences = { ...UserPreferences.DEFAULT_PREFERENCES };
        await this.save();
    }

    /**
     * Save preferences to IndexedDB
     */
    private async save(): Promise<void> {
        try {
            const existing = await db.userPreferences.get('current');
            if (existing) {
                await db.userPreferences.update('current', this.preferences);
            } else {
                await db.userPreferences.put({ id: 'current', ...this.preferences });
            }
            console.log('[UserPreferences] Saved to IndexedDB');
        } catch (error) {
            console.error('[UserPreferences] Failed to save:', error);
            throw new Error('Failed to save preferences');
        }
    }

    /**
     * Get persona prompt for AI
     */
    public getPersonaPrompt(): string {
        if (!this.preferences.persona) {
            return '';
        }
        
        return `You are speaking as: ${this.preferences.persona}. Maintain this personality in your responses.`;
    }

    /**
     * Get user's preferred name
     */
    public getUserName(): string {
        return this.preferences.userName;
    }

    /**
     * Get mascot variant
     */
    public getMascot(): MascotVariant {
        return this.preferences.mascot;
    }

    /**
     * Get speech engine preference
     */
    public getSpeechEngine(): SpeechEngine {
        return this.preferences.speechEngine;
    }

    /**
     * Get voice settings for current speech engine
     */
    public getVoiceSettings(): {
        engine: SpeechEngine;
        voice: string;
        rate: number;
        pitch: number;
        volume: number;
    } {
        return {
            engine: this.preferences.speechEngine,
            voice: this.preferences.speechEngine === 'kokoro' 
                ? this.preferences.kokoroVoice 
                : this.preferences.browserVoice,
            rate: this.preferences.speechRate,
            pitch: this.preferences.speechPitch,
            volume: this.preferences.speechVolume,
        };
    }

    /**
     * Check if voice alerts are enabled
     */
    public isVoiceAlertsEnabled(): boolean {
        return this.preferences.enableVoiceAlerts;
    }

    /**
     * Check if notifications are enabled
     */
    public isNotificationsEnabled(): boolean {
        return this.preferences.enableNotifications;
    }

    /**
     * Get transcription language
     */
    public getTranscriptionLanguage(): string {
        return this.preferences.transcriptionLanguage;
    }

    /**
     * Set transcription language
     */
    public async setTranscriptionLanguage(language: string): Promise<void> {
        this.preferences.transcriptionLanguage = language;
        await this.save();
    }

    /**
     * Get AI action settings
     */
    public getSummarizerSettings(): { type: string; length: string; largeContentStrategy: string } {
        return {
            type: this.preferences.summarizerType,
            length: this.preferences.summarizerLength,
            largeContentStrategy: this.preferences.summarizerLargeContentStrategy,
        };
    }

    public getTranslatorSettings(): { targetLanguage: string } {
        return {
            targetLanguage: this.preferences.translatorTargetLanguage,
        };
    }

    public getExplainPrompt(): string {
        return this.preferences.explainPrompt;
    }

    /**
     * Get assistant enabled state
     */
    public isAssistantEnabled(): boolean {
        return this.preferences.assistantEnabled;
    }

    /**
     * Check if initial setup is completed
     */
    public isSetupCompleted(): boolean {
        return this.preferences.setupCompleted;
    }

    /**
     * Mark setup as completed
     */
    public async completeSetup(): Promise<void> {
        await this.set('setupCompleted', true);
    }

    /**
     * Destroy instance (cleanup)
     */
    public static destroy(): void {
        if (UserPreferences.instance) {
            UserPreferences.instance = null;
        }
    }
}

// Export default instance getter
export const getUserPreferences = () => UserPreferences.getInstance();
