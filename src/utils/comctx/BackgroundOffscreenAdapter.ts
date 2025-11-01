import type { Adapter, OffMessage, OnMessage, SendMessage } from "comctx";
import { COMCTX_CHANNEL } from "./constants";
import type { BridgeEnvelope, BridgeMessageMeta } from "./types";

export class BackgroundOffscreenAdapter implements Adapter<BridgeMessageMeta> {
    private readonly namespace: string;

    constructor(namespace: string) {
        this.namespace = namespace;
    }

    public sendMessage: SendMessage<BridgeMessageMeta> = async (message) => {
        const envelope: BridgeEnvelope<BridgeMessageMeta> = {
            channel: COMCTX_CHANNEL,
            namespace: this.namespace,
            target: "offscreen",
            payload: message,
            tabId: message.meta?.tabId,
        };

        await chrome.runtime.sendMessage(envelope);
    };

    public onMessage: OnMessage<BridgeMessageMeta> = (callback): OffMessage | void => {
        const handler = (
            message: BridgeEnvelope<BridgeMessageMeta>,
        ) => {
            if (message?.channel !== COMCTX_CHANNEL) return;
            if (message.namespace !== this.namespace) return;
            if (message.target !== "background") return;

            console.warn("BackgroundOffscreenAdapter:onMessage", {
                path: message.payload?.path,
                sender: message.payload?.meta,
                type: message.payload?.type,
            });
            try {
                if (!message.payload?.path?.length) {
                    console.warn("BackgroundOffscreenAdapter: missing path", message.payload);
                }
                callback({ ...message.payload });
            } catch (error) {
                console.error("BackgroundOffscreenAdapter: failed to dispatch message", message.payload, error);
                throw error;
            }
        };

        chrome.runtime.onMessage.addListener(handler as any);

        return () => chrome.runtime.onMessage.removeListener(handler as any);
    };
}
