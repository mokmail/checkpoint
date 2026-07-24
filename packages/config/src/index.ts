import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const schema = z.object({
  port: z.string().default('3000'),
  env: z.string().default('development'),

  // Ollama (local AI provider)
  ollamaBaseUrl: z.string().url().default('http://localhost:11434'),
  ollamaChatModel: z.string().default('llama3.2:latest'),
  ollamaEmbeddingModel: z.string().default('nomic-embed-text:latest'),

  // Infrastructure
  databaseUrl: z.string().default(''),
  redisUrl: z.string().default('redis://localhost:6379'),
  vectorDbUrl: z.string().default('http://localhost:8000'),

  // Auth
  jwtSecret: z.string().default('your-super-secret-jwt-key'),
});

const parsed = schema.safeParse({
  port: process.env.PORT || process.env.API_PORT,
  env: process.env.NODE_ENV,
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
  ollamaChatModel: process.env.OLLAMA_CHAT_MODEL,
  ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  vectorDbUrl: process.env.VECTOR_DB_URL,
  jwtSecret: process.env.JWT_SECRET,
});

if (!parsed.success) {
  console.error('Invalid config:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const config = parsed.data;

export type Config = typeof config;