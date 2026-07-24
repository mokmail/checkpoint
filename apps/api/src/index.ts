import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config } from '@ai-chat/config';
import { ChatMessage } from '@ai-chat/shared';
import { prisma } from './db.js';
import { pingRedis } from './redis.js';
import { modelsRoutes } from './routes/models.js';
import { chatRoutes } from './routes/chat.js';
import { conversationsRoutes } from './routes/conversations.js';
import { memoriesRoutes } from './routes/memories.js';
import { agentsRoutes } from './routes/agents.js';
import { pluginsRoutes } from './routes/plugins.js';
import { channelsRoutes } from './routes/channels.js';
import { notesRoutes } from './routes/notes.js';
import { workflowsRoutes } from './routes/workflows.js';
import { calendarRoutes } from './routes/calendar.js';
import { authRoutes } from './routes/auth.js';
import { authPlugin } from './auth.js';
import { loadAllPlugins } from './plugins/loader.js';

const fastify = Fastify({
  logger: true,
});

fastify.get('/', async () => ({ message: 'AI Chat API', provider: 'ollama' }));

fastify.get('/health', async () => {
  let db = 'unknown';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'ok';
  } catch {
    db = 'unavailable';
  }
  const redisOk = await pingRedis();
  return {
    status: db === 'ok' && redisOk ? 'ok' : 'degraded',
    ollama: config.ollamaBaseUrl,
    model: config.ollamaChatModel,
    database: db,
    redis: redisOk ? 'ok' : 'unavailable',
  };
});

export type ChatMessageTyped = ChatMessage;

const start = async () => {
  try {
    await fastify.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    });

    await fastify.register(rateLimit, {
      global: true,
      max: Number(process.env.RATE_LIMIT_MAX ?? 120),
      timeWindow: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
      keyGenerator: (req) => {
        const xf = req.headers['x-forwarded-for'];
        return (Array.isArray(xf) ? xf[0] : xf) || req.ip;
      },
    });

    await fastify.register(websocket);

    await fastify.register(authPlugin);
    await fastify.register(authRoutes, { prefix: '/api' });

    await fastify.register(modelsRoutes, { prefix: '/api' });
    await fastify.register(chatRoutes, { prefix: '/api' });
    await fastify.register(conversationsRoutes, { prefix: '/api' });
    await fastify.register(memoriesRoutes, { prefix: '/api' });
    await fastify.register(agentsRoutes, { prefix: '/api' });
    await fastify.register(pluginsRoutes, { prefix: '/api' });
    await fastify.register(channelsRoutes, { prefix: '/api' });
    await fastify.register(notesRoutes, { prefix: '/api' });
    await fastify.register(workflowsRoutes, { prefix: '/api' });
    await fastify.register(calendarRoutes, { prefix: '/api' });

    // Load builtin + local plugins
    const pluginResult = await loadAllPlugins();
    if (pluginResult.errors.length) fastify.log.warn({ errors: pluginResult.errors }, 'Plugin load errors');
    fastify.log.info({ plugins: pluginResult.loaded }, 'Plugins loaded');

    await fastify.listen({ port: Number(process.env.PORT || process.env.API_PORT || 3001), host: '0.0.0.0' });
    fastify.log.info({ ollama: config.ollamaBaseUrl, model: config.ollamaChatModel }, 'API server started');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();