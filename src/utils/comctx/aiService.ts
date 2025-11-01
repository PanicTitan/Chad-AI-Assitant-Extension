import { defineProxy } from "comctx";
import type { LanguageModelExCreateOptions } from "../built-in-ai-ex/LanguageModelEx";
import { LanguageModelEx } from "../built-in-ai-ex/LanguageModelEx";
import { SummarizerEx } from "../built-in-ai-ex/SummarizerEx";
import type { SummarizerExCreateOptions } from "../built-in-ai-ex/SummarizerEx";
import { TranslatorEx } from "../built-in-ai-ex/TranslatorEx";
import type { TranslatorExCreateOptions } from "../built-in-ai-ex/TranslatorEx";
import { WriterEx } from "../built-in-ai-ex/WriterEx";
import type { WriterExCreateOptions } from "../built-in-ai-ex/WriterEx";
import { RewriterEx } from "../built-in-ai-ex/RewriterEx";
import type { RewriterExCreateOptions } from "../built-in-ai-ex/RewriterEx";
import { BackgroundAdapter } from "./BackgroundAdapter";
import { ContentAdapter } from "./ContentAdapter";
import { OffscreenAdapter } from "./OffscreenAdapter";
import { BackgroundOffscreenAdapter } from "./BackgroundOffscreenAdapter";
import {
	COMCTX_NAMESPACE_CONTENT,
	COMCTX_NAMESPACE_OFFSCREEN,
} from "./constants";
import { ensureOffscreenDocument } from "../offscreenManager";
import { fetchPageText } from "../extensionHelper";
import { Speech } from "../Speech";
import { AudioCapture } from "../AudioCapture";
import { getUserPreferences } from "../UserPreferences";
import { WhisperTranscriberWorkerClient } from "../WhisperTranscriberWorkerClient";
import { getUnusedChatContext, saveChatContext } from "../db";

const nonThenableCache = new WeakMap<object, object>();

function makeNonThenable<T extends object>(value: T): T {
	if (value === null) return value;
	const typeofValue = typeof value;
	if (typeofValue !== "object" && typeofValue !== "function") {
		return value;
	}
	const existing = nonThenableCache.get(value as unknown as object);
	if (existing) {
		return existing as T;
	}
	const proxy = new Proxy(value as unknown as object, {
		get(target, prop, receiver) {
			if (prop === "then") {
				return undefined;
			}
			return Reflect.get(target, prop, receiver);
		},
		has(target, prop) {
			if (prop === "then") {
				return false;
			}
			return Reflect.has(target, prop);
		},
	});
	nonThenableCache.set(value as unknown as object, proxy);
	return proxy as unknown as T;
}

export interface RemoteLanguageModelHandle {
	handleId: string;
}

export interface LanguageModelPromptArgs {
	handleId: string;
	input: LanguageModelPrompt;
	options?: LanguageModelPromptOptions;
}

export interface LanguageModelAppendArgs {
	handleId: string;
	input: LanguageModelPrompt;
	options?: LanguageModelAppendOptions;
}

export interface LanguageModelCloneArgs {
	handleId: string;
	options?: LanguageModelCloneOptions;
}

export interface SummarizeTextArgs {
	text: string;
	options?: SummarizerExCreateOptions;
}

export interface TranslateTextArgs {
	text: string;
	options?: TranslatorExCreateOptions;
}

export interface RewriteTextArgs {
	text: string;
	options?: RewriterExCreateOptions;
}

export interface WriteTextArgs {
	text: string;
	options?: WriterExCreateOptions;
}

export interface TranscribeAudioArgs {
	audioBlob: { base64: string; type: string };
	chunkDuration?: number; // Duration in seconds for each chunk, default 30
}

export type ChatContextData = 
    | { reason: 'selected-text'; url: string; title: string; context: string }
    | { reason: 'omnibox'; context: string }
    | { reason: 'fullpage-chat'; url: string; title: string; pageContent: string };

