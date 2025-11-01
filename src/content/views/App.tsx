import '@ant-design/v5-patch-for-react-19';
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FabMenu, type FabAction, type FabConfigAction } from "../components/FabMenu";
import { SelectionToolbar, type SelectionAction, type SelectionConfigAction, type SummarizerConfig, type SummarizerType, type SummarizerLength, type LargeContentStrategy } from "../components/SelectionToolbar";
import { FloatingPopup, type PopupStatus } from "../components/FloatingPopup";
import { InputAssistant, type InputAction } from "../components/InputAssistant";
import { WriterForm, type WriterSize, type WriterFormat, type WriterTone } from "../components/WriterForm";
import { ImageInspector } from "../components/ImageInspector";
import styles from "./App.module.css";
import { getTheme } from "@/utils/theme";
import { getExtensionBridge } from "@/utils/extensionBridge";
import type { ExtensionBridge } from "@/utils/comctx/aiService";
import type { SummarizerExCreateOptions } from "@/utils/built-in-ai-ex/SummarizerEx";
import type { TranslatorExCreateOptions } from "@/utils/built-in-ai-ex/TranslatorEx";
import type { WriterExCreateOptions } from "@/utils/built-in-ai-ex/WriterEx";
import type { RewriterExCreateOptions } from "@/utils/built-in-ai-ex/RewriterEx";
import type { LanguageModelExCreateOptions } from "@/utils/built-in-ai-ex/LanguageModelEx";
import { getUserPreferences } from '@/utils/UserPreferences';
import { AudioCapture } from '@/utils/AudioCapture';
import EasySpeech from 'easy-speech';

interface PopupState {
    title: string;
    status: PopupStatus;
    body: ReactNode;
    anchor?: { x: number; y: number } | null;
    footer?: ReactNode;
    open?: boolean;
    initialHeight?: number;
}

function isEditableInput(element: EventTarget | null): element is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
    if (!(element instanceof HTMLElement)) return false;
    // Don't show input assistant inside our own UI components
    if (element.closest && element.closest("#assistant-content-root")) return false;
    if (element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLInputElement) {
        const invalidTypes = new Set([
            "password",
            "number",
            "date",
            "time",
            "checkbox",
            "radio",
            "hidden",
            "file",
        ]);
        return !invalidTypes.has(element.type ?? "text");
    }
    return element.isContentEditable;
}

function readInputValue(element: HTMLElement): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value;
    }
    return element.innerText ?? element.textContent ?? "";
}

function writeInputValue(element: HTMLElement, value: string, mode: "replace" | "append" = "replace") {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const next = mode === "append" ? `${element.value}${value}` : value;
        element.value = next;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        return;
    }
    if (element.isContentEditable) {
        const next = mode === "append" ? `${element.innerText}${value}` : value;
        element.innerText = next;
        element.dispatchEvent(new Event("input", { bubbles: true }));
    }
}

function getSelectedText(range: Range | null): string {
    if (!range) return "";
    return range.toString().trim();
}

const DEFAULT_SUMMARIZER_OPTIONS = {
    type: "key-points",
    format: "markdown",
    length: "short",
    outputLanguage: "en",
    largeContentStrategy: "join",
    context: "Summarize the content into 3-5 concise bullet points focusing on actionable insights, key facts, and notable takeaways.",
} as SummarizerExCreateOptions;

const DEFAULT_WRITER_OPTIONS = {
    tone: "neutral",
    format: "plain-text",
    outputLanguage: "en",
} as WriterExCreateOptions;

const DEFAULT_REWRITER_OPTIONS = {} as RewriterExCreateOptions;

const DEFAULT_MODEL_OPTIONS = {
    contextHandler: "clear",
    historyHandler: "clear",
    maxQuotaUsage: 0.85,
    temperature: 0.7,
    topK: 32,
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
} as LanguageModelExCreateOptions;

// Helper to add persona to model options
async function getModelOptionsWithPersona(bridge: ExtensionBridge, baseOptions: LanguageModelExCreateOptions = DEFAULT_MODEL_OPTIONS): Promise<LanguageModelExCreateOptions> {
    const { personaPrompt } = await bridge.getPreferences();

    if (!personaPrompt) {
        return baseOptions;
    }
    
    // Add persona to system prompt
    const existingSystemPrompt = baseOptions.initialPrompts?.find(p => p.role === 'system')?.content || '';
    const systemPrompt = existingSystemPrompt 
        ? `This is your persona, follow it: "${personaPrompt}."\n\n${existingSystemPrompt}`
        : personaPrompt;
    // console.log("systemPrompt:", systemPrompt)
    return {
        ...baseOptions,
        initialPrompts: [
            { role: 'system', content: systemPrompt } as const
        ]
    };
}

interface TranslationRecord {
    node: Text;
    original: string;
}

