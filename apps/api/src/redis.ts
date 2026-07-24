import Redis from 'ioredis';

declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

const url = process.env.REDIS_URL || 'redis://localhost:6379';
const enabled = !!process.env.REDIS_URL || process.env.NODE_ENV !== 'test';

export const redis: Redis | null = enabled
  ? (global.__redis ??
      (() => {
        try {
          const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
          client.on('error', (err) => {
            // eslint-disable-next-line no-console
            console.warn('[redis] connection error:', err.message);
          });
          return client;
        } catch {
          return null;
        }
      })())
  : null;

if (process.env.NODE_ENV !== 'production' && redis) {
  global.__redis = redis;
}

export async function pingRedis(): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.connect?.();
    const res = (await redis.ping()) as string;
    return res === 'PONG';
  } catch {
    return false;
  }
}