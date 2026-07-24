import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const apiTarget = process.env.VITE_API_URL || 'http://localhost:3001';
const ragTarget = process.env.VITE_RAG_URL || 'http://localhost:3002';

export default defineConfig({
  plugins: [react()],
  root: here,
  build: { outDir: 'dist' },
  server: {
    host: '0.0.0.0',
    port: 3500,
    proxy: {
      '/api': apiTarget,
      '/rag': {
        target: ragTarget,
        rewrite: (p) => p.replace(/^\/rag/, ''),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3500,
    proxy: {
      '/api': apiTarget,
      '/rag': {
        target: ragTarget,
        rewrite: (p) => p.replace(/^\/rag/, ''),
      },
    },
  },
});