// @ts-nocheck
import { env as hf, StyleTextToSpeech2Model, AutoTokenizer, Tensor, RawAudio } from "@huggingface/transformers";
import type { ProgressCallback, PreTrainedTokenizer } from "@huggingface/transformers";
import { phonemize } from "./phonemize";
import { TextSplitterStream } from "./splitter";
import { getVoiceData, VOICES } from "./voices";
import { getPublicPath } from "../vite-helper";

// hf.allowLocalModels = true;
// hf.allowRemoteModels = false;
// hf.localModelPath = "/onnx/"
hf.backends.onnx.wasm.wasmPaths = getPublicPath("/ort/wasm/")

const STYLE_DIM = 256;
const SAMPLE_RATE = 24000;

export type GenerateOptions = {
    voice?: keyof typeof VOICES;
    speed?: number;
};

export type StreamProperties = {
    split_pattern?: RegExp;
};

export type StreamGenerateOptions = GenerateOptions & StreamProperties;


export class KokoroTTS {
    model: StyleTextToSpeech2Model;
    tokenizer: PreTrainedTokenizer;

    constructor(model: StyleTextToSpeech2Model, tokenizer: PreTrainedTokenizer) {
        this.model = model;
        this.tokenizer = tokenizer;
    }

    /**
     * Load a KokoroTTS model from the Hugging Face Hub.
     */
    static async from_pretrained(
        model_id: string,
        options: {
            dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
            device?: "wasm" | "webgpu" | "cpu" | null;
            progress_callback?: ProgressCallback | null;
        } = {}
    ): Promise<KokoroTTS> {
        const { dtype = "fp32", device = null, progress_callback = null } = options;
        const modelPromise = StyleTextToSpeech2Model.from_pretrained(model_id, { progress_callback, dtype, device, local_files_only: false });
        const tokenizerPromise = AutoTokenizer.from_pretrained(model_id, { progress_callback });
        const [model, tokenizer] = await Promise.all([modelPromise, tokenizerPromise]);
        return new KokoroTTS(model, tokenizer);
    }

    get voices(): typeof VOICES {
        return VOICES;
    }

    list_voices(): void {
        console.table(VOICES);
    }

    _validate_voice(voice: keyof typeof VOICES): "a" | "b" {
        if (!Object.prototype.hasOwnProperty.call(VOICES, voice)) {
            console.error(`Voice "${voice}" not found. Available voices:`);
            console.table(VOICES);
            throw new Error(`Voice "${voice}" not found. Should be one of: ${Object.keys(VOICES).join(", ")}.`);
        }
        const language = voice.at(0) as "a" | "b";
        return language;
    }

    /**
     * Generate audio from text.
     */
    async generate(text: string, options: GenerateOptions = {}): Promise<RawAudio> {
        const { voice = "af_heart", speed = 1 } = options;
        const language = this._validate_voice(voice);
        const phonemes = await phonemize(text, language);
        const { input_ids } = this.tokenizer(phonemes, {
            truncation: true,
        });
        return this.generate_from_ids(input_ids, { voice, speed });
    }

    /**
     * Generate audio from input ids.
     */
    async generate_from_ids(input_ids: Tensor, options: GenerateOptions = {}): Promise<RawAudio> {
        const { voice = "af_heart", speed = 1 } = options;
        // Select voice style based on number of input tokens
        const num_tokens = Math.min(Math.max((input_ids.dims.at(-1) ?? 0) - 2, 0), 509);
        // Load voice style
        const data = await getVoiceData(voice);
        const offset = num_tokens * STYLE_DIM;
        const voiceData = data.slice(offset, offset + STYLE_DIM);
        // Prepare model inputs
        const inputs = {
            input_ids,
            style: new Tensor("float32", voiceData, [1, STYLE_DIM]),
            speed: new Tensor("float32", [speed], [1]),
        };
        // Generate audio
        const { waveform } = await this.model(inputs);
        return new RawAudio(waveform.data, SAMPLE_RATE);
    }

    /**
     * Generate audio from text in a streaming fashion.
     */
    async *stream(
        text: string | TextSplitterStream,
        options: StreamGenerateOptions = {}
    ): AsyncGenerator<{ text: string; phonemes: string; audio: RawAudio }, void, void> {
        const { voice = "af_heart", speed = 1, split_pattern = null } = options;
        const language = this._validate_voice(voice);
        let splitter: TextSplitterStream;
        if (text instanceof TextSplitterStream) {
            splitter = text;
        } else if (typeof text === "string") {
            splitter = new TextSplitterStream();
            const chunks = split_pattern
                ? text
                    .split(split_pattern)
                    .map((chunk) => chunk.trim())
                    .filter((chunk) => chunk.length > 0)
                : [text];
            splitter.push(...chunks);
        } else {
            throw new Error("Invalid input type. Expected string or TextSplitterStream.");
        }
        for await (const sentence of splitter) {
            const phonemes = await phonemize(sentence, language);
            const { input_ids } = this.tokenizer(phonemes, {
                truncation: true,
            });
            // TODO: There may be some cases where - even with splitting - the text is too long.
            // In that case, we should split the text into smaller chunks and process them separately.
            // For now, we just truncate these exceptionally long chunks
            const audio = await this.generate_from_ids(input_ids, { voice, speed });
            yield { text: sentence, phonemes, audio };
        }
    }
}

export const env = {
    set cacheDir(value: string) {
        hf.cacheDir = value;
    },
    get cacheDir(): string {
        return hf.cacheDir;
    },
    set wasmPaths(value: string) {
        hf.backends.onnx.wasm.wasmPaths = value;
    },
    get wasmPaths(): unknown {
        return hf.backends.onnx.wasm.wasmPaths;
    },
};

export { TextSplitterStream };