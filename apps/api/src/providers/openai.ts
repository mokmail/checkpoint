import {
  AIProvider,
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelInfo,
} from '@ai-chat/shared';

interface OpenAIModel {
  id: string;
  owned_by?: string;
  context_window?: number;
  object?: string;
}

/**
 * OpenAI-compatible REST client. Covers OpenAI, OpenRouter, Groq, Mistral,
 * vLLM, LM Studio and any custom OpenAI-compatible endpoint via baseUrl.
 */
export class OpenAICompatProvider implements AIProvider {
  constructor(
    public readonly id: string,
    public readonly name: string,
    private baseUrl: string,
    private apiKey?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`${this.name} listModels failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { data?: OpenAIModel[] } | OpenAIModel[];
    const list = Array.isArray(data) ? data : data.data ?? [];
    return list.map((m) => ({
      id: m.id,
      name: m.id,
      provider: this.id,
      contextWindow: m.context_window,
      capabilities: ['completion'],
    }));
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: false,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      }),
    });
    if (!res.ok) {
      throw new Error(`${this.name} chat failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      model: string;
      choices: Array<{ message: { role: string; content: string } }>;
      usage?: { completion_tokens?: number };
    };
    const choice = data.choices?.[0];
    return {
      model: data.model,
      content: choice?.message?.content ?? '',
      role: (choice?.message?.role as ChatResponse['role']) ?? 'assistant',
      tokens: data.usage?.completion_tokens,
      done: true,
    };
  }

  async *chatStream(request: ChatRequest): AsyncIterable<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: true,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`${this.name} chatStream failed: ${res.status} ${res.statusText}`);
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
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // skip malformed
        }
      }
    }
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: request.model, input: request.input }),
    });
    if (!res.ok) {
      throw new Error(`${this.name} embed failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { model: string; data: Array<{ embedding: number[] }> };
    return { model: data.model, embeddings: data.data.map((d) => d.embedding) };
  }
}