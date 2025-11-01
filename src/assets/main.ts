/**
 * Offscreen Document - AI Service Provider
 * This document runs in the background with DOM access and provides AI capabilities
 * to the content script via Comctx RPC
 */
// @ts-ignore
import { provideAIService, type AIService } from '../utils/comctx/aiService';
// @ts-ignore
import OffscreenAdapter from '../utils/comctx/OffscreenAdapter';
import { LanguageModelEx } from '../utils/built-in-ai-ex/LanguageModelEx';
import { SummarizerEx } from '../utils/built-in-ai-ex/SummarizerEx';
import { WriterEx } from '../utils/built-in-ai-ex/WriterEx';
import { RewriterEx } from '../utils/built-in-ai-ex/RewriterEx';
import { TranslatorEx } from '../utils/built-in-ai-ex/TranslatorEx';

console.log('[Offscreen] AI Service Provider starting...');

// Store active language models by ID
const activeModels = new Map<string, LanguageModelEx>();
let modelIdCounter = 0;

// Implement the AI Service
const aiService: AIService = {
  async createLanguageModel(options = {}) {
    try {
      const model = await LanguageModelEx.create(options);
      const id = `model_${++modelIdCounter}`;
      activeModels.set(id, model);
      
      const systemMessage = model.history.getSystemPrompt();
      const systemPrompt = typeof systemMessage.content === 'string' ? systemMessage.content : '';
      
      console.log('[Offscreen] Created language model:', id);
      return { id, systemPrompt };
    } catch (error) {
      console.error('[Offscreen] Failed to create language model:', error);
      throw error;
    }
  },

  async promptLanguageModel(modelId, prompt) {
    const model = activeModels.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    try {
      const response = await model.prompt(prompt);
      return response;
    } catch (error) {
      console.error('[Offscreen] Failed to prompt model:', error);
      throw error;
    }
  },

  async promptStreamingLanguageModel(modelId, prompt) {
    const model = activeModels.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    try {
      const stream = await model.promptStreaming(prompt);
      return stream;
    } catch (error) {
      console.error('[Offscreen] Failed to prompt streaming model:', error);
      throw error;
    }
  },

  async destroyLanguageModel(modelId) {
    const model = activeModels.get(modelId);
    if (model) {
      model.destroy();
      activeModels.delete(modelId);
      console.log('[Offscreen] Destroyed language model:', modelId);
    }
  },

  async summarizeText(text, options = {}) {
    try {
      // Map option types to correct formats
      const summarizerOptions: any = { ...options };
      // @ts-ignore
      if (options.type === 'tldr') {
        summarizerOptions.type = 'tldr';
      }
      
      const summarizer = await SummarizerEx.create(summarizerOptions);
      const summary = await summarizer.summarize(text);
      summarizer.destroy();
      return summary;
    } catch (error) {
      console.error('[Offscreen] Failed to summarize text:', error);
      throw error;
    }
  },

  async writeText(prompt, options = {}) {
    try {
      const writer = await WriterEx.create(options);
      const text = await writer.write(prompt);
      writer.destroy();
      return text;
    } catch (error) {
      console.error('[Offscreen] Failed to write text:', error);
      throw error;
    }
  },

  async rewriteText(text, options = {}) {
    try {
      const rewriter = await RewriterEx.create(options);
      const rewritten = await rewriter.rewrite(text);
      rewriter.destroy();
      return rewritten;
    } catch (error) {
      console.error('[Offscreen] Failed to rewrite text:', error);
      throw error;
    }
  },

  async translateText(text, targetLanguage, sourceLanguage) {
    try {
      const translator = await TranslatorEx.create({
        sourceLanguage: sourceLanguage || 'auto',
        targetLanguage,
      });
      const translated = await translator.translate(text);
      translator.destroy();
      return translated;
    } catch (error) {
      console.error('[Offscreen] Failed to translate text:', error);
      throw error;
    }
  },

  async detectLanguage(text) {
    try {
      const detector = await (self as any).translation.createDetector();
      const results = await detector.detect(text);
      const topResult = results[0];
      return topResult?.detectedLanguage || 'en';
    } catch (error) {
      console.error('[Offscreen] Failed to detect language:', error);
      return 'en'; // Default fallback
    }
  },

  async explainImage(imageData) {
    try {
      const model = await LanguageModelEx.create({
        temperature: 0.7,
        expectedInputs: [
          { type: 'text', languages: ['en'] },
          { type: 'image' },
        ],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });

      const explanation = await model.prompt([
        {
          role: 'user',
          content: 'Please describe what you see in this image in detail. Image data: ' + (typeof imageData === 'string' ? imageData.substring(0, 100) : '[Binary data]'),
        },
      ] as any);

      model.destroy();
      return explanation;
    } catch (error) {
      console.error('[Offscreen] Failed to explain image:', error);
      throw error;
    }
  },

  async explainText(text, context) {
    try {
      const model = await LanguageModelEx.create({
        temperature: 0.7,
      });

      const prompt = context
        ? `Context: ${context}\n\nPlease explain the following text:\n${text}`
        : `Please explain the following text:\n${text}`;

      const explanation = await model.prompt(prompt);
      model.destroy();
      return explanation;
    } catch (error) {
      console.error('[Offscreen] Failed to explain text:', error);
      throw error;
    }
  },
};

// Provide the AI service through Comctx
// The provideAIService function is created by defineProxy and expects (adapter, service)
const adapter = new OffscreenAdapter();
const providedService = provideAIService(adapter);

// Assign our AI service implementation to the provided service
Object.assign(providedService, aiService);

console.log('[Offscreen] AI Service Provider ready and listening');

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  console.log('[Offscreen] Cleaning up active models...');
  activeModels.forEach((model) => model.destroy());
  activeModels.clear();
});
