import { FastifyInstance } from 'fastify';
import { config } from '@ai-chat/config';
import { resolveProvider } from '../providers/registry.js';

interface ChatBody {
  model?: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export async function chatRoutes(fastify: FastifyInstance) {
  fastify.post('/chat', async (req, reply) => {
    const body = req.body as ChatBody;
    if (!body?.messages?.length) {
      return reply.status(400).send({ error: 'messages are required' });
    }
    const modelId = body.model ?? config.ollamaChatModel;
    const { provider, model } = resolveProvider(modelId);

    if (body.stream) {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();

      try {
        for await (const chunk of provider.impl.chatStream({
          model,
          messages: body.messages,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          stream: true,
        })) {
          reply.raw.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        }
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      } catch (err) {
        fastify.log.error(err);
        reply.raw.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
        reply.raw.end();
      }
      return reply;
    }

    try {
      const res = await provider.impl.chat({
        model,
        messages: body.messages,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      });
      return { response: res };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(502).send({ error: `${provider.name} chat failed` });
    }
  });

  fastify.post('/chat/embeddings', async (req, reply) => {
    const { input, model } = req.body as { input?: string; model?: string };
    if (!input) return reply.status(400).send({ error: 'input is required' });
    const { provider, model: modelName } = resolveProvider(model ?? config.ollamaEmbeddingModel);
    try {
      const res = await provider.impl.embed({
        model: modelName,
        input,
      });
      return { embedding: res.embeddings[0], model: res.model };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(502).send({ error: `${provider.name} embeddings failed` });
    }
  });
}