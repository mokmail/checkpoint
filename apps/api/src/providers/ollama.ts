import { config } from '@ai-chat/config';
import {
  AIProvider,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelInfo,
} from '@ai-chat/shared';

export class OllamaProvider implements AIProvider {
  constructor(private baseUrl: string = config.ollamaBaseUrl) {}

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) {
      throw new Error(`Ollama listModels failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      models: Array<{
        name: string;
        model: string;
        size?: number;
        details?: {
          context_length?: number;
          family?: string;
          parameter_size?: string;
          quantization_level?: string;
        };
        capabilities?: string[];
      }>;
    };
    return data.models.map((m) => ({
      id: m.model,
      name: m.name,
      provider: 'ollama',
      contextWindow: m.details?.context_length,
      capabilities: m.capabilities ?? ['completion'],
      size: m.size,
    }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: false,
        options: {
          ...(request.temperature !== undefined && { temperature: request.temperature }),
          ...(request.maxTokens !== undefined && { num_predict: request.maxTokens }),
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama chat failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      model: string;
      message: { role: string; content: string };
      done: boolean;
      eval_count?: number;
    };
    return {
      model: data.model,
      content: data.message.content,
      role: data.message.role as ChatResponse['role'],
      tokens: data.eval_count,
      done: data.done,
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        options: {
          ...(request.temperature !== undefined && { temperature: request.temperature }),
          ...(request.maxTokens !== undefined && { num_predict: request.maxTokens }),
        },
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama chatStream failed: ${res.status} ${res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as {
              message?: { content: string; thinking?: string };
              done: boolean;
            };
            if (chunk.message?.thinking) yield chunk.message.thinking;
            if (chunk.message?.content) yield chunk.message.content;
            if (chunk.done) return;
          } catch {
            // skip malformed line
          }
        }
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        input: request.input,
      }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embed failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { model: string; embeddings: number[][] };
    return { model: data.model, embeddings: data.embeddings };
  }
}

export const ollama = new OllamaProvider();