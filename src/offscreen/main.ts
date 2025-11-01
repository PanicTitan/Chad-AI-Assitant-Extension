import { registerOffscreenService } from "../utils/comctx/aiService";

const statusElement = document.querySelector<HTMLParagraphElement>(".status");

function setStatus(state: "loading" | "ready" | "error", message: string) {
	if (!statusElement) return;
	statusElement.dataset.state = state;
	statusElement.textContent = message;
}

async function bootstrap() {
	try {
		registerOffscreenService();
		setStatus("ready", "AI runtime ready");
		chrome.runtime.sendMessage({ type: "assistant:offscreen-ready" }).catch(() => undefined);
	} catch (error) {
		console.error("Failed to register offscreen service", error);
		setStatus("error", "Failed to start AI runtime");
	}
}

bootstrap();

chrome.runtime.onMessage.addListener((message) => {
	if (message?.type === "assistant:offscreen-status-request") {
		chrome.runtime.sendMessage({
			type: "assistant:offscreen-status",
			state: statusElement?.dataset.state ?? "loading",
		}).catch(() => undefined);
	}
});
