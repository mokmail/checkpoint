import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { resolveProvider } from '../providers/registry.js';
import { config } from '@ai-chat/config';
import { renderTemplate, validateVariables, type AgentVariable } from '../template.js';
import { hookBus } from '../plugins/loader.js';
import { communityPresets } from '../presets.js';

const agentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  systemPrompt: z.string().min(1),
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  knowledgeBases: z.array(z.string()).optional(),
  variables: z.array(z.any()).optional(),
  accessType: z.enum(['public', 'private', 'group']).optional(),
  accessGroups: z.array(z.string()).optional(),
  accessUsers: z.array(z.string()).optional(),
});

export async function agentsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.auth.require);

  // GET /api/agents/presets — list community agent presets
  fastify.get('/agents/presets', async (req) => {
    const category = (req.query as { category?: string })?.category;
    const list = category ? communityPresets.filter((p) => p.category === category) : communityPresets;
    return { presets: list };
  });

  // POST /api/agents/presets/:presetId/install — install a community preset
  fastify.post('/agents/presets/:presetId/install', async (req, reply) => {
    const { presetId } = req.params as { presetId: string };
    const preset = communityPresets.find((p) => p.id === presetId);
    if (!preset) return reply.status(404).send({ error: 'Preset not found' });
    const uid = req.user.id;
    const agent = await prisma.agent.create({
      data: {
        userId: uid,
        name: preset.name,
        description: preset.description,
        systemPrompt: preset.systemPrompt,
        model: preset.model || null,
        tools: preset.tools,
        knowledgeBases: [],
        variables: preset.variables as unknown as import('@prisma/client').Prisma.InputJsonValue,
        accessType: 'private',
      },
    });
    return reply.status(201).send({ agent });
  });

  // GET /api/agents
  fastify.get('/agents', async (req) => {
    const uid = req.user.id;
    // own agents + public agents from others
    const agents = await prisma.agent.findMany({
      where: { OR: [{ userId: uid }, { accessType: 'public' }] },
      orderBy: { updatedAt: 'desc' },
    });
    return { agents };
  });

  // POST /api/agents
  fastify.post('/agents', async (req, reply) => {
    const parsed = agentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const uid = req.user.id;
    const a = parsed.data;
    const agent = await prisma.agent.create({
      data: {
        userId: uid,
        name: a.name,
        description: a.description,
        systemPrompt: a.systemPrompt,
        model: a.model,
        tools: a.tools ?? [],
        knowledgeBases: a.knowledgeBases ?? [],
        variables: a.variables ?? [],
        accessType: a.accessType ?? 'private',
        accessGroups: a.accessGroups ?? [],
        accessUsers: a.accessUsers ?? [],
      },
    });
    return reply.status(201).send({ agent });
  });

  // GET /api/agents/:id
  fastify.get('/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const agent = await prisma.agent.findFirst({
      where: { OR: [{ id, userId: uid }, { id, accessType: 'public' }] },
    });
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return { agent };
  });

  // PUT /api/agents/:id
  fastify.put('/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = agentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const uid = req.user.id;
    const existing = await prisma.agent.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Agent not found' });
    const a = parsed.data;
    const agent = await prisma.agent.update({
      where: { id },
      data: {
        ...(a.name !== undefined && { name: a.name }),
        ...(a.description !== undefined && { description: a.description }),
        ...(a.systemPrompt !== undefined && { systemPrompt: a.systemPrompt }),
        ...(a.model !== undefined && { model: a.model }),
        ...(a.tools !== undefined && { tools: a.tools }),
        ...(a.knowledgeBases !== undefined && { knowledgeBases: a.knowledgeBases }),
        ...(a.variables !== undefined && { variables: a.variables }),
        ...(a.accessType !== undefined && { accessType: a.accessType }),
        ...(a.accessGroups !== undefined && { accessGroups: a.accessGroups }),
        ...(a.accessUsers !== undefined && { accessUsers: a.accessUsers }),
      },
    });
    return { agent };
  });

  // DELETE /api/agents/:id
  fastify.delete('/agents/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const existing = await prisma.agent.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Agent not found' });
    await prisma.agent.delete({ where: { id } });
    return reply.status(204).send();
  });

  // POST /api/agents/:id/chat — chat with an agent (streaming)
  // Renders the agent's system prompt template, injects KB context, runs tools, streams response.
  fastify.post('/agents/:id/chat', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const body = (req.body as {
      message: string;
      variables?: Record<string, unknown>;
      stream?: boolean;
      temperature?: number;
      maxTokens?: number;
    }) ?? { message: '' };

    if (!body.message?.trim()) {
      return reply.status(400).send({ error: 'message is required' });
    }

    const agent = await prisma.agent.findFirst({
      where: { OR: [{ id, userId: uid }, { id, accessType: 'public' }] },
    });
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });

    // validate + render template variables
    const variables = (agent.variables as AgentVariable[] | null) ?? [];
    if (body.variables) {
      const { valid, errors } = validateVariables(body.variables, variables);
      if (!valid) return reply.status(400).send({ error: 'Invalid variables', details: errors });
    }
    const systemPrompt = renderTemplate(agent.systemPrompt, body.variables ?? {}, variables);

    // build messages
    const messages: { role: 'system' | 'user'; content: string }[] = [
      { role: 'system', content: systemPrompt },
    ];

    // inject knowledge-base context via the RAG service
    if (agent.knowledgeBases.length > 0) {
      try {
        const kbContext = await fetchKbContext(agent.knowledgeBases, body.message);
        if (kbContext) {
          messages.push({ role: 'system', content: `Relevant knowledge base context:\n\n${kbContext}` });
        }
      } catch (err) {
        fastify.log.warn({ err: String(err) }, 'Agent KB context fetch failed');
      }
    }

    // run pre_chat plugin hooks
    const hookResult = await hookBus.runHook('pre_chat', {
      userId: uid,
      model: agent.model || config.ollamaChatModel,
      messages,
    });
    const finalMessages = (hookResult.messages ?? messages) as { role: 'user' | 'assistant' | 'system'; content: string }[];
    finalMessages.push({ role: 'user', content: body.message });

    // execute agent tools (tool_call hook) — collect any tool results to inject
    if (agent.tools.length > 0) {
      for (const tool of agent.tools) {
        try {
          const toolResults = await hookBus.runHookCollect('tool_call', body.message, tool);
          const matched = toolResults.find((r) => r.result.content);
          if (matched?.result.content) {
            finalMessages.push({ role: 'system', content: `Tool "${tool}" result: ${matched.result.content}` });
          }
        } catch {
          // tool failures are non-fatal
        }
      }
    }

    const useModel = agent.model || config.ollamaChatModel;
    const { provider, model } = resolveProvider(useModel);

    if (body.stream) {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();

      try {
        for await (const chunk of provider.impl.chatStream({
          model,
          messages: finalMessages,
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          stream: true,
        })) {
          reply.raw.write(`data: ${JSON.stringify({ content: chunk, agentId: id })}\n\n`);
        }
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      } catch (err) {
        fastify.log.error(err);
        reply.raw.write(`data: ${JSON.stringify({ error: 'Agent chat stream failed' })}\n\n`);
        reply.raw.end();
      }
      return reply;
    }

    try {
      const res = await provider.impl.chat({
        model,
        messages: finalMessages,
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      });
      return { agentId: id, content: res.content, model: res.model, tokens: res.tokens };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(502).send({ error: `${provider.name} agent chat failed` });
    }
  });

  // GET /api/agents/:id/export
  fastify.get('/agents/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const agent = await prisma.agent.findFirst({
      where: { OR: [{ id, userId: uid }, { id, accessType: 'public' }] },
    });
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${agent.name.replace(/[^a-z0-9]+/gi, '-')}.agent.json"`);
    return agent;
  });

  // POST /api/agents/import
  fastify.post('/agents/import', async (req, reply) => {
    const parsed = agentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid agent definition', details: parsed.error.flatten() });
    }
    const uid = req.user.id;
    const a = parsed.data;
    const agent = await prisma.agent.create({
      data: {
        userId: uid,
        name: a.name,
        description: a.description,
        systemPrompt: a.systemPrompt,
        model: a.model,
        tools: a.tools ?? [],
        knowledgeBases: a.knowledgeBases ?? [],
        variables: a.variables ?? [],
        accessType: 'private',
      },
    });
    return reply.status(201).send({ agent });
  });
}

// Fetch context from the agent's attached knowledge bases via the RAG service.
async function fetchKbContext(kbIds: string[], query: string): Promise<string> {
  const ragUrl = process.env.RAG_URL || 'http://localhost:3002';
  const parts: string[] = [];
  for (const kbId of kbIds) {
    try {
      const res = await fetch(`${ragUrl}/knowledge-bases/${kbId}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK: 3 }),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: Array<{ content: string; score: number }> };
      for (const r of data.results ?? []) {
        parts.push(r.content);
      }
    } catch {
      // KB unavailable — skip
    }
  }
  return parts.join('\n\n---\n\n');
}