function collectTextNodes(limit = 2000): TranslationRecord[] {
    const rejects = new Set(["SCRIPT", "STYLE", "IFRAME", "NOSCRIPT", "CODE", "PRE", "SVG", "CANVAS", "VIDEO", "AUDIO"]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
            const data = node.data?.trim();
            if (!data || data.length < 2) return NodeFilter.FILTER_SKIP;
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_SKIP;
            if (rejects.has(parent.tagName)) return NodeFilter.FILTER_SKIP;
            if (parent.closest && parent.closest("#assistant-content-root")) return NodeFilter.FILTER_SKIP;
            if (parent.closest && (parent.closest("code") || parent.closest("pre") || parent.closest("script"))) {
                return NodeFilter.FILTER_SKIP;
            }
            const isCodeLike = /^[\{\}\[\]\(\);,<>\/\\=\+\-\*\&\|\^%\$#@!~`]+$/.test(data);
            if (isCodeLike) return NodeFilter.FILTER_SKIP;
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    const records: TranslationRecord[] = [];
    let current: Node | null;
    while ((current = walker.nextNode()) && records.length < limit) {
        if (current instanceof Text) {
            records.push({ node: current, original: current.data });
        }
    }
    console.debug(`Collected ${records.length} text nodes for translation`);
    return records;
}

function chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

export default function ContentApp() {
    const theme = getTheme();
    const bridgeRef = useRef<ExtensionBridge | null>(null);
    const speechInitializedRef = useRef<boolean>(false);
    const browserSpeechInitializedRef = useRef<boolean>(false);
    const [popups, setPopups] = useState<Array<PopupState & { id: string }>>([]);
    const popupIdCounter = useRef(0);
    const [selectionRange, setSelectionRange] = useState<Range | null>(null);
    const [selectionVisible, setSelectionVisible] = useState(false);
    const [selectionBusy, setSelectionBusy] = useState<SelectionAction | null>(null);
    const [speechProcessing, setSpeechProcessing] = useState(false); // Generating audio
    const [speechPlaying, setSpeechPlaying] = useState(false); // Playing audio
    const [summarizerConfig, setSummarizerConfig] = useState<SummarizerConfig>({
        type: "key-points",
        length: "short",
        largeContentStrategy: "join",
    });
    const [translatorConfig, setTranslatorConfig] = useState<{ targetLanguage: string }>({
        targetLanguage: typeof navigator !== "undefined" ? navigator.language ?? "en" : "en",
    });
    const [explainPrompt, setExplainPrompt] = useState<string>("");
    const [mascot, setMascot] = useState<string>("yellow");
    const [fabBusy, setFabBusy] = useState<FabAction | null>(null);
    const [translationActive, setTranslationActive] = useState(false);
    const translationRecordsRef = useRef<TranslationRecord[]>([]);
    const [screenReaderActive, setScreenReaderActive] = useState(false);
    const [screenReaderMessage, setScreenReaderMessage] = useState("Reading page");
    const [inputAnchor, setInputAnchor] = useState<DOMRect | null>(null);
    const [inputVisible, setInputVisible] = useState(false);
    const [inputBusy, setInputBusy] = useState<InputAction | null>(null);
    const focusedInputRef = useRef<HTMLElement | null>(null);
    const voiceRecognitionRef = useRef<any>(null);
    const voiceActiveRef = useRef(false);
    const [isRecording, setIsRecording] = useState(false);
    const [imageInspectorVisible, setImageInspectorVisible] = useState(false);
    const [imageInspectorAnchor, setImageInspectorAnchor] = useState<DOMRect | null>(null);
    const [imageInspectorBusy, setImageInspectorBusy] = useState(false);
    const imageInspectorTargetRef = useRef<HTMLImageElement | null>(null);
    const hideImageInspectorTimerRef = useRef<number | null>(null);
    const inputModalTargetRef = useRef<HTMLElement | null>(null);

    const cancelHideImageInspector = useCallback(() => {
        if (typeof window === "undefined") return;
        if (hideImageInspectorTimerRef.current !== null) {
            window.clearTimeout(hideImageInspectorTimerRef.current);
            hideImageInspectorTimerRef.current = null;
        }
    }, []);

    const scheduleHideImageInspector = useCallback(() => {
        if (typeof window === "undefined") return;
        cancelHideImageInspector();
        hideImageInspectorTimerRef.current = window.setTimeout(() => {
            setImageInspectorVisible(false);
            setImageInspectorAnchor(null);
            imageInspectorTargetRef.current = null;
        }, 200);
    }, [cancelHideImageInspector]);

    useEffect(() => {
        let cancelled = false;
        getExtensionBridge()
            .then((instance) => {
                if (cancelled) return;
                bridgeRef.current = instance;
            })
            .catch((error) => console.warn("Failed to establish extension bridge", error));
        return () => {
            cancelled = true;
        };
    }, []);

    // Load user preferences on mount and initialize Speech
    useEffect(() => {
        const loadPreferences = async () => {
            try {
                const bridge = await getExtensionBridge();
                const prefs = await bridge.getPreferences();
                
                // Load AI action settings
                setSummarizerConfig({
                    type: prefs.summarizerSettings.type as SummarizerType,
                    length: prefs.summarizerSettings.length as SummarizerLength,
                    largeContentStrategy: prefs.summarizerSettings.largeContentStrategy as LargeContentStrategy,
                });
                
                setTranslatorConfig({ targetLanguage: prefs.translatorSettings.targetLanguage });
                setExplainPrompt(prefs.explainPrompt);
                setMascot(prefs.mascot);
                
                // console.log('[ContentApp] User preferences loaded from extension storage');
                // console.log('[ContentApp] TTS will be initialized on first use');
            } catch (error) {
                console.error('[ContentApp] Failed to load user preferences:', error);
            }
        };
        
        loadPreferences();
    }, []);

    const updateSelectionFromWindow = useCallback(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
            setSelectionVisible(false);
            setSelectionRange(null);
            return;
        }
        const range = selection.getRangeAt(0).cloneRange();
        setSelectionRange(range);
        setSelectionVisible(true);
    }, []);

    useEffect(() => {
        const handleMouseUp = () => setTimeout(updateSelectionFromWindow);
        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Shift" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
                setTimeout(updateSelectionFromWindow);
            }
        };
        const handleMouseDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && target.closest && target.closest("#assistant-content-root")) return;
            setSelectionVisible(false);
        };
        document.addEventListener("mouseup", handleMouseUp);
        document.addEventListener("keyup", handleKeyUp);
        document.addEventListener("mousedown", handleMouseDown);
        return () => {
            document.removeEventListener("mouseup", handleMouseUp);
            document.removeEventListener("keyup", handleKeyUp);
            document.removeEventListener("mousedown", handleMouseDown);
        };
    }, [updateSelectionFromWindow]);

    const updateInputAnchor = useCallback((element: HTMLElement | null) => {
        if (!element) {
            setInputAnchor(null);
            return;
        }
        const rect = element.getBoundingClientRect();
        setInputAnchor(rect);
    }, []);

    useEffect(() => {
        const handleFocusIn = (event: FocusEvent) => {
            const target = event.target as HTMLElement | null;
            if (!isEditableInput(target)) {
                focusedInputRef.current = null;
                setInputVisible(false);
                return;
            }
            focusedInputRef.current = target;
            updateInputAnchor(target);
            setInputVisible(true);
        };
        const handleFocusOut = (event: FocusEvent) => {
            const previous = event.target as HTMLElement | null;
            const related = event.relatedTarget as HTMLElement | null;
            
            // If focus moved to our UI, keep the assistant visible
            if (related && related.closest) {
                if (related.closest("#assistant-content-root") || related.closest(".ant-dropdown") || related.closest(".ant-btn")) {
                    return;
                }
            }
            
            window.setTimeout(() => {
                const active = document.activeElement as HTMLElement | null;
                
                // If focus is now on our UI, keep the assistant visible
                if (active && active.closest && (active.closest("#assistant-content-root") || active.closest(".ant-dropdown") || active.closest(".ant-btn"))) {
                    return;
                }
                
                // If focus moved to another editable input, update to that input
                if (active && isEditableInput(active)) {
                    focusedInputRef.current = active;
                    updateInputAnchor(active);
                    setInputVisible(true);
                    return;
                }
                
                // If previous input is still in the DOM and valid, keep showing assistant
                if (previous && previous.isConnected && isEditableInput(previous)) {
                    return; // Don't hide, keep showing for the previous input
                }
                
                // Only hide if focus moved to something that's not editable and not our UI
                focusedInputRef.current = null;
                setInputVisible(false);
            }, 150);
        };
        document.addEventListener("focusin", handleFocusIn);
        document.addEventListener("focusout", handleFocusOut);
        return () => {
            document.removeEventListener("focusin", handleFocusIn);
            document.removeEventListener("focusout", handleFocusOut);
        };
    }, [updateInputAnchor]);

    useEffect(() => {
        const handleScroll = () => {
            if (focusedInputRef.current) {
                updateInputAnchor(focusedInputRef.current);
            }
        };
        window.addEventListener("scroll", handleScroll, true);
        window.addEventListener("resize", handleScroll);
        return () => {
            window.removeEventListener("scroll", handleScroll, true);
            window.removeEventListener("resize", handleScroll);
        };
    }, [updateInputAnchor]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const handlePointerOver = (event: PointerEvent) => {
            // Try to get the actual element at the cursor position (bypasses overlays)
            const elementsAtPoint = document.elementsFromPoint(event.clientX, event.clientY);
            let target: HTMLImageElement | null = null;
            
            // Check if pointer is over a floating popup - if so, don't detect images behind it
            const isOverPopup = elementsAtPoint.some(elem => 
                elem instanceof HTMLElement && (
                    elem.dataset.floatingPopup === "true" ||
                    elem.closest('[data-floating-popup="true"]')
                )
            );
            if (isOverPopup) return;
            
            for (const elem of elementsAtPoint) {
                // Skip assistant elements
                if (elem.closest("#assistant-content-root")) continue;
                // Skip the image inspector itself
                if (elem.closest("#assistant-image-inspector")) continue;
                // Find the first image element
                if (elem instanceof HTMLImageElement) {
                    target = elem;
                    break;
                }
            }
            
            if (!target) return;
            if (target.width < 80 && target.height < 80) return;
            
            // Hide the inspector button during active interrogation
            if (imageInspectorBusy) return;
            
            imageInspectorTargetRef.current = target;
            setImageInspectorAnchor(target.getBoundingClientRect());
            setImageInspectorVisible(true);
            cancelHideImageInspector();
        };

        const handlePointerOut = (event: PointerEvent) => {
            const target = event.target as EventTarget | null;
            if (!(target instanceof HTMLImageElement)) return;
            if (target !== imageInspectorTargetRef.current) return;
            const related = event.relatedTarget as HTMLElement | null;
            if (related) {
                if (related === target) {
                    cancelHideImageInspector();
                    return;
                }
                if (related.closest && related.closest("#assistant-image-inspector")) {
                    cancelHideImageInspector();
                    return;
                }
            }
            scheduleHideImageInspector();
        };

        document.addEventListener("pointerover", handlePointerOver, true);
        document.addEventListener("pointerout", handlePointerOut, true);

        return () => {
            document.removeEventListener("pointerover", handlePointerOver, true);
            document.removeEventListener("pointerout", handlePointerOut, true);
        };
    }, [cancelHideImageInspector, scheduleHideImageInspector]);

    useEffect(() => {
        if (!imageInspectorVisible) return;
        if (typeof window === "undefined") return;

        const updateAnchor = () => {
            const target = imageInspectorTargetRef.current;
            if (!target || !target.isConnected) return;
            setImageInspectorAnchor(target.getBoundingClientRect());
        };

        updateAnchor();
        window.addEventListener("scroll", updateAnchor, true);
        window.addEventListener("resize", updateAnchor);

        return () => {
            window.removeEventListener("scroll", updateAnchor, true);
            window.removeEventListener("resize", updateAnchor);
        };
    }, [imageInspectorVisible]);

    const speakText = useCallback(async (text: string) => {
        if (!text.trim()) return;
        
        try {
            const bridge = await getExtensionBridge();
            const prefs = await bridge.getPreferences();
            const voiceSettings = prefs.voiceSettings;
            
            // Reset states
            setSpeechProcessing(false);
            setSpeechPlaying(false);
            
            // Use EasySpeech directly for browser TTS
            if (voiceSettings.engine === 'browser') {
                // Initialize EasySpeech if not already done
                if (!browserSpeechInitializedRef.current) {
                    await EasySpeech.init({ maxTimeout: 5000, interval: 250 });
                    browserSpeechInitializedRef.current = true;
                }
                
                return new Promise<void>((resolve, reject) => {
                    EasySpeech.speak({
                        text,
                        voice: voiceSettings.voice ? EasySpeech.voices().find(v => v.voiceURI === voiceSettings.voice) : undefined,
                        rate: voiceSettings.rate || 1,
                        pitch: voiceSettings.pitch || 1,
                        volume: voiceSettings.volume || 1,
                        start: () => {
                            // console.log('[Speech] Browser TTS started');
                            setSpeechPlaying(true);
                        },
                        end: () => {
                            // console.log('[Speech] Browser TTS ended');
                            setSpeechPlaying(false);
                            resolve();
                        },
                        error: (e) => {
                            console.error('[Speech] Browser TTS error:', e);
                            setSpeechPlaying(false);
                            reject(new Error(e.error));
                        },
                    });
                });
            }
            
            // Use offscreen bridge for Kokoro
            // Bridge already declared above
            
            // Lazy initialize Kokoro on first use
            if (!speechInitializedRef.current) {
                // console.log('[Speech] Initializing Kokoro TTS on first use...');
                setSpeechProcessing(true);
                try {
                    await bridge.speechInit({
                        loadKokoro: true,
                        kokoroDevice: 'webgpu',
                        kokoroDtype: 'fp32',
                    });
                    speechInitializedRef.current = true;
                    // console.log('[Speech] Kokoro TTS initialized successfully');
                } catch (error) {
                    console.error('[Speech] Failed to initialize Kokoro:', error);
                    setSpeechProcessing(false);
                    return;
                }
            }
            
            // Show processing state for Kokoro
            setSpeechProcessing(true);
            
            // Small delay to show processing
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Switch to playing state
            setSpeechProcessing(false);
            setSpeechPlaying(true);
            
            await bridge.speechSpeak({
                text,
                voice: voiceSettings.voice,
                rate: voiceSettings.rate,
                pitch: voiceSettings.pitch,
                volume: voiceSettings.volume,
                engine: voiceSettings.engine as 'browser' | 'kokoro',
            });
            
            // Reset states after completion
            setSpeechProcessing(false);
            setSpeechPlaying(false);
        } catch (error) {
            console.warn("Speech synthesis failed", error);
            setSpeechProcessing(false);
            setSpeechPlaying(false);
        }
    }, []);

    const stopSpeech = useCallback(async () => {
        try {
            const bridge = await getExtensionBridge();
            const prefs = await bridge.getPreferences();
            const voiceSettings = prefs.voiceSettings;
            
            // Stop based on current engine preference
            if (voiceSettings.engine === 'browser') {
                // Stop browser TTS
                if (browserSpeechInitializedRef.current) {
                    EasySpeech.cancel();
                }
            } else if (voiceSettings.engine === 'kokoro') {
                // Stop Kokoro via bridge only if it's initialized
                if (speechInitializedRef.current) {
                    await bridge.speechStop();
                }
            }
            
            // Reset states
            setSpeechProcessing(false);
            setSpeechPlaying(false);
            setSelectionBusy(null);
        } catch (error) {
            console.warn("Stop speech failed", error);
        }
    }, []);

    const ensureBridgeInstance = useCallback(async (): Promise<ExtensionBridge | null> => {
        if (bridgeRef.current) return bridgeRef.current;
        try {
            const instance = await getExtensionBridge();
            bridgeRef.current = instance;
            return instance;
        } catch (error) {
            console.error("Extension bridge unavailable", error);
            return null;
        }
    }, []);

    const openResultPopup = useCallback((state: PopupState) => {
        const id = `popup-${++popupIdCounter.current}`;
        setPopups((prev) => [...prev, { ...state, id, open: true }]);
        return id;
    }, []);

    const closePopup = useCallback((id: string) => {
        // First set open to false to trigger exit animation
        setPopups((prev) => prev.map((p) => (p.id === id ? { ...p, open: false } : p)));
        // Then remove after animation completes
        setTimeout(() => {
            setPopups((prev) => prev.filter((p) => p.id !== id));
        }, 300);
    }, []);
    
    const updatePopup = useCallback((id: string, updates: Partial<PopupState>) => {
        setPopups((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
    }, []);

    const handleSelectionAction = useCallback(async (action: SelectionAction) => {
        const text = getSelectedText(selectionRange);
        if (!text) {
            setSelectionVisible(false);
            return;
        }

        // For speak action, keep toolbar visible to show stop button
        if (action === "speak") {
            setSelectionBusy(action);
            await speakText(text);
            setSelectionBusy(null);
            // Hide toolbar after speech completes
            setSelectionVisible(false);
            setSelectionRange(null);
            window.getSelection()?.removeAllRanges();
            return;
        }

        // Hide toolbar immediately for other actions
        setSelectionVisible(false);
        setSelectionRange(null);
        
        // Clear the browser selection to prevent toolbar from reappearing
        window.getSelection()?.removeAllRanges();

        if (action === "chat") {
            setSelectionBusy(action);
            try {
                console.log('[Content] Saving selected text context...');
                // Save page context with selected text using bridge
                const bridge = await getExtensionBridge();
                await bridge.saveChatContext({
                    reason: 'selected-text',
                    url: window.location.href,
                    title: document.title,
                    context: text,
                });
                console.log('[Content] Context saved, opening sidepanel...');
                
                // Open sidepanel using bridge
                                // await bridge.openSidepanel();
                chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
                
                setSelectionBusy(null);
            } catch (error) {
                console.error('Failed to open chat:', error);
                openResultPopup({
                    title: "Error",
                    status: "error",
                    body: "Failed to open chat. Please try again.",
                    anchor: null,
                });
                setSelectionBusy(null);
            }
            return;
        }

        if (action === "search") {
            setSelectionBusy(action);
            const rect = selectionRange?.getBoundingClientRect();
            const popupId = openResultPopup({
                title: "Search Results",
                status: "loading",
                body: "Searching Google...",
                anchor: rect ? { x: rect.left + rect.width / 2, y: rect.top - 24 } : null,
            });

            try {
                const bridgeInstance = await ensureBridgeInstance();
                if (!bridgeInstance) {
                    setSelectionBusy(null);
                    return;
                }

                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
                
                updatePopup(popupId, {
                    status: "loading",
                    body: "Fetching search results...",
                });
                
                const searchContent = await bridgeInstance.fetchPageText(searchUrl);
                
                if (!searchContent) {
                    updatePopup(popupId, {
                        status: "error",
                        body: "Failed to fetch search results",
                    });
                    setSelectionBusy(null);
                    return;
                }

                updatePopup(popupId, {
                    status: "loading",
                    body: "Summarizing results...",
                });

                const prefs = await bridgeInstance.getPreferences();
                const options: SummarizerExCreateOptions = {
                    ...DEFAULT_SUMMARIZER_OPTIONS,
                    type: "key-points",
                    length: "medium",
                    ...(prefs.personaPrompt && { 
                        sharedContext: `This is your persona, follow it: "${prefs.personaPrompt}". Write the summary as your persona would do.` 
                    })
                };
                const summary = await bridgeInstance.summarize({ text: searchContent, options });
                
                updatePopup(popupId, {
                    status: "success",
                    body: summary,
                });
            } catch (error) {
                console.error("Search failed", error);
                updatePopup(popupId, {
                    status: "error",
                    body: `Search failed: ${error}`,
                });
            } finally {
                setSelectionBusy(null);
            }
            return;
        }

        const bridgeInstance = await ensureBridgeInstance();
        if (!bridgeInstance) return;

        setSelectionBusy(action);
        const rect = selectionRange?.getBoundingClientRect();
        const popupId = openResultPopup({
            title: action === "summary" ? "Summary" : action === "translate" ? "Translation" : "Explanation",
            status: "loading",
            body: "",
            anchor: rect
                ? { x: rect.left + rect.width / 2, y: rect.top - 24 }
                : null,
        });

        try {
            if (action === "summary") {
                const prefs = await bridgeInstance.getPreferences();
                const options: SummarizerExCreateOptions = {
                    ...DEFAULT_SUMMARIZER_OPTIONS,
                    type: summarizerConfig.type,
                    length: summarizerConfig.length,
                    ...(prefs.personaPrompt && { 
                        sharedContext: `This is your persona, follow it: "${prefs.personaPrompt}". Write the summary as your persona would do.` 
                    })
                };
                const summary = await bridgeInstance.summarize({ text, options });
                updatePopup(popupId, {
                    status: "success",
                    body: summary,
                });
            } else if (action === "translate") {
                const options: TranslatorExCreateOptions = {
                    targetLanguage: translatorConfig.targetLanguage,
                } as TranslatorExCreateOptions;
                const translation = await bridgeInstance.translate({ text, options });
                updatePopup(popupId, { status: "success", body: translation });
            } else if (action === "explain") {
                const handleId = await bridgeInstance.languageModelCreate(await getModelOptionsWithPersona(bridgeInstance));
                const explanation = await bridgeInstance.languageModelPrompt({
                    handleId,
                    input: [
                        { role: "user", content: text },
                        { role: "user", content: "Explain the text above in simple terms." },
                    ],
                });
                await bridgeInstance.languageModelDestroy(handleId);
                updatePopup(popupId, { status: "success", body: explanation });
            }
        } catch (error) {
            console.error("Failed to run selection action", error);
            updatePopup(popupId, { status: "error", body: String(error) });
        } finally {
            setSelectionBusy(null);
        }
    }, [ensureBridgeInstance, openResultPopup, updatePopup, selectionRange, speakText]);

    const togglePageTranslation = useCallback(async () => {
        const bridgeInstance = await ensureBridgeInstance();
        if (!bridgeInstance) return;
        setFabBusy("translate");

        try {
            if (!translationActive) {
                const records = collectTextNodes();
                const appliedRecords: TranslationRecord[] = [];
                const popupId = openResultPopup({ title: "Page translation", status: "loading", body: `Translating ${records.length} text segments...`, anchor: null });
                let changed = false;
                let processedCount = 0;
                
                for (const batch of chunkArray(records, 15)) {
                    const options: TranslatorExCreateOptions = {
                        targetLanguage: translatorConfig.targetLanguage,
                    } as TranslatorExCreateOptions;
                    const translations = await Promise.all(
                        batch.map((record) =>
                            bridgeInstance.translate({ text: record.original, options }).catch((err) => {
                                console.warn("Translation failed for segment", err);
                                return record.original;
                            }),
                        ),
                    );
                    
                    translations.forEach((translation, index) => {
                        const record = batch[index];
                        if (translation && translation !== record.original && record.node.isConnected) {
                            record.node.data = translation;
                            appliedRecords.push(record);
                            changed = true;
                        }
                    });
                    
                    processedCount += batch.length;
                    updatePopup(popupId, {
                        body: `Translated ${processedCount} of ${records.length} segments...`,
                    });
                }

                console.debug(`Translation completed: ${appliedRecords.length} of ${records.length} nodes changed`);

                if (!changed) {
                    updatePopup(popupId, {
                        title: "No translation needed",
                        status: "success",
                        body: "The page already matches the requested language.",
                    });
                    translationRecordsRef.current = [];
                    setTranslationActive(false);
                    return;
                }

                translationRecordsRef.current = appliedRecords;
                setTranslationActive(true);
                updatePopup(popupId, {
                    status: "success",
                    body: `Translated ${appliedRecords.length} text segments. Click translate again to restore original content.`,
                });
            } else {
                const popupId = openResultPopup({ title: "Restoring original", status: "loading", body: "Restoring original language...", anchor: null });
                translationRecordsRef.current.forEach(({ node, original }) => {
                    node.data = original;
                });
                translationRecordsRef.current = [];
                setTranslationActive(false);
                updatePopup(popupId, {
                    title: "Translation disabled",
                    status: "success",
                    body: "Original language restored.",
                });
            }
        } catch (error) {
            console.error("Translation toggle failed", error);
            openResultPopup({ title: "Translation failed", status: "error", body: String(error), anchor: null });
        } finally {
            setFabBusy(null);
        }
    }, [ensureBridgeInstance, openResultPopup, updatePopup, translationActive, translatorConfig]);

    const summarizePage = useCallback(async () => {
        const bridgeInstance = await ensureBridgeInstance();
        if (!bridgeInstance) return;
        setFabBusy("summary");
        const popupId = openResultPopup({ title: "Page summary", status: "loading", body: "Analyzing page content...", anchor: null });
        try {
            const text = document.body ? document.body.innerText : document.documentElement.innerText;
            const prefs = await bridgeInstance.getPreferences();
            const options: SummarizerExCreateOptions = {
                ...DEFAULT_SUMMARIZER_OPTIONS,
                type: summarizerConfig.type,
                length: summarizerConfig.length,
                largeContentStrategy: summarizerConfig.largeContentStrategy || "join",
                ...(prefs.personaPrompt && { 
                    sharedContext: `This is your persona, follow it: "${prefs.personaPrompt}". Write the summary as your persona would do.` 
                })
            };
            const summary = await bridgeInstance.summarize({ text, options });
            updatePopup(popupId, { status: "success", body: summary });
        } catch (error) {
            console.error("Page summary failed", error);
            updatePopup(popupId, { title: "Summary failed", status: "error", body: String(error) });
        } finally {
            setFabBusy(null);
        }
    }, [ensureBridgeInstance, openResultPopup, updatePopup, summarizerConfig]);

    const explainPage = useCallback(async () => {
        const bridgeInstance = await ensureBridgeInstance();
        if (!bridgeInstance) return;
        setFabBusy("explain");
        const popupId = openResultPopup({ title: "Page explanation", status: "loading", body: "Generating explanation...", anchor: null });
        try {
            const text = document.body ? document.body.innerText : document.documentElement.innerText;
            const handleId = await bridgeInstance.languageModelCreate(await getModelOptionsWithPersona(bridgeInstance));
            const promptText = explainPrompt 
                ? `${explainPrompt}\n\nContent to explain:`
                : "Explain the following content in approachable language:";
            const explanation = await bridgeInstance.languageModelPrompt({
                handleId,
                input: [
                    {
                        role: "user",
                        content: promptText,
                    },
                    { role: "user", content: text },
                ],
            });
            await bridgeInstance.languageModelDestroy(handleId);
            updatePopup(popupId, { status: "success", body: explanation });
        } catch (error) {
            console.error("Page explanation failed", error);
            updatePopup(popupId, { title: "Explain failed", status: "error", body: String(error) });
        } finally {
            setFabBusy(null);
        }
    }, [ensureBridgeInstance, openResultPopup, updatePopup, explainPrompt]);

    const toggleScreenReader = useCallback(async () => {
        if (screenReaderActive) {
            // Stop using the same logic as stopSpeech
            await stopSpeech();
            setScreenReaderActive(false);
            return;
        }
        
        const bridge = await getExtensionBridge();
        const prefs = await bridge.getPreferences();
        const voiceSettings = prefs.voiceSettings;
        
        // Lazy initialize Kokoro on first use if needed
        if (voiceSettings.engine === 'kokoro' && !speechInitializedRef.current) {
            // console.log('[Screen Reader] Initializing Kokoro TTS on first use...');
            setScreenReaderMessage("Initializing...");
            try {
                await bridge.speechInit({
                    loadKokoro: true,
                    kokoroDevice: 'webgpu',
                    kokoroDtype: 'fp32',
                });
                speechInitializedRef.current = true;
                // console.log('[Screen Reader] Kokoro TTS initialized successfully');
            } catch (error) {
                console.error('[Screen Reader] Failed to initialize Kokoro:', error);
                return;
            }
        }
        
        setScreenReaderActive(true);
        setScreenReaderMessage("Reading page");
        const text = document.body ? document.body.innerText : document.documentElement.innerText;
        
        try {
            if (voiceSettings.engine === 'browser') {
                // Use EasySpeech directly for browser TTS
                if (!browserSpeechInitializedRef.current) {
                    await EasySpeech.init({ maxTimeout: 5000, interval: 250 });
                    browserSpeechInitializedRef.current = true;
                }
                
                await new Promise<void>((resolve, reject) => {
                    EasySpeech.speak({
                        text,
                        voice: voiceSettings.voice ? EasySpeech.voices().find(v => v.voiceURI === voiceSettings.voice) : undefined,
                        rate: voiceSettings.rate || 1,
                        pitch: voiceSettings.pitch || 1,
                        volume: voiceSettings.volume || 1,
                        end: () => {
                            setScreenReaderActive(false);
                            resolve();
                        },
                        error: (e) => {
                            console.error('[Screen Reader] Browser TTS error:', e);
                            reject(new Error(e.error));
                        },
                    });
                });
            } else if (voiceSettings.engine === 'kokoro') {
                // Use Kokoro via bridge
                const bridge = await getExtensionBridge();
                
                await bridge.speechSpeak({
                    text,
                    voice: voiceSettings.voice,
                    rate: voiceSettings.rate,
                    pitch: voiceSettings.pitch,
                    volume: voiceSettings.volume,
                    engine: voiceSettings.engine,
                });
                
                setScreenReaderActive(false);
            }
        } catch (error) {
            console.error("Screen reader failed", error);
            setScreenReaderActive(false);
        }
    }, [screenReaderActive, stopSpeech]);

    const handleFabAction = useCallback(async (action: FabAction) => {
        if (action === "summary") summarizePage();
        if (action === "translate") togglePageTranslation();
        if (action === "explain") explainPage();
        if (action === "screen-reader") toggleScreenReader();
        if (action === "chat") {
            try {
                console.log('[Content/FAB] Saving full page context...');
                // Save FULL page context using bridge
                const bridge = await getExtensionBridge();
                await bridge.saveChatContext({
                    reason: 'fullpage-chat',
                    url: window.location.href,
                    title: document.title,
                    pageContent: document.body.innerText, // Full page text
                });
                console.log('[Content/FAB] Context saved, opening sidepanel...');
                
                // Open the sidepanel using bridge
                                // await bridge.openSidepanel();
                chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL" });
            } catch (err) {
                console.error('Failed to open sidepanel:', err);
                openResultPopup({
                    title: "Chat",
                    status: "error",
                    body: "Failed to open side panel. Please try again.",
                    anchor: null,
                });
            }
        }
    }, [explainPage, openResultPopup, summarizePage, togglePageTranslation, toggleScreenReader]);

    const handleFabConfigOpen = useCallback(async (action: FabConfigAction) => {
        const bridge = await getExtensionBridge();
        
        let popupId: string;
        
        const renderSummaryConfig = (currentConfig: typeof summarizerConfig) => (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.7 }}>Type</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        {(["key-points", "tldr", "teaser", "headline"] as SummarizerType[]).map((type) => (
                            <button
                                key={type}
                                style={{
                                    background: currentConfig.type === type ? "rgba(86, 140, 255, 0.15)" : "transparent",
                                    border: `1px solid ${currentConfig.type === type ? "rgba(86, 140, 255, 0.5)" : "rgba(15, 23, 42, 0.15)"}`,
                                    padding: "0.4rem 0.75rem",
                                    borderRadius: "0.5rem",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                    color: currentConfig.type === type ? "#568cff" : "inherit",
                                    cursor: "pointer",
                                    transition: "all 0.2s ease",
                                }}
                                onClick={async () => {
                                    const newConfig = { ...currentConfig, type };
                                    setSummarizerConfig(newConfig);
                                    await bridge.saveSummarizerSettings({
                                        type: newConfig.type,
                                        length: newConfig.length,
                                        largeContentStrategy: newConfig.largeContentStrategy || 'join'
                                    });
                                    updatePopup(popupId, { body: renderSummaryConfig(newConfig) });
                                }}
                            >
                                {type === "key-points" ? "Key Points" : type === "tldr" ? "TLDR" : type === "teaser" ? "Teaser" : "Headline"}
                            </button>
                        ))}
                    </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.7 }}>Length</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        {(["short", "medium", "long"] as SummarizerLength[]).map((length) => (
                            <button
                                key={length}
                                style={{
                                    background: currentConfig.length === length ? "rgba(86, 140, 255, 0.15)" : "transparent",
                                    border: `1px solid ${currentConfig.length === length ? "rgba(86, 140, 255, 0.5)" : "rgba(15, 23, 42, 0.15)"}`,
                                    padding: "0.4rem 0.75rem",
                                    borderRadius: "0.5rem",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                    color: currentConfig.length === length ? "#568cff" : "inherit",
                                    cursor: "pointer",
                                    transition: "all 0.2s ease",
                                }}
                                onClick={async () => {
                                    const newConfig = { ...currentConfig, length };
                                    setSummarizerConfig(newConfig);
                                    await bridge.saveSummarizerSettings({
                                        type: newConfig.type,
                                        length: newConfig.length,
                                        largeContentStrategy: newConfig.largeContentStrategy || 'join'
                                    });
                                    updatePopup(popupId, { body: renderSummaryConfig(newConfig) });
                                }}
                            >
                                {length.charAt(0).toUpperCase() + length.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.7 }}>Large Content</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                        {(["join", "merge"] as LargeContentStrategy[]).map((strategy) => (
                            <button
                                key={strategy}
                                style={{
                                    background: (currentConfig.largeContentStrategy || "join") === strategy ? "rgba(86, 140, 255, 0.15)" : "transparent",
                                    border: `1px solid ${(currentConfig.largeContentStrategy || "join") === strategy ? "rgba(86, 140, 255, 0.5)" : "rgba(15, 23, 42, 0.15)"}`,
                                    padding: "0.4rem 0.75rem",
                                    borderRadius: "0.5rem",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                    color: (currentConfig.largeContentStrategy || "join") === strategy ? "#568cff" : "inherit",
                                    cursor: "pointer",
                                    transition: "all 0.2s ease",
                                }}
                                onClick={async () => {
                                    const newConfig = { ...currentConfig, largeContentStrategy: strategy };
                                    setSummarizerConfig(newConfig);
                                    await bridge.saveSummarizerSettings({
                                        type: newConfig.type,
                                        length: newConfig.length,
                                        largeContentStrategy: newConfig.largeContentStrategy || 'join'
                                    });
                                    updatePopup(popupId, { body: renderSummaryConfig(newConfig) });
                                }}
                                title={strategy === "join" ? "Concatenate content" : "Merge summaries"}
                            >
                                {strategy.charAt(0).toUpperCase() + strategy.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        );
        
        const renderTranslateConfig = (currentConfig: typeof translatorConfig) => (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", opacity: 0.7 }}>Target Language</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    {[
                        { code: "en", label: "English" },
                        { code: "es", label: "Spanish" },
                        { code: "pt", label: "Portuguese" },
                        { code: "fr", label: "French" },
                        { code: "de", label: "German" },
                        { code: "it", label: "Italian" },
                        { code: "ja", label: "Japanese" },
                        { code: "ko", label: "Korean" },
                        { code: "zh", label: "Chinese" },
                        { code: "ru", label: "Russian" },
                    ].map(({ code, label }) => (
                        <button
                            key={code}
                            style={{
                                background: currentConfig.targetLanguage === code ? "rgba(86, 140, 255, 0.15)" : "transparent",
                                border: `1px solid ${currentConfig.targetLanguage === code ? "rgba(86, 140, 255, 0.5)" : "rgba(15, 23, 42, 0.15)"}`,
                                padding: "0.4rem 0.75rem",
                                borderRadius: "0.5rem",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                color: currentConfig.targetLanguage === code ? "#568cff" : "inherit",
                                cursor: "pointer",
                                transition: "all 0.2s ease",
                            }}
                            onClick={async () => {
                                const newConfig = { targetLanguage: code };
                                setTranslatorConfig(newConfig);
                                await bridge.saveTranslatorSettings(newConfig);
                                updatePopup(popupId, { body: renderTranslateConfig(newConfig) });
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
        );
        
        if (action === "summary-config") {
            popupId = openResultPopup({
                title: "Summarize Settings",
                status: "idle",
                body: renderSummaryConfig(summarizerConfig),
                anchor: null,
            });
        } else if (action === "translate-config") {
            popupId = openResultPopup({
                title: "Translate Settings",
                status: "idle",
                body: renderTranslateConfig(translatorConfig),
                anchor: null,
            });
        } else if (action === "explain-config") {
            let tempValue = explainPrompt;
            const popupId = openResultPopup({
                title: "Custom Explain Prompt",
                status: "idle",
                body: (
                    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                        <textarea
                            defaultValue={tempValue}
                            onChange={(e) => { tempValue = e.target.value; }}
                            placeholder="What do you want the AI to explain about the page? (e.g., 'Explain this page like I'm 5', 'Explain technical terms', etc.)"
                            rows={4}
                            style={{
                                width: "100%",
                                padding: "0.75rem",
                                borderRadius: "0.5rem",
                                border: "1px solid rgba(15, 23, 42, 0.15)",
                                fontSize: "0.85rem",
                                fontFamily: "inherit",
                                resize: "vertical",
                            }}
                        />
                        <button
                            style={{
                                padding: "0.65rem 1.25rem",
                                background: "#4f7aff",
                                color: "white",
                                border: "none",
                                borderRadius: "0.75rem",
                                cursor: "pointer",
                                fontWeight: 600,
                                alignSelf: "flex-end",
                            }}
                            onClick={async () => {
                                setExplainPrompt(tempValue);
                                await bridge.saveExplainPrompt(tempValue);
                                closePopup(popupId);
                            }}
                        >
                            Save
                        </button>
                    </div>
                ),
                anchor: null,
                initialHeight: 250,
            });
        }
    }, [summarizerConfig, translatorConfig, explainPrompt, openResultPopup, closePopup, updatePopup, setSummarizerConfig, setTranslatorConfig, setExplainPrompt]);

    const handleSelectionConfigOpen = useCallback((action: SelectionConfigAction) => {
        // Reuse the same config popups as FAB
        if (action === "summary-config") {
            handleFabConfigOpen("summary-config");
        } else if (action === "translate-config") {
            handleFabConfigOpen("translate-config");
        }
    }, [handleFabConfigOpen]);

    const describeImage = useCallback(async () => {
        const target = imageInspectorTargetRef.current;
        if (!target) return;
        const bridgeInstance = await ensureBridgeInstance();
        if (!bridgeInstance) return;

        // Hide the inspector button immediately like toolbar behavior
        setImageInspectorVisible(false);
        cancelHideImageInspector();
        setImageInspectorBusy(true);

        const rect = target.getBoundingClientRect();
        setImageInspectorAnchor(rect);
        const imageSrc = target.currentSrc || target.src;
        const popupId = openResultPopup({
            title: "Image insight",
            status: "loading",
            body: "Fetching image...",
            anchor: { x: rect.left + rect.width / 2, y: Math.max(0, rect.top - 24) },
        });

        let handleId: string | null = null;
        try {
            // console.log("target:", target);
            // Fetch the image as a blob
            updatePopup(popupId, { body: "Downloading image..." });
            const src = target.currentSrc || target.src;
            if (!src) {
                throw new Error("No image source available");
            }

            const response = await fetch(src);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            // console.log("[Image] Response received:", response);
            const imageBlob = await response.blob();
            // console.log("[Image] Fetched image blob:", imageBlob.size, "bytes, type:", imageBlob.type);
            
            // Convert blob to base64 for transport (blobs are not transferable through Chrome message passing)
            const arrayBuffer = await imageBlob.arrayBuffer();
            const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
            const imageData = { base64, type: imageBlob.type };
            // console.log("[Image] Converted to base64 for transport, length:", base64.length);
            
            // Create language model and send image for analysis
            updatePopup(popupId, { body: "Analyzing image with AI..." });
            handleId = await bridgeInstance.languageModelCreate(await getModelOptionsWithPersona(bridgeInstance, {
                ...DEFAULT_MODEL_OPTIONS,
                expectedInputs: [
                    { type: "text", languages: ["en"] },
                    { type: "image" },
                ],
            }));

            const description = await bridgeInstance.languageModelPrompt({
                handleId,
                input: [
                    {
                        role: "user",
                        content: [{ type: "image", value: imageData as any }],
                    },
                    {
                        role: "user",
                        content: "Describe this image in detail. Focus on what would be helpful for accessibility. Keep it concise (2-4 sentences).",
                    },
                ],
            });
            // console.log("description:", description);

            updatePopup(popupId, {
                status: "success",
                body: (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <img 
                            src={imageSrc} 
                            alt="Interrogated image"
                            style={{ 
                                maxWidth: "100%", 
                                maxHeight: "200px", 
                                objectFit: "contain",
                                borderRadius: "8px",
                                border: "1px solid rgba(0, 0, 0, 0.1)"
                            }}
                        />
                        <div>{description}</div>
                    </div>
                ),
            });
        } catch (error) {
            console.error("Image insight failed", error);
            updatePopup(popupId, { status: "error", body: String(error) });
        } finally {
            if (handleId) {
                try {
                    await bridgeInstance.languageModelDestroy(handleId);
                } catch (destroyError) {
                    console.warn("Failed to release image insight handle", destroyError);
                }
            }
            setImageInspectorBusy(false);
        }
    }, [ensureBridgeInstance, cancelHideImageInspector, openResultPopup, updatePopup]);

    const handleInputAction = useCallback(async (action: InputAction) => {
        const target = focusedInputRef.current;
        if (!target) return;
        const bridgeInstance = await ensureBridgeInstance();
        if (!bridgeInstance) return;
        setInputVisible(true);

        if (action === "voice") {
            // console.log("[Voice] Voice action triggered");
            if (voiceActiveRef.current) {
                // console.log("[Voice] Already recording, stopping...");
                // Stop the audio recording
                setInputBusy("voice");
                try {
                    const audioCapture = voiceRecognitionRef.current as any;
                    if (audioCapture && typeof audioCapture.stop === "function") {
                        const audioBlob = await audioCapture.stop();
                        // console.log("[Voice] Recording stopped, blob size:", audioBlob.size);
                        
                        // Convert blob to base64 for transport
                        const arrayBuffer = await audioBlob.arrayBuffer();
                        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
                        const audioData = { base64, type: audioBlob.type };
                        // console.log("[Voice] Converted to base64 for transport");
                        
                        // Transcribe using AI
                        const bridgeInstance = await ensureBridgeInstance();
                        if (bridgeInstance) {
                            const transcript = await bridgeInstance.transcribeAudio({ 
                                audioBlob: audioData,
                                chunkDuration: 30
                            });
                            // console.log("[Voice] Transcript:", transcript);
                            writeInputValue(target, transcript, "append");
                        }
                    }
                } catch (error) {
                    console.error("[Voice] Transcription failed:", error);
                    openResultPopup({ 
                        title: "Transcription failed", 
                        status: "error", 
                        body: String(error), 
                        anchor: null 
                    });
                } finally {
                    voiceActiveRef.current = false;
                    setIsRecording(false);
                    setInputBusy(null);
                    if (target.isConnected) {
                        target.focus({ preventScroll: true });
                        updateInputAnchor(target);
                    }
                }
                return;
            }
            
            // Start recording
            try {
                // const { AudioCapture } = await import("@/utils/AudioCapture");
                const audioCapture = new AudioCapture();
                
                const hasPermission = await audioCapture.checkPermission();
                if (!hasPermission) {
                    const granted = await audioCapture.requestPermission();
                    if (!granted) {
                        openResultPopup({ 
                            title: "Permission denied", 
                            status: "error", 
                            body: "Microphone permission is required for voice input.", 
                            anchor: null 
                        });
                        return;
                    }
                }
                
                await audioCapture.start();
                // console.log("[Voice] Recording started");
                voiceRecognitionRef.current = audioCapture as any;
                voiceActiveRef.current = true;
                setIsRecording(true);
            } catch (error) {
                console.error("[Voice] Failed to start recording:", error);
                openResultPopup({ 
                    title: "Recording failed", 
                    status: "error", 
                    body: String(error), 
                    anchor: null 
                });
            }
            return;
        }

        if (action === "voice-stop") {
            if (voiceRecognitionRef.current) {
                // Trigger the same stop logic as above
                handleInputAction("voice");
            }
            return;
        }

        if (action === "write" || action === "rewrite" || action === "expand") {
            inputModalTargetRef.current = target;
            
            // Open a popup with the form
            const popupId = openResultPopup({
                title: action === "write" ? "Write" : action === "rewrite" ? "Rewrite" : "Expand",
                status: "idle",
                body: (
                    <WriterForm
                        action={action}
                        onSubmit={(input, size, format, tone) => handleWriterFormSubmit(popupId, action, input, size, format, tone)}
                        onCancel={() => closePopup(popupId)}
                    />
                ),
                anchor: inputAnchor ? { x: inputAnchor.left + inputAnchor.width / 2, y: inputAnchor.top - 24 } : null,
                initialHeight: 420,
            });
            return;
        }

        if (action === "fix-grammar") {
            const currentValue = readInputValue(target);
            if (!currentValue.trim()) return;

            inputModalTargetRef.current = target;
            setInputBusy(action);

            const popupId = openResultPopup({
                title: "Fix Grammar",
                status: "loading",
                body: "Checking grammar...",
                anchor: inputAnchor ? { x: inputAnchor.left + inputAnchor.width / 2, y: inputAnchor.top - 24 } : null,
            });

            try {
                const handleId = await bridgeInstance.languageModelCreate(await getModelOptionsWithPersona(bridgeInstance));
                const corrected = await bridgeInstance.languageModelPrompt({
                    handleId,
                    input: [
                        { role: "user", content: "Fix any grammar, spelling, and punctuation errors in the following text. Keep the same meaning and tone. Output only the corrected text, nothing else:" },
                        { role: "user", content: currentValue },
                    ],
                });
                await bridgeInstance.languageModelDestroy(handleId);

                // Show corrected text with action buttons
                updatePopup(popupId, {
                    status: "success",
                    body: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ 
                                padding: '1rem', 
                                background: 'rgba(79, 122, 255, 0.05)', 
                                borderRadius: '0.75rem',
                                border: '1px solid rgba(79, 122, 255, 0.2)',
                                maxHeight: '300px',
                                overflowY: 'auto',
                            }}>
                                <div style={{ 
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    lineHeight: '1.6',
                                }}>{corrected}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button 
                                    type="button"
                                    onClick={() => closePopup(popupId)}
                                    style={{
                                        padding: '0.65rem 1.25rem',
                                        background: 'transparent',
                                        color: 'inherit',
                                        border: '1px solid currentColor',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                    }}
                                >
                                    Close
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => {
                                        writeInputValue(target, corrected, "replace");
                                        if (target.isConnected) {
                                            target.focus({ preventScroll: true });
                                        }
                                        closePopup(popupId);
                                    }}
                                    style={{
                                        padding: '0.65rem 1.25rem',
                                        background: '#4f7aff',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                    }}
                                >
                                    Replace
                                </button>
                            </div>
                        </div>
                    ),
                });
            } catch (error) {
                console.error("Grammar fix failed", error);
                updatePopup(popupId, {
                    status: "error",
                    body: String(error),
                });
            } finally {
                setInputBusy(null);
                if (target.isConnected) {
                    target.focus({ preventScroll: true });
                    updateInputAnchor(target);
                    setInputVisible(true);
                }
            }
            return;
        }

        setInputBusy(action);
        try {
            // This block is now empty, but kept for consistency
        } catch (error) {
            console.error("Input helper failed", error);
            openResultPopup({ title: "Input helper", status: "error", body: String(error), anchor: null });
        } finally {
            setInputBusy(null);
            if (target.isConnected) {
                target.focus({ preventScroll: true });
                updateInputAnchor(target);
                setInputVisible(true);
            }
        }
    }, [ensureBridgeInstance, openResultPopup, updateInputAnchor]);

    const handleWriterFormSubmit = useCallback(
        async (popupId: string, action: "write" | "rewrite" | "expand", input: string, size: WriterSize, format: WriterFormat, tone: WriterTone) => {
            const target = inputModalTargetRef.current;
            if (!target) return;

            const bridgeInstance = bridgeRef.current;
            if (!bridgeInstance) return;

            // Update popup to show loading
            updatePopup(popupId, {
                status: "loading",
                body: "Generating text...",
            });

            setInputBusy(action);

            try {
                let output: string = "";
                const { personaPrompt } = await bridgeInstance.getPreferences();
                
                if (action === "write") {
                    const options: WriterExCreateOptions = {
                        ...DEFAULT_WRITER_OPTIONS,
                        length: size,
                        format: format,
                        tone: tone,
                        ...(personaPrompt && { context: `This is your persona, follow it: "${personaPrompt}."` })
                    };
                    output = await bridgeInstance.write({ text: input, options });
                } else if (action === "rewrite") {
                    const currentValue = readInputValue(target);
                    if (!currentValue.trim()) return;
                    const rewriteLength = size === "short" ? "shorter" : size === "long" ? "longer" : "as-is";
                    const rewriteTone = tone === "formal" ? "more-formal" : tone === "casual" ? "more-casual" : "as-is";
                    const options: RewriterExCreateOptions = {
                        ...DEFAULT_REWRITER_OPTIONS,
                        length: rewriteLength,
                        format: format === "markdown" ? "markdown" : "plain-text",
                        tone: rewriteTone,
                        ...(personaPrompt && { context: `This is your persona, follow it: "${personaPrompt}."` })
                    };
                    output = await bridgeInstance.rewrite({ text: currentValue, options });
                } else if (action === "expand") {
                    const currentValue = readInputValue(target);
                    if (!currentValue.trim()) return;
                    const handleId = await bridgeInstance.languageModelCreate(await getModelOptionsWithPersona(bridgeInstance));
                    const prompt = format === "markdown"
                        ? "Continue the following text using markdown formatting:"
                        : "Continue the following text, extending the idea:";
                    output = await bridgeInstance.languageModelPrompt({
                        handleId,
                        input: [
                            { role: "user", content: prompt },
                            { role: "user", content: currentValue },
                        ],
                    });
                    await bridgeInstance.languageModelDestroy(handleId);
                    output = `${currentValue}\n${output}`;
                }
                
                // Show generated text with action buttons
                updatePopup(popupId, {
                    status: "success",
                    body: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ 
                                padding: '1rem', 
                                background: 'rgba(79, 122, 255, 0.05)', 
                                borderRadius: '0.75rem',
                                border: '1px solid rgba(79, 122, 255, 0.2)',
                                maxHeight: '300px',
                                overflowY: 'auto',
                            }}>
                                <div style={{ 
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    lineHeight: '1.6',
                                }}>{output}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button 
                                    type="button"
                                    onClick={() => closePopup(popupId)}
                                    style={{
                                        padding: '0.65rem 1.25rem',
                                        background: 'transparent',
                                        color: 'inherit',
                                        border: '1px solid currentColor',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                    }}
                                >
                                    Close
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => {
                                        // Regenerate with same prompt and options
                                        handleWriterFormSubmit(popupId, action, input, size, format, tone);
                                    }}
                                    style={{
                                        padding: '0.65rem 1.25rem',
                                        background: '#6b7280',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                    }}
                                >
                                    Regenerate
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => {
                                        writeInputValue(target, output, "replace");
                                        if (target.isConnected) {
                                            target.focus({ preventScroll: true });
                                        }
                                        closePopup(popupId);
                                    }}
                                    style={{
                                        padding: '0.65rem 1.25rem',
                                        background: '#4f7aff',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.75rem',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                    }}
                                >
                                    Accept
                                </button>
                            </div>
                        </div>
                    ),
                });
            } catch (error) {
                console.error("Input helper failed", error);
                updatePopup(popupId, {
                    status: "error",
                    body: (
                        <div>
                            <p style={{ marginBottom: '0.75rem', color: '#ff4d4f' }}>
                                Error: {String(error)}
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button 
                                    type="button"
                                    onClick={() => {
                                        closePopup(popupId);
                                        // Reopen form to try again
                                        const newPopupId = openResultPopup({
                                            title: action === "write" ? "Write" : action === "rewrite" ? "Rewrite" : "Expand",
                                            status: "idle",
                                            body: (
                                                <WriterForm
                                                    action={action}
                                                    onSubmit={(input, size, format, tone) => handleWriterFormSubmit(newPopupId, action, input, size, format, tone)}
                                                    onCancel={() => closePopup(newPopupId)}
                                                />
                                            ),
                                            anchor: null,
                                            initialHeight: 420,
                                        });
                                    }}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: '#4f7aff',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.5rem',
                                        cursor: 'pointer',
                                        fontWeight: 600,
                                    }}
                                >
                                    Try again
                                </button>
                                <button 
                                    type="button"
                                    onClick={() => closePopup(popupId)}
                                    style={{
                                        padding: '0.5rem 1rem',
                                        background: 'transparent',
                                        color: 'inherit',
                                        border: '1px solid currentColor',
                                        borderRadius: '0.5rem',
                                        cursor: 'pointer',
                                    }}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    ),
                });
            } finally {
                setInputBusy(null);
                if (target.isConnected) {
                    target.focus({ preventScroll: true });
                    updateInputAnchor(target);
                    setInputVisible(true);
                }
            }
        },
        [closePopup, openResultPopup, updatePopup, updateInputAnchor]
    );

    const screenReaderToast = screenReaderActive ? (
        <div className={styles.screenReaderToast}>
            <span>{screenReaderMessage}</span>
            <button type="button" onClick={toggleScreenReader}>Stop</button>
        </div>
    ) : null;

    const speechToast = (speechProcessing || speechPlaying) ? (
        <div className={styles.speechToast}>
            <span>
                {speechProcessing ? "⏳ Generating audio..." : "🔊 Reading text"}
            </span>
            <button type="button" onClick={stopSpeech}>Stop</button>
        </div>
    ) : null;

    return (
        <div className={styles.root} data-theme={theme}>
            {/* Floating close button */}
            {/* <button
                className={styles.closeButton}
                onClick={() => {
                    const root = document.getElementById("assistant-content-root");
                    if (root) root.remove();
                }}
                title="Close Assistant"
                aria-label="Close Assistant"
            >
                ✕
            </button> */}
            
            <div className={`${styles.layer} ${styles.fabLayer}`} data-theme={theme}>
                <FabMenu
                    theme={theme}
                    onAction={handleFabAction}
                    onConfigOpen={handleFabConfigOpen}
                    busyAction={fabBusy}
                    activeStates={{ translate: translationActive, "screen-reader": screenReaderActive }}
                    mascot={mascot}
                />
            </div>
            <div className={`${styles.layer} ${styles.interactiveLayer}`}>
                <SelectionToolbar
                    visible={selectionVisible}
                    range={selectionRange}
                    theme={theme}
                    busyAction={selectionBusy}
                    speechProcessing={speechProcessing}
                    speechPlaying={speechPlaying}
                    onAction={handleSelectionAction}
                    onConfigOpen={handleSelectionConfigOpen}
                    onStopSpeech={stopSpeech}
                />
            </div>
            <div className={`${styles.layer} ${styles.interactiveLayer}`}>
                <ImageInspector
                    visible={imageInspectorVisible}
                    anchor={imageInspectorAnchor}
                    theme={theme}
                    busy={imageInspectorBusy}
                    onInspect={describeImage}
                    onPointerEnter={cancelHideImageInspector}
                    onPointerLeave={scheduleHideImageInspector}
                />
            </div>
            {popups.map((popup) => (
                <div key={popup.id} className={`${styles.layer} ${styles.interactiveLayer}`}>
                    <FloatingPopup
                        open={popup.open ?? true}
                        title={popup.title}
                        status={popup.status}
                        body={popup.body}
                        footer={popup.footer}
                        anchor={popup.anchor}
                        theme={theme}
                        onClose={() => closePopup(popup.id)}
                        initialHeight={popup.initialHeight}
                    />
                </div>
            ))}
            <div className={`${styles.layer} ${styles.interactiveLayer}`}>
                <InputAssistant
                    visible={inputVisible}
                    theme={theme}
                    anchor={inputAnchor}
                    busyAction={inputBusy}
                    onAction={handleInputAction}
                    isRecording={isRecording}
                />
            </div>
            {screenReaderToast}
            {speechToast}
        </div>
    );
}