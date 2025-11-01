import { db } from "@/utils/db";
import { registerBackgroundExtensionBridge } from "../utils/comctx/aiService";
import { ensureOffscreenDocument, closeOffscreenDocument } from "../utils/offscreenManager";

const extensionBridge = registerBackgroundExtensionBridge();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "assistant:ensure-offscreen") {
        ensureOffscreenDocument();
    }
    if (message?.type === "assistant:close-offscreen") {
        closeOffscreenDocument();
    }
    if (message?.type === "OPEN_SIDEPANEL") {
        // Open sidepanel for the tab that sent the message
        if (sender.tab?.id) {
            chrome.sidePanel.open({ tabId: sender.tab.id })
                .then(() => sendResponse({ success: true }))
                .catch((error) => {
                    console.error('Failed to open sidepanel:', error);
                    sendResponse({ success: false, error: error.message });
                });
            return true; // Keep the message channel open for async response
        }
    }
});

// Handle keyboard command to open sidepanel
chrome.commands.onCommand.addListener((command) => {
    console.log(`Command triggered: ${command}`);
    if (command === "open-sidepanel") {
        // Get the current active tab and open sidepanel
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
                chrome.sidePanel.open({ tabId: tabs[0].id })
                    .catch((error) => console.error('Failed to open sidepanel via command:', error));
            }
        });
    }
});

chrome.runtime.onSuspend?.addListener(() => {
    closeOffscreenDocument().catch((error) => {
        console.warn("Failed to close offscreen document on suspend", error);
    });
});

// Expose bridge for debugging
(globalThis as any).assistantExtensionBridge = extensionBridge;

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

// Omnibox Integration
chrome.omnibox.setDefaultSuggestion({
    description: 'Ask AI Assistant: %s'
});

// Handle omnibox input changes (for suggestions)
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    const suggestions: chrome.omnibox.SuggestResult[] = [];
    
    if (text.trim()) {
        suggestions.push({
            content: `ask:${text}`,
            description: `Ask: <match>${text}</match>`
        });
        
        suggestions.push({
            content: `search:${text}`,
            description: `Search tabs: <match>${text}</match>`
        });
        
        suggestions.push({
            content: `history:${text}`,
            description: `Search history: <match>${text}</match>`
        });
    }
    
    suggest(suggestions);
});

// Handle omnibox input accepted
chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
    // Import db at the top level to avoid dynamic import issues
    // const { db } = await import('../utils/db.js');
    
    // Get or create active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (tabs[0]?.id) {
        const tabId = tabs[0].id;
        
        // Save the query as context for the chat
        try {
            const contextId = `ctx-${Date.now()}`;
            await db.chatContext.add({
                id: contextId,
                data: {
                    reason: 'omnibox',
                    context: text,
                },
                timestamp: new Date(),
                used: false,
            });
            console.log('[Omnibox] Context saved:', contextId);
        } catch (error) {
            console.error('[Omnibox] Failed to save context:', error);
        }
        
        // Instead of opening sidepanel directly (which requires user gesture),
        // we'll inject a script that opens it from the page context
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    // Send message to background to open sidepanel
                    chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL' });
                }
            });
        } catch (error) {
            console.error('[Omnibox] Failed to trigger sidepanel:', error);
            
            // Fallback: Navigate to extension page with sidepanel
            const url = chrome.runtime.getURL('src/index.html?path=sidepanel&source=omnibox');
            if (disposition === 'currentTab') {
                await chrome.tabs.update(tabId, { url });
            } else if (disposition === 'newForegroundTab') {
                await chrome.tabs.create({ url, active: true });
            } else {
                await chrome.tabs.create({ url, active: false });
            }
        }
    }
});

// Cache for HuggingFace files
const CACHE_NAME = 'huggingface-models-cache';
const HUGGINGFACE_URL_PATTERN = /^https:\/\/huggingface\.co\//;

// Handle fetch events to cache HuggingFace requests
self.addEventListener('fetch', (event: any) => {
    const url = event.request.url;
    
    // Only cache GET requests from huggingface.co
    if (event.request.method !== 'GET' || !HUGGINGFACE_URL_PATTERN.test(url)) {
        return;
    }
    
    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            // Try to get from cache first
            const cachedResponse = await cache.match(event.request);
            if (cachedResponse) {
                console.log('[Cache] Serving from cache:', url);
                return cachedResponse;
            }
            
            // If not in cache, fetch from network
            try {
                console.log('[Cache] Fetching from network:', url);
                const networkResponse = await fetch(event.request);
                
                // Cache successful responses
                if (networkResponse.ok) {
                    cache.put(event.request, networkResponse.clone());
                    console.log('[Cache] Cached:', url);
                }
                
                return networkResponse;
            } catch (error) {
                console.error('[Cache] Fetch failed:', error);
                throw error;
            }
        })
    );
});
