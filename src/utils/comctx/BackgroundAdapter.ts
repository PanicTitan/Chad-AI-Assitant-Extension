import type { Adapter, OffMessage, OnMessage, SendMessage } from "comctx";
import { COMCTX_CHANNEL } from "./constants";
import type { BridgeEnvelope, BridgeMessageMeta } from "./types";

export class BackgroundAdapter implements Adapter<BridgeMessageMeta> {
	private readonly namespace: string;

	constructor(namespace: string) {
		this.namespace = namespace;
	}

	public sendMessage: SendMessage<BridgeMessageMeta> = async (message) => {
		const tabId = message.meta?.tabId;
		if (typeof tabId !== "number") {
			console.warn("[BackgroundAdapter] missing tabId in message meta", message);
			return;
		}

		console.log("[BackgroundAdapter] Sending message:", message.type, message.path, "to tab", tabId);
		const envelope: BridgeEnvelope<BridgeMessageMeta> = {
			channel: COMCTX_CHANNEL,
			namespace: this.namespace,
			target: "content",
			payload: message,
			tabId,
		};

		await chrome.tabs.sendMessage(tabId, envelope).catch((error) => {
			console.warn("[BackgroundAdapter] failed to send message to tab", tabId, error);
		});
	};

	public onMessage: OnMessage<BridgeMessageMeta> = (callback): OffMessage | void => {
		const handler = (
			message: BridgeEnvelope<BridgeMessageMeta>,
			sender: chrome.runtime.MessageSender,
		) => {
			if (message?.channel !== COMCTX_CHANNEL) return;
			if (message.namespace !== this.namespace) return;
			if (message.target !== "background") return;

			console.log("[BackgroundAdapter] Received message:", message.payload?.type, message.payload?.path, "from tab", sender.tab?.id);
			const tabId = sender.tab?.id ?? message.tabId;
			const payload = typeof tabId === "number"
				? ({
					...message.payload,
					meta: {
						...(message.payload.meta ?? {}),
						tabId,
					},
				} as typeof message.payload)
				: ({ ...message.payload } as typeof message.payload);

			callback(payload);
		};

		chrome.runtime.onMessage.addListener(handler as any);

		return () => chrome.runtime.onMessage.removeListener(handler as any);
	};
}
