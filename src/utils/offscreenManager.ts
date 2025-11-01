const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/index.html";
const OFFSCREEN_JUSTIFICATION = "Run local AI utilities with DOM access";
const DEFAULT_REASONS = [
	"DOM_PARSER",
	"AUDIO_PLAYBACK",
	"USER_MEDIA",
] as chrome.offscreen.Reason[];
const OFFSCREEN_READY_TIMEOUT = 10_000;

interface ReadyWaiter {
	resolve: () => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout> | null;
}

let creatingDocument: Promise<void> | null = null;
let offscreenReady = false;
const readyWaiters: ReadyWaiter[] = [];

chrome.runtime.onMessage.addListener((message) => {
	if (message?.type === "assistant:offscreen-ready") {
		handleOffscreenReady();
		return;
	}

	if (message?.type === "assistant:offscreen-status") {
		if (message.state === "ready") {
			handleOffscreenReady();
		} else if (message.state === "error") {
			handleOffscreenError(new Error("Offscreen runtime reported an error state"));
		}
	}
});

function handleOffscreenReady(): void {
	if (offscreenReady) return;
	offscreenReady = true;
	if (!readyWaiters.length) return;
	const waiters = readyWaiters.splice(0, readyWaiters.length);
	for (const waiter of waiters) {
		if (waiter.timeoutId) {
			clearTimeout(waiter.timeoutId);
		}
		waiter.resolve();
	}
}

function handleOffscreenError(error: Error): void {
	offscreenReady = false;
	if (!readyWaiters.length) return;
	const waiters = readyWaiters.splice(0, readyWaiters.length);
	for (const waiter of waiters) {
		if (waiter.timeoutId) {
			clearTimeout(waiter.timeoutId);
		}
		waiter.reject(error);
	}
}

function requestOffscreenStatus(): void {
	try {
		chrome.runtime.sendMessage({ type: "assistant:offscreen-status-request" }).catch(() => undefined);
	} catch (error) {
		console.warn("Failed to query offscreen status", error);
	}
}

function waitForOffscreenReady(timeoutMs = OFFSCREEN_READY_TIMEOUT): Promise<void> {
	if (offscreenReady) return Promise.resolve();

	return new Promise<void>((resolve, reject) => {
		const waiter: ReadyWaiter = {
			resolve: () => {
				if (waiter.timeoutId) {
					clearTimeout(waiter.timeoutId);
				}
				resolve();
			},
			reject: (error: Error) => {
				if (waiter.timeoutId) {
					clearTimeout(waiter.timeoutId);
				}
				reject(error);
			},
			timeoutId: null,
		};

		if (timeoutMs > 0) {
			waiter.timeoutId = setTimeout(() => {
				const index = readyWaiters.indexOf(waiter);
				if (index !== -1) {
					readyWaiters.splice(index, 1);
				}
				waiter.reject(new Error("Offscreen runtime did not become ready in time"));
			}, timeoutMs);
		}

		readyWaiters.push(waiter);
		requestOffscreenStatus();
	});
}

async function hasOffscreenDocument(): Promise<boolean> {
	const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

	if ("getContexts" in chrome.runtime) {
		const contexts = await chrome.runtime.getContexts({
			contextTypes: ["OFFSCREEN_DOCUMENT"],
			documentUrls: [offscreenUrl],
		});
		return contexts.length > 0;
	}

	const globalScope = self as unknown as { clients: { matchAll: () => Promise<Array<{ url?: string }>> } };
	const clientsList = await globalScope.clients.matchAll();
	return clientsList.some((client) => client.url === offscreenUrl);
}

export async function ensureOffscreenDocument(
	reasons: chrome.offscreen.Reason[] = DEFAULT_REASONS,
): Promise<void> {
	const exists = await hasOffscreenDocument();
	if (exists) {
		if (offscreenReady) return;
		await waitForOffscreenReady();
		return;
	}

	if (creatingDocument) {
		await creatingDocument;
		return;
	}

	offscreenReady = false;
	creatingDocument = (async () => {
		await chrome.offscreen.createDocument({
			url: OFFSCREEN_DOCUMENT_PATH,
			reasons,
			justification: OFFSCREEN_JUSTIFICATION,
		});
		await waitForOffscreenReady();
	})();

	try {
		await creatingDocument;
	} finally {
		creatingDocument = null;
	}
}

export async function closeOffscreenDocument(): Promise<void> {
	if (!(await hasOffscreenDocument())) return;

	await chrome.offscreen.closeDocument();
	offscreenReady = false;
}
