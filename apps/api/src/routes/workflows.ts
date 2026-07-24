import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const workflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: z.record(z.unknown()).optional(),
  steps: z.array(z.record(z.unknown())).optional(),
  enabled: z.boolean().optional(),
});

export async function workflowsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.auth.require);

  // GET /api/workflows
  fastify.get('/workflows', async (req) => {
    const uid = req.user.id;
    const workflows = await prisma.workflow.findMany({
      where: { userId: uid },
      orderBy: { updatedAt: 'desc' },
    });
    return { workflows };
  });

  // POST /api/workflows
  fastify.post('/workflows', async (req, reply) => {
    const parsed = workflowSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    const uid = req.user.id;
    const { name, description, trigger, steps, enabled } = parsed.data;
    const workflow = await prisma.workflow.create({
      data: {
        userId: uid,
        name,
        description,
        trigger: (trigger ?? { type: 'manual' }) as import('@prisma/client').Prisma.InputJsonValue,
        steps: (steps ?? []) as import('@prisma/client').Prisma.InputJsonValue,
        enabled: enabled ?? true,
      },
    });
    // If trigger is a schedule, register a cron job (handled by the worker)
    return reply.status(201).send({ workflow });
  });

  // GET /api/workflows/:id
  fastify.get('/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const workflow = await prisma.workflow.findFirst({ where: { id, userId: uid } });
    if (!workflow) return reply.status(404).send({ error: 'Workflow not found' });
    return { workflow };
  });

  // PUT /api/workflows/:id
  fastify.put('/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const parsed = workflowSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    const existing = await prisma.workflow.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Workflow not found' });
    const data = parsed.data;
    const workflow = await prisma.workflow.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.trigger !== undefined && { trigger: data.trigger as import('@prisma/client').Prisma.InputJsonValue }),
        ...(data.steps !== undefined && { steps: data.steps as import('@prisma/client').Prisma.InputJsonValue }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
      },
    });
    return { workflow };
  });

  // DELETE /api/workflows/:id
  fastify.delete('/workflows/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const existing = await prisma.workflow.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Workflow not found' });
    await prisma.workflow.delete({ where: { id } });
    return reply.status(204).send();
  });

  // POST /api/workflows/:id/execute — manually execute a workflow
  fastify.post('/workflows/:id/execute', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const workflow = await prisma.workflow.findFirst({ where: { id, userId: uid } });
    if (!workflow) return reply.status(404).send({ error: 'Workflow not found' });

    const steps = (workflow.steps as Array<Record<string, unknown>>) ?? [];
    const results: Record<string, unknown>[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const type = step.type as string;

      if (type === 'prompt') {
        // execute a prompt step via the model
        try {
          const { resolveProvider } = await import('../providers/registry.js');
          const { config } = await import('@ai-chat/config');
          const { provider, model } = resolveProvider((step.model as string) || config.ollamaChatModel);
          const promptText = (step.config as { prompt?: string })?.prompt ?? '';
          const res = await provider.impl.chat({
            model,
            messages: [{ role: 'user', content: promptText }],
          });
          results.push({ step: i, type, content: res.content });
        } catch (err) {
          results.push({ step: i, type, error: String(err) });
        }
      } else if (type === 'condition') {
        const condition = (step.config as { if?: string })?.if;
        results.push({ step: i, type, condition, evaluated: !!condition });
        // simple: if condition is falsy, stop
        if (!condition) break;
      } else {
        results.push({ step: i, type, note: 'Step type not supported in manual execution' });
      }
    }

    return { executed: true, results };
  });

  // POST /api/workflows/:id/enable
  fastify.post('/workflows/:id/enable', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const existing = await prisma.workflow.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Workflow not found' });
    await prisma.workflow.update({ where: { id }, data: { enabled: true } });
    return { ok: true, enabled: true };
  });

  // POST /api/workflows/:id/disable
  fastify.post('/workflows/:id/disable', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const existing = await prisma.workflow.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Workflow not found' });
    await prisma.workflow.update({ where: { id }, data: { enabled: false } });
    return { ok: true, enabled: false };
  });
}