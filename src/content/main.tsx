import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ContentApp from "./views/App";
import { getExtensionBridge } from "@/utils/extensionBridge";

const CONTAINER_ID = "assistant-content-root";

function ensureContainer(): HTMLElement {
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
        container = document.createElement("div");
        container.id = CONTAINER_ID;
        container.style.all = "initial";
        container.style.position = "fixed";
        container.style.inset = "0";
        container.style.pointerEvents = "none";
        container.style.zIndex = "10000";
        document.documentElement.appendChild(container);
    }
    return container;
}

async function initializeAssistant() {
    // Check if assistant is enabled in user preferences via bridge
    const bridge = await getExtensionBridge();
    const prefs = await bridge.getPreferences();
    
    if (!prefs.assistantEnabled) {
        console.log('[Assistant] Assistant is disabled in preferences');
        return;
    }
    
    const container = ensureContainer();
    const root = createRoot(container);

    root.render(
        <StrictMode>
            <ContentApp />
        </StrictMode>,
    );
}

// Initialize the assistant
initializeAssistant().catch(error => {
    console.error('[Assistant] Failed to initialize:', error);
});
