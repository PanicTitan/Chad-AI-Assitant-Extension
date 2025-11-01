import type { Message, MessageMeta } from "comctx";

export interface BridgeMessageMeta extends MessageMeta {
    tabId?: number;
}

export interface BridgeEnvelope<TMeta extends MessageMeta = BridgeMessageMeta> {
    channel: string;
    namespace: string;
    target: "background" | "offscreen" | "content";
    payload: Message<TMeta>;
    tabId?: number;
}
