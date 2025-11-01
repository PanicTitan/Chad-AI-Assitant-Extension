import { createContentExtensionBridge, ExtensionBridge } from "./comctx/aiService";

let cachedBridge: ExtensionBridge | null = null;
let initializingBridge: Promise<ExtensionBridge> | null = null;

async function initializeBridge(): Promise<ExtensionBridge> {
	if (cachedBridge) return cachedBridge;
	if (!initializingBridge) {
		initializingBridge = (async () => {
			const bridge = createContentExtensionBridge();
			try {
				await bridge.ping();
			} catch (error) {
				console.warn("Extension bridge ping failed", error);
			}
			cachedBridge = bridge;
			return bridge;
		})();
	}
	return initializingBridge;
}

export async function getExtensionBridge(): Promise<ExtensionBridge> {
	return initializeBridge();
}

export function getCachedExtensionBridge(): ExtensionBridge | null {
	return cachedBridge;
}
