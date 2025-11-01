import type { Adapter, OffMessage, OnMessage, SendMessage } from "comctx";
import { COMCTX_CHANNEL } from "./constants";
import type { BridgeEnvelope, BridgeMessageMeta } from "./types";

export class OffscreenAdapter implements Adapter<BridgeMessageMeta> {
	private readonly namespace: string;

	constructor(namespace: string) {
		this.namespace = namespace;
	}

	public sendMessage: SendMessage<BridgeMessageMeta> = async (message) => {
		console.log("[OffscreenAdapter] Sending message:", message.type, message.path);
		const envelope: BridgeEnvelope<BridgeMessageMeta> = {
			channel: COMCTX_CHANNEL,
			namespace: this.namespace,
			target: "background",
			payload: message,
			tabId: message.meta?.tabId,
		};

		await chrome.runtime.sendMessage(envelope);
	};

	public onMessage: OnMessage<BridgeMessageMeta> = (callback): OffMessage | void => {
		const handler = (message: BridgeEnvelope<BridgeMessageMeta>) => {
			if (message?.channel !== COMCTX_CHANNEL) return;
			if (message.namespace !== this.namespace) return;
			if (message.target !== "offscreen") return;

			console.log("[OffscreenAdapter] Received message:", message.payload?.type, message.payload?.path);
			callback({ ...message.payload });
		};

		chrome.runtime.onMessage.addListener(handler as any);

		return () => chrome.runtime.onMessage.removeListener(handler as any);
	};
}
