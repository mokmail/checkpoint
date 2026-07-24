import { FastifyInstance } from 'fastify';
import { listProviders, resolveProvider, getModelConfig, setModelConfig } from '../providers/registry.js';

export async function modelsRoutes(fastify: FastifyInstance) {
  // GET /api/models — list all available models across providers
  fastify.get('/models', async (_req, _reply) => {
    const providers = listProviders();
    const all = await Promise.all(
      providers.map(async (p) => {
        try {
          const models = await p.impl.listModels();
          return models.map((m) => ({
            ...m,
            config: getModelConfig(p.id, m.id),
          }));
        } catch (err) {
          fastify.log.warn({ provider: p.id, err: String(err) }, 'Failed to list models for provider');
          return [];
        }
      }),
    );
    const models = all.flat();
    return { models, providers: providers.map((p) => ({ id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl })) };
  });

  // GET /api/models/:id — get model details
  fastify.get('/models/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { provider, model } = resolveProvider(id);
    try {
      const models = await provider.impl.listModels();
      const found = models.find((m) => m.id === model);
      if (!found) return reply.status(404).send({ error: 'Model not found' });
      return { model: { ...found, config: getModelConfig(provider.id, found.id) } };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(502).send({ error: `Failed to get model from ${provider.name}` });
    }
  });

  // POST /api/models/test — test model connection
  fastify.post('/models/test', async (req, reply) => {
    const { model } = req.body as { model?: string };
    if (!model) return reply.status(400).send({ error: 'model is required' });
    const { provider, model: modelName } = resolveProvider(model);
    try {
      const res = await provider.impl.chat({
        model: modelName,
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
      });
      return { ok: true, provider: provider.id, model: res.model };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(502).send({ error: `Model test failed on ${provider.name}` });
    }
  });

  // PUT /api/models/:id/config — update per-model settings
  fastify.put('/models/:id/config', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { config?: Record<string, unknown> } | null;
    if (!body?.config) return reply.status(400).send({ error: 'config is required' });
    const { provider, model } = resolveProvider(id);
    setModelConfig(provider.id, model, body.config);
    return { ok: true, provider: provider.id, model, config: body.config };
  });

  // GET /api/providers — list configured providers
  fastify.get('/providers', async () => {
    return { providers: listProviders().map((p) => ({ id: p.id, name: p.name, type: p.type, baseUrl: p.baseUrl })) };
  });
}