export interface ChatContextRecord {
    id: string;
    data: ChatContextData;
    timestamp: Date;
    used: boolean;
}

function normalizeLanguageTag(tag?: string | null): string | undefined {
	if (!tag) return undefined;
	try {
		const [canonical] = Intl.getCanonicalLocales(tag);
		return canonical?.toLowerCase();
	} catch (error) {
		console.debug("Language normalization failed", tag, error);
		return tag.toLowerCase();
	}
}

function getLanguageBase(tag?: string): string | undefined {
	if (!tag) return undefined;
	try {
		return new Intl.Locale(tag).language;
	} catch (error) {
		console.debug("Language base extraction failed", tag, error);
		return tag.split("-")[0];
	}
}

export interface SpeechInitOptions {
	loadKokoro?: boolean;
	kokoroModelId?: string;
	kokoroDtype?: 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';
	kokoroDevice?: 'webgpu' | 'wasm';
}

export interface SpeakArgs {
	text: string;
	voice?: string;
	rate?: number;
	pitch?: number;
	volume?: number;
	engine?: 'kokoro' | 'browser';
}

export interface OffscreenAiService {
	ping(): Promise<string>;
	languageModelCreate(options: LanguageModelExCreateOptions): Promise<RemoteLanguageModelHandle>;
	languageModelPrompt(args: LanguageModelPromptArgs): Promise<string>;
	languageModelAppend(args: LanguageModelAppendArgs): Promise<void>;
	languageModelClone(args: LanguageModelCloneArgs): Promise<void>;
	languageModelDestroy(handleId: string): Promise<void>;
	summarizeText(args: SummarizeTextArgs): Promise<string>;
	translateText(args: TranslateTextArgs): Promise<string>;
	rewriteText(args: RewriteTextArgs): Promise<string>;
	writeText(args: WriteTextArgs): Promise<string>;
	transcribeAudio(args: TranscribeAudioArgs): Promise<string>;
	speechInit(options: SpeechInitOptions): Promise<{ kokoro: boolean; browser: boolean }>;
	speechSpeak(args: SpeakArgs): Promise<void>;
	speechStop(): Promise<void>;
	getPreferences(): Promise<{
		personaPrompt: string;
		summarizerSettings: { type: string; length: string; largeContentStrategy: string };
		translatorSettings: { targetLanguage: string };
		voiceSettings: { engine: string; voice: string; rate: number; pitch: number; volume: number };
		explainPrompt: string;
		mascot: string;
		assistantEnabled: boolean;
	}>;
	saveSummarizerSettings(settings: { type: string; length: string; largeContentStrategy: string }): Promise<void>;
	saveTranslatorSettings(settings: { targetLanguage: string }): Promise<void>;
	saveExplainPrompt(prompt: string): Promise<void>;
	saveChatContext(data: ChatContextData): Promise<string>;
	getChatContext(): Promise<ChatContextRecord | null>;
	openSidepanel(): Promise<void>;
}

