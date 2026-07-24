import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import {
  loadAllPlugins,
  setPluginEnabled,
  setPluginConfig,
  listLoadedPlugins,
  hookBus,
} from '../plugins/loader.js';
import { validateManifest } from '../plugins/types.js';

const installSchema = z.object({
  manifest: z.record(z.unknown()),
  source: z.enum(['local', 'npm']).default('local'),
  filePath: z.string().optional(),
});

export async function pluginsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.auth.require);

  // GET /api/plugins — list all plugins (DB + loaded)
  fastify.get('/plugins', async (_req) => {
    const dbPlugins = await prisma.plugin.findMany({ orderBy: { name: 'asc' } });
    const loaded = listLoadedPlugins();
    const loadedMap = new Map(loaded.map((p) => [p.id, p]));
    return {
      plugins: dbPlugins.map((p) => ({
        ...p,
        active: loadedMap.has(p.name) && loadedMap.get(p.name)!.enabled,
      })),
    };
  });

  // POST /api/plugins — install a plugin from a manifest
  fastify.post('/plugins', async (req, reply) => {
    const parsed = installSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { manifest: rawManifest, source, filePath } = parsed.data;
    let manifest;
    try {
      manifest = validateManifest(rawManifest);
    } catch (err) {
      return reply.status(400).send({ error: 'Invalid manifest', details: err instanceof Error ? err.message : err });
    }
    const uid = req.user.id;
    const existing = await prisma.plugin.findUnique({ where: { name: manifest.name } });
    if (existing) {
      return reply.status(409).send({ error: 'Plugin already installed' });
    }
    const plugin = await prisma.plugin.create({
      data: {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        type: manifest.type,
        enabled: true,
        config: (manifest.config ?? {}) as import('@prisma/client').Prisma.InputJsonValue,
        hooks: manifest.hooks,
        permissions: manifest.permissions,
        source,
        filePath: filePath ?? null,
        userId: uid,
      },
    });
    // reload all plugins to pick up the new one if it's on disk
    await loadAllPlugins();
    return reply.status(201).send({ plugin });
  });

  // DELETE /api/plugins/:id — uninstall
  fastify.delete('/plugins/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.plugin.findUnique({ where: { name: id } });
    if (!existing) return reply.status(404).send({ error: 'Plugin not found' });
    await prisma.plugin.delete({ where: { name: id } });
    // reload to remove from the bus
    await loadAllPlugins();
    return reply.status(204).send();
  });

  // PUT /api/plugins/:id/config — update plugin config
  fastify.put('/plugins/:id/config', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { config } = (req.body as { config?: Record<string, unknown> }) ?? {};
    if (!config) return reply.status(400).send({ error: 'config is required' });
    const existing = await prisma.plugin.findUnique({ where: { name: id } });
    if (!existing) return reply.status(404).send({ error: 'Plugin not found' });
    await setPluginConfig(id, config);
    return { ok: true, name: id, config };
  });

  // POST /api/plugins/:id/enable
  fastify.post('/plugins/:id/enable', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.plugin.findUnique({ where: { name: id } });
    if (!existing) return reply.status(404).send({ error: 'Plugin not found' });
    await setPluginEnabled(id, true);
    return { ok: true, name: id, enabled: true };
  });

  // POST /api/plugins/:id/disable
  fastify.post('/plugins/:id/disable', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.plugin.findUnique({ where: { name: id } });
    if (!existing) return reply.status(404).send({ error: 'Plugin not found' });
    await setPluginEnabled(id, false);
    return { ok: true, name: id, enabled: false };
  });

  // GET /api/plugins/hooks — list all available hook names
  fastify.get('/plugins/hooks', async () => {
    return {
      hooks: ['pre_chat', 'post_chat', 'filter_message', 'on_conversation_create', 'on_message_sent', 'on_message_received', 'tool_call', 'skill_invoke'],
    };
  });

  // POST /api/plugins/test-hook — invoke a hook for testing
  fastify.post('/plugins/test-hook', async (req, reply) => {
    const { hook, ctx } = (req.body as { hook?: string; ctx?: unknown }) ?? {};
    if (!hook) return reply.status(400).send({ error: 'hook is required' });
    const result = await hookBus.runHook(hook as 'pre_chat', ((ctx ?? {}) as Record<string, unknown>) as never);
    return { result };
  });
}