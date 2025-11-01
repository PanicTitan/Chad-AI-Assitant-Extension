export function getTheme(): "light" | "dark" {
    // return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    return "light"
}

// Export utility classes
export { AudioCapture } from './AudioCapture';
export { Speech } from './Speech';
export { NotificationManager, getNotificationManager } from './NotificationManager';
export type { NotificationConfig, NotificationOptions, NotificationPermission } from './NotificationManager';
export { BackgroundVoiceRecognition } from './BackgroundVoiceRecognition';
export type { 
    VoiceRecognitionConfig, 
    VoiceRecognitionStatus, 
    KeywordTrigger, 
    VoiceContext, 
    AudioBufferData 
} from './BackgroundVoiceRecognition';
export { UserPreferences, getUserPreferences } from './UserPreferences';
export type { UserPreferencesData, MascotVariant, SpeechEngine } from './UserPreferences';