/**
 * Convert base64 string to Blob
 * @param base64 - Base64 encoded string
 * @param mimeType - MIME type for the blob
 * @returns Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return new Blob([bytes], { type: mimeType });
}

class OffscreenAiServiceImpl implements OffscreenAiService {
	private readonly languageModels = new Map<string, LanguageModelEx>();

	public async ping(): Promise<string> {
		return "pong";
	}

	public async languageModelCreate(options: LanguageModelExCreateOptions): Promise<RemoteLanguageModelHandle> {
		const model = await LanguageModelEx.create(options);
		const handleId = crypto.randomUUID();
		this.languageModels.set(handleId, model);
		return { handleId };
	}

	private getModel(handleId: string): LanguageModelEx {
		const model = this.languageModels.get(handleId);
		if (!model) {
			throw new Error(`LanguageModel handle ${handleId} not found`);
		}
		return model;
	}

	public async languageModelPrompt({ handleId, input, options }: LanguageModelPromptArgs): Promise<string> {
		console.log("[aiService] languageModelPrompt called, input:", typeof input === 'string' ? `string(${input.length})` : `array(${input.length})`);
		const model = this.getModel(handleId);
		
		// Convert base64 image/audio data back to blob for AI processing
		const processedInput = Array.isArray(input) ? input.map((msg) => {
			if (typeof msg === 'object' && 'content' in msg && Array.isArray(msg.content)) {
				return {
					...msg,
					content: msg.content.map((contentItem: any) => {
						// Handle image base64 conversion
						if (contentItem.type === 'image' && contentItem.value && typeof contentItem.value === 'object' && 'base64' in contentItem.value) {
							console.log("[aiService] Converting base64 image back to blob, type:", contentItem.value.type);
							const blob = base64ToBlob(contentItem.value.base64, contentItem.value.type || 'image/jpeg');
							console.log("[aiService] Converted image blob size:", blob.size, "type:", blob.type);
							return { type: 'image', value: blob };
						}
						// Handle audio base64 conversion
						if (contentItem.type === 'audio' && contentItem.value && typeof contentItem.value === 'object' && 'base64' in contentItem.value) {
							console.log("[aiService] Converting base64 audio back to blob, type:", contentItem.value.type);
							const blob = base64ToBlob(contentItem.value.base64, contentItem.value.type || 'audio/webm');
							console.log("[aiService] Converted audio blob size:", blob.size, "type:", blob.type);
							return { type: 'audio', value: blob };
						}
						return contentItem;
					})
				};
			}
			return msg;
		}) : input;
		
		console.log("[aiService] Calling model.prompt with processed input");
		return model.prompt(processedInput as LanguageModelPrompt, options);
	}

	public async languageModelAppend({ handleId, input, options }: LanguageModelAppendArgs): Promise<void> {
		const model = this.getModel(handleId);
		await model.append(input, options);
	}

	public async languageModelClone({ handleId, options }: LanguageModelCloneArgs): Promise<void> {
		const model = this.getModel(handleId);
		await model.clone(options);
	}

	public async languageModelDestroy(handleId: string): Promise<void> {
		const model = this.languageModels.get(handleId);
		if (!model) return;
		model.destroy();
		this.languageModels.delete(handleId);
	}

	public async summarizeText({ text, options }: SummarizeTextArgs): Promise<string> {
		const summarizer = await SummarizerEx.create(options ?? { type: "tldr", length: "medium" });
		try {
			return await summarizer.summarize(text);
		} finally {
			summarizer.destroy?.();
		}
	}

	public async translateText({ text, options }: TranslateTextArgs): Promise<string> {
		const translatorOptions: Partial<TranslatorExCreateOptions> = {
			...(options ?? {}),
		};
		if (!translatorOptions.targetLanguage) {
			translatorOptions.targetLanguage = navigator.language ?? "en";
		}
		if (!translatorOptions.sourceLanguage) {
			try {
				const detected = await TranslatorEx.autoDetect(text);
				const detectedLanguage = (detected as any)?.detectedLanguage
					?? (detected as any)?.language
					?? (detected as any)?.detectedLanguages?.[0]?.detectedLanguage
					?? (detected as any)?.languages?.[0]?.language;
				translatorOptions.sourceLanguage = detectedLanguage ?? translatorOptions.targetLanguage;
			} catch (error) {
				console.warn("TranslatorEx auto-detect failed", error);
				translatorOptions.sourceLanguage = translatorOptions.targetLanguage;
			}
		}
		const targetNormalized = normalizeLanguageTag(translatorOptions.targetLanguage);
		const sourceNormalized = normalizeLanguageTag(translatorOptions.sourceLanguage);
		const sourceBase = getLanguageBase(sourceNormalized);
		const targetBase = getLanguageBase(targetNormalized);
		console.debug("translateText request", {
			sourceLanguage: translatorOptions.sourceLanguage,
			targetLanguage: translatorOptions.targetLanguage,
			sourceNormalized,
			targetNormalized,
			sourceBase,
			targetBase,
			textPreview: text.slice(0, 48),
		});
		if (sourceBase && targetBase && sourceBase === targetBase) {
			console.debug("Skipping translation because languages match", { sourceBase, targetBase });
			return text;
		}
		try {
			const translator = await TranslatorEx.create({
				...translatorOptions,
				sourceLanguage: sourceNormalized ?? translatorOptions.sourceLanguage,
				targetLanguage: targetNormalized ?? translatorOptions.targetLanguage,
			} as TranslatorExCreateOptions);
			try {
				const translated = await translator.translate(text);
				return translated;
			} finally {
				translator.destroy?.();
			}
		} catch (error) {
			console.warn("TranslatorEx create failed, returning original text", {
				error,
				sourceLanguage: translatorOptions.sourceLanguage,
				targetLanguage: translatorOptions.targetLanguage,
			});
			return text;
		}
	}

	public async rewriteText({ text, options }: RewriteTextArgs): Promise<string> {
		const rewriterOptions = (options ?? {}) as RewriterExCreateOptions;
		const rewriter = await RewriterEx.create(rewriterOptions);
		try {
			return await rewriter.rewrite(text);
		} finally {
			rewriter.destroy?.();
		}
	}

	public async writeText({ text, options }: WriteTextArgs): Promise<string> {
		const writer = await WriterEx.create(options ?? { tone: "neutral", format: "plain-text", outputLanguage: navigator.language ?? "en" });
		try {
			return await writer.write(text);
		} finally {
			writer.destroy?.();
		}
	}

	public async transcribeAudio({ audioBlob, chunkDuration = 30 }: TranscribeAudioArgs): Promise<string> {
		console.log("[aiService] transcribeAudio called, base64 length:", audioBlob.base64.length);
		
		try {
			// Convert base64 back to blob
			console.log("[aiService] Converting base64 audio back to blob");
			const blob = base64ToBlob(audioBlob.base64, audioBlob.type || 'audio/webm');
			console.log("[aiService] Audio blob reconstructed - size:", blob.size, "type:", blob.type);
			
			// Get user preferences for transcription language
			// const { getUserPreferences } = await import('../UserPreferences');
			const userPrefs = getUserPreferences();
			const transcriptionLang = userPrefs.getTranscriptionLanguage();
			
			// Use WhisperTranscriberWorkerClient to run in background (prevents UI lag)
			// const { WhisperTranscriberWorkerClient } = await import('../WhisperTranscriberWorkerClient');
			const transcriber = new WhisperTranscriberWorkerClient();
			
			console.log("[aiService] Starting Whisper transcription in worker");
			const result = await transcriber.oneShotTranscribe(blob, {
				language: transcriptionLang,
			});
			
			console.log("[aiService] Transcription complete:", result.text.substring(0, 100));
			console.log("[aiService] Chunks:", result.chunks.length, "TPS:", result.tps);
			
			return result.text;
			
		} catch (error: any) {
			console.error("[aiService] Transcription error:", error);
			throw new Error('Failed to transcribe audio: ' + (error instanceof Error ? error.message : String(error)));
		}
	}

    speechOptions!: SpeechInitOptions;

	public async speechInit(options: SpeechInitOptions): Promise<{ kokoro: boolean; browser: boolean }> {
        this.speechOptions = options

		let init = await Speech.init({
			loadKokoro: options.loadKokoro,
			kokoroModelId: options.kokoroModelId,
			kokoroDtype: options.kokoroDtype,
			kokoroDevice: options.kokoroDevice,
		});
        
        await Speech.reset();

        return init;
	}

	public async speechSpeak(args: SpeakArgs): Promise<void> {
        try {
            try {
                await Speech.reset();
            } catch (error) {
                
            }
            // This is needed because the offscreen can be disposed at any time and the next iteration will need to init again
            await Speech.init(this.speechOptions);
            await Speech.speak({
                text: args.text,
                voice: args.voice,
                rate: args.rate,
                pitch: args.pitch,
                volume: args.volume,
                engine: args.engine,
            });
            await Speech.reset();
        } catch (error) {
            
        }
	}

	public async speechStop(): Promise<void> {
		try {
            Speech.stop();
        } catch (error) {
            
        }
	}

	public async getPreferences(): Promise<{
		personaPrompt: string;
		summarizerSettings: { type: string; length: string; largeContentStrategy: string };
		translatorSettings: { targetLanguage: string };
		voiceSettings: { engine: string; voice: string; rate: number; pitch: number; volume: number };
		explainPrompt: string;
		mascot: string;
		assistantEnabled: boolean;
	}> {
		// const { getUserPreferences } = await import('../UserPreferences');
		const prefs = getUserPreferences();
		await prefs.initialize();
		return {
			personaPrompt: prefs.getPersonaPrompt(),
			summarizerSettings: prefs.getSummarizerSettings(),
			translatorSettings: prefs.getTranslatorSettings(),
			voiceSettings: prefs.getVoiceSettings(),
			explainPrompt: prefs.getExplainPrompt(),
			mascot: prefs.getMascot(),
			assistantEnabled: prefs.isAssistantEnabled()
		};
	}

	public async saveSummarizerSettings(settings: { type: string; length: string; largeContentStrategy: string }): Promise<void> {
		// const { getUserPreferences } = await import('../UserPreferences');
		const prefs = getUserPreferences();
		await prefs.update({
			summarizerType: settings.type,
			summarizerLength: settings.length,
			summarizerLargeContentStrategy: settings.largeContentStrategy
		});
	}

	public async saveTranslatorSettings(settings: { targetLanguage: string }): Promise<void> {
		// const { getUserPreferences } = await import('../UserPreferences');
		const prefs = getUserPreferences();
		await prefs.update({
			translatorTargetLanguage: settings.targetLanguage
		});
	}

	public async saveExplainPrompt(prompt: string): Promise<void> {
		// const { getUserPreferences } = await import('../UserPreferences');
		const prefs = getUserPreferences();
		await prefs.update({
			explainPrompt: prompt
		});
	}

	public async saveChatContext(data: ChatContextData): Promise<string> {
		// Use the existing db module
		console.log('[Offscreen] Saving chat context to IndexedDB:', { data });
		const id = await saveChatContext(data);
		console.log('[Offscreen] Chat context saved with id:', id);
		return id;
	}

	public async getChatContext(): Promise<ChatContextRecord | null> {
		// Use the existing db module
		console.log('[Offscreen] Getting chat context from IndexedDB...');
		const context = await getUnusedChatContext();
		console.log('[Offscreen] Retrieved context:', context);
		return context || null;
	}

	public async openSidepanel(): Promise<void> {
		console.log('[Offscreen] Opening sidepanel...');
		// Send message to background to open sidepanel
		await chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
		console.log('[Offscreen] Sidepanel open request sent');
	}
}

export interface ExtensionBridge {
	ping(): Promise<string>;
	languageModel: {
		create(options: LanguageModelExCreateOptions): Promise<string>;
		prompt(args: LanguageModelPromptArgs): Promise<string>;
		append(args: LanguageModelAppendArgs): Promise<void>;
		clone(args: LanguageModelCloneArgs): Promise<void>;
		destroy(handleId: string): Promise<void>;
	};
	languageModelCreate(options: LanguageModelExCreateOptions): Promise<string>;
	languageModelPrompt(args: LanguageModelPromptArgs): Promise<string>;
	languageModelAppend(args: LanguageModelAppendArgs): Promise<void>;
	languageModelClone(args: LanguageModelCloneArgs): Promise<void>;
	languageModelDestroy(handleId: string): Promise<void>;
	summarize(args: SummarizeTextArgs): Promise<string>;
	translate(args: TranslateTextArgs): Promise<string>;
	rewrite(args: RewriteTextArgs): Promise<string>;
	write(args: WriteTextArgs): Promise<string>;
	transcribeAudio(args: TranscribeAudioArgs): Promise<string>;
	fetchPageText(url: string): Promise<string>;
	speechInit(options: SpeechInitOptions): Promise<{ kokoro: boolean; browser: boolean }>;
	speechSpeak(args: SpeakArgs): Promise<void>;
	speechStop(): Promise<void>;
	getPreferences(): Promise<{
		personaPrompt: string;
		summarizerSettings: { type: string; length: string; largeContentStrategy: string };
		translatorSettings: { targetLanguage: string };
		voiceSettings: { engine: string; voice: string; rate: number; pitch: number; volume: number };
		explainPrompt: string;
		mascot: string;
		assistantEnabled: boolean;
	}>;
	saveSummarizerSettings(settings: { type: string; length: string; largeContentStrategy: string }): Promise<void>;
	saveTranslatorSettings(settings: { targetLanguage: string }): Promise<void>;
	saveExplainPrompt(prompt: string): Promise<void>;
	saveChatContext(data: ChatContextData): Promise<string>;
	getChatContext(): Promise<ChatContextRecord | null>;
	openSidepanel(): Promise<void>;
}

class ExtensionBridgeImpl implements ExtensionBridge {
	private offscreen?: OffscreenAiService;
	private readonly languageHandleMap = new Map<string, string>();
	public readonly languageModel: ExtensionBridge["languageModel"];

	private async ensureOffscreen(): Promise<OffscreenAiService> {
		if (!this.offscreen) {
			await ensureOffscreenDocument();
			const injected = injectOffscreenService(new BackgroundOffscreenAdapter(COMCTX_NAMESPACE_OFFSCREEN));
			this.offscreen = makeNonThenable(injected);
		}

		const service = this.offscreen;
		if (!service) {
			throw new Error("Failed to initialize offscreen service");
		}
		return service;
	}

	public constructor() {
		this.languageModel = {
			create: (options: LanguageModelExCreateOptions) => this.languageModelCreate(options),
			prompt: (args: LanguageModelPromptArgs) => this.languageModelPrompt(args),
			append: (args: LanguageModelAppendArgs) => this.languageModelAppend(args),
			clone: (args: LanguageModelCloneArgs) => this.languageModelClone(args),
			destroy: (handleId: string) => this.languageModelDestroy(handleId),
		};
	}

	public async ping(): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.ping();
	}

	public async languageModelCreate(options: LanguageModelExCreateOptions): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		const { handleId } = await offscreen.languageModelCreate(options);
		const publicHandle = crypto.randomUUID();
		this.languageHandleMap.set(publicHandle, handleId);
		return publicHandle;
	}

	public async languageModelPrompt(args: LanguageModelPromptArgs): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		const handleId = this.languageHandleMap.get(args.handleId);
		if (!handleId) throw new Error(`Unknown language model handle ${args.handleId}`);
		return offscreen.languageModelPrompt({ ...args, handleId });
	}

	public async languageModelAppend(args: LanguageModelAppendArgs): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		const handleId = this.languageHandleMap.get(args.handleId);
		if (!handleId) throw new Error(`Unknown language model handle ${args.handleId}`);
		await offscreen.languageModelAppend({ ...args, handleId });
	}

	public async languageModelClone(args: LanguageModelCloneArgs): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		const handleId = this.languageHandleMap.get(args.handleId);
		if (!handleId) throw new Error(`Unknown language model handle ${args.handleId}`);
		await offscreen.languageModelClone({ ...args, handleId });
	}

	public async languageModelDestroy(handleId: string): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		const remoteHandle = this.languageHandleMap.get(handleId);
		if (!remoteHandle) return;
		await offscreen.languageModelDestroy(remoteHandle);
		this.languageHandleMap.delete(handleId);
	}

	public async summarize(args: SummarizeTextArgs): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.summarizeText(args);
	}

	public async translate(args: TranslateTextArgs): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.translateText(args);
	}

	public async rewrite(args: RewriteTextArgs): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.rewriteText(args);
	}

	public async write(args: WriteTextArgs): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.writeText(args);
	}

	public async transcribeAudio(args: TranscribeAudioArgs): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.transcribeAudio(args);
	}

	public async fetchPageText(url: string): Promise<string> {
		return fetchPageText(url);
	}

	public async speechInit(options: SpeechInitOptions): Promise<{ kokoro: boolean; browser: boolean }> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.speechInit(options);
	}

	public async speechSpeak(args: SpeakArgs): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.speechSpeak(args);
	}

	public async speechStop(): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.speechStop();
	}

	public async getPreferences(): Promise<{
		personaPrompt: string;
		summarizerSettings: { type: string; length: string; largeContentStrategy: string };
		translatorSettings: { targetLanguage: string };
		voiceSettings: { engine: string; voice: string; rate: number; pitch: number; volume: number };
		explainPrompt: string;
		mascot: string;
		assistantEnabled: boolean;
	}> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.getPreferences();
	}

	public async saveSummarizerSettings(settings: { type: string; length: string; largeContentStrategy: string }): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.saveSummarizerSettings(settings);
	}

	public async saveTranslatorSettings(settings: { targetLanguage: string }): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.saveTranslatorSettings(settings);
	}

	public async saveExplainPrompt(prompt: string): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.saveExplainPrompt(prompt);
	}

	public async saveChatContext(data: ChatContextData): Promise<string> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.saveChatContext(data);
	}

	public async getChatContext(): Promise<ChatContextRecord | null> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.getChatContext();
	}

	public async openSidepanel(): Promise<void> {
		const offscreen = await this.ensureOffscreen();
		return offscreen.openSidepanel();
	}
}

const [rawProvideOffscreenService, rawInjectOffscreenService] = defineProxy(
	() => new OffscreenAiServiceImpl(),
	{ namespace: COMCTX_NAMESPACE_OFFSCREEN },
);

const [rawProvideExtensionService, rawInjectExtensionService] = defineProxy(
	() => new ExtensionBridgeImpl(),
	{ namespace: COMCTX_NAMESPACE_CONTENT },
);

export function provideOffscreenService(adapter: OffscreenAdapter): OffscreenAiService {
	return rawProvideOffscreenService(adapter as unknown as any) as OffscreenAiService;
}

export function injectOffscreenService(adapter: BackgroundOffscreenAdapter): OffscreenAiService {
	return rawInjectOffscreenService(adapter as unknown as any) as OffscreenAiService;
}

export function provideExtensionService(adapter: BackgroundAdapter): ExtensionBridge {
	return rawProvideExtensionService(adapter as unknown as any) as ExtensionBridge;
}

export function injectExtensionService(adapter: ContentAdapter): ExtensionBridge {
	return rawInjectExtensionService(adapter as unknown as any) as ExtensionBridge;
}

export function createContentExtensionBridge(): ExtensionBridge {
	const bridge = injectExtensionService(new ContentAdapter(COMCTX_NAMESPACE_CONTENT));
	return makeNonThenable(bridge);
}

export function registerBackgroundExtensionBridge(): ExtensionBridge {
	return provideExtensionService(new BackgroundAdapter(COMCTX_NAMESPACE_CONTENT));
}

export function registerOffscreenService(): OffscreenAiService {
	return provideOffscreenService(new OffscreenAdapter(COMCTX_NAMESPACE_OFFSCREEN));
}
