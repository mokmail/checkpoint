export const version = '0.1.0';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  conversationId?: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  model?: string;
  tokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  model: string;
  content: string;
  role: MessageRole;
  tokens?: number;
  done: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  capabilities: string[];
  size?: number;
  pricing?: PricingInfo;
  config?: ModelConfig;
}

export interface PricingInfo {
  inputPer1k?: number;
  outputPer1k?: number;
  currency?: string;
}

export interface ModelConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  // arbitrary provider-specific overrides
  [key: string]: unknown;
}

export interface ModelProvider {
  id: string;
  name: string;
  type: 'openai' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl: string;
  models: ModelInfo[];
}

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
}

export interface EmbeddingResponse {
  model: string;
  embeddings: number[][];
}

export interface AIProvider {
  listModels(): Promise<ModelInfo[]>;
  chat(request: ChatRequest): Promise<ChatResponse>;
  chatStream(request: ChatRequest): AsyncIterable<string>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}