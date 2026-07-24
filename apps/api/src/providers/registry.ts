import { AIProvider, ModelInfo } from '@ai-chat/shared';
import { config } from '@ai-chat/config';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatProvider } from './openai.js';

export interface RegisteredProvider {
  id: string;
  name: string;
  type: 'openai' | 'ollama' | 'custom';
  baseUrl: string;
  impl: AIProvider;
}

const providers = new Map<string, RegisteredProvider>();

function register(p: RegisteredProvider) {
  providers.set(p.id, p);
}

// Always-on: Ollama
register({
  id: 'ollama',
  name: 'Ollama (local)',
  type: 'ollama',
  baseUrl: config.ollamaBaseUrl,
  impl: new OllamaProvider(config.ollamaBaseUrl),
});

// OpenAI
if (process.env.OPENAI_API_KEY) {
  register({
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    impl: new OpenAICompatProvider('openai', 'OpenAI', process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1', process.env.OPENAI_API_KEY),
  });
}

// OpenRouter
if (process.env.OPENROUTER_API_KEY) {
  register({
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    impl: new OpenAICompatProvider('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', process.env.OPENROUTER_API_KEY),
  });
}

// Groq
if (process.env.GROQ_API_KEY) {
  register({
    id: 'groq',
    name: 'GroqCloud',
    type: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    impl: new OpenAICompatProvider('groq', 'GroqCloud', 'https://api.groq.com/openai/v1', process.env.GROQ_API_KEY),
  });
}

// Mistral
if (process.env.MISTRAL_API_KEY) {
  register({
    id: 'mistral',
    name: 'Mistral',
    type: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    impl: new OpenAICompatProvider('mistral', 'Mistral', 'https://api.mistral.ai/v1', process.env.MISTRAL_API_KEY),
  });
}

// LM Studio (local, no key)
if (process.env.LMSTUDIO_BASE_URL) {
  register({
    id: 'lmstudio',
    name: 'LM Studio (local)',
    type: 'custom',
    baseUrl: process.env.LMSTUDIO_BASE_URL,
    impl: new OpenAICompatProvider('lmstudio', 'LM Studio (local)', process.env.LMSTUDIO_BASE_URL, process.env.LMSTUDIO_API_KEY),
  });
}

// vLLM (local, no key)
if (process.env.VLLM_BASE_URL) {
  register({
    id: 'vllm',
    name: 'vLLM (local)',
    type: 'custom',
    baseUrl: process.env.VLLM_BASE_URL,
    impl: new OpenAICompatProvider('vllm', 'vLLM (local)', process.env.VLLM_BASE_URL, process.env.VLLM_API_KEY),
  });
}

// Generic custom endpoint
if (process.env.CUSTOM_OPENAI_BASE_URL) {
  register({
    id: process.env.CUSTOM_OPENAI_ID || 'custom',
    name: process.env.CUSTOM_OPENAI_NAME || 'Custom endpoint',
    type: 'custom',
    baseUrl: process.env.CUSTOM_OPENAI_BASE_URL,
    impl: new OpenAICompatProvider(
      process.env.CUSTOM_OPENAI_ID || 'custom',
      process.env.CUSTOM_OPENAI_NAME || 'Custom endpoint',
      process.env.CUSTOM_OPENAI_BASE_URL,
      process.env.CUSTOM_OPENAI_API_KEY,
    ),
  });
}

export function listProviders(): RegisteredProvider[] {
  return [...providers.values()];
}

export function getProvider(id: string): RegisteredProvider | undefined {
  return providers.get(id);
}

/** Resolve "provider:model" or bare model id (defaults to ollama). */
export function resolveProvider(modelId: string): { provider: RegisteredProvider; model: string } {
  const [provId, rest] = modelId.split(':');
  if (rest && providers.has(provId)) {
    return { provider: providers.get(provId)!, model: rest };
  }
  // bare model id → search providers by model id, prefer ollama
  const ollama = providers.get('ollama');
  if (ollama) return { provider: ollama, model: modelId };
  const first = listProviders()[0];
  return { provider: first, model: modelId };
}

// Per-model config overrides (in-memory for now; persisted to DB in Phase B)
const modelConfigs = new Map<string, ModelInfo['config']>();

export function getModelConfig(providerId: string, modelId: string): ModelInfo['config'] | undefined {
  return modelConfigs.get(`${providerId}:${modelId}`);
}

export function setModelConfig(providerId: string, modelId: string, cfg: ModelInfo['config']): void {
  modelConfigs.set(`${providerId}:${modelId}`, cfg);
}