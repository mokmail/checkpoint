import winston from 'winston';
import { config } from '@ai-chat/config';
import { ollama } from './providers/ollama.js';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.Console()],
});

interface Job {
  id: string;
  type: 'summarize' | 'embed';
  payload: { text: string; model?: string };
}

const queue: Job[] = [];

export function enqueue(job: Job): void {
  queue.push(job);
  logger.info('Job enqueued', { jobId: job.id, type: job.type });
}

async function processJob(job: Job): Promise<void> {
  logger.info('Processing job', { jobId: job.id, type: job.type });
  if (job.type === 'summarize') {
    const res = await ollama.chat({
      model: job.payload.model ?? config.ollamaChatModel,
      messages: [
        { role: 'system', content: 'Summarize the following text concisely.' },
        { role: 'user', content: job.payload.text },
      ],
    });
    logger.info('Job done', { jobId: job.id, summary: res.content.slice(0, 120) });
  } else if (job.type === 'embed') {
    const res = await ollama.embed({
      model: job.payload.model ?? config.ollamaEmbeddingModel,
      input: job.payload.text,
    });
    logger.info('Job done', { jobId: job.id, dims: res.embeddings[0].length });
  }
}

async function loop(): Promise<void> {
  while (true) {
    const job = queue.shift();
    if (job) {
      try {
        await processJob(job);
      } catch (err) {
        logger.error('Job failed', { jobId: job.id, error: String(err) });
      }
    } else {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

logger.info('Worker started', { ollama: config.ollamaBaseUrl, chatModel: config.ollamaChatModel });
loop().catch((err) => logger.error(String(err